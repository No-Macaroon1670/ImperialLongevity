# -*- coding: utf-8 -*-
"""照片漏斗·闸0——零 token 机械预筛（2026-08-20 立，用户点题：太糊的别送进贵工序）。

只写清单不动文件：inbox 的文件数就是欠账数（crop.py 档头军规），
本闸的产出是 docs/desk/ 下的 manifest，供闸1（sonnet 缩略图初判）分工用。

三件事：
  1. EXIF 齐读——时间、GPS、转正方向；按「同分钟±90s」聚簇还原拍摄场次。
  2. 连拍归簇——簇内 dHash 汉明距 ≤6 视为同景连拍，只推最清晰一张，
     其余标 burst_dup（这是相机倾倒里最大的无谓 token 源）。
  3. 清晰度评分——灰度 1024px 上拉普拉斯方差。**绝对阈值不可信**
     （暗光高 ISO、浅景深都会假阳性），故只按本批分布标百分位：
     bottom 10% 且无同簇更清版本 → low_sharp（降级送闸1 复核，不是死刑）。

判词只有四种：ok / burst_dup（有更清的同景，闸1可跳过）/
low_sharp（闸1 花一眼复核）/ unreadable（文件坏，唯一可直弃的）。
"""
import io, os, sys, json, math, datetime
import numpy as np
from PIL import Image, ImageOps, ExifTags
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INBOX = os.path.join(ROOT, 'img', 'inbox')
OUT = os.path.join(ROOT, 'docs', 'desk')

TAGS = {v: k for k, v in ExifTags.TAGS.items()}

def exif_of(im):
    try:
        ex = im._getexif() or {}
    except Exception:
        ex = {}
    dt = ex.get(TAGS.get('DateTimeOriginal')) or ex.get(TAGS.get('DateTime'))
    gps = ex.get(TAGS.get('GPSInfo'))
    lat = lon = None
    if gps:
        def cv(x):
            try:
                return float(x[0]) / float(x[1]) if isinstance(x, tuple) else float(x)
            except Exception:
                return None
        try:
            la, lo = gps.get(2), gps.get(4)
            if la and lo:
                lat = cv(la[0]) + cv(la[1]) / 60 + cv(la[2]) / 3600
                lon = cv(lo[0]) + cv(lo[1]) / 60 + cv(lo[2]) / 3600
                if gps.get(1) == 'S': lat = -lat
                if gps.get(3) == 'W': lon = -lon
        except Exception:
            pass
    return dt, (round(lat, 5) if lat else None), (round(lon, 5) if lon else None)

def dhash(g):  # g: 灰度 PIL
    small = np.asarray(g.resize((9, 8), Image.LANCZOS), dtype=np.int16)
    return ''.join('1' if small[r, c] > small[r, c + 1] else '0'
                   for r in range(8) for c in range(8))

def ham(a, b):
    return sum(x != y for x, y in zip(a, b))

def parse_dt(s, fname):
    for f in ('%Y:%m:%d %H:%M:%S',):
        try:
            return datetime.datetime.strptime(s, f)
        except Exception:
            pass
    # 文件名兜底：20240101_132725 / IMG_20160904_062252 / PXL_20240330_...
    import re
    m = re.search(r'(20\d{6})[_-]?(\d{6})', fname)
    if m:
        try:
            return datetime.datetime.strptime(m.group(1) + m.group(2), '%Y%m%d%H%M%S')
        except Exception:
            pass
    return None

def main(folder=INBOX):
    rows = []
    for fn in sorted(os.listdir(folder)):
        if not fn.lower().endswith(('.jpg', '.jpeg', '.png', '.heic')):
            continue
        p = os.path.join(folder, fn)
        try:
            im = Image.open(p)
            dt_s, lat, lon = exif_of(im)
            im = ImageOps.exif_transpose(im)
            w, h = im.size
            g = im.convert('L')
            g.thumbnail((1024, 1024), Image.LANCZOS)
            arr = np.asarray(g, dtype=np.float64)
            sharp = float(ndimage.laplace(arr).var())
            rows.append({'file': fn, 'w': w, 'h': h, 'dt': dt_s,
                         'lat': lat, 'lon': lon, 'sharp': round(sharp, 1),
                         'hash': dhash(g),
                         'ts': (parse_dt(dt_s, fn).isoformat() if parse_dt(dt_s, fn) else None)})
        except Exception as e:
            rows.append({'file': fn, 'verdict': 'unreadable', 'err': str(e)[:80]})
    good = [r for r in rows if 'err' not in r]
    # 连拍归簇：时间近（≤90s）且 dHash 近（≤6）
    for r in good:
        r['burst'] = None
    bid = 0
    for i, r in enumerate(good):
        for q in good[:i]:
            if r['ts'] and q['ts']:
                d = abs((datetime.datetime.fromisoformat(r['ts'])
                         - datetime.datetime.fromisoformat(q['ts'])).total_seconds())
                if d <= 90 and ham(r['hash'], q['hash']) <= 6:
                    r['burst'] = q['burst'] if q['burst'] is not None else q.setdefault('burst', (bid := bid + 1))
                    break
    # 簇内推清晰王，其余 burst_dup
    from collections import defaultdict
    clusters = defaultdict(list)
    for r in good:
        if r['burst'] is not None:
            clusters[r['burst']].append(r)
    for members in clusters.values():
        best = max(members, key=lambda r: r['sharp'])
        for r in members:
            r['verdict'] = 'ok' if r is best else 'burst_dup'
    # 清晰度百分位（只在非 dup 里比）
    solo = [r for r in good if r.get('verdict') != 'burst_dup']
    if solo:
        cut = float(np.percentile([r['sharp'] for r in solo], 10))
        for r in solo:
            r['verdict'] = 'low_sharp' if r['sharp'] < cut else 'ok'
    # 场次分组（同小时同地视作一场）
    for r in good:
        r['session'] = (r['ts'][:13] if r['ts'] else '未知场次')
    os.makedirs(OUT, exist_ok=True)
    stamp = datetime.date.today().isoformat().replace('-', '')
    outp = os.path.join(OUT, 'photo-gate0-%s.json' % stamp)
    json.dump({'folder': folder, 'n': len(rows),
               'verdict_counts': {v: sum(1 for r in rows if r.get('verdict') == v)
                                  for v in ('ok', 'burst_dup', 'low_sharp', 'unreadable')},
               'sharp_cut_p10': (round(cut, 1) if solo else None),
               'rows': rows}, io.open(outp, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('写出', outp)
    for v in ('ok', 'burst_dup', 'low_sharp', 'unreadable'):
        n = sum(1 for r in rows if r.get('verdict') == v)
        if n:
            print('%-10s %d' % (v, n))
    dups = [r['file'] for r in rows if r.get('verdict') == 'burst_dup']
    lows = [(r['file'], r['sharp']) for r in rows if r.get('verdict') == 'low_sharp']
    if dups: print('连拍冗余：', ', '.join(dups[:10]), '…' if len(dups) > 10 else '')
    if lows: print('低清复核：', ', '.join('%s(%.0f)' % x for x in lows))

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else INBOX)
