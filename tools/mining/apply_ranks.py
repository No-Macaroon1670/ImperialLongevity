# -*- coding: utf-8 -*-
"""把 rank.py 算出的分量写回 events.js 的 `r` 字段。

rank.py 只产 ranks.json,一直缺这一步——先前的分量是手工搬的,
于是新增条目长期没有 r（今天之前有 315 条是空的,锚点集还停在 408 条时代的旧账）。

**按 (y, n) 配对**,所以这一步必须跑在任何改 `y` 的操作之前。
文物定年那批要改 39 条的年份,顺序反了就有几十条配不上——而且是静默配不上。
"""
import io, json, os, re, sys

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
HERE = os.path.dirname(os.path.abspath(__file__))
EVENTS = os.path.join(ROOT, "js/events.js")

ranks = {(r["y"], r["n"]): r["r"]
         for r in json.load(io.open(os.path.join(HERE, "ranks.json"), encoding="utf-8"))}
print("ranks.json %d 条" % len(ranks))

src = io.open(EVENTS, encoding="utf-8").read()
head, body = src[:src.index("export const EVENTS")], src[src.index("export const EVENTS"):]

hit = miss = 0
out = []
for ln in body.split("\n"):
    m = re.match(r"^(  \{ )(.*?)(,?\s*\},?)$", ln)
    if not m:
        out.append(ln)
        continue
    inner = m.group(2)
    my = re.search(r"y: (-?\d+)", inner)
    mn = re.search(r"n: '([^']+)'", inner)
    if not (my and mn):
        out.append(ln)
        continue
    key = (int(my.group(1)), mn.group(1))
    if key not in ranks:
        miss += 1
        out.append(ln)
        continue
    hit += 1
    # 去掉旧的 r,再统一补到末尾——原先 r 的位置各行不一(有的在 ya 前有的在后),
    # 就地替换要写好几种模式,不如摘掉重挂
    inner = re.sub(r",\s*r: \d+", "", inner).rstrip().rstrip(",")
    out.append("%s%s, r: %d }," % (m.group(1), inner, ranks[key]))

print("配上 %d 条,配不上 %d 条" % (hit, miss))
if miss:
    print("！配不上的多半是 (y, n) 变过——检查是不是先改了年份", file=sys.stderr)
io.open(EVENTS, "w", encoding="utf-8", newline="\n").write(head + "\n".join(out))
