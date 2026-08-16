# -*- coding: utf-8 -*-
"""按 pageid 去重合并新一批事件,并导出一份供 agent 拟雅名的清单。

字符串去重会漏掉繁简/异名同条目(晉滅吳之戰 == 晋灭吴之战 == pageid 306558),
所以条目名一律送 zh.wikipedia 查 pageid,再按 pageid 判重。

只走 REST summary 接口:action=query 的 titles 不做繁简转换(昆阳之战↔昆陽之戰),
会把大量真实条目误判为「不存在」。REST 会转换,但连发数十次会被限流,
故加 0.25s 间隔、三次退避重试,并把结果缓存到 pidcache.json——重跑几乎不发请求。
"""
import io, json, re, os, sys, time, urllib.parse, urllib.request

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
EV = os.path.join(ROOT, "js/events.js")
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "pidcache.json")

src = io.open(EV, encoding="utf-8").read()
body = src[src.index("export const EVENTS = ["):]
existing = []
for line in body.splitlines():
    m = re.match(r"\s*\{ (.*) \},?$", line)
    if not m:
        continue
    d = {}
    for kv in re.finditer(r"(\w+): (?:'([^']*)'|(-?\d+))", m.group(1)):
        k, sv, nv = kv.groups()
        d[k] = sv if sv is not None else int(nv)
    if "w" in d:
        existing.append(d)
print("现有 %d 条" % len(existing))

new = json.load(io.open(sys.argv[1], encoding="utf-8")) if len(sys.argv) > 1 else []

cache = json.load(io.open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}

def rest_pageid(title):
    if title in cache:
        return cache[title]
    url = "https://zh.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title, safe="")
    req = urllib.request.Request(url, headers={"User-Agent": "ImperialLongevity/1.0 (dedupe)"})
    # 只缓存「问到了」的结果。429 是限流不是「查无此条目」——
    # 把限流当成不存在缓存下来,会静默丢掉真实事件(实测误杀三条)
    for attempt in range(6):
        try:
            d = json.load(urllib.request.urlopen(req, timeout=30))
            val = [d.get("pageid"), d.get("title")] if d.get("type") == "standard" else None
            cache[title] = val
            time.sleep(0.4)
            return val
        except urllib.error.HTTPError as ex:
            if ex.code == 404:                       # 这才是真的没有
                cache[title] = None
                time.sleep(0.4)
                return None
            time.sleep(4 * (attempt + 1))
        except Exception:
            time.sleep(4 * (attempt + 1))
    print("  !! %s → 六次皆败(多半是限流),本轮不判此条" % title)
    return "?"                                       # 未知:既不判重也不判无

allt = sorted({e["w"] for e in existing} | {e["w"] for e in new})
todo = [t for t in allt if t not in cache]
if todo:
    print("查 pageid:%d 条(缓存已有 %d)" % (len(todo), len(allt) - len(todo)))
for t in allt:
    rest_pageid(t)
json.dump(cache, io.open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
missing = [t for t in allt if not cache.get(t)]
if missing:
    print("确实查无此条目(%d):" % len(missing), missing)

seen = {}
for e in existing:
    c = cache.get(e["w"])
    if c:
        seen.setdefault(c[0], e)

merged = list(existing)
dropped = []
for c in new:
    got = cache.get(c["w"])
    if not got:
        dropped.append("%s %s (%s) → 条目不存在" % (c["y"], c["n"], c["w"])); continue
    p = got[0]
    if p in seen:
        dropped.append("%s %s (%s) → 与已有「%s」同条目 pageid=%s"
                       % (c["y"], c["n"], c["w"], seen[p]["n"], p)); continue
    seen[p] = c
    merged.append(c)

merged.sort(key=lambda e: (e["y"], e.get("y2", e["y"])))
lines = []
for e in merged:
    parts = ["y: %d" % e["y"]]
    if e.get("y2"): parts.append("y2: %d" % e["y2"])
    parts += ["k: '%s'" % e["k"], "n: '%s'" % e["n"], "w: '%s'" % e["w"]]
    if e.get("b"): parts.append("b: '%s'" % e["b"])
    if e.get("d"): parts.append("d: '%s'" % e["d"])
    lines.append("  { " + ", ".join(parts) + " },")
io.open(os.path.join(HERE, "merged2.txt"), "w", encoding="utf-8").write("\n".join(lines))
print("原有 %d + 新增 %d = %d" % (len(existing), len(merged) - len(existing), len(merged)))
print("丢弃 %d:" % len(dropped))
for d in dropped:
    print("  " + d)

# 供 agent 拟雅名的清单:分三段导出
def fy(y): return ("前%d" % -y) if y < 0 else str(y)
cuts = [(-2000, 316), (317, 1126), (1127, 3000)]
for i, (a, b) in enumerate(cuts, 1):
    rows = [e for e in merged if a <= e["y"] <= b and e["k"] != "era"]
    out = "\n".join("%s | %s | %s | %s" % (fy(e["y"]), e["k"], e["n"], e["w"]) for e in rows)
    io.open(os.path.join(HERE, "ya%d.txt" % i), "w", encoding="utf-8").write(out)
    print("ya%d.txt %d 条 (%s–%s)" % (i, len(rows), fy(a), b))
