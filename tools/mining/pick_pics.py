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
OUT = os.path.join(ROOT, "tools/mining/pic_candidates.json")  # 无参数时的旧名；按线跑见 main 内改名
UA = {"User-Agent": "ImperialLongevity-picprobe/1.0 (storyline illustration licensing)"}
# 可自由使用者（署名仍要给）。凡不在此列一律标出，人来判
FREE = re.compile(r'(cc0|公有领域|public domain|^pd|cc[- ]by([- ]sa)?)', re.I)

# 检索词出自长文那一句，不是站名。每站给两三组，中英各试
# 分类比全文检索准得多：Commons 的全文会命中扫描古籍的描述文字，
# 头一版就因此抓回一堆政府公文 PDF 与港大图书馆展柜照。故先走分类，
# 再用关键词在分类内部排序；分类空了才退回全文检索。
CATS = {
    '白马寺': ['White Horse Temple (Luoyang)'],
    '克孜尔石窟': ['Kizil Caves'],
    '敦煌石窟': ['Mogao Caves'],
    '麦积山石窟': ['Maijishan'],
    '云冈石窟': ['Yungang Grottoes'],
    '龙门石窟': ['Longmen Grottoes'],
    '榆林窟': ['Yulin Caves'],
    '峨眉山乐山大佛': ['Leshan Giant Buddha'],
    '金刚经印本': ['Diamond Sutra'],
    '大足石刻': ['Dazu Rock Carvings'],
    '藏经洞发现': ['Library Cave', 'Mogao Caves'],
    # ── 香火线（2026-08-22 扩）。花觚/城隍两站自摄图已足，不在此列 ──
    '序': ['Mausoleum of the Yellow Emperor'],
    '一人得道鸡犬升天': ['Liu An'],
    '买地券': [],
    '妈祖信仰': ['Meizhou Mazu Ancestral Temple', 'Mazu'],
    '文昌帝君': ['Wenchang Wang'],
    '除夜赐钟馗': ['Zhong Kui'],
    '门神': ['Menshen'],
    '包公变阎罗': ['Bao Zheng'],
    '关林': ['Guanlin'],
    '关羽累封': ['Guan Yu'],
    '落点': ['Sun Simiao'],
}
# 叙述里那句话的关键词。命中它的候选排前面——图要贴着这一段文字，
# 不是贴着站名（用户：我想要的是那铺悟空唐僧的壁画）
WANT = {
    '白马寺': ['gate', 'temple', 'hall', '山门'],
    '克孜尔石窟': ['mural', 'painting', 'jataka', 'berlin'],
    '敦煌石窟': ['nine', '九层', 'exterior', 'cliff', 'facade'],
    '麦积山石窟': ['cliff', 'walkway', 'stair', 'exterior', 'clay', 'sculpture'],
    '云冈石窟': ['cave 20', 'cave20', 'seated', 'colossal'],
    '龙门石窟': ['vairocana', 'fengxian', 'losana', 'colossal'],
    '榆林窟': ['xuanzang', 'monkey', 'pilgrim', 'mural', '取经'],
    '峨眉山乐山大佛': ['giant buddha', 'leshan'],
    '金刚经印本': ['frontispiece', '868'],
    '大足石刻': ['baoding', 'parental', 'filial', '父母'],
    '藏经洞发现': ['cave 17', 'cave17', 'library cave', 'stein', 'wang'],
    '序': ['mausoleum', 'qiaoshan', 'tomb', 'huangdi', '轩辕', '桥山'],
    '一人得道鸡犬升天': ['liu an', 'huainan', '淮南'],
    '买地券': ['tomb contract', 'land deed', '买地券', '買地券'],
    '妈祖信仰': ['meizhou', 'temple', 'statue', '湄洲', '祖庙'],
    '文昌帝君': ['wenchang', 'zitong', '文昌', '梓潼'],
    '除夜赐钟馗': ['gong kai', 'zhongkui', 'painting', '龔開', '歲朝'],
    '门神': ['door god', 'new year print', 'woodblock', '年画', '門神'],
    '包公变阎罗': ['bao zheng', 'baogong', 'portrait', 'temple', '包公祠'],
    '关林': ['guanlin', 'tomb', 'gate', 'luoyang', '冢'],
    '关羽累封': ['guandi', 'xiezhou', 'temple', 'statue', '解州'],
    '落点': ['sun simiao', 'yaowang', 'statue', '药王山', '孫思邈'],
}
QUERIES = {k: WANT[k] for k in CATS}
# 按线跑：pick_pics.py <线key> 只处理该线的站（不给参数则全表）
LINE_STOPS = {
    'shiku': ['白马寺', '克孜尔石窟', '敦煌石窟', '麦积山石窟', '云冈石窟', '龙门石窟',
              '榆林窟', '峨眉山乐山大佛', '金刚经印本', '大足石刻', '藏经洞发现'],
    'xianghuo': ['序', '一人得道鸡犬升天', '买地券', '妈祖信仰', '文昌帝君',
                 '除夜赐钟馗', '门神', '包公变阎罗', '关林', '关羽累封', '落点'],
}
# 只要照片。djvu/pdf 是扫描古籍与公文，tif/svg/ogv 不适合直接上页
BAD_EXT = re.compile(r'\.(djvu|pdf|tif|tiff|svg|ogv|webm|ogg|mid|xcf)$', re.I)


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


