# -*- coding: utf-8 -*-
"""把 ingest.py 转好的一批并进 js/events.js。

与 apply.py 的区别:apply.py 里写死了一串批次文件名,是当时那几轮的账本;
往后每收一批都去改那个名单,名单只会越来越长,而且**旧名字重跑一次就会
复活手工删掉的条目**(那个文件里已经为此写过一条警告)。这里改成按参数收,
一次只并一批,不留账本。

判重仍按 **pageid** 不按字符串:繁简异名指同一条目(晉滅吳之戰 == 晋灭吴之战),
字符串判不出来。pageid 走 pidcache.json,只查没缓存过的。

    python merge_batch.py <ingest 转出的 json> [...]
"""
import io, json, os, re, sys, time, urllib.parse, urllib.request

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
EV = os.path.join(ROOT, "js/events.js")
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "pidcache.json")
UA = {"User-Agent": "ImperialLongevity/1.0 (merge)"}
cache = json.load(io.open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}

# 字段顺序照库里现有的写法,新条目混进去看不出是后加的
ORDER = ["y", "o", "k", "n", "w", "ws", "d", "r", "cf", "ya",
         "y2", "u1", "u2", "b", "nb", "m", "yc"]


def pid(title):
    if title in cache:
        return cache[title]
    url = ("https://zh.wikipedia.org/api/rest_v1/page/summary/"
           + urllib.parse.quote(title, safe=""))
    for attempt in range(5):
        try:
            d = json.load(urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=30))
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
    # 限流与 404 在 HTTP 上长得一样,而把限流当成「没有这个条目」正是本项目
    # 栽过好几次的那个错。分不清就不判,下一轮重跑。
    return "?"


def fmt(e):
    parts = []
    for k in ORDER:
        if k not in e:
            continue
        v = e[k]
        parts.append("%s: %d" % (k, v) if isinstance(v, int) else
                     "%s: '%s'" % (k, str(v).replace("'", "\\'")))
    for k in e:                                   # ORDER 之外的字段不悄悄丢掉
        if k not in ORDER:
            raise SystemExit("未知字段 %r(在 %s)——先决定它排在哪里" % (k, e.get("n")))
    return "  { %s }," % ", ".join(parts)


src = io.open(EV, encoding="utf-8").read()
cut = src.index("export const EVENTS")
head, body = src[:cut], src[cut:]

exist_key = set()                                 # (y, n) —— lint 的唯一键
exist_w = {}
for ln in body.split("\n"):
    my = re.match(r"^  \{ y: (-?\d+),", ln)
    if not my:
        continue
    mn = re.search(r"n: '([^']+)'", ln)
    mw = re.search(r"w: '((?:[^']|\\')+)'", ln)
    if mn:
        exist_key.add((int(my.group(1)), mn.group(1)))
    if mw:
        exist_w.setdefault(mw.group(1), mn.group(1) if mn else "?")

rows = []
for path in sys.argv[1:]:
    rows += json.load(io.open(path, encoding="utf-8"))

# 先把现有条目的 pageid 建起来(只查这批新条目的 w 撞不撞得上)
new, skipped = [], []
for r in rows:
    if (r["y"], r["n"]) in exist_key:
        skipped.append("%s %s → (y, n) 已存在" % (r["y"], r["n"])); continue
    p = pid(r["w"])
    if p == "?":
        skipped.append("%s %s → 限流,本轮不判(重跑即可)" % (r["y"], r["n"])); continue
    if p is None:
        skipped.append("%s %s → 维基无此条目 %r" % (r["y"], r["n"], r["w"])); continue
    hit = None
    for w0, n0 in exist_w.items():
        if w0 == r["w"]:
            hit = n0; break
        p0 = cache.get(w0)
        if p0 and p0 != "?" and p0[0] == p[0]:
            hit = n0; break
    # 撞了 pageid 不一定是重复:一个人可以有好几件事(赵孟頫两幅画)。
    # 只报出来让人看,不自动砍。
    if hit:
        print("  · %s %s 与既有「%s」共用条目 %s" % (r["y"], r["n"], hit, r["w"]))
    new.append(r)

new.sort(key=lambda e: e["y"])                    # 先排好再插,否则插点全乱
out, ins = [], 0
for ln in body.split("\n"):
    m = re.match(r"^  \{ y: (-?\d+),", ln)
    if m:
        while ins < len(new) and new[ins]["y"] <= int(m.group(1)):
            out.append(fmt(new[ins])); ins += 1
    out.append(ln)
while ins < len(new):                             # 落在全库末尾之后的
    out.insert(len(out) - 2, fmt(new[ins])); ins += 1

io.open(EV, "w", encoding="utf-8", newline="\n").write(head + "\n".join(out))
io.open(CACHE, "w", encoding="utf-8", newline="\n").write(
    json.dumps(cache, ensure_ascii=False, indent=0))
print("并入 %d 条" % len(new))
for s in skipped:
    print("  ! " + s, file=sys.stderr)
