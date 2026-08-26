# -*- coding: utf-8 -*-
"""盛时疆域示意层：研核定稿 → 坐标解析 → js/territories.js ＋ 出处档。

四至锚点法（用户 2026-08-21 定）：轮廓由正史/维基的四至**文字**推导，
每个顶点能指回一句引文；不描摹任何历史地图。锚定年切片：y=数据锚定年。
坐标沿用 build_geo 的 Wikidata P625 链路（CC0）；查不到的锚点**跳过并明报**，
绝不手补一个没有出处的坐标。

用法：python tools/mining/build_territories.py <研核输出json>
"""
import io, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_geo import qids, coords, MANUAL  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')


def main():
    src = sys.argv[1]
    data = json.load(io.open(src, encoding='utf-8'))
    rows = data.get('result', data)['rows']
    # 契约 v2「一政权多切片」：同 key 的多行各成一片（唐 668/740 实例），
    # 故收成列表不收字典——旧写法 finals[key]=final 会让后一片吃掉前一片。
    finals = []
    for r in rows:
        if r.get('verdict') in ('过', '改后过') and r.get('final'):
            finals.append(r['final'])
    import re, time

    def variants(name):
        # 剥全/半角括注：「尼古拉耶夫斯克(庙街)」→ 先试全名、再试括外、再试括内
        v = [name]
        m = re.match(r'^([^（(]+)[（(]([^）)]+)[）)]', name)
        if m:
            v += [m.group(1).strip(), m.group(2).strip()]
        return v

    want = sorted({v for f in finals for c in f['corners'] for v in variants(c['place'])})
    qs, cs = {}, {}
    todo = want
    for round_ in range(3):
        if not todo:
            break
        if round_:
            print('  429 重试第 %d 轮（剩 %d），限速歇 30s…' % (round_, len(todo)))
            time.sleep(30)
        got = qids(todo)
        qs.update({k: v for k, v in got.items() if v})
        todo = [t for t in todo if t not in qs]
    cs = coords(sorted(set(qs.values())))
    missing_coords = [q for q in set(qs.values()) if q not in cs]
    if missing_coords:
        time.sleep(20)
        cs.update(coords(missing_coords))

    def pt(title):
        for v in variants(title):
            q = qs.get(v)
            c = cs.get(q) if q else None
            c = c or MANUAL.get(v)
            if c:
                return c
        return None

    out, doc = {}, ['# 盛时疆域示意·出处档（生成物，与 js/territories.js 同源）', '']
    for f in finals:
        key = f['key']
        pts, miss = [], []
        for c in f['corners']:
            co = pt(c['place'])
            (pts.append([round(co[1], 2), round(co[0], 2)]) if co else miss.append(c['place']))
        if len(pts) < 3:
            print('✗ %s 可解析锚点不足（%d），整朝跳过' % (f['name'], len(pts)))
            continue
        snap = {'y': f['peak']['y'], 'span': f['peak']['span'],
                '盛': bool(f['peak'].get('sheng', True)), 'note': f['caveats'], 'pts': pts}
        if key in out:
            out[key]['snaps'].append(snap)
            out[key]['snaps'].sort(key=lambda x: x['y'])
        else:
            out[key] = {'名': f['name'], 'snaps': [snap]}
        print('· %s：%d 锚点%s' % (f['name'], len(pts),
              '，查不到坐标弃 %s' % '、'.join(miss) if miss else ''))
        doc.append('## %s ｜ 锚定年 %s（%s）\n' % (f['name'], f['peak']['y'], f['peak']['span']))
        doc.append('**盛时之据**：%s\n' % f['peak']['basis'])
        doc.append('| 锚点 | 据 |')
        doc.append('|---|---|')
        for c in f['corners']:
            mark = '' if c['place'] not in miss else '（坐标未解析，未入图）'
            doc.append('| %s%s | %s |' % (c['place'], mark, c['basis'].replace('|', '，')))
        doc.append('\n**四至引文**：')
        for q in f['quotes']:
            doc.append('- 「%s」——%s' % (q['text'], q['source'].replace('|', '，')))
        doc.append('\n**示警**：')
        for cv in f['caveats']:
            doc.append('- %s' % cv)
        doc.append('')

    head = io.open(os.path.join(ROOT, 'js/territories.js'), encoding='utf-8').read()
    head = head.split('export const TERR')[0]
    body = 'export const TERR = ' + json.dumps(out, ensure_ascii=False, indent=1) + ';\n'
    io.open(os.path.join(ROOT, 'js/territories.js'), 'w', encoding='utf-8', newline='\n').write(head + body)
    io.open(os.path.join(ROOT, 'docs/geo-territories.md'), 'w', encoding='utf-8', newline='\n').write('\n'.join(doc) + '\n')
    print('写出 js/territories.js：%d 政权；docs/geo-territories.md 出处档' % len(out))


if __name__ == '__main__':
    main()
