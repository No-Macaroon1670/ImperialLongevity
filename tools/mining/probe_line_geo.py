# -*- coding: utf-8 -*-
"""石窟线的两项可行性实测：**坐标**与**配图许可**。

两个候选功能各卡在一处，都不该靠猜：

  ① 叙事小地图（桌面端讲解对角）——要十一站的经纬度。
     问题：本库 events.js 里没有坐标字段，Wikidata 的 P625 够不够用？
  ② 每站配一张图——要的不是「有没有图」，是**许可与署名**。
     维基条目的首图多半在 Commons，许可从 PD 到 CC-BY-SA 不等，
     署名要求也不同。搞错一张就是侵权，不是「差不多」。

数据来源：Wikidata（CC0）取坐标，Commons API 取图与许可元数据。
两处都是别人的公共接口，故限速。

用法：python tools/mining/probe_line_geo.py [key]
产出：tools/mining/line_geo.json
"""
import io, json, os, re, sys, time
import urllib.parse, urllib.request

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_line_doc import load_line, load_events, load_sources  # noqa: E402

UA = {"User-Agent": "ImperialLongevity-geoprobe/1.0 (storyline minimap feasibility)"}
OUT = os.path.join(ROOT, "tools/mining/line_geo.json")
# 可自由使用的许可（署名仍要给）。凡不在此列的一律标出来，人来判
FREE = re.compile(r'(cc0|public domain|pd-|cc[- ]by([- ]sa)?[- ]?[0-9.]*)', re.I)


def get(url, tries=3):
    for i in range(tries):
        try:
            return json.load(urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=30))
        except Exception as e:
            if i == tries - 1:
                print('    取失败：%s' % str(e)[:60], file=sys.stderr)
            time.sleep(3)
    return {}


def coords(titles):
    """zhwiki 条目名 → (lat, lon)。Wikidata P625，CC0。"""
    got = {}
    for i in range(0, len(titles), 20):
        url = ('https://www.wikidata.org/w/api.php?action=wbgetentities&sites=zhwiki'
               '&props=claims|sitelinks&format=json&titles='
               + urllib.parse.quote('|'.join(titles[i:i + 20])))
        d = get(url)
        for qid, ent in (d.get('entities') or {}).items():
            if qid.startswith('-'):
                continue
            zh = ((ent.get('sitelinks') or {}).get('zhwiki') or {}).get('title')
            cl = ((ent.get('claims') or {}).get('P625') or [])
            if zh and cl:
                v = cl[0].get('mainsnak', {}).get('datavalue', {}).get('value', {})
                if 'latitude' in v:
                    got[zh] = {'qid': qid, 'lat': v['latitude'], 'lon': v['longitude']}
            elif zh:
                got[zh] = {'qid': qid}
        time.sleep(0.4)
    return got


def lead_image(title):
    """zhwiki 条目首图 → 文件名、许可、作者、说明页。许可查不到就照实写 None。"""
    url = ('https://zh.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages'
           '&piprop=original&titles=' + urllib.parse.quote(title))
    d = get(url)
    pages = ((d.get('query') or {}).get('pages') or {})
    src = None
    for p in pages.values():
        src = (p.get('original') or {}).get('source')
    if not src:
        return None
    fname = urllib.parse.unquote(src.rsplit('/', 1)[-1])
    if fname.startswith('thumb'):
        fname = urllib.parse.unquote(src.split('/thumb/')[-1].split('/')[-2])
    meta = get('https://commons.wikimedia.org/w/api.php?action=query&format=json'
               '&prop=imageinfo&iiprop=extmetadata|url|size&titles='
               + urllib.parse.quote('File:' + fname))
    info = {}
    for p in ((meta.get('query') or {}).get('pages') or {}).values():
        ii = (p.get('imageinfo') or [{}])[0]
        em = ii.get('extmetadata') or {}
        g = lambda k: (em.get(k) or {}).get('value')
        info = {
            '文件': fname, '图片URL': ii.get('url'),
            '宽': ii.get('width'), '高': ii.get('height'),
            '许可': g('LicenseShortName'), '许可码': g('License'),
            '作者': re.sub(r'<[^>]+>', '', g('Artist') or '') or None,
            '说明页': ii.get('descriptionurl'),
            '要求署名': (g('AttributionRequired') or '').lower() == 'true',
        }
    return info or {'文件': fname, '图片URL': src, '许可': None}


def main():
    key = sys.argv[1] if len(sys.argv) > 1 else 'shiku'
    _, stops = load_line(key)
    ev = load_events()
    per = load_sources(key).get('站', {})

    rows = []
    titles = []
    for s in stops:
        n = s['ev'] or ''
        e = ev.get(n) or {}
        w = e.get('w') or n
        titles.append(w)
        rows.append({'站': n, '维基正题': w, '地点': (per.get(n) or {}).get('地点'),
                     '年': e.get('y')})
    print('取坐标（Wikidata P625，CC0）…')
    cs = coords(titles)
    for r in rows:
        c = cs.get(r['维基正题']) or {}
        r['qid'] = c.get('qid')
        if 'lat' in c:
            r['lat'], r['lon'] = round(c['lat'], 4), round(c['lon'], 4)

    print('取首图与许可（Commons）…')
    for r in rows:
        r['图'] = lead_image(r['维基正题'])
        time.sleep(0.5)
        got = '有' if (r['图'] or {}).get('图片URL') else '无'
        print('  %-12s 坐标 %-8s 图 %s  %s'
              % (r['站'], ('%.2f,%.2f' % (r['lat'], r['lon'])) if r.get('lat') else '缺',
                 got, ((r['图'] or {}).get('许可') or '（许可未取到）')))

    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(rows, ensure_ascii=False, indent=1))
    nc = sum(1 for r in rows if r.get('lat'))
    ni = sum(1 for r in rows if (r['图'] or {}).get('图片URL'))
    nf = sum(1 for r in rows if FREE.search(((r['图'] or {}).get('许可码') or
                                             (r['图'] or {}).get('许可') or '')))
    print('\n共 %d 站：有坐标 %d｜有首图 %d｜许可可用 %d' % (len(rows), nc, ni, nf))
    if nc < len(rows):
        print('  缺坐标：', [r['站'] for r in rows if not r.get('lat')])
    if ni and nf < ni:
        print('  许可需人判：', [r['站'] for r in rows
                                if (r['图'] or {}).get('图片URL')
                                and not FREE.search(((r['图'] or {}).get('许可码') or
                                                     (r['图'] or {}).get('许可') or ''))])
    print('写出 %s' % OUT)


if __name__ == '__main__':
    main()
