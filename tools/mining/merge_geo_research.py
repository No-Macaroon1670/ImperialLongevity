# -*- coding: utf-8 -*-
"""把 agent 查回来的地点链并进 js/events.js 的 `p` 与 js/dynasties.js 的 `cap`。

输入是 Workflow 的产出 JSON（`rows` 里每条形如
`{name, kind, points:[{place, role, primary, low, basis}], note}`），
输出是照 docs/geo-model.md 写法的字段：

    p: ['寿县:战*']
    cap: ['南京市:都', '北京市:迁*']

**只补空缺，不覆盖已有的。** 手写过的那几条是有人看过的，机器不该动它。

三道闸，任一条不过就跳过并列进报告——**宁可少并一条，也不要并进一条坏的**：
  · 角色必须在 docs/geo-model.md 的角色表里
  · 主点必须恰好一个
  · 条目名必须在库里对得上（agent 抄错名字的，宁可漏掉也不硬猜）

坐标不在这一步查——那是 build_geo_events.py 的活，它查不到会报错，
届时再回来改地名。这一步只管把判断落成字。

用法：python tools/mining/merge_geo_research.py <产出.json> [<产出.json> …]
"""
import io, json, os, re, sys

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
ROLES = set('生 显 卒 葬 贬 行 造 立 发 现 址 战 起 都 迁 说 灾 颁'.split())


def token(p):
    """{place, role, primary, low} → '地名:角色*~'"""
    return '%s:%s%s%s' % (p['place'], p['role'], '*' if p.get('primary') else '',
                          '~' if p.get('low') else '')


def vet(row):
    """返回 (地名串列表, 跳过的理由)。理由为 None 即通过。"""
    if row.get('kind') == 'none' or not row.get('points'):
        return None, '无地'
    pts = row['points']
    bad = [p['role'] for p in pts if p.get('role') not in ROLES]
    if bad:
        return None, '角色不在表里：%s' % '、'.join(bad)
    n = sum(1 for p in pts if p.get('primary'))
    if n != 1:
        return None, '主点 %d 个（应当恰好一个）' % n
    if any(':' in p['place'] or "'" in p['place'] for p in pts):
        return None, '地名里有冒号或引号，会把编码打乱'
    return [token(p) for p in pts], None


def load_rows(paths):
    rows = []
    for p in paths:
        d = json.load(io.open(p, encoding='utf-8'))
        # Workflow 的产出可能整个是结果，也可能包在 {result: …} 里
        for cand in (d, d.get('result') if isinstance(d, dict) else None):
            if isinstance(cand, dict) and isinstance(cand.get('rows'), list):
                rows += cand['rows']
                break
    # 同名以后到的为准（复核过的排在后面）
    out = {}
    for r in rows:
        if isinstance(r, dict) and r.get('name'):
            out[r['name']] = r
    return out


def patch_events(rows, report):
    path = os.path.join(ROOT, 'js/events.js')
    s = io.open(path, encoding='utf-8').read()
    names = set(re.findall(r"n: '([^']+)'", s))
    done = 0
    for name, row in sorted(rows.items()):
        if name not in names:
            continue
        toks, why = vet(row)
        if why:
            report.setdefault(why, []).append(name)
            continue
        anchor = "n: '%s'," % name
        if s.count(anchor) != 1:
            report.setdefault('条目名在库里不唯一或对不上', []).append(name)
            continue
        i = s.index(anchor)
        # 已经有 p 的不动：手写过的是有人看过的
        tail = s[i:i + 400]
        if re.match(r"n: '[^']+', p: ", tail):
            report.setdefault('已有 p，跳过', []).append(name)
            continue
        lit = 'p: [%s], ' % ', '.join("'%s'" % t for t in toks)
        s = s[:i + len(anchor) + 1] + lit + s[i + len(anchor) + 1:]
        done += 1
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s)
    return done


def patch_dynasties(rows, report):
    path = os.path.join(ROOT, 'js/dynasties.js')
    s = io.open(path, encoding='utf-8').read()
    head = s.find('export const DYNASTIES')
    tail = s.find('export const SUCCESSION')
    body = s[head:tail]

    # 政权名 → 该 D(...) 在 body 里的起点。重名的一律不动
    starts = {}
    dup = set()
    for m in re.finditer(r"D\('([a-z0-9_]+)',\s*'([^']+)'", body):
        nm = m.group(2)
        if nm in starts:
            dup.add(nm)
        starts[nm] = m.start()
    done = 0
    for name, row in sorted(rows.items()):
        if name not in starts:
            continue
        if name in dup:
            report.setdefault('政权重名，未动', []).append(name)
            continue
        toks, why = vet(row)
        if why:
            report.setdefault(why, []).append(name)
            continue
        i = starts[name]
        # 找这一条 D(...) 的范围：从 D( 起数括号
        depth, j = 0, i
        while j < len(body):
            if body[j] == '(':
                depth += 1
            elif body[j] == ')':
                depth -= 1
                if depth == 0:
                    break
            j += 1
        seg = body[i:j + 1]
        if 'cap: [' in seg:
            report.setdefault('已有 cap，跳过', []).append(name)
            continue
        lit = 'cap: [%s]' % ', '.join("'%s'" % t for t in toks)
        k = seg.find('{')
        if k >= 0:
            new = seg[:k + 1] + ' ' + lit + ',' + seg[k + 1:]
        else:
            new = seg[:-1] + ', { ' + lit + ' }' + seg[-1]
        body = body[:i] + new + body[j + 1:]
        # 长度变了，后面的起点全部失效，重新扫一遍
        starts = {}
        dup = set()
        for m in re.finditer(r"D\('([a-z0-9_]+)',\s*'([^']+)'", body):
            nm = m.group(2)
            if nm in starts:
                dup.add(nm)
            starts[nm] = m.start()
        done += 1
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s[:head] + body + s[tail:])
    return done


def main():
    if len(sys.argv) < 2:
        sys.exit('用法：python tools/mining/merge_geo_research.py <产出.json> …')
    rows = load_rows(sys.argv[1:])
    print('读到 %d 条（同名取后到的）' % len(rows))
    report = {}
    ne = patch_events(rows, report)
    nd = patch_dynasties(rows, report)
    print('并进 events.js %d 条、dynasties.js %d 条' % (ne, nd))
    for why, names in sorted(report.items()):
        print('  · %s（%d）：%s' % (why, len(names), '、'.join(names[:14])
                                   + (' …' if len(names) > 14 else '')))
    left = [n for n in rows if n not in set(re.findall(
        r"n: '([^']+)'", io.open(os.path.join(ROOT, 'js/events.js'), encoding='utf-8').read()))]
    dnames = set(re.findall(r"D\('[a-z0-9_]+',\s*'([^']+)'",
                            io.open(os.path.join(ROOT, 'js/dynasties.js'), encoding='utf-8').read()))
    orphan = [n for n in left if n not in dnames]
    if orphan:
        print('  · **库里没有这个名字**（%d）：%s' % (len(orphan), '、'.join(orphan[:20])))


if __name__ == '__main__':
    main()
