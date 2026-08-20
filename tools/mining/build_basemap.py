# -*- coding: utf-8 -*-
"""生成叙事小地图的底图：js/basemap.js。

**只画海岸线与两条大河，不画国界。** 三个理由，都很实际：

  1. 授权。地图瓦片（OSM/Mapbox/高德）各有署名与用量条款，本库是零依赖静态
     站点，不想为一张角落里的小图背上运行时外部依赖。Natural Earth 是
     **公共领域**（其官网明示 no permission needed），下载下来化成一条 SVG 路径
     即可，不留外链。
  2. 政区。国界画法本身有争议，一张讲石窟与赤壁的小地图没有必要卷进去。
     海岸线与河道没有这个问题。
  3. 贴题。页名就叫「王朝之河」，底图是黄河与长江，正好。

投影：等距圆柱，x 按中纬 35°N 的 cos 压缩（x = lon·cos35°）。这不是等积也不是
等角投影，在本图的范围（东经 73–135、北纬 18–50）里形变可以接受，换来的是
**放点的数学足够简单**——前端只要一次线性映射，不必带一套投影库。

数据：Natural Earth 1:50m physical（coastline、rivers_lake_centerlines），
经 Douglas–Peucker 抽稀。抽稀容差写在产物里，便于日后核对。

用法：python tools/mining/build_basemap.py
"""
import io, json, math, os, sys, urllib.request

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
OUT = os.path.join(ROOT, 'js/basemap.js')
BASE = ('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/')
UA = {"User-Agent": "ImperialLongevity-basemap/1.0"}

# 本图范围：西到帕米尔（克孜尔 82°E），东到海岸；南到乐山与大足，北到大同。
# 再加一圈余量，免得点贴边
BBOX = (73.0, 18.0, 135.0, 50.0)          # 西 南 东 北
LAT0 = 35.0                                # x 压缩取的中纬
TOL = 0.06                                 # 抽稀容差（度）；越大越简，越省字节
# 只留这两条河。**Natural Earth 的 name 字段要照它自己的写法**：
# 黄河在里面叫 `Huang`（不是 Huang He，更不是 Yellow），长江上游叫
# `Chang Jiang`、下游才叫 `Yangtze`。上一版写的是 {'Yangtze','Yangtze Kiang',
# 'Huang He','Yellow'}，于是黄河一段没有、长江只剩下游三段——图上「黄河」
# 两个字底下空空如也（用户实测指出）。**用全等匹配**，子串匹配会把
# 别的 Huang 什么江也捞进来
RIVERS = {'Huang', 'Chang Jiang', 'Yangtze'}

# ── 地形骨架 ──────────────────────────────────────────────────────────
# 山脉、高原、盆地是这张图缺的定位锚：点为什么密在中原、稀在高原，
# 山画出来自己会说话。只做「骨架版」——山脉淡淡填一层、其余只标名字，
# 不做高程渐变（会跟四百个彩点抢颜色带宽，也会把底图吹成几百 KB）。
# 数据同样来自 Natural Earth（geography_regions_polys，公共领域），
# 按英文 NAME 挑，**中文名自己给**：NE 的 NAME_ZH 混着繁体（天山山脈）
# 和怪译（GOBI 作「大漠」），不如自己写十几个名字踏实。
# mtn = 画填充＋标名；flat = 只标名（平原一填就压在点堆底下）
TERRAIN = {
    'Qinling Mountains': ('秦岭', 'mtn'),
    'Taihang Mts.': ('太行山', 'mtn'),
    'TIAN SHAN': ('天山', 'mtn'),
    'KUNLUN MOUNTAINS': ('昆仑山', 'mtn'),
    'QUILIAN MOUNTAINS': ('祁连山', 'mtn'),
    'GREATER KHINGAN RANGE': ('大兴安岭', 'mtn'),
    'Nan Ling Mts.': ('南岭', 'mtn'),
    'Wuyi Mts.': ('武夷山', 'mtn'),
    'HIMALAYAS': ('喜马拉雅山', 'mtn'),
    'Dabie Mts.': ('大别山', 'mtn'),
    'Lüliang Mts.': ('吕梁山', 'mtn'),
    'Helan Mts.': ('贺兰山', 'mtn'),
    'Yin Mts.': ('阴山', 'mtn'),
    'Hengduan Mts.': ('横断山', 'mtn'),
    'Changbai Mts.': ('长白山', 'mtn'),
    'PLATEAU OF TIBET': ('青藏高原', 'flat'),
    'Loess Plateau': ('黄土高原', 'flat'),
    'YUNGUI PLATEAU': ('云贵高原', 'flat'),
    'MONGOLIAN PLATEAU': ('蒙古高原', 'flat'),
    'GOBI DESERT': ('戈壁', 'flat'),
    'TAKLIMAKAN DESERT': ('塔克拉玛干沙漠', 'flat'),
    'TARIM BASIN': ('塔里木盆地', 'flat'),
    'SICHUAN BASIN': ('四川盆地', 'flat'),
    'Junggar Basin': ('准噶尔盆地', 'flat'),
    'NORTH CHINA PLAIN': ('华北平原', 'flat'),
    'MANCHURIAN PLAIN': ('东北平原', 'flat'),
}


