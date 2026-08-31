# -*- coding: utf-8 -*-
"""生成叙事小地图的底图：js/basemap.js。

**只画海岸线、水系与地形骨架，不画国界。** 三个理由，都很实际：

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

数据：Natural Earth（coastline、rivers_lake_centerlines、lakes、
geography_regions_polys），经 Douglas–Peucker 抽稀。抽稀容差写在产物里，
便于日后核对。**主用 1:50m，只有 50m 里根本没有的两样退到 1:10m**
（淮河、洞庭湖，见下面 RIVERS_10M / LAKES 的注释）。混用两个比例尺是有代价的：
10m 的原始点比 50m 密一个量级，同一个容差抽出来的线要细一档——但比例尺不齐
远好过东西不在图上。两个 10m 文件合计约 12 MB，构建时多下这些，产物不受影响。

**济水不画（2026-08-26 底图水系扩建案）。** 四渎里的江、河、淮都进了图，济水
没有：它是历史河道，唐宋以后先被黄河多次夺流，1855 年黄河北徙后干脆走了济水
故道入海，今天地面上已无独立的济水。Natural Earth 是**今天的**地表数据，
必然没有这条线，去别的现代数据集里找也一样没有。照库规「缺失远好过猜错」，
**不凭印象画一条从荥阳到利津的线**——那等于伪造地理数据。要补济水得走一手
历史底本（杨守敬《历代舆地图》一类的历史地图集，或谭其骧《中国历史地图集》
可对照的河道），逐段读图取点、注明底本与年代分层，那是另一个案子的工作量，
不在本轮。淮河同理只取 NE 的今道：今天的淮河干流下游是 1194 年黄河夺淮之后
反复改出来的，与先秦「四渎」的淮不是同一条线，图上的水系一律只是参照线。

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
# ── 水系 ──────────────────────────────────────────────────────────────
# **Natural Earth 的 name 字段要照它自己的写法**，而且一条大河在 NE 里是**逐段
# 分开的要素、每段各有各的名字**——这是本文件踩过两次的同一个坑。
#
# 踩坑一（旧账）：上一版写的是 {'Yangtze','Yangtze Kiang','Huang He','Yellow'}，
# 于是黄河一段没有、长江只剩下游三段——图上「黄河」两个字底下空空如也
# （用户实测指出）。改成 {'Huang','Chang Jiang','Yangtze'} 才把两条河接上。
#
# 踩坑二（2026-08-26 底图水系扩建案，「长江断得早」）：上一版仍然只有长江的
# **下两段**。NE 50m 里长江是五段接力，五段的 scalerank 全是 1（NE 自己也认它
# 是同一条一等大河），首尾坐标严丝合缝地对得上——实测的接头如下：
#
#     Tuotuo       沱沱河（源头） 90.7947,34.3004 → 92.9928,34.1003
#     Tongtian     通天河         92.9928,34.1003 → 98.5415,31.6898
#     Jinsha       金沙江         98.5415,31.6898 → 103.8507,28.6680  (name_en=Yangtze)
#     Chang Jiang  川江—荆江       103.8507,28.6680 → 113.1277,29.4628  (name_en=Yangtze)
#     Yangtze      下游           113.1277,29.4628 → 120.0739,31.9603
#
# 旧匹配集只收后两段，长江于是从宜宾（103.85°E）才开始——**上游一千多公里、
# 整整十三个经度是空的**，「断得早」断在这里。注意 name_en 救不了场：金沙江的
# name_en 确实是 Yangtze，但通天河、沱沱河的 name_en 就是它们自己的名字，
# 只认 name_en=='Yangtze' 照样会断在 98.54°E。只能按段名逐个列。
# 下游终点 120.07°E 不是漏段：再往东的长江口在 NE 里已经宽成海，归 coastline 画。
#
# 黄河同查，**这次没毛病**：'Huang' 一个名字就吃到两个要素——name_en=Huang 的
# 上中游（96.1642,35.1296 → 114.8309,35.0198）与 name_en=Yellow 的下游
# （114.8377,35.0198 → 119.0357,37.8092，入渤海），两者在 114.83°E 只差 0.007°
# （约 600 m，本图 1000 单位宽下不到 0.15 个单位，看不出来）。另有一条
# featurecla='Lake Centerline' 的 'Huang'，是穿扎陵湖—鄂陵湖的那截河心线，
# 本来就该画，一并收下。
#
# **用全等匹配**，子串匹配会把别的 Huang 什么江也捞进来。
RIVERS = {
    'Huang',                                     # 黄河（上中游＋下游＋湖心线）
    'Tuotuo', 'Tongtian', 'Jinsha',              # 长江上游三段（本轮补）
    'Chang Jiang', 'Yangtze',                    # 长江中下游
}

# 淮河：**50m 里根本没有**（2026-08-26 实测：50m rivers 在本图范围内共 63 个
# 要素，逐个看过，没有任何一条叫 Huai 或 name_en 沾 Huai 的）。退到 1:10m 才有，
# 而且照样是分段的，且第二段的名字是坏的：
#
#     Huai   淮河上中游  113.7205,32.4160 → 116.5214,32.5012   (桐柏山东麓 → 淮南)
#     Hudi   淮河下游    116.5214,32.5012 → 119.6162,32.3539   (淮南 → 洪泽湖 → 入海)
#
# `Hudi` 不是别的河，就是淮河下游被 NE 写坏了的名字。三条硬证据：①接头坐标
# **一位不差**地等于 Huai 的终点（116.5214,32.5012）；②featurecla 与 scalerank
# 都跟 Huai 一样（River / 7）；③它的走向穿过洪泽湖（NE 自己给了 'Hudi' 的
# Lake Centerline 段，117.76–119.34°E，正是洪泽湖的湖心线），出海口在 119.62°E，
# 那正是苏北灌溉总渠—淮河入海水道的位置。只收 Huai 的话，淮河会变成一条悬在
# 113.7–116.5°E 之间的断头线——正是本案要修的「断得早」，不能一边修长江一边
# 在淮河上重犯。若日后觉得这个判断太进取，删掉 'Hudi' 即可，淮河退回上中游。
RIVERS_10M = {'Huai', 'Hudi'}

# ── 风格化大湖（2026-08-26 底图水系扩建案）─────────────────────────────
# 古舆图的惯例：水系不止是线，几个标志性的湖是读图的锚。四个候选——洞庭、
# 鄱阳、太湖、青海湖——按 NE 自己的 name 全等匹配，中文名自己给（NE 的 name_zh
# 这四个倒是都对，但沿用 TERRAIN 的规矩：中文名由本文件负责，不看 NE 的脸色）。
#
# **为什么湖也走 10m**：洞庭湖在 ne_50m_lakes 里**没有多边形**（实测：50m lakes
# 在本图范围内 49 个多边形，洞庭盆地 111.5–113.6°E / 28.4–30.0°N 内一个都没有；
# 50m 只在 rivers 里留了一条穿洞庭的 'Yuan' 湖心线）。既然为洞庭非下 10m 不可，
# 四个湖就都从 10m 取——同一个文件、同一档细度，省得四个湖三种精度。
#
# **洞庭湖只画 NE 点了名的那一块。** 今天的洞庭已被围垦切成东、南、西数片，
# NE 10m 给了三个多边形，只有主体那块（111.96–112.90°E, 28.76–29.09°N）带
# name='Dongting Hu'，另外两块（112.77–113.07/29.15–29.50 与
# 112.41–112.56/29.09–29.27）**无名**。按位置把无名多边形认作东洞庭湖再拼上去，
# 是「按地方猜身份」——本库不做，与济水同一条规矩。故图上的洞庭比读者印象里小，
# 也偏西南，岳阳那一侧的东洞庭缺着。要补，得有一个按名字而非按位置的判据。
#
# 另有一个同名陷阱：10m lakes 里 'Po Hu' 的 name_en 是 'Poyang Lake'（实际是
# 鄱阳湖北边的泊湖，116.30–116.56°E 的小湖）。全等匹配 name='Poyang Hu' 不会
# 认错，但**千万别改成匹配 name_en**。
LAKES = {
    'Dongting Hu': '洞庭湖',
    'Poyang Hu': '鄱阳湖',
    'Tai Hu': '太湖',
    'Qinghai Hu': '青海湖',
}
# 湖的抽稀容差。案由里说「湖是配角，比河粗些无妨」，但容差是**绝对度数**而湖是
# 小地物：太湖东西才 0.66°，用河的 0.03 会把它压成一个六边形（长江三千公里，
# 同一个容差只是把弯抹平一点）。四个多边形的字节开销可以忽略，故反过来给更细的
# 0.02——约合本图 0.4 个视图单位，地图页放大到 z=2 也还是湖的样子。
LAKE_TOL = 0.02

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


def take_rivers(gj, names, tol, out, seen):
    """按 name 全等挑河段，顺手记账：哪个名字取到了、跨多少经度。

    记账不是装饰。这个文件踩过两次「某一段的 name 不是想当然的那个」，
    产物是一坨路径字符串，肉眼看不出少了哪一段；构建时按名字打一行
    bbox，下次谁改匹配集，少了什么当场就看得见。
    """
    for feat in gj['features']:
        pr = feat.get('properties') or {}
        nm = (pr.get('name') or '').strip()
        if nm not in names:
            continue
        seen.setdefault(nm, [])
        g = feat['geometry']
        lines = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
        for ln in lines:
            for seg in clip([(p[0], p[1]) for p in ln]):
                out.append(dp(seg, tol))
                seen[nm].extend(seg)


def report(seen, want, label):
    for nm in sorted(want):
        pts = seen.get(nm) or []
        if not pts:
            print('  ✗ %s：%s 里没有这个名字' % (label, nm))
            continue
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        print('  %-12s %5d 点  %.2f–%.2f°E  %.2f–%.2f°N'
              % (nm, len(pts), min(xs), max(xs), min(ys), max(ys)))


# ── 世界版底图（世界图双版案，2026-08-31 库主点火；设计定案 2026-08-24 三答）──
# 只产海岸线一样：世界版是流散与出海的舞台，河湖地形都留给中国版。
# **中国居中（150°E）**：太平洋居中、美洲在右、欧洲在左——流散的弧照真实航向
# 向右过洋（大英/宾大/波士顿诸点若用格林尼治居中会落在图左，弧要横穿大西洋，
# 方向就撒谎了）。代价是格陵兰在图缝处被切开，中文版世界地图的通例如此。
# 数据 Natural Earth 1:110m（公共领域），**vendored 一次**：首跑落
# tools/mining/vendor/，以后重建零外呼（geocache 同族道理）。
W_OUT = os.path.join(ROOT, 'js/basemap-world.js')
W_CENTER = 150.0                 # 居中经线
W_LAT = (-60.0, 75.0)            # 南砍南极洲；北到挪威岸够用
W_TOL = 0.4                      # 110m 本就粗，0.4 度足矣


def fetch_vendored(name):
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vendor', name)
    if os.path.exists(p):
        print('  %s（vendored，零外呼）' % name)
        return json.load(io.open(p, encoding='utf-8'))
    gj = fetch(name)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    io.open(p, 'w', encoding='utf-8', newline='\n').write(json.dumps(gj))
    print('  已 vendor：%s' % p)
    return gj


def w_shift(lon):
    return ((lon - W_CENTER + 540.0) % 360.0) - 180.0


def w_clip(line):
    """平移居中后按纬度域裁剪；**跨缝必断**（相邻点平移后经度跳逾180度即是
    绕过了图缝，连线会横贯整图）。"""
    out, cur, prev = [], [], None
    for x, y in line:
        sx = w_shift(x)
        if not (W_LAT[0] <= y <= W_LAT[1]):
            if cur:
                out.append(cur)
            cur, prev = [], None
            continue
        if prev is not None and abs(sx - prev) > 180.0:
            if cur:
                out.append(cur)
            cur = []
        cur.append((sx, y))
        prev = sx
    if cur:
        out.append(cur)
    return [seg for seg in out if len(seg) >= 2]


def w_project(x, y):
    """平移后经纬 → 视图坐标。世界版取平直圆柱（lat0=0）：全球尺度上再作
    cos 压缩会把赤道带压歪，且这版不与中国版拼图，无须迁就。"""
    return (1000.0 * (x + 180.0) / 360.0, 1000.0 * (W_LAT[1] - y) / 360.0)


def w_path(segs):
    d = []
    for seg in segs:
        pts = [w_project(x, y) for x, y in seg]
        d.append('M' + 'L'.join('%.1f %.1f' % (a, b) for a, b in pts))
    return ''.join(d)


def build_world():
    coast = []
    for feat in fetch_vendored('ne_110m_coastline.geojson')['features']:
        g = feat['geometry']
        lines = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
        for ln in lines:
            for seg in w_clip([(p[0], p[1]) for p in ln]):
                coast.append(dp(seg, W_TOL))
    h = 1000.0 * (W_LAT[1] - W_LAT[0]) / 360.0
    body = ('// basemap-world.js — 世界版底图（世界图双版案）。**生成物，不要手改**：\n'
            '// 改了去跑 tools/mining/build_basemap.py。\n'
            '//\n'
            '// 只有海岸线：世界版是流散（出→藏）与出海事件的舞台，河湖地形留在中国版。\n'
            '// **中国居中（150°E）**，太平洋居中、美洲在右——流散的弧照真实航向向右过洋；\n'
            '// 图缝在大西洋 30°W，格陵兰在缝处被切开，中文版世界地图通例如此。\n'
            '// 投影：平直圆柱（不压缩）。数据 Natural Earth 1:110m（公共领域），\n'
            '// vendored 于 tools/mining/vendor/，重建零外呼。\n'
            'export const WORLDMAP = {\n'
            '  center: %.1f,\n'
            '  lat: [%.1f, %.1f],\n'
            '  w: 1000, h: %.1f,\n'
            '  tol: %.2f,\n'
            "  src: 'Natural Earth 1:110m coastline（公共领域）',\n"
            "  coast: '%s',\n"
            '};\n\n'
            '/** 经纬 → 世界版视图坐标。与 build_basemap.w_project() 必须一致。 */\n'
            'export function projectWorld(lon, lat) {\n'
            '  const x = ((lon - WORLDMAP.center + 540) %% 360) - 180;\n'
            '  return [1000 * (x + 180) / 360, 1000 * (WORLDMAP.lat[1] - lat) / 360];\n'
            '}\n') % (W_CENTER, W_LAT[0], W_LAT[1], h, W_TOL, w_path(coast))
    io.open(W_OUT, 'w', encoding='utf-8', newline='\n').write(body)
    print('写出 %s：海岸 %d 段，%d 字节' % (W_OUT, len(coast), len(body.encode('utf-8'))))


def main():
    sys.setrecursionlimit(10000)
    if '--world-only' in sys.argv:
        build_world()
        return
    build_world()
    coast, rivers, seen = [], [], {}
    for feat in fetch('ne_50m_coastline.geojson')['features']:
        g = feat['geometry']
        lines = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
        for ln in lines:
            for seg in clip([(p[0], p[1]) for p in ln]):
                coast.append(dp(seg, TOL))
    # 河是主角，留细一点（容差取海岸的一半）
    take_rivers(fetch('ne_50m_rivers_lake_centerlines.geojson'),
                RIVERS, TOL / 2, rivers, seen)
    report(seen, RIVERS, '50m rivers')
    # 淮河只在 10m 里有，容差要**放大**一档（直接用海岸那档 TOL）。这条容易想反：
    # 10m 的原始点密一个量级（实测 43 点/度，50m 的江河才 8–12 点/度），同一个
    # 0.03 抽下来淮河留 6–7 点/度、长江只有 3–4 点/度——淮河会比长江还皱，
    # 一条支流在图上比干流还热闹。放到 0.06 之后两边都落在 3.5–4.9 点/度，
    # 粗细才对得上。容差是几何偏差不是点距，别拿它当「精度旋钮」使
    take_rivers(fetch('ne_10m_rivers_lake_centerlines.geojson'),
                RIVERS_10M, TOL, rivers, seen)
    report(seen, RIVERS_10M, '10m rivers')

    # 大湖。闭合环不做 bbox 裁剪（同地形骨架：几何裁剪会把环切开），四个湖
    # 本来就整个在框内。一个名字若命中多个要素，取环点数最多的那个——
    # NE 偶有同名重复要素（50m 的 Lake Zaysan 就出现两次）
    lakes, best = [], {}
    for feat in fetch('ne_10m_lakes.geojson')['features']:
        pr = feat.get('properties') or {}
        nm = (pr.get('name') or '').strip()
        if nm not in LAKES:
            continue
        g = feat['geometry']
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        ring = max((pl[0] for pl in polys), key=len)
        if nm not in best or len(ring) > len(best[nm]):
            best[nm] = ring
    for nm, zh in LAKES.items():
        ring = best.get(nm)
        if not ring:
            print('  ✗ 10m lakes 里没有 %s（%s），本轮缺这个湖' % (nm, zh))
            continue
        pts = dp([(q[0], q[1]) for q in ring], LAKE_TOL)
        if len(pts) < 5:                       # 抽成三四个点就不是湖了，宁可不画
            print('  ✗ %s 抽稀后只剩 %d 点，不画' % (zh, len(pts)))
            continue
        cx = sum(q[0] for q in pts) / len(pts)
        cy = sum(q[1] for q in pts) / len(pts)
        c = project(cx, cy)
        xs = [q[0] for q in pts]
        ys = [q[1] for q in pts]
        print('  %-12s %-8s %3d→%-3d 点  %.2f–%.2f°E  %.2f–%.2f°N'
              % (nm, zh, len(ring), len(pts), min(xs), max(xs), min(ys), max(ys)))
        lakes.append({
            'n': zh,
            'd': 'M' + 'L'.join('%.1f %.1f' % project(x0, y0) for x0, y0 in pts) + 'Z',
            'c': [round(c[0], 1), round(c[1], 1)],
        })

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
// 只有海岸线、水系与地形骨架，没有国界。理由见那个脚本的抬头：授权（Natural
// Earth 是公共领域，不必挂外部瓦片）、政区（国界画法有争议，一张小图没必要
// 卷进去）、贴题（页名就叫「王朝之河」）。
//
// **河道是今天的河道。** 黄河历史上改道二十余次，1128–1855 的七百年间夺淮入海，
// 河口在今道以南数百公里；淮河今天的下游干流也是那次夺淮之后反复改出来的。
// 图上的水只是参照线，不是任何一个朝代的水。
//
// 水系收江、河、淮三条。**四渎的第四条济水不在图上**：它是历史河道，今天地面上
// 已无独立的济水，Natural Earth 这种今地表数据里必然没有，而本库不凭印象画线
// （「缺失远好过猜错」）。补它要走历史底本，另案。见 build_basemap.py 抬头。
//
// 投影：等距圆柱，x 按中纬 %.0f°N 的 cos 压缩。不等积也不等角，在本图范围内
// 形变可接受，换来的是放点只需一次线性映射。前端与生成脚本共用同一个 project()。
export const BASEMAP = {
  bbox: [%.1f, %.1f, %.1f, %.1f],       // 西 南 东 北
  lat0: %.1f,
  w: 1000, h: %.1f,
  tol: %.3f,                            // 抽稀容差（度）
  src: 'Natural Earth 1:50m physical；淮河与四湖取 1:10m（公共领域）',
  coast: '%s',
  // 黄河、长江（五段接力，源头起）、淮河。见 build_basemap.py 的 RIVERS
  rivers: '%s',
  // 风格化大湖：每个 {n 中文名, d 闭合路径, c 形心}。层序归渲染端——
  // **海岸之上、河之下**，河压在湖上，「长江过洞庭」那个「过」字才看得出来。
  // 要撤掉某个湖，删这个数组里的一项再跑一次脚本即可（也可在 CSS 里按
  // data-lake 属性藏，见 styles.css 的 .pl-lake）。见 build_basemap.py 的 LAKES
  lakes: %s,
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
       json.dumps(lakes, ensure_ascii=False),
       json.dumps(terrain, ensure_ascii=False))
    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(src)
    print('写出 %s：海岸 %d 段、河 %d 段、湖 %d 个，共 %.1f KB'
          % (OUT, len(coast), len(rivers), len(lakes),
             len(src.encode('utf-8')) / 1024))


if __name__ == '__main__':
    main()
