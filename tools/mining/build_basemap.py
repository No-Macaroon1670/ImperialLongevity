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
# 只留这几条河。Natural Earth 的 name 字段用英文
RIVERS = {'Yangtze', 'Yangtze Kiang', 'Huang He', 'Yellow'}


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
    """Douglas–Peucker 抽稀。自己写十几行，省得为一张小图引一个库。"""
    if len(pts) < 3:
        return pts
    x0, y0 = pts[0]
    x1, y1 = pts[-1]
    dx, dy = x1 - x0, y1 - y0
    den = math.hypot(dx, dy) or 1e-9
    far, fi = -1.0, 0
    for i in range(1, len(pts) - 1):
        x, y = pts[i]
        d = abs(dy * x - dx * y + x1 * y0 - y1 * x0) / den
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
        nm = (feat.get('properties') or {}).get('name') or ''
        if not any(r.lower() in nm.lower() for r in RIVERS):
            continue
        g = feat['geometry']
        lines = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
        for ln in lines:
            for seg in clip([(p[0], p[1]) for p in ln]):
                rivers.append(dp(seg, TOL / 2))       # 河是主角，留细一点

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
};

/** 经纬 → 视图坐标。与 tools/mining/build_basemap.py 的 project() 必须一致。 */
export function project(lon, lat) {
  const [w, s, e, n] = BASEMAP.bbox;
  const k = Math.cos((BASEMAP.lat0 * Math.PI) / 180);
  const W = (e - w) * k;
  return [(1000 * (lon - w) * k) / W, (1000 * (n - lat)) / W];
}
''' % (LAT0, w, s, e, n, LAT0, H, TOL, path(coast), path(rivers))
    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(src)
    print('写出 %s：海岸 %d 段、河 %d 段，共 %.1f KB'
          % (OUT, len(coast), len(rivers), len(src.encode('utf-8')) / 1024))


if __name__ == '__main__':
    main()
