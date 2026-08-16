# -*- coding: utf-8 -*-
"""把三批待办一次性并进 js/events.js:

  splits.json  拆开「一个点塞了两件事」的复合条目(漠北之战·盐铁官营 等四条)
  famous.json  补回被「改朝换代刻痕」规则误杀的十条(淝水之战、陈桥兵变 等)
  gaps2.json   补空档的三十六条(寿春三叛、夺门之变、路人皆知 等)

判重按 **pageid**,不按字符串:繁简异名同条目(晉滅吳之戰 == 晋灭吴之战)
字符串判不出来。pageid 走 pidcache.json,只查没缓存过的。
"""
import io, json, os, re, sys, time, urllib.parse, urllib.request

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
EV = os.path.join(ROOT, "js/events.js")
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "pidcache.json")
UA = {"User-Agent": "ImperialLongevity/1.0 (merge)"}
cache = json.load(io.open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}

def pid(title):
    if title in cache:
        return cache[title]
    url = "https://zh.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title, safe="")
    for attempt in range(5):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
            v = [d.get("pageid"), d.get("title")] if d.get("type") == "standard" else None
            cache[title] = v
            time.sleep(0.4)
            return v
        except urllib.error.HTTPError as ex:
            if ex.code == 404:
                cache[title] = None
                return None
            time.sleep(4 * (attempt + 1))
        except Exception:
            time.sleep(4 * (attempt + 1))
    return "?"                                    # 限流:既不判重也不判无

# ── 现有事件 ────────────────────────────────────────────────────────────────
src = io.open(EV, encoding="utf-8").read()
head, body = src.split("export const EVENTS = [", 1)
body, foot = body.split("\n];", 1)

def parse(line):
    m = re.match(r"\s*\{ (.*) \},?$", line)
    if not m:
        return None
    d, order = {}, []
    for kv in re.finditer(r"(\w+): (?:'((?:[^']|\\')*)'|(-?\d+))", m.group(1)):
        k, sv, nv = kv.groups()
        d[k] = sv if sv is not None else int(nv)
        order.append(k)
    return d if "w" in d else None

evs = [e for e in (parse(l) for l in body.splitlines()) if e]
print("现有 %d 条" % len(evs))

# ── 一、拆复合条目 ──────────────────────────────────────────────────────────
splits = json.load(io.open(os.path.join(HERE, "splits.json"), encoding="utf-8"))
for sp in splits:
    y, n = sp["drop"]
    before = len(evs)
    evs = [e for e in evs if not (e["y"] == y and e["n"] == n)]
    if len(evs) == before:
        print("  ! 拆分找不到:%s %s" % (y, n)); continue
    evs += sp["add"]
    print("  拆 %s %s → %s" % (y, n, "、".join(a["n"] for a in sp["add"])))

# ── 二、按 pageid 并入新条目 ────────────────────────────────────────────────
seen, dropped = {}, []
for e in evs:
    p = pid(e["w"])
    if p and p != "?":
        seen.setdefault(p[0], e)

for fn in ["famous.json", "gaps2.json", "heritage.json"]:
    for c in json.load(io.open(os.path.join(HERE, fn), encoding="utf-8")):
        p = pid(c["w"])
        if p == "?":
            dropped.append("%s %s → 限流,本轮不判(重跑即可)" % (c["y"], c["n"])); continue
        if p is None:
            dropped.append("%s %s (%s) → 条目不存在" % (c["y"], c["n"], c["w"])); continue
        if p[0] in seen:
            dropped.append("%s %s → 与「%s」同条目" % (c["y"], c["n"], seen[p[0]]["n"])); continue
        seen[p[0]] = c
        evs.append(c)

json.dump(cache, io.open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=0)

# ── 三、写回 ────────────────────────────────────────────────────────────────
evs.sort(key=lambda e: (e["y"], e.get("y2", e["y"]), e["n"]))
KEYS = ["y", "y2", "k", "n", "w", "b", "d", "ya", "yc", "u", "r"]
lines = []
for e in evs:
    parts = []
    for k in KEYS:
        if k not in e or e[k] in (None, ""):
            continue
        parts.append("%s: %s" % (k, e[k] if isinstance(e[k], int) else "'%s'" % e[k]))
    lines.append("  { " + ", ".join(parts) + " },")
io.open(EV, "w", encoding="utf-8").write(
    head + "export const EVENTS = [\n" + "\n".join(lines) + "\n];" + foot)

print("\n写回 %d 条(净增 %d)" % (len(evs), len(evs) - 349 + 4))
print("未并入 %d:" % len(dropped))
for d in dropped:
    print("  " + d)
