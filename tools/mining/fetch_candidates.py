# -*- coding: utf-8 -*-
"""把判官荐/备名单的 Commons 元数据抓进 pic_candidates.json（许可与署名从
Commons 抓、不手抄——build_pics 的分界线）。逐名叩 imageinfo，missing 即报错
中止：图版判官提请的 existence 校验（觅图回执文件名讹误两案实踩）在此落地。

用法：python tools/mining/fetch_candidates.py <站名> File:甲.jpg File:乙.pdf …
（站名只作候选册分组标签；同名文件已在册则更新该条）"""
import io, json, os, re, sys, time
import urllib.parse, urllib.request

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
UA = {"User-Agent": "ImperialLongevity-pics/1.0 (curated storyline images)"}
API = ('https://commons.wikimedia.org/w/api.php?action=query&format=json'
       '&formatversion=2&prop=imageinfo&iiprop=extmetadata%7Csize%7Curl'
       '&iiurlwidth=1280&titles=')


def strip_html(t):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', t or '')).strip()


def fetch(title, tries=4):
    u = API + urllib.parse.quote(title)
    for i in range(tries):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40))
            return d
        except urllib.error.HTTPError as e:
            if e.code == 429 and i + 1 < tries:
                time.sleep(20 * (i + 1))
                continue
            raise
    return None


def main():
    if len(sys.argv) < 3:
        sys.exit('用法：fetch_candidates.py <站名> File:… …')
    group = sys.argv[1]
    titles = sys.argv[2:]
    path = os.path.join(ROOT, 'tools/mining/pic_candidates.json')
    book = json.load(io.open(path, encoding='utf-8'))
    known = {}
    for r in book:
        for c in r['候选']:
            known[c['文件']] = c

    rec = next((r for r in book if r['站'] == group), None)
    if rec is None:
        rec = {'站': group, '检索词': [], '候选': []}
        book.append(rec)

    bad = []
    for t in titles:
        t = t if t.startswith('File:') else 'File:' + t
        d = fetch(t)
        page = d['query']['pages'][0]
        if page.get('missing') or 'imageinfo' not in page:
            bad.append(t)
            print('  ✗ missing：%s' % t)
            continue
        ii = page['imageinfo'][0]
        em = ii.get('extmetadata', {})
        g = lambda k: strip_html(em.get(k, {}).get('value', ''))
        c = {
            '许可': g('LicenseShortName') or g('UsageTerms'),
            '许可码': g('License'),
            '作者': g('Artist'),
            '出处': g('Credit')[:200],
            '说明': g('ImageDescription')[:200],
            '说明页': ii.get('descriptionurl'),
            '缩略图': ii.get('thumburl'),
            '原图': ii.get('url'),
            '宽': ii.get('width'), '高': ii.get('height'),
            '可用': True,
            '文件': page['title'],
        }
        old = known.get(page['title'])
        if old:
            old.update(c)
            print('  ↻ 更新：%s（%s）' % (page['title'], c['许可']))
        else:
            rec['候选'].append(c)
            print('  ＋ %s（%s，%dx%d）' % (page['title'], c['许可'], c['宽'] or 0, c['高'] or 0))
        time.sleep(1.2)

    if bad:
        sys.exit('存在 missing 文件，不落盘：%s' % bad)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(book, ensure_ascii=False, indent=1))
    print('写回 pic_candidates.json（%d 组）' % len(book))


if __name__ == '__main__':
    main()
