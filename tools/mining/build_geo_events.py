# -*- coding: utf-8 -*-
"""把库内条目的地点做成 js/geo-events.js。

两路合并，**两路的可信度不一样，故分开标**：

  `w` 自动     条目本身的维基页带 P625 主坐标（zhwiki prop=coordinates 一次取 50 条，
               不绕 Wikidata——绕过去会吃 429，实测）。这一路只有「遗址·建筑」类
               靠得住：实测 68 条命中 55（81%），而文物 159 条只命中 5、战事 103 条
               命中 0。原因很实在——文物条目的维基页讲的是**器**不是**地**。

  `p` 手工     条目里手写的 `p` 字段，写的是**地名不是坐标**。地名是策展判断
               （该落在出土地还是现藏地，由人定），坐标是事实（从 wiki 抓，不手打）。
               这与本项目「选图是策展判断、许可与署名从 Commons 抓」是同一条分界。
               一条目可给两个地名，即「出→藏」两点。

`p` 优先于自动：手写的那个是有人看过的。

每个地名必须实测能解析——解析不出的**不许留在数据里**，脚本会报错退出。
上一轮实测踩到两个：`长安`（有条目无坐标）、`高家堰`（重定向到洪泽湖大堤，无坐标），
已在 events.js 里换成 `西安碑林`、`洪泽湖`。

用法：python tools/mining/build_geo_events.py
读：js/events.js、docs/geo-events-probe.json　写：js/geo-events.js
"""
import io, json, os, re, sys, time
import urllib.parse, urllib.request, urllib.error

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
UA = {"User-Agent": "ImperialLongevity-geo/1.0 (github.com/No-Macaroon1670/ImperialLongevity)"}
BBOX = [73.0, 18.0, 135.0, 50.0]        # 与 js/basemap.js 一致：西 南 东 北


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


def coords_of(titles, pace=0.4, chunk=50, log=None):
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
            u = ('https://zh.wikipedia.org/w/api.php?action=query&format=json'
                 '&formatversion=2&redirects=1&prop=coordinates&coprimary=primary'
                 '&colimit=max&titles=' + urllib.parse.quote('|'.join(ch)))
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
        p = re.search(r"p: (\[[^\]]*\]|'[^']*')", b)
        evs.append({
            'y': int(m.group(1)), 'n': f('n'), 'w': f('w'), 'k': f('k'), 'r': f('r'),
            'p': re.findall(r"'([^']+)'", p.group(1)) if p else None,
        })
    return [e for e in evs if e['n']]


def inbox(lat, lon):
    return BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]


def main():
    evs = load_events()
    probe_path = os.path.join(ROOT, 'docs/geo-events-probe.json')
    auto = {}
    if os.path.exists(probe_path):
        for n, v in json.load(io.open(probe_path, encoding='utf-8'))['点'].items():
            auto[n] = tuple(v['点'])

    # 手写 p：先把所有地名解析成坐标，解析不出的直接报错——不许留在数据里
    names = [x for e in evs if e['p'] for x in e['p']]
    resolved = coords_of(names) if names else {}
    bad = [x for x in dict.fromkeys(names) if x not in resolved]
    if bad:
        sys.exit('✗ 这些 p 地名解析不出坐标，先在 events.js 里换掉：%s' % bad)

    out, stat = {}, {'p': 0, 'auto': 0, 'outside': 0}
    for e in evs:
        pts = []
        if e['p']:
            for x in e['p']:
                lat, lon = resolved[x]
                pts.append({'名': x, '点': [lat, lon], '据': 'p'})
        elif e['n'] in auto:
            lat, lon = auto[e['n']]
            pts.append({'名': e['n'], '点': [lat, lon], '据': 'w'})
        if not pts:
            continue
        keep = [q for q in pts if inbox(*q['点'])]
        if not keep:
            stat['outside'] += 1
            continue
        stat['p' if pts[0]['据'] == 'p' else 'auto'] += 1
        out[e['n']] = {'y': e['y'], 'k': e['k'], 'r': int(e['r'] or 3), '点': keep}

    js = [
        '// geo-events.js — 库内条目的地点。**生成物，不要手改**：',
        '// 改了去跑 tools/mining/build_geo_events.py。',
        '//',
        '// 每条给一到两个点。`据` 记这个点是怎么来的，两路可信度不同：',
        "//   'p' 条目里手写的地名（策展判断，有人看过），坐标从 wiki 抓、不手打",
        "//   'w' 条目本身的维基页带的主坐标（自动，只有「遗址·建筑」一类靠得住）",
        '//',
        '// 只收落在底图 bbox 内的点（见 js/basemap.js）。框外的整条不收——',
        '// 硬贴到边上会让读者以为它就在那儿。',
        'export const GEO_EVENTS = %s;' % json.dumps(out, ensure_ascii=False, indent=1),
        '',
    ]
    path = os.path.join(ROOT, 'js/geo-events.js')
    io.open(path, 'w', encoding='utf-8', newline='\n').write('\n'.join(js))
    print('写出 %s' % path)
    print('  手写 p %d 条、自动 %d 条，共 %d 条；框外舍去 %d 条'
          % (stat['p'], stat['auto'], len(out), stat['outside']))
    two = [n for n, v in out.items() if len(v['点']) > 1]
    if two:
        print('  两个点的（出→藏）：%s' % '、'.join(two))


if __name__ == '__main__':
    main()
