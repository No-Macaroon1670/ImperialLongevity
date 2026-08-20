# -*- coding: utf-8 -*-
"""把库内条目与政权的地点做成 js/geo-events.js、js/geo-dynasties.js。

模型见 docs/geo-model.md。一句话：**一条目记全部地方，图上只出主点**，
点选才展开链。

两路来源，可信度不一样，故分开标：

  `p` 手工   条目里手写的 `p`（政权是 `cap`），写的是**地名不是坐标**，
             带角色与两个记号：`地名:角色`，`*` 主点，`~` 低置信。
             地名是策展判断（落出土地还是现藏地，由人定），坐标是事实
             （从 wiki 抓，不手打）。这与本项目「选图是策展判断、
             许可与署名从 Commons 抓」是同一条分界。

  `w` 自动   条目本身的维基页带 P625 主坐标。只有「遗址·建筑」一类靠得住：
             实测 69 条命中 56（81%），而文物 159 条只命中 5、战事 103 条命中 0
             ——文物条目的维基页讲的是**器**不是**地**。故自动那一路里
             非遗址类一律标成低置信：坐标是从条目页顺手拿的，没人核过
             它是不是这件事发生的地方。

`p` 优先于自动：手写的那个是有人看过的。

每个地名必须实测能解析——解析不出的**不许留在数据里**，脚本报错退出。

用法：python tools/mining/build_geo_events.py
读：js/events.js、js/dynasties.js、docs/geo-events-probe.json
写：js/geo-events.js、js/geo-dynasties.js
"""
import io, json, os, re, sys, time
import urllib.parse, urllib.request, urllib.error

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
UA = {"User-Agent": "ImperialLongevity-geo/1.0 (github.com/No-Macaroon1670/ImperialLongevity)"}
BBOX = [73.0, 18.0, 135.0, 50.0]        # 与 js/basemap.js 一致：西 南 东 北

# 角色表，见 docs/geo-model.md。不在表里的一律报错——错字会静悄悄变成新角色
ROLES = set('生 显 卒 葬 贬 行 造 立 发 现 址 战 起 都 迁 陪 说 灾 颁'.split())


def get(url, tries=8):
    """取一次 API。**退不出去就抛**，不返回 None。

    上一版取尽重试后 `return None`，调用方写的是 `if not d: break`——
    于是一批 50 个标题里，限流打断的那一批剩下的全部静悄悄没有，
    看上去跟「这些条目没坐标」一模一样。实测因此丢掉京师大学堂、开平碉楼；
    更要命的是同一个函数还在解析手写的 `p` 地名，那边一丢就报
    「这些 p 地名解析不出坐标」——一条假错误，会逼人去改本来没问题的数据。
    """
    wait = 2
    for a in range(tries):
        try:
            return json.load(urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=60))
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503) or a == tries - 1:
                raise
            time.sleep(wait); wait = min(wait * 2, 60)
        except (urllib.error.URLError, TimeoutError):
            if a == tries - 1:
                raise
            time.sleep(wait); wait = min(wait * 2, 60)
    raise RuntimeError('取不到：%s' % url)


