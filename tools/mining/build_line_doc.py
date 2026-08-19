# -*- coding: utf-8 -*-
"""把一条故事线导出成可读的资料文本（docs/line-<key>.md）。

线的材料分在三处，读的时候要对着看，故本脚本把它们并到一处：

    js/lines.js            站表与短文案（图上落哪儿、打什么光、面板上那一两句）
    js/line-text-<key>.js  长文（宽屏面板里读的整段散文，含序与落点）
    js/events.js           可核验的数据（年份、类别、所属政权、简注、馆藏页、世遗）

再加第四样：`docs/sources-<key>.json`——长文里那些硬数字（尺寸、件数、工时、
逐字引文、藏品编号）的**逐条核验记录**。有则附在文末，一条一条写明出处与
核验结论；核不出的照写「未能核实」，不替它编一个（本库通例：缺失远好过猜错）。

**生成物，不要手改**：改文案去 js/lines.js，改长文去 js/line-text-<key>.js，
改史实去 js/events.js，改核验记录去 docs/sources-<key>.json，然后重跑。

用法：python tools/mining/build_line_doc.py [key]     # 缺省 shiku
"""
import io, json, os, re, sys

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
BS = chr(92)
STR = r"'((?:[^'" + BS + BS + r"]|" + BS + BS + r".)*)'"
FIELD = r"\b%s:\s*" + STR

KIND = {'war': '战事', 'gov': '制度', 'rev': '民变·政变', 'out': '外患·外交',
        'cul': '文化·科技', 'dis': '灾疫', 'fig': '名人轶事', 'era': '治世·中兴',
        'inst': '制度·交流存续期', 'her': '遗址·建筑', 'art': '文物'}

# 核验结论的排序与记号：先看站不住的，再看没核出的
VERDICT = {'证实': ('✅', 0), '部分': ('◐', 1), '存疑': ('⚠', 2), '未能核实': ('—', 3)}


def unquote(js):
    """把 'a' + 'b' 的续行拼接还原成一整串。"""
    return ''.join(re.findall(STR, js)).replace(BS + "'", "'")


def paras(block):
    """长文的一块 → 段落表。每段一个字符串字面量，可跨行用 + 续。"""
    out, cur = [], ''
    for ln in block.split('\n'):
        t = ln.strip()
        if not t or t.startswith('//'):
            continue
        cur += ''.join(re.findall(STR, t))
        if t.endswith(',') and not t.endswith('+'):
            out.append(cur.replace(BS + "'", "'"))
            cur = ''
    if cur:
        out.append(cur.replace(BS + "'", "'"))
    return [p for p in out if p]


def load_dyn():
    """政权 key → 中文名。文里写「属 ehan」是给机器看的，读者要的是「东汉」。"""
    src = io.open(os.path.join(ROOT, 'js/dynasties.js'), encoding='utf-8').read()
    return {m.group(1): m.group(2) for m in
            re.finditer(r"D\('([a-z_]+)',\s*'([^']+)'", src)}


def load_events():
    src = io.open(os.path.join(ROOT, 'js/events.js'), encoding='utf-8').read()
    out = {}
    for m in re.finditer(r'\{([^{}]*?y:\s*-?\d+[^{}]*?)\},', src):
        b = m.group(1)
        def g(k):
            mm = re.search(FIELD % k, b)
            return mm.group(1) if mm else None
        n = g('n')
        if not n:
            continue
        y2 = re.search(r'y2:\s*(-?\d+)', b)
        u = re.search(r'\bu:\s*(\d+)', b)
        out[n] = {'y': int(re.search(r'y:\s*(-?\d+)', b).group(1)),
                  'y2': int(y2.group(1)) if y2 else None,
                  'k': g('k'), 'w': g('w'), 'b': g('b'), 'd': g('d'),
                  'yc': g('yc'), 'm': g('m'), 'ya': g('ya'),
                  'u': int(u.group(1)) if u else None}
    return out


