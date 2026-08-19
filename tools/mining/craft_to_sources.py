# -*- coding: utf-8 -*-
"""把纪录片叙事稿里的考据抽成 docs/sources-<key>.json。

石窟线的原稿是一页 HTML（考据折在每节末尾），赤壁线起就统一走 Markdown
叙事稿：正文挂标记〔S4〕〔存疑 · S2〕，文末挂出处表。两种形态的抽取脚本
因此分开——本脚本管 Markdown 那种，也就是往后所有线。

标记与表的分工照 documentary-narrative skill 的规矩：
  · 正文标记只写编号与档次（信史不标，只标传统叙述／学者推断／存疑等）
  · 出处表写「这个编号支撑的是哪句话、依据是什么、来源在哪」

产出的 JSON 与石窟线同构，故 build_line_doc.py 与 build_line_page.py 不用改：
  站 → {考据: [{级, 文}], 出处: [{题, url}], 引文: [{文, 出处}]}
「复核」栏留给事后独立重查（merge_recheck.py），本脚本不碰。

用法：python tools/mining/craft_to_sources.py <key>
读：docs/line-<key>-craft.md　写：docs/sources-<key>.json
"""
import io, json, os, re, sys

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
MARK = re.compile(r'〔([^〕]+)〕')                       # 〔S4〕/〔存疑 · S2〕
ROW = re.compile(r'^\|\s*(S\d+)\s*\|(.+?)\|(.+?)\|(.+?)\|\s*$', re.M)
URL = re.compile(r'https?://[^\s|）)]+')
# 以「起、以」讫的整段是引文；紧随其后的一段若以「出」「见」起头，视为它的出处
QUOTE = re.compile(r'^「(.+)」$')


def main():
    key = sys.argv[1] if len(sys.argv) > 1 else 'chibi'
    src = os.path.join(ROOT, 'docs/line-%s-craft.md' % key)
    out = os.path.join(ROOT, 'docs/sources-%s.json' % key)
    md = io.open(src, encoding='utf-8').read()

    # ── 出处表：S 编号 → 依据、来源、日期 ────────────────────────────
    table = {}
    for m in ROW.finditer(md):
        sid, basis, where, date = (x.strip() for x in m.groups())
        table[sid] = {'依据': basis, '来源': where, '日期': date,
                      'urls': URL.findall(where)}

    # ── 解说词：每站的标记 ──────────────────────────────────────────
    body = md.split('## 三、解说词', 1)[1].split('## 四、出处表', 1)[0]
    stops, order = {}, []
    cur = None
    for chunk in re.split(r'\n### ', body):
        if not chunk.strip():
            continue
        head, _, rest = chunk.partition('\n')
        # 「① 隆中对 · 207 · 一场还没发生的战争」→ 隆中对；「序 · 三十个字」→ 序
        parts = [p.strip() for p in head.split('·')]
        name = re.sub(r'^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]\s*', '', parts[0]).strip()
        cur = name
        order.append(name)
        rec = {'考据': [], '出处': [], '引文': []}
        seen = set()
        for tag in MARK.findall(rest):
            bits = [b.strip() for b in tag.split('·')]
            sid = next((b for b in bits if re.fullmatch(r'S\d+', b)), None)
            lvl = next((b for b in bits if not re.fullmatch(r'S\d+', b)), '信史')
            if not sid or sid in seen:
                continue
            seen.add(sid)
            t = table.get(sid)
            if not t:
                print('  ⚠ 正文有 %s，出处表里没有' % sid)
                continue
            rec['考据'].append({'级': lvl, '文': t['依据']})
            for u in t['urls']:
                title = re.sub(r'https?://\S+', '', t['来源']).strip(' ；;，,')[:60] or sid
                if not any(x['url'] == u for x in rec['出处']):
                    rec['出处'].append({'题': title, 'url': u})
        # 引文：整段「…」，其出处从同站的考据里按字面找
        for line in rest.split('\n'):
            q = QUOTE.match(line.strip())
            if not q:
                continue
            frag = q.group(1)[:12]
            hit = next((k['文'] for k in rec['考据'] if frag[:6] in k['文']), '')
            rec['引文'].append({'文': q.group(1), '出处': hit})
        stops[name] = rec

    keep = []
    if os.path.exists(out):
        try:
            keep = json.load(io.open(out, encoding='utf-8')).get('复核', [])
        except Exception:
            keep = []
    data = {
        '说明': ('%s长文的考据与出处，抽自 docs/line-%s-craft.md'
                 '（documentary-narrative skill 的叙事稿）。正文标记〔S#〕与文末出处表'
                 '一一对应，考据随文写就而非事后补。「复核」一节留给事后独立重查。'
                 % (key, key)),
        '顺序': order, '站': stops, '复核': keep,
    }
    io.open(out, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(data, ensure_ascii=False, indent=1))
    nk = sum(len(v['考据']) for v in stops.values())
    nl = sum(len(v['出处']) for v in stops.values())
    nq = sum(len(v['引文']) for v in stops.values())
    print('写出 %s：%d 站，考据 %d 条，出处链接 %d 条，引文 %d 条（出处表共 %d 条）'
          % (out, len(stops), nk, nl, nq, len(table)))
    unused = sorted(set(table) - {s for v in stops.values() for s in []} , key=lambda x: int(x[1:]))
    used = set()
    for chunk in re.split(r'\n### ', body):
        used |= {b.strip() for tag in MARK.findall(chunk) for b in tag.split('·')
                 if re.fullmatch(r'S\d+', b.strip())}
    idle = sorted(set(table) - used, key=lambda x: int(x[1:]))
    if idle:
        print('  · 出处表里未被正文引用的编号：', idle)
    for k in order:
        v = stops[k]
        print('  %-8s 考据%2d 出处%2d 引文%d' % (k, len(v['考据']), len(v['出处']), len(v['引文'])))


if __name__ == '__main__':
    main()