def _wikidata_fallback(titles, pace=0.5, host='zh.wikipedia.org'):
    """条目名 → (lat, lon)，绕 Wikidata 的 P625。

    zhwiki 的 `prop=coordinates` 读的是条目正文里的 `{{coord}}` 模板，**有条目
    不等于有那个模板**：寿县、宾大博物馆的坐标标成了非主坐标，国立故宫博物院
    压根没写在正文里、只在 Wikidata 上。三个都因此解析不出来，看上去像
    「这地方没坐标」——其实是找错了地方。故留这条兜底。

    只给前一路漏掉的那几个用：Wikidata 的 wbgetentities 吃 429 吃得很快，
    全量走它会被限流，实测过。
    """
    out = {}
    titles = list(dict.fromkeys(titles))
    qs = {}
    for i in range(0, len(titles), 20):
        ch = titles[i:i + 20]
        d = get('https://' + host + '/w/api.php?action=query&format=json&formatversion=2'
                '&redirects=1&prop=pageprops&ppprop=wikibase_item&titles='
                + urllib.parse.quote('|'.join(ch)))
        q = d['query']
        norm = {x['from']: x['to'] for x in q.get('normalized', [])}
        redir = {x['from']: x['to'] for x in q.get('redirects', [])}
        page = {p['title']: p for p in q['pages']}
        for c in ch:
            x = redir.get(norm.get(c, c), norm.get(c, c))
            qid = (page.get(x, {}).get('pageprops') or {}).get('wikibase_item')
            if qid:
                qs[c] = qid
        time.sleep(pace)
    ids = list(dict.fromkeys(qs.values()))
    pos = {}
    for i in range(0, len(ids), 40):
        d = get('https://www.wikidata.org/w/api.php?action=wbgetentities&format=json'
                '&props=claims&ids=' + '|'.join(ids[i:i + 40]))
        for qid, ent in (d.get('entities') or {}).items():
            cl = ((ent.get('claims') or {}).get('P625') or [])
            v = cl[0].get('mainsnak', {}).get('datavalue', {}).get('value', {}) if cl else {}
            if 'latitude' in v:
                pos[qid] = (round(v['latitude'], 4), round(v['longitude'], 4))
        time.sleep(pace)
    for name, qid in qs.items():
        if qid in pos:
            out[name] = pos[qid]
    return out


def _fetch_coords(titles, host, pace=0.4, chunk=50, log=None, fallback=True):
    """zhwiki 条目名 → (lat, lon)。取不到的不进结果，由调用方决定怎么办。

    **本项目取维基坐标只此一处**。写过两遍，第二遍（一次性的覆盖率探测）
    把坐标按重定向之后的标题存、按之前的名字查，于是 8 条重定向条目
    （大足石刻、西湖、泉州港、黑石号…）全部丢失，还让我据此下了个错结论。
    故此后一律 import 这个函数，不许再抄一份。

    三处坑，都是实测踩出来的：
      · `colimit` 默认只有 10。一批 50 个标题只回前 10 条坐标，其余静悄悄没有
        ——不是「没坐标」，是「没返回」（天龙山石窟排第 11 位，单查有、批量无）。
      · 就算给了 max 也可能分页，故 `cocontinue` 要跟到底。
      · **按调用方给的原名存**（`out[c]`），不要按重定向后的标题存。
    """
    out = {}
    titles = list(dict.fromkeys(t for t in titles if t))
    for i in range(0, len(titles), chunk):
        ch = titles[i:i + chunk]
        cont = None
        while True:
            u = ('https://%s/w/api.php?action=query&format=json'
                 '&formatversion=2&redirects=1&prop=coordinates&coprimary=primary'
                 '&colimit=max&titles=' % host
                 + urllib.parse.quote('|'.join(ch)))
            if cont:
                u += '&cocontinue=' + urllib.parse.quote(cont)
            d = get(u)
            q = d['query']
            norm = {x['from']: x['to'] for x in q.get('normalized', [])}
            redir = {x['from']: x['to'] for x in q.get('redirects', [])}
            page = {pg['title']: pg for pg in q['pages']}
            for c in ch:
                x = redir.get(norm.get(c, c), norm.get(c, c))
                co = (page.get(x, {}).get('coordinates') or [{}])[0]
                if 'lat' in co and c not in out:
                    out[c] = (round(co['lat'], 4), round(co['lon'], 4))
            cont = (d.get('continue') or {}).get('cocontinue')
            if not cont:
                break
            time.sleep(pace)
        if log:
            log(min(i + chunk, len(titles)), len(titles), len(out))
        time.sleep(pace)
    miss = [t for t in titles if t not in out]
    if miss and fallback:
        # 第二遍：Wikidata P625——**先于**非主坐标盲取。旧序先盲取
        # coordinates[0]：北京市条目六条坐标全非主，第一条是东北市界极点，
        # 偏出城区约一百三十公里，金元明清四朝主点跟着钉错（陪都终审实测抓出）；
        # P625 是单点canonical，可信得多，P625 也没有的才轮到盲取
        out.update(_wikidata_fallback(miss, pace=pace, host=host))
        miss2 = [t for t in miss if t not in out]
        # 第三遍：非主坐标盲取（寿县、宾大博物馆当年即此路）
        for i in range(0, len(miss2), chunk):
            ch = miss2[i:i + chunk]
            d = get('https://%s/w/api.php?action=query&format=json'
                    '&formatversion=2&redirects=1&prop=coordinates&coprimary=all'
                    '&colimit=max&titles=' % host
                    + urllib.parse.quote('|'.join(ch)))
            q = d['query']
            norm = {x['from']: x['to'] for x in q.get('normalized', [])}
            redir = {x['from']: x['to'] for x in q.get('redirects', [])}
            page = {pg['title']: pg for pg in q['pages']}
            for c in ch:
                x = redir.get(norm.get(c, c), norm.get(c, c))
                co = (page.get(x, {}).get('coordinates') or [{}])[0]
                if 'lat' in co:
                    out[c] = (round(co['lat'], 4), round(co['lon'], 4))
            time.sleep(pace)
        still = [t for t in miss2 if t not in out]
        # 第四遍：拿全文检索找正题。zhwiki 的繁简变体不是重定向——
        # 「南汉山城」是缺页，「南漢山城」才有坐标。`converttitles` 实测不管用，
        # 检索管用。**只认字数相同的结果**，免得检索把「寿县」找成别的地方；
        # 换过的名字全部打出来，好让人回去核
        left = [t for t in still if t not in out]
        for t in left:
            d = get('https://%s/w/api.php?action=query&format=json'
                    '&formatversion=2&list=search&srlimit=3&srsearch=' % host
                    + urllib.parse.quote(t))
            for hit in (d.get('query') or {}).get('search') or []:
                title = hit['title']
                if len(title) != len(t):
                    continue
                got = _fetch_coords([title], host, pace=pace, fallback=False)
                if not got:
                    got = _wikidata_fallback([title], pace=pace, host=host)
                if got:
                    out[t] = list(got.values())[0]
                    print('  · 「%s」查不到，检索到正题「%s」，用它' % (t, title))
                    break
            time.sleep(pace)
    return out


