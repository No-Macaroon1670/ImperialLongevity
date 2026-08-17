# -*- coding: utf-8 -*-
"""应用三批文物定年调查，并把「断代窗口」从 y/y2 拆出来。

## 为什么要拆

`y`/`y2` 一直担着两种意思，只靠类别推断：
    her/inst/era  —— 真的持续了那么久（莫高窟确实从 366 存在到 1368）
    art           —— 断代窗口（四羊方尊铸成于某一刻，只知落在这段里）
靠 `k` 猜有两个漏洞：art 里真有跨度的（样式雷那种）会被当成窗口，
而「有起讫、边界又不确定」的东西（夏商）根本无从表示。

拆开之后：
    y / y2   —— **一律是存续**。没有 y2 就是时点。
    u1 / u2  —— 锚点可能落在哪个区间。误差棒画的是它。
四类情形从此都表示得了，`evAnchor` 与误差棒也不必再猜类别。

## 迁移规则（art 且有 y2）

    窗口 = agent 给的新区间（narrow/remodel），否则沿用原 y–y2
    锚点 = agent 给的 yb，否则取窗口中点
    agent 给了 yb 且 conf 为「高」 —— 那是定死的年份，窗口整个去掉

## 不自动改的

结构性问题（「不是单件器物」「原作与摹本混为一谈」）改的是条目**是什么**，
不是**在哪一年**：敦煌遗书是五万卷的总称、样式雷是雷氏家族的图档、
定陵凤冠是四顶。这些要改名或拆条，得人来定，脚本只列出来。
"""
import io, json, os, re, sys

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
HERE = os.path.dirname(os.path.abspath(__file__))
SCRATCH = (r"C:/Users/ziyi_/AppData/Local/Temp/claude/C--Users-ziyi--Claude/"
           r"1fabfb86-a26a-4b09-be7f-6c753fa25f61/scratchpad")
EVENTS = os.path.join(ROOT, "js/events.js")


def astro(s):
    """「前221」→ -220。agent 一律写人类读法的公元前年份，换算只在这里做一次。"""
    if s is None or s == "":
        return None
    s = str(s).strip()
    m = re.match(r"^前\s*(\d+)$", s)
    if m:
        return -(int(m.group(1)) - 1)
    if re.match(r"^-\d", s):
        raise SystemExit("拒收带负号的年份 %r——agent 该写「前N」" % s)
    return int(s)


dec = {}
for f in ["date_ancient.json", "date_mid.json", "date_late.json"]:
    for r in json.load(io.open(os.path.join(SCRATCH, f), encoding="utf-8")):
        dec[r["n"]] = r

src = io.open(EVENTS, encoding="utf-8").read()
cut = src.index("export const EVENTS")
head, body = src[:cut], src[cut:]

out, changed, migrated, structural, unmatched = [], 0, 0, [], []
for ln in body.split("\n"):
    m = re.match(r"^(  \{ )(.*?)(,?\s*\},?)$", ln)
    if not m or "k: 'art'" not in ln:
        out.append(ln)
        continue
    inner = m.group(2)
    n = re.search(r"n: '([^']+)'", inner).group(1)
    y = int(re.search(r"y: (-?\d+)", inner).group(1))
    my2 = re.search(r"y2: (-?\d+)", inner)
    if not my2:                       # 本来就是时点，不涉及窗口
        out.append(ln)
        continue
    y2 = int(my2.group(1))

    d = dec.get(n)
    if not d:
        unmatched.append(n)
    act = (d or {}).get("action", "keep")

    # 1) 窗口
    lo, hi = y, y2
    if d and d.get("y") and d.get("y2"):
        lo, hi = astro(d["y"]), astro(d["y2"])
        if lo > hi:
            raise SystemExit("%s 的新区间颠倒了：%s–%s" % (n, d["y"], d["y2"]))
    # 2) 锚点
    yb = astro(d.get("yb")) if d and d.get("yb") else None
    anchor = yb if yb is not None else (lo + hi) // 2
    # 3) conf 高的 yb 是定死的年份，窗口去掉
    firm = yb is not None and (d or {}).get("conf") == "高"

    if act == "remodel" and not (d.get("yb") or d.get("y")):
        structural.append((n, d.get("why", "")[:60]))

    if act != "keep":
        changed += 1
    migrated += 1

    inner = re.sub(r"y: -?\d+", "y: %d" % anchor, inner, count=1)
    inner = re.sub(r",\s*y2: -?\d+", "", inner)          # y2 让位给 u1/u2
    inner = re.sub(r",\s*u[12]: -?\d+", "", inner)       # 重跑时先清旧值
    if not firm:
        inner = inner.rstrip().rstrip(",") + ", u1: %d, u2: %d" % (lo, hi)
    out.append("%s%s }," % (m.group(1), inner.rstrip().rstrip(",")))

io.open(EVENTS, "w", encoding="utf-8", newline="\n").write(head + "\n".join(out))
print("迁移 %d 条 art（其中 %d 条采纳了 agent 的改动）" % (migrated, changed))
if unmatched:
    print("！调查里没有的 art 条目 %d 条：%s" % (len(unmatched), unmatched[:6]), file=sys.stderr)
print("\n结构性问题 %d 条——改的是「这条是什么」，留给人定：" % len(structural))
for n, why in structural:
    print("   %-14s %s" % (n, why))