def load_long(key):
    """js/line-text-<key>.js → (序, {ev: 段落表}, 落点)。文件缺席不算错。"""
    path = os.path.join(ROOT, 'js/line-text-%s.js' % key)
    if not os.path.exists(path):
        return None, {}, None
    src = io.open(path, encoding='utf-8').read()

    def named(const):
        blk = re.search(r'export const %s = \{(.*?)\n\};' % const, src, re.S)
        if not blk:
            return None
        body = blk.group(1)
        t = re.search(r"t:\s*" + STR, body)
        pb = re.search(r'p:\s*\[(.*?)\n  \],', body, re.S)
        return {'t': t.group(1) if t else '', 'p': paras(pb.group(1)) if pb else []}

    text = {}
    tb = re.search(r'export const TEXT = \{(.*?)\n\};', src, re.S)
    if tb:
        # 键有两种写法：裸键 `石鼓:` 与**带引号的** `'孝文帝汉化·迁都洛阳':`——
        # 条目名含「·」「（」一类字符时 JS 不许裸写，必须加引号。
        # 旧正则只认裸键，于是那一站的长文**静悄悄丢掉**，build 只报「无长文的站」
        # 而不说为什么（勘合线实测踩到）。两种都收。
        for m in re.finditer(r"\n  (?:'([^']+)'|\"([^\"]+)\"|([^\s:{}'\"]+)): \[(.*?)\n  \],",
                             tb.group(1), re.S):
            name = m.group(1) or m.group(2) or m.group(3)
            text[name] = paras(m.group(4))
    return named('PROLOGUE'), text, named('EPILOGUE')


def load_line(key):
    src = io.open(os.path.join(ROOT, 'js/lines.js'), encoding='utf-8').read()
    blk = re.search(r"%s:\s*\{(.*?)\n  \}," % key, src, re.S)
    meta = {}
    if blk:
        for f in ('name', 'sub', 'lede'):
            mm = re.search(FIELD % f, blk.group(1))
            meta[f] = mm.group(1) if mm else ''
    # 按 key 找站表，别抓文件里第一个数组——多条线共处一个文件之后，
    # 「第一个」永远是石窟线，赤壁线于是拿到了别人的站（实测踩过）
    m0 = (re.search(r'const %s = \[(.*?)\n\];' % key.upper(), src, re.S)
          or re.search(r'const [A-Z_]+ = \[(.*?)\n\];', src, re.S))
    const = m0.group(1)
    stops = []
    for m in re.finditer(r'\n  \{(.*?)\n  \},', const, re.S):
        body = m.group(1)
        def multi(f):
            mm = re.search(r"%s:\s*((?:%s\s*(?:\+\s*)?)+)" % (f, STR), body)
            return unquote(mm.group(1)) if mm else None
        stops.append({'t': multi('t'), 'b': multi('b'), 'b2': multi('b2'),
                      'ev': multi('ev'), 'links': multi('links')})
    return meta, stops


def load_sources(key):
    """考据与出处：docs/sources-<key>.json（由 extract_shiku_sources.py 抽自原稿）。

    两层并列而不互相覆盖：`站` 是写稿时逐条核过的账（含分级标注），
    `复核` 是事后另派人手独立核的结果。两边打架就两边都摆出来——
    读者自己判，比我替他判可靠。
    """
    path = os.path.join(ROOT, 'docs/sources-%s.json' % key)
    if not os.path.exists(path):
        return {}
    return json.load(io.open(path, encoding='utf-8'))


def yr(y, y2=None):
    f = lambda v: ('前%d' % (-v + 1)) if v <= 0 else str(v)
    return f(y) + ('–' + f(y2) if y2 else '')