def search(q, limit=8):
    d = get('https://commons.wikimedia.org/w/api.php?action=query&format=json'
            '&formatversion=2&list=search&srnamespace=6&srlimit=%d&srsearch=%s'
            % (limit, urllib.parse.quote(q)))
    return [r['title'] for r in ((d.get('query') or {}).get('search') or [])]


def in_category(cat, limit=200):
    """分类里的全部文件（含一层子分类）。比全文检索准得多。"""
    out, subs = [], []
    d = get('https://commons.wikimedia.org/w/api.php?action=query&format=json'
            '&formatversion=2&list=categorymembers&cmtype=file|subcat&cmlimit=%d'
            '&cmtitle=%s' % (limit, urllib.parse.quote('Category:' + cat)))
    for m in ((d.get('query') or {}).get('categorymembers') or []):
        (subs if m['title'].startswith('Category:') else out).append(m['title'])
    for sc in subs[:6]:
        time.sleep(0.8)
        d2 = get('https://commons.wikimedia.org/w/api.php?action=query&format=json'
                 '&formatversion=2&list=categorymembers&cmtype=file&cmlimit=%d'
                 '&cmtitle=%s' % (limit, urllib.parse.quote(sc)))
        out += [m['title'] for m in ((d2.get('query') or {}).get('categorymembers') or [])]
    return [t for t in out if not BAD_EXT.search(t)]


def rank(files, want):
    """命中叙述关键词的排前面。命中数相同则保持分类里的原序。"""
    def score(t):
        low = t.lower()
        return -sum(1 for w in want if w.lower() in low)
    return sorted(files, key=score)


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
    global OUT
    only = LINE_STOPS.get(sys.argv[1]) if len(sys.argv) > 1 else None
    if len(sys.argv) > 1:
        # 按线跑写按线的档，别覆盖别条线的候选（2026-08-22 险案：香火线打捞差点覆盖石窟候选）
        OUT = os.path.join(ROOT, 'tools/mining/pic_candidates-%s.json' % sys.argv[1])
    for stop, qs in QUERIES.items():
        if only and stop not in only:
            continue
        files, seen = [], set()
        for cat in CATS.get(stop, []):
            for t in in_category(cat):
                if t not in seen:
                    seen.add(t)
                    files.append(t)
            time.sleep(1.0)
        # **两路都走，不是二选一**。实测：分类救了麦积山与藏经洞（全文检索
        # 命中的是政府公文 PDF 与图书馆展柜照），却弄丢了云冈与龙门
        # ——关键词检索本来精确命中「Cave 20」与「奉先寺卢舍那」，
        # 而分类里那两处的文件名是「Caves 1-4」「2010 CHINE (459...)」这类，
        # 排序无从下手。合起来再排，命中叙述关键词的排前面
        for q in qs:
            for t in search('%s %s' % ((CATS.get(stop) or [stop])[0], q)):
                if t not in seen and not BAD_EXT.search(t):
                    seen.add(t)
                    files.append(t)
            time.sleep(1.0)
        files = rank(files, qs)
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
