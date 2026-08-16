# -*- coding: utf-8 -*-
"""量出事件轨上还剩哪些空档:按相邻事件的年差排序,列出最大的若干段。

只看画在轨上的(era 类已改画成皇帝格子的外套,不占轨),故与用户在图上看到的一致。
"""
import io, re, os, sys

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "js/events.js")
src = io.open(path, encoding="utf-8").read()
if "export const EVENTS" in src:
    src = src[src.index("export const EVENTS = ["):]
rows = []
for line in src.splitlines():
    m = re.match(r"\s*\{ (.*) \},?$", line)
    if not m:
        continue
    d = {}
    for kv in re.finditer(r"(\w+): (?:'([^']*)'|(-?\d+))", m.group(1)):
        k, sv, nv = kv.groups()
        d[k] = sv if sv is not None else int(nv)
    if "w" in d and d.get("k") != "era":
        rows.append(d)
rows.sort(key=lambda e: e["y"])
fy = lambda y: ("前%d" % -y) if y < 0 else str(y)
print("轨上事件 %d 条,%s – %s" % (len(rows), fy(rows[0]["y"]), fy(rows[-1]["y"])))
gaps = []
for a, b in zip(rows, rows[1:]):
    gaps.append((b["y"] - a["y"], a, b))
gaps.sort(key=lambda g: -g[0])
print("\n最大的 20 段空档:")
for d, a, b in gaps[:20]:
    print("  %4d 年  %s (%s) → %s (%s)" % (d, fy(a["y"]), a["n"], fy(b["y"]), b["n"]))
# 每世纪条数
from collections import Counter
c = Counter((e["y"] // 100) * 100 for e in rows)
print("\n每世纪条数(空缺者为零):")
for cen in range(-300, 2000, 100):
    print("  %5s: %s" % (fy(cen), "█" * c.get(cen, 0) + (" %d" % c[cen] if c.get(cen) else " 0")))