def coords_of(titles, pace=0.4, chunk=50, log=None, fallback=True):
    """zhwiki/enwiki 条目名 → (lat, lon)。`en:` 前缀走英文维基（约定见 events.js 抬头）：
    流散在外的东西常常只有英文条目，记录在谁手里、条目就在谁的语言里。
    返回的键**保留调用方给的原样**（含前缀），调用方不用关心分流。"""
    titles = list(dict.fromkeys(t for t in titles if t))
    zh = [t for t in titles if not t.startswith('en:')]
    en = [t[3:] for t in titles if t.startswith('en:')]
    out = _fetch_coords(zh, 'zh.wikipedia.org', pace, chunk, log, fallback) if zh else {}
    if en:
        got = _fetch_coords(en, 'en.wikipedia.org', pace, chunk, None, fallback)
        for k, v in got.items():
            out['en:' + k] = v
    return out


# ── 读 ────────────────────────────────────────────────────────────────────

TOKEN = re.compile(r'^(.+?):([^:]+)$')


def parse_chain(items, who):
    """['寿县:战*', '涿鹿县:战~'] → [{名,角,主,约}]。写错就报错，不猜。"""
    out = []
    for it in items:
        m = TOKEN.match(it)
        if not m:
            sys.exit('✗ %s 的落点「%s」没写角色。格式是 地名:角色，见 docs/geo-model.md'
                     % (who, it))
        place, tag = m.group(1).strip(), m.group(2).strip()
        primary, low = '*' in tag, '~' in tag
        role = tag.replace('*', '').replace('~', '').strip()
        if role not in ROLES:
            sys.exit('✗ %s 的落点「%s」角色「%s」不在角色表里，见 docs/geo-model.md'
                     % (who, it, role))
        out.append({'名': place, '角': role, '主': primary, '约': low})
    n = sum(1 for x in out if x['主'])
    if n != 1:
        sys.exit('✗ %s 有 %d 个主点（`*`），应当恰好一个' % (who, n))
    if out and out[0]['角'] == '陪':
        sys.exit('✗ %s 的链以陪都开头——陪都要跟在它所属正都之后' % who)
    return out


