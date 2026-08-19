# -*- coding: utf-8 -*-
"""按**叙述里那句话**去 Commons 找候选图，连许可与署名一并抓回。

用户要的不是条目首图——那张事件卡上已经有了。要的是贴着这一段文字的那张：
榆林窟讲的是第三窟那铺取经图（猴形行者与白马），云冈讲的是第二十窟那尊
露天大佛，金刚经讲的是卷首扉画。故检索词取自长文，不取自站名。

**许可是硬门槛**，不是附注。Commons 上从 CC0 到 CC-BY-SA 都有，署名要求
各不相同；抓不到许可元数据的一律不用。本脚本只做**候选与取证**，
选哪一张、配文怎么写，留给人（或另一轮 agent）定——机器不该替读者判断
「哪张图更能说明这段话」。

用法：python tools/mining/pick_pics.py [key]
产出：tools/mining/pic_candidates.json
"""
import io, json, os, re, sys, time
import urllib.parse, urllib.request

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
OUT = os.path.join(ROOT, "tools/mining/pic_candidates.json")
UA = {"User-Agent": "ImperialLongevity-picprobe/1.0 (storyline illustration licensing)"}
# 可自由使用者（署名仍要给）。凡不在此列一律标出，人来判
FREE = re.compile(r'(cc0|公有领域|public domain|^pd|cc[- ]by([- ]sa)?)', re.I)

# 检索词出自长文那一句，不是站名。每站给两三组，中英各试
QUERIES = {
    '白马寺': ['White Horse Temple Luoyang', '白马寺 洛阳'],
    '克孜尔石窟': ['Kizil Caves mural', 'Kizil Berlin Museum wall painting'],
    '敦煌石窟': ['Mogao Caves nine storey', '莫高窟 九层楼'],
    '麦积山石窟': ['Maijishan Grottoes cliff', '麦积山 栈道'],
    '云冈石窟': ['Yungang Grottoes Cave 20', 'Yungang seated Buddha open air'],
    '龙门石窟': ['Longmen Vairocana Fengxian', 'Empress donors Northern Wei relief'],
    '榆林窟': ['Yulin Caves Xuanzang', 'Xuanzang monkey pilgrim mural', '榆林窟 取经图'],
    '峨眉山乐山大佛': ['Leshan Giant Buddha', '乐山大佛'],
    '金刚经印本': ['Diamond Sutra 868 frontispiece', 'Jingangjing printed 868'],
    '大足石刻': ['Dazu Rock Carvings Baodingshan', 'Dazu parental kindness sutra'],
    '藏经洞发现': ['Mogao Library Cave 17', 'Dunhuang library cave Stein'],
}


def get(url, tries=5):
    """退避重试。这是别人的公共接口，429 要让路而不是硬撞。"""
    for i in range(tries):
        try:
            return json.load(urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=30))
        except Exception as e:
            code = getattr(e, 'code', None)
            wait = 8 * (i + 1) if code == 429 else 3
            if i == tries - 1:
                print('    取失败(%s)：%s' % (code, str(e)[:50]), file=sys.stderr)
                return {}
            time.sleep(wait)
    return {}


def search(q, limit=6):
    d = get('https://commons.wikimedia.org/w/api.php?action=query&format=json'
            '&formatversion=2&list=search&srnamespace=6&srlimit=%d&srsearch=%s'
            % (limit, urllib.parse.quote(q)))
    return [r['title'] for r in ((d.get('query') or {}).get('search') or [])]


def meta(files):
    """File:xxx → 许可、作者、说明页、尺寸、缩略图地址。"""
    out = {}
    for i in range(0, len(files), 10):
        d = get('https://commons.wikimedia.org/w/api.php?action=query&format=json'
                '&formatversion=2&prop=imageinfo&iiprop=extmetadata|url|size'
                '&iiurlwidth=880&titles=' + urllib.parse.quote('|'.join(files[i:i + 10])))
        for p in ((d.get('query') or {}).get('pages') or []):
            ii = (p.get('imageinfo') or [{}])[0]
            em = ii.get('extmetadata') or {}
            g = lambda k: (em.get(k) or {}).get('value')
            clean = lambda t: re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', t or '')).strip()
            out[p.get('title')] = {
                '许可': clean(g('LicenseShortName')), '许可码': g('License'),
                '作者': clean(g('Artist'))[:120] or None,
                '出处': clean(g('Credit'))[:120] or None,
                '说明': clean(g('ImageDescription'))[:200] or None,
                '说明页': ii.get('descriptionurl'),
                '缩略图': ii.get('thumburl'), '原图': ii.get('url'),
                '宽': ii.get('width'), '高': ii.get('height'),
            }
        time.sleep(1.2)
    return out


def main():
    rows = []
    for stop, qs in QUERIES.items():
        files, seen = [], set()
        for q in qs:
            for t in search(q):
                if t not in seen:
                    seen.add(t)
                    files.append(t)
            time.sleep(1.2)
        m = meta(files[:12])
        cands = []
        for f in files[:12]:
            info = m.get(f) or {}
            lic = info.get('许可码') or info.get('许可') or ''
            info['可用'] = bool(FREE.search(lic))
            info['文件'] = f
            cands.append(info)
        ok = [c for c in cands if c.get('可用')]
        rows.append({'站': stop, '检索词': qs, '候选': cands})
        print('%-12s 候选 %2d｜许可可用 %2d｜%s'
              % (stop, len(cands), len(ok),
                 '、'.join(sorted({c.get('许可') or '?' for c in cands}))[:70]))

    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(rows, ensure_ascii=False, indent=1))
    tot = sum(len(r['候选']) for r in rows)
    ok = sum(1 for r in rows for c in r['候选'] if c.get('可用'))
    nost = [r['站'] for r in rows if not any(c.get('可用') for c in r['候选'])]
    print('\n共 %d 站，候选 %d 张，许可可用 %d 张' % (len(rows), tot, ok))
    if nost:
        print('  ⚠ 没有可用候选的站：', nost)
    print('写出 %s' % OUT)


if __name__ == '__main__':
    main()
