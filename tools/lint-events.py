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
body = s[s.index("export const EVENTS = ["):]
bad = 0
seen = {}
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
    NO_W_OK = {'绿松石龙形器', '三道岗沉船', '簪花', '金鱼村窖藏', '象纹铜铙', '法书要录', '金马小像', '琅琊刻石', '乃孙作祖己鼎'}  # 无维基条判例：维基锚是服务不是门槛（象纹铜铙 2026-08-26 入：六候选REST实测皆missing，卡即百科自足；琅琊刻石 2026-08-26 入：琅琊刻石/琅邪刻石/瑯琊刻石/琅琊台刻石/瑯琊臺刻石五种写法 REST 实测皆 404，原文走维基文库《瑯邪臺刻石》）
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
print("检查 %d 条,%d 处问题" % (len(seen), bad))
sys.exit(1 if bad else 0)