def load_events():
    src = io.open(os.path.join(ROOT, 'js/events.js'), encoding='utf-8').read()
    body = src[src.find('export const EVENTS'):]
    evs = []
    for m in re.finditer(r"\{ y: (-?\d+),(.*?)\},\n", body, re.S):
        b = m.group(2)
        def f(k):
            mm = re.search(r"%s: '([^']*)'" % k, b)
            return mm.group(1) if mm else None
        p = re.search(r"p: (\[[^\]]*\])", b)
        # `r`（分量）是数字不是字符串。上一版拿读字符串的 f() 去读它，永远读不到，
        # 于是全库的 r 一律落成默认值 3——图上按分量分大小就成了一样大
        rr = re.search(r", r: (\d+)", b)
        evs.append({
            'y': int(m.group(1)), 'n': f('n'), 'w': f('w'), 'k': f('k'),
            'r': int(rr.group(1)) if rr else 3,
            'p': re.findall(r"'([^']+)'", p.group(1)) if p else None,
        })
    return [e for e in evs if e['n']]


def load_dynasties():
    src = io.open(os.path.join(ROOT, 'js/dynasties.js'), encoding='utf-8').read()
    src = src[src.find('export const DYNASTIES'):src.find('export const SUCCESSION')]
    out = []
    for m in re.finditer(r"D\('([a-z0-9_]+)',\s*'([^']+)',\s*(-?\d+),\s*(-?\d+)", src):
        key, name, s0, e0 = m.groups()
        blk = src[m.start():m.start() + 2600]
        cap = re.search(r"cap: (\[[^\]]*\])", blk)
        out.append({'key': key, 'name': name, 's': int(s0), 'e': int(e0),
                    'cap': re.findall(r"'([^']+)'", cap.group(1)) if cap else None})
    return out


def inbox(lat, lon):
    return BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]


def shape(pts):
    """诸说 / 链 / 单点。有一个 `说` 就是诸说——并存的主张，不是先后的行迹。"""
    if any(p['角'] == '说' for p in pts):
        return '诸说'
    return '链' if len(pts) > 1 else '单点'


def assemble(pts, xy):
    """[{名,角,主,约}] + 坐标表 → (链, 主下标, 图外主点下标)。

    **图外的点不丢，只标。** 硬贴到图框边上会让读者以为它就在那儿；
    整条扔掉又会把「这东西流散出去了」这件事一起扔掉。故留在数据里，
    图上不画，信息栏里照写。主点若在图外（六骏有两骏在宾大），
    改由链上最后一个图内点顶上，另记一笔说明主点其实在图外。
    """
    chain = []
    for p in pts:
        lat, lon = xy[p['名']]
        chain.append({'名': p['名'], '角': p['角'], '点': [lat, lon],
                      '约': p['约'], '外': not inbox(lat, lon)})
    want = next(i for i, p in enumerate(pts) if p['主'])
    if not chain[want]['外']:
        return chain, want, -1
    inside = [i for i, c in enumerate(chain) if not c['外']]
    return chain, (inside[-1] if inside else -1), want


# ── 写 ────────────────────────────────────────────────────────────────────

HEAD = """// %s — %s**生成物，不要手改**：
// 改了去跑 tools/mining/build_geo_events.py。
//
// 模型见 docs/geo-model.md。一条目记全部地方，图上只出主点，点选才展开链。
//   `式`   单点 / 链（有时序）/ 诸说（并存的主张）
//   `主`   图上要画的那个点在 `链` 里的下标；-1 表示无图内点，图上不画
//   `外主` 主点其实在图外时它在 `链` 里的下标；-1 表示主点就在图内
//   `约`   低置信：今地属传统比定、推定，或只由国别推出。图上画成半透明
//   `外`   落在底图 bbox 之外（见 js/basemap.js）。图上不画，只进信息栏
//   `据`   'p' 手写的地名（有人看过）/ 'w' 条目自己维基页上的主坐标（自动）
export const %s = %s;
"""


