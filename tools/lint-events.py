# -*- coding: utf-8 -*-
"""events.js 的逐行体检。改这个文件多半是脚本批量改的,一次手滑就整站白屏。

今天就出过一次:给赵飞燕写 yc 时,我在 Python 里把一句话拆成两段字符串拼接,
结果 JS 那边成了 '…甚少。''另有…' —— 两个相邻的字符串字面量。整个 events.js
语法错,依赖它的模块全崩,页面一片空白,而浏览器只报一句「Unexpected string」。

改完 events.js 就跑一遍这个。
"""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = io.open(os.path.join(ROOT, "js/events.js"), encoding="utf-8").read()
# d 键合法性对照表（2026-09-01 外审折子采纳项：d 必须存在于 dynasties.js）
_dd = io.open(os.path.join(ROOT, "js/dynasties.js"), encoding="utf-8").read()
DYN_KEYS = set(re.findall(r"D\('(\w+)'", _dd))
body = s[s.index("export const EVENTS = ["):]
bad = 0
seen = {}
warn_cf = []
for i, line in enumerate(body.splitlines(), 1):
    t = line.strip()
    if not t.startswith("{ y:"):
        continue
    def err(msg):
        global bad
        bad += 1
        print("  ✗ %s\n    %s" % (msg, t[:130]))
    if t.count("'") % 2:
        err("单引号不成对")
    if "''" in t or re.search(r"'\s+'", t):
        err("相邻的字符串字面量(多半是拼接时多写了一对引号)")
    if not t.endswith("},"):
        err("行尾不是 },")
    m = re.search(r"\by: (-?\d+)", t); n = re.search(r"n: '([^']+)'", t)
    w = re.search(r"w: '([^']+)'", t); k = re.search(r"k: '(\w+)'", t)
    NO_W_OK = {'李纲锏', '中山长城', '燕长城', '秦昭王长城', '北齐长城', '隋长城', '淳化元宝金钱', '绿松石龙形器', '三道岗沉船', '簪花', '金鱼村窖藏', '象纹铜铙', '法书要录', '金马小像', '琅琊刻石', '乃孙作祖己鼎', '青釉堆塑谷仓罐', '乾隆石经',
    # 海外批五条（2026-09-01，判官裁 w 留空族：馆藏单件 zh/en 维基皆无专条或 w 判留空）
    '弥勒佛鎏金铜像', '赵见憘造像碑', '328窟供养菩萨像', '耀州窑睡童枕', '玫茵堂鸡缸杯',
    '马蹄金'}  # 甲批 2026-09-01：真身标题被同名植物占位、金币义无条，wsrc 挂漢書/卷006  # 无维基条判例：维基锚是服务不是门槛（象纹铜铙 2026-08-26 入：六候选REST实测皆missing，卡即百科自足；琅琊刻石 2026-08-26 入：琅琊刻石/琅邪刻石/瑯琊刻石/琅琊台刻石/瑯琊臺刻石五种写法 REST 实测皆 404，原文走维基文库《瑯邪臺刻石》；青釉堆塑谷仓罐 2026-08-26 入：正名 REST 404，类目条魂瓶虽200但系一类非一件、库内无个体挂类目先例，照金马小像判例不挂）
    if not w and n and n.group(1) in NO_W_OK:
        w = True
    if not (m and n and w and k):
        err("缺 y / n / w / k")
        continue
    key = (int(m.group(1)), n.group(1))
    if key in seen:
        err("与第 %d 行同年同名" % seen[key])
    seen[key] = i
    y2 = re.search(r"y2: (-?\d+)", t)
    if y2 and int(y2.group(1)) < int(m.group(1)):
        err("y2 早于 y")
    # 2026-09-01 外审折子采纳五查
    d = re.search(r"d: '(\w+)'", t)
    if d and d.group(1) not in DYN_KEYS:
        err("d 键不在 dynasties.js: %s" % d.group(1))
    u1 = re.search(r"u1: (-?\d+)", t); u2 = re.search(r"u2: (-?\d+)", t)
    if u1 and u2:
        a, b = int(u1.group(1)), int(u2.group(1))
        if a > b:
            err("u1 晚于 u2")
        yv = int(m.group(1))
        U_WINDOW_OK = {'女史箴图'}  # y 锚传称原作层、u 窗锚现存摹本层——双层语义并存，候数据模型冻结案（2026-09-01 外审批红存案）
        if (yv < a or yv > b) and not (n and n.group(1) in U_WINDOW_OK):
            err("y 不在 u1/u2 窗内")
        if not re.search(r"cf: \d", t):
            warn_cf.append(n.group(1) if n else t[:40])  # 存量欠账（131 处，2026-09-01 实测）：只警告不拦，回填归数据模型冻结案
    if k and k.group(1) == 'era':
        if not y2:
            err("era 缺 y2")
        if not d:
            err("era 缺 d")
    ya = re.search(r"ya: '([^']+)'", t)
    disp = ya.group(1) if ya else n.group(1)   # 图上写的是雅名(有则用)
    # 与 views-lanes.js 的排布一致:两列、每列五字;名字里有「·」「、」则在那里断
    cut = max(disp.find("·"), disp.find("、"))
    if 0 < cut < len(disp) - 1:
        fits = cut <= 5 and len(disp) - cut - 1 <= 5
    else:
        fits = len(disp) <= 10
    if not fits:
        err("图上排不下(两列每列五字;有「·」「、」则在此断)")
if warn_cf:
    print("（警告：有断代窗未声明 cf 共 %d 条——存量欠账，候数据模型冻结案回填，不拦提交）" % len(warn_cf))
print("检查 %d 条,%d 处问题" % (len(seen), bad))
sys.exit(1 if bad else 0)