def main():
    key = sys.argv[1] if len(sys.argv) > 1 else 'shiku'
    meta, stops = load_line(key)
    ev = load_events()
    dyn = load_dyn()
    pro, long_text, epi = load_long(key)
    srcs = load_sources(key)
    per = srcs.get('站', {})
    recheck = {}
    for r in srcs.get('复核', []):
        recheck.setdefault(r.get('stop', ''), []).append(r)

    L = []
    L.append('# %s · 资料文本' % meta.get('name', key))
    L.append('')
    L.append('> %s' % meta.get('lede', ''))
    L.append('>')
    L.append('> %s。共 %d 站。' % (meta.get('sub', ''), len(stops)))
    L.append('')
    L.append('这份文本把四样并在一处：**长文**出自 `js/line-text-%s.js`（宽屏面板里读的'
             '整段散文），**讲述**出自 `js/lines.js`（站表与短文案），**史实**出自 '
             '`js/events.js`（本库的简注与出处，逐条经维基条目核验），**核验**出自 '
             '`docs/sources-%s.json`（长文里每个硬数字的逐条溯源）。'
             '图上走这条线：`timeline.html#line=%s`。' % (key, key, key))
    L.append('')
    nk = sum(len(v.get('考据', [])) for v in per.values())
    nl = sum(len(v.get('出处', [])) for v in per.values())
    nr = sum(len(v) for v in recheck.values())
    if nk or nr:
        bits = []
        if nk:
            bits.append('原稿考据 %d 条、出处链接 %d 条' % (nk, nl))
        if nr:
            tally = {}
            for rs in recheck.values():
                for r in rs:
                    v = r.get('verdict', '未能核实')
                    tally[v] = tally.get(v, 0) + 1
            bits.append('独立复核 %d 条（%s）' % (nr, '、'.join(
                '%s %d' % (k, tally[k]) for k in sorted(tally, key=lambda x: VERDICT.get(x, ('', 9))[1]))))
        L.append('考据合计：%s。逐条见每站末尾的「考据与出处」。' % '，'.join(bits))
        L.append('')
    L.append('---')
    L.append('')

    def block(sec):
        if not sec or not sec['p']:
            return
        L.append('## %s' % sec['t'])
        L.append('')
        for p in sec['p']:
            L.append(p)
            L.append('')
        L.append('---')
        L.append('')

    def sources_of(name):
        rec = per.get(name) or {}
        kao, lnk, quo = rec.get('考据', []), rec.get('出处', []), rec.get('引文', [])
        chk = recheck.get(name) or []
        if not (kao or lnk or quo or chk):
            return
        L.append('<details><summary>考据与出处</summary>')
        L.append('')
        cell = lambda t: (t or '').replace('|', '｜').replace(chr(10), ' ')
        if quo:
            for q in quo:
                L.append('> 「%s」%s' % (q['文'], ('　——' + q['出处']) if q.get('出处') else ''))
                L.append('')
        if kao:
            L.append('| 级别 | 条目 |')
            L.append('|---|---|')
            for k in kao:
                L.append('| %s | %s |' % (cell(k.get('级')), cell(k.get('文'))))
            L.append('')
        if chk:
            chk = sorted(chk, key=lambda r: VERDICT.get(r.get('verdict', ''), ('', 9))[1])
            ok = [r for r in chk if r.get('verdict') == '证实']
            chk = [r for r in chk if r.get('verdict') != '证实']
            L.append('独立复核（另派人手事后重查，与上表并列）：本站核 %d 条，'
                     '其中 %d 条证实（不逐条列），余下这些读的时候请留意——'
                     % (len(ok) + len(chk), len(ok)))
            L.append('')
            if not chk:
                L.append('（本站无待留意者。）')
                L.append('')
            L.append('| 断言 | 结论 | 出处 | 备注 |')
            L.append('|---|---|---|---|')
            for r in chk:
                mark = VERDICT.get(r.get('verdict', ''), ('', 9))[0]
                title, url = r.get('source_title', ''), r.get('source_url', '')
                cite = '[%s](%s)' % (title, url) if url else (title or '—')
                L.append('| %s | %s %s | %s | %s |'
                         % (cell(r.get('claim')), mark, r.get('verdict', ''),
                            cell(cite), cell(r.get('note')) or '—'))
            L.append('')
        if lnk:
            L.append('出处：' + '　'.join('[%s](%s)' % (x['题'], x['url']) for x in lnk))
            L.append('')
        L.append('</details>')
        L.append('')

    block(pro)
    sources_of('序')

    miss = []
    for i, s in enumerate(stops, 1):
        e = ev.get(s['ev'] or '')
        L.append('## %d. %s' % (i, s['t']))
        L.append('')
        long_p = long_text.get(s['ev'] or '')
        if long_p:
            for p in long_p:
                L.append(p)
                L.append('')
            # 短文案照录：手机上读到的就是这两句，与长文并非同一段话
            L.append('<details><summary>窄屏文案（手机上读到的版本）</summary>')
            L.append('')
            L.append('**%s**%s' % (s['b'], s.get('b2') or ''))
            L.append('')
            L.append('</details>')
            L.append('')
        else:
            L.append('**%s**' % s['b'])
            L.append('')
            if s.get('b2'):
                L.append(s['b2'])
                L.append('')
        if not e:
            miss.append(s['ev'])
            L.append('*（图上落点未对上：%s）*' % s['ev'])
            L.append('')
            continue
        bits = ['%s 年' % yr(e['y'], e['y2']), KIND.get(e['k'], e['k'])]
        if e.get('d'):
            bits.append(dyn.get(e['d'], e['d']))
        L.append('图上落点：**%s**（%s）' % (s['ev'], ' · '.join(bits)))
        L.append('')
        if e.get('yc'):
            L.append('> 本库简注：%s' % e['yc'])
            L.append('')
        links = []
        if e.get('w'):
            links.append('[中文维基 · %s](https://zh.wikipedia.org/wiki/%s)' % (e['w'], e['w']))
        if e.get('m'):
            links.append('[馆藏／专题页](%s)' % e['m'])
        # u 是**列入年份**，不是遗产编号（编号得另查 whc）——照编号拼 URL
        # 会指到别人家去，故只作一句陈述，链接留给已有的 m 字段
        if e.get('u'):
            links.append('世界遗产（%d 年列入）' % e['u'])
        if links:
            L.append('　'.join(links))
            L.append('')
        sources_of(s['ev'])
        L.append('---')
        L.append('')

    block(epi)
    sources_of('落点')

    L.append('## 关于这条线')
    L.append('')
    L.append('站点全部取自库内既有条目，没有为这条线新造史实。文案守两条：'
             '**可减不可加**（不新增任何数字或说法），以及**缺失远好过猜错**。')
    L.append('')
    if nk:
        L.append('长文出自 `docs/line-shiku-craft.md` 那份纪录片叙事稿（叙事契约 → 幕表 → '
                 '解说词），考据随文写就而非事后补。分级照原稿：**信史**有史料支撑，'
                 '**传统叙述**是后世追记，**补研究**是为这条线新查的，**推断**是现代学者的重建，'
                 '**存疑**是各源不一致。凡各源打架的数字，原稿的做法是**一个都不给**'
                 '——这正是本库「缺失远好过猜错」在文本层的样子。')
        L.append('')
    if nr:
        L.append('另有独立复核一栏：写稿之外另派人手把硬数字重查一遍，结论四档'
                 '（✅ 证实、◐ 部分、⚠ 存疑、— 未能核实）。**核不出的照写「未能核实」，'
                 '不替它补一个出处**；两栏打架时两边都摆出来，不替读者判。')
        L.append('')
    L.append('每站另可挂一条手挑的视频或深度链接，征集单见 `docs/video-brief.md`；'
             '回填后由 `tools/mining/ingest_video_links.py` 核验入库。')
    L.append('')
    path = os.path.join(ROOT, 'docs/line-%s.md' % key)
    io.open(path, 'w', encoding='utf-8', newline='\n').write('\n'.join(L))
    print('写出 %s：%d 站，%d 段长文，%d 条核验，%d 字'
          % (path, len(stops), sum(len(v) for v in long_text.values()), nk + nr, len('\n'.join(L))))
    if miss:
        print('  ⚠ 未对上的落点：', miss)
    nolong = [s['ev'] for s in stops if s['ev'] and s['ev'] not in long_text]
    if nolong:
        print('  · 无长文的站：', nolong)


if __name__ == '__main__':
    main()