def emit(path, varname, what, data):
    io.open(os.path.join(ROOT, path), 'w', encoding='utf-8', newline='\n').write(
        HEAD % (os.path.basename(path), what, varname,
                json.dumps(data, ensure_ascii=False, indent=1)))


def main():
    evs = load_events()
    dyns = load_dynasties()

    auto = {}
    probe = os.path.join(ROOT, 'docs/geo-events-probe.json')
    if os.path.exists(probe):
        for n, v in json.load(io.open(probe, encoding='utf-8'))['点'].items():
            auto[n] = tuple(v['点'])

    # 手写的地名先全解析。解析不出的直接报错——不许留在数据里
    hand = {}
    for e in evs:
        if e['p']:
            hand[('ev', e['n'])] = parse_chain(e['p'], '条目「%s」' % e['n'])
    for d in dyns:
        if d['cap']:
            hand[('dy', d['key'])] = parse_chain(d['cap'], '政权「%s」' % d['name'])

    names = [x['名'] for chain in hand.values() for x in chain]
    print('手写地名 %d 处（去重 %d 个），解析中…' % (len(names), len(set(names))))
    xy = coords_of(names) if names else {}
    bad = [x for x in dict.fromkeys(names) if x not in xy]
    if bad:
        sys.exit('✗ 这些地名解析不出坐标，先在数据里换掉（%d 个）：\n  %s'
                 % (len(bad), '、'.join(bad)))

    # ── 事件 ──────────────────────────────────────────────────────────
    out, stat = {}, {'p': 0, 'auto': 0, '无图内点': 0}
    for e in evs:
        key = ('ev', e['n'])
        if key in hand:
            chain, main_i, out_i = assemble(hand[key], xy)
            src, form = 'p', shape(hand[key])
        elif e['n'] in auto:
            lat, lon = auto[e['n']]
            if not inbox(lat, lon):
                continue
            # 自动那一路只有遗址·建筑靠得住：条目页讲的是地。其余标低置信
            chain = [{'名': e['n'], '角': '址' if e['k'] == 'her' else '显',
                      '点': [lat, lon], '约': e['k'] != 'her', '外': False}]
            main_i, out_i, src, form = 0, -1, 'w', '单点'
        else:
            continue
        if main_i < 0:
            stat['无图内点'] += 1
        stat['p' if src == 'p' else 'auto'] += 1
        out[e['n']] = {'y': e['y'], 'k': e['k'], 'r': e['r'], '据': src,
                       '式': form, '主': main_i, '外主': out_i, '链': chain}

    emit('js/geo-events.js', 'GEO_EVENTS', '库内条目的地点。', out)
    forms = {}
    for v in out.values():
        forms[v['式']] = forms.get(v['式'], 0) + 1
    print('写出 js/geo-events.js：%d 条（手写 %d、自动 %d）；%s；无图内点 %d 条'
          % (len(out), stat['p'], stat['auto'],
             '、'.join('%s %d' % kv for kv in sorted(forms.items())), stat['无图内点']))

    # ── 政权 ──────────────────────────────────────────────────────────
    dout = {}
    for d in dyns:
        key = ('dy', d['key'])
        if key not in hand:
            continue
        chain, main_i, out_i = assemble(hand[key], xy)
        dout[d['key']] = {'名': d['name'], 's': d['s'], 'e': d['e'],
                          '式': shape(hand[key]), '主': main_i, '外主': out_i, '链': chain}
    emit('js/geo-dynasties.js', 'GEO_DYN', '各政权的都城与迁都链。', dout)
    moved = [v['名'] for v in dout.values() if len(v['链']) > 1]
    print('写出 js/geo-dynasties.js：%d / %d 个政权有都城；迁过都的 %d 个'
          % (len(dout), len(dyns), len(moved)))
    # 轻量计数产物:河页/首页的 data-il-count=geo 用它,不必 import 全量地理表
    io.open('js/geo-stats.js', 'w', encoding='utf-8', newline='\n').write(
        '// geo-stats.js — 生成物,勿手改;跑 tools/mining/build_geo_events.py。\n'
        'export const GEO_STATS = { ev: %d, dyn: %d };\n' % (len(out), len(dout)))
    print('写出 js/geo-stats.js')


if __name__ == '__main__':
    main()