def fetch(name):
    u = BASE + name
    print('  取 %s …' % name)
    return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=120))


def clip(line):
    """按 bbox 切段：出框就断开，免得画出一条横穿地图的直线。"""
    w, s, e, n = BBOX
    out, cur = [], []
    for x, y in line:
        if w <= x <= e and s <= y <= n:
            cur.append((x, y))
        elif cur:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return [seg for seg in out if len(seg) >= 2]


def dp(pts, tol):
    """Douglas–Peucker 抽稀。自己写十几行，省得为一张小图引一个库。

    **闭合环要单独处理**：岛屿的首尾是同一个点，弦退化成零长，
    点到「线」的距离公式分母为零、分子也为零，于是 far 恒等于 0 ≤ tol，
    整个环被压成两个重合的点。实测因此丢掉了台湾与海南——图上只剩
    「M788.8 491.1L788.8 491.1」这样的残段，而台北故宫的点就孤零零
    浮在海里。弦退化时改量到那个点的距离即可。
    """
    if len(pts) < 3:
        return pts
    x0, y0 = pts[0]
    x1, y1 = pts[-1]
    dx, dy = x1 - x0, y1 - y0
    den = math.hypot(dx, dy)
    far, fi = -1.0, 0
    for i in range(1, len(pts) - 1):
        x, y = pts[i]
        d = (math.hypot(x - x0, y - y0) if den < 1e-12
             else abs(dy * x - dx * y + x1 * y0 - y1 * x0) / den)
        if d > far:
            far, fi = d, i
    if far <= tol:
        return [pts[0], pts[-1]]
    return dp(pts[:fi + 1], tol)[:-1] + dp(pts[fi:], tol)


def project(x, y):
    """经纬 → 视图坐标（0–1000 × 0–H）。与前端 basemap.project 必须一致。"""
    w, s, e, n = BBOX
    k = math.cos(math.radians(LAT0))
    X = (x - w) * k
    W = (e - w) * k
    return (1000.0 * X / W, 1000.0 * (n - y) / W)


def path(segs):
    d = []
    for seg in segs:
        pts = [project(x, y) for x, y in seg]
        d.append('M' + 'L'.join('%.1f %.1f' % (a, b) for a, b in pts))
    return ''.join(d)


