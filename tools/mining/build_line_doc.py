# -*- coding: utf-8 -*-
"""把一条故事线导出成可读的资料文本（docs/line-<key>.md）。

线的文案在 js/lines.js，站点落到的事件在 js/events.js——两处各管一半：
前者是策展的讲述，后者是可核验的数据（年份、类别、所属政权、简注、馆藏页、
世界遗产编号）。读的时候要两边对着看，故本脚本把它们并到一处。

**生成物，不要手改**：改文案去 js/lines.js，改史实去 js/events.js，然后重跑。

用法：python tools/mining/build_line_doc.py [key]     # 缺省 shiku
"""
import io, json, os, re, sys

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
BS = chr(92)
FIELD = r"\b%s:\s*'((?:[^'" + BS + BS + r"]|" + BS + BS + r".)*)'"

KIND = {'war': '战事', 'gov': '制度', 'rev': '民变·政变', 'out': '外患·外交',
        'cul': '文化·科技', 'dis': '灾疫', 'fig': '名人轶事', 'era': '治世·中兴',
        'inst': '制度·交流存续期', 'her': '遗址·建筑', 'art': '文物'}


def unquote(js):
    """把 lines.js 里 'a' + 'b' 的续行拼接还原成一整串。"""
    return ''.join(re.findall(r"'((?:[^'" + BS + BS + r"]|" + BS + BS + r".)*)'", js)) \
        .replace(BS + "'", "'")


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


def load_line(key):
    src = io.open(os.path.join(ROOT, 'js/lines.js'), encoding='utf-8').read()
    # 线的元信息
    blk = re.search(r"%s:\s*\{(.*?)\n  \}," % key, src, re.S)
    meta = {}
    if blk:
        for f in ('name', 'sub', 'lede'):
            mm = re.search(FIELD % f, blk.group(1))
            meta[f] = mm.group(1) if mm else ''
    # 站表：按 { ... }, 逐块切
    const = re.search(r'const [A-Z_]+ = \[(.*?)\n\];', src, re.S).group(1)
    stops = []
    for m in re.finditer(r'\n  \{(.*?)\n  \},', const, re.S):
        body = m.group(1)
        def multi(f):
            mm = re.search(r"%s:\s*((?:'(?:[^'%s]|%s.)*'\s*(?:\+\s*)?)+)" % (f, BS + BS, BS + BS), body)
            return unquote(mm.group(1)) if mm else None
        stops.append({'t': multi('t'), 'b': multi('b'), 'b2': multi('b2'),
                      'ev': multi('ev'), 'links': multi('links')})
    return meta, stops


def yr(y, y2=None):
    f = lambda v: ('前%d' % (-v + 1)) if v <= 0 else str(v)
    return f(y) + ('–' + f(y2) if y2 else '')


def main():
    key = sys.argv[1] if len(sys.argv) > 1 else 'shiku'
    meta, stops = load_line(key)
    ev = load_events()
    dyn = load_dyn()
    L = []
    L.append('# %s · 资料文本' % meta.get('name', key))
    L.append('')
    L.append('> %s' % meta.get('lede', ''))
    L.append('>')
    L.append('> %s。共 %d 站。' % (meta.get('sub', ''), len(stops)))
    L.append('')
    L.append('这份文本把两半并在一处：**讲述**出自 `js/lines.js`（策展文案，'
             '经 avoid-ai-writing 审过一轮），**史实**出自 `js/events.js`'
             '（本库的简注与出处，逐条经维基条目核验）。图上走这条线：'
             '`timeline.html#line=%s`。' % key)
    L.append('')
    L.append('---')
    L.append('')
    miss = []
    for i, s in enumerate(stops, 1):
        e = ev.get(s['ev'] or '')
        L.append('## %d. %s' % (i, s['t']))
        L.append('')
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
        L.append('---')
        L.append('')
    L.append('## 关于这条线')
    L.append('')
    L.append('站点全部取自库内既有条目，没有为这条线新造史实。文案守两条：'
             '**可减不可加**（不新增任何数字或说法），以及**缺失远好过猜错**。')
    L.append('')
    L.append('每站另可挂一条手挑的视频或深度链接，征集单见 `docs/video-brief.md`；'
             '回填后由 `tools/mining/ingest_video_links.py` 核验入库。')
    L.append('')
    path = os.path.join(ROOT, 'docs/line-%s.md' % key)
    io.open(path, 'w', encoding='utf-8', newline='\n').write('\n'.join(L))
    print('写出 %s：%d 站，%d 字' % (path, len(stops), len('\n'.join(L))))
    if miss:
        print('  ⚠ 未对上的落点：', miss)


if __name__ == '__main__':
    main()