def main():
    sys.setrecursionlimit(10000)
    coast, rivers = [], []
    for feat in fetch('ne_50m_coastline.geojson')['features']:
        g = feat['geometry']
        lines = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
        for ln in lines:
            for seg in clip([(p[0], p[1]) for p in ln]):
                coast.append(dp(seg, TOL))
    for feat in fetch('ne_50m_rivers_lake_centerlines.geojson')['features']:
        nm = ((feat.get('properties') or {}).get('name') or '').strip()
        if nm not in RIVERS:
            continue
        g = feat['geometry']
        lines = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
        for ln in lines:
            for seg in clip([(p[0], p[1]) for p in ln]):
                rivers.append(dp(seg, TOL / 2))       # 河是主角，留细一点

    # 地形骨架。环不做 bbox 裁剪：越界部分由 viewBox 裁掉即可，
    # 几何裁剪反而会把闭合环切开
    terrain = []
    for feat in fetch('ne_50m_geography_regions_polys.geojson')['features']:
        pr = feat.get('properties') or {}
        hit = TERRAIN.get((pr.get('NAME') or '').strip())
        if not hit:
            continue
        nm, cls = hit
        g = feat['geometry']
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        ring = max((pl[0] for pl in polys), key=len)
        pts = dp([(q[0], q[1]) for q in ring], 0.12)
        if len(pts) < 6:
            continue
        cx = sum(q[0] for q in pts) / len(pts)
        cy = sum(q[1] for q in pts) / len(pts)
        pj = [project(x0, y0) for x0, y0 in pts]
        d = 'M' + 'L'.join('%.1f %.1f' % q for q in pj) + 'Z'
        c = project(cx, cy)
        terrain.append({'n': nm, 'cls': cls, 'd': d if cls == 'mtn' else '',
                        'c': [round(c[0], 1), round(c[1], 1)],
                        'rank': int(pr.get('SCALERANK') or 4)})
    print('  地形 %d 处（要 %d 处，缺的是 NE 里没有的名字）'
          % (len(terrain), len(TERRAIN)))
    missing = set(v[0] for v in TERRAIN.values()) - set(t['n'] for t in terrain)
    if missing:
        print('  缺：', '、'.join(sorted(missing)))

    w, s, e, n = BBOX
    k = math.cos(math.radians(LAT0))
    H = 1000.0 * (n - s) / ((e - w) * k)
    src = '''// basemap.js — 叙事小地图的底图。**生成物，不要手改**：
// 改了去跑 tools/mining/build_basemap.py。
//
// 只有海岸线与黄河、长江，没有国界。理由见那个脚本的抬头：授权（Natural Earth
// 是公共领域，不必挂外部瓦片）、政区（国界画法有争议，一张小图没必要卷进去）、
// 贴题（页名就叫「王朝之河」）。
//
// **河道是今天的河道。** 黄河历史上改道二十余次，1128–1855 的七百年间夺淮入海，
// 河口在今道以南数百公里；图上的河只是参照线，不是任何一个朝代的河。
//
// 投影：等距圆柱，x 按中纬 %.0f°N 的 cos 压缩。不等积也不等角，在本图范围内
// 形变可接受，换来的是放点只需一次线性映射。前端与生成脚本共用同一个 project()。
export const BASEMAP = {
  bbox: [%.1f, %.1f, %.1f, %.1f],       // 西 南 东 北
  lat0: %.1f,
  w: 1000, h: %.1f,
  tol: %.3f,                            // 抽稀容差（度）
  src: 'Natural Earth 1:50m physical（公共领域）',
  coast: '%s',
  rivers: '%s',
  // 地形骨架：mtn 画填充＋标名，flat 只标名。见 build_basemap.py 的 TERRAIN
  terrain: %s,
};

/** 经纬 → 视图坐标。与 tools/mining/build_basemap.py 的 project() 必须一致。 */
export function project(lon, lat) {
  const [w, s, e, n] = BASEMAP.bbox;
  const k = Math.cos((BASEMAP.lat0 * Math.PI) / 180);
  const W = (e - w) * k;
  return [(1000 * (lon - w) * k) / W, (1000 * (n - lat)) / W];
}
''' % (LAT0, w, s, e, n, LAT0, H, TOL, path(coast), path(rivers),
       json.dumps(terrain, ensure_ascii=False))
    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(src)
    print('写出 %s：海岸 %d 段、河 %d 段，共 %.1f KB'
          % (OUT, len(coast), len(rivers), len(src.encode('utf-8')) / 1024))


if __name__ == '__main__':
    main()
