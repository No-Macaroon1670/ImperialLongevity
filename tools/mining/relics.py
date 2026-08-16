# -*- coding: utf-8 -*-
"""文物候选池:多来源汇总 + 分量信号,来源各自记账。

用户指出《禁止出境展览文物》带政治色彩,这是对的,而且那份名单自己就能证明:
「青花云龙纹象耳瓶」即大维德花瓶,至正十一年(1351)款,元青花断代的标准器,
1935 年起藏于伦敦——一份出境禁令名单在物理上就不可能收录它。台北故宫的
毛公鼎、散氏盘、快雪时晴帖同理。出境禁令只能给发布方**手上有的**东西排序,
于是把 1949 年的分断与近代流散当成了重要性判断。

所以不拿它当主干,只当**一个记了账的来源**。另取两份来源做对冲:
中华民国国宝(文化資產保存法指定,政治倾向不同)、以及已知的海外收藏名品。

分量仍按老办法算:语言链接 / 入链 / 年访问量三项 z 分合成——三者各有偏,
一个信号的偏,另两个多半不共享。名单归属只入账、不加分。
"""
import io, json, math, os, re, sys, time, urllib.parse, urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "ImperialLongevity/1.0 (relic notability)"}
SIG = os.path.join(HERE, "relic_signals.json")
sig = json.load(io.open(SIG, encoding="utf-8")) if os.path.exists(SIG) else {}

def get(url):
    for a in range(6):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=45)
            time.sleep(0.4)
            return json.load(r)
        except urllib.error.HTTPError as ex:
            if ex.code == 404:
                return None
            time.sleep(4 * (a + 1))
        except Exception:
            time.sleep(4 * (a + 1))
    return "?"

def cat_members(cat):
    out, cont = [], None
    while True:
        kw = {"action": "query", "format": "json", "formatversion": "2",
              "list": "categorymembers", "cmtitle": "Category:" + cat,
              "cmlimit": "500", "cmnamespace": "0"}
        if cont:
            kw["cmcontinue"] = cont
        d = get("https://zh.wikipedia.org/w/api.php?" + urllib.parse.urlencode(kw))
        if d in (None, "?"):
            break
        out += [m["title"] for m in d["query"]["categorymembers"]]
        cont = d.get("continue", {}).get("cmcontinue")
        if not cont:
            break
    return out

# ── 来源 ────────────────────────────────────────────────────────────────────
SRC = {}
for tag, cat in [("禁展", "禁止出境展览文物"),
                 ("台国宝", "中華民國國寶"),
                 ("台故宫", "國立故宮博物院國寶類藏品")]:
    ms = cat_members(cat)
    print("%s:%d 条" % (tag, len(ms)))
    for m in ms:
        SRC.setdefault(m, set()).add(tag)

# 用户给的百件书目里已确认有条目的
p = os.path.join(HERE, "relics_have.txt")
if os.path.exists(p):
    for n in io.open(p, encoding="utf-8").read().split():
        SRC.setdefault(n.strip(), set()).add("百件")

# 海外收藏的名品:两份官方名单在**物理上**都收不到它们,须手工补,
# 否则这一层会悄悄变成「只讲留在两岸的东西」——偏差从缺席进来,最难事后察觉
for n in ["大维德花瓶", "女史箴圖", "昭陵六骏", "圓明園十二生肖獸首銅像",
          "敦煌遺書", "永樂大典", "翠玉白菜", "肉形石", "毛公鼎", "散氏盤",
          "快雪時晴帖", "谿山行旅圖", "早春圖", "富春山居圖"]:
    SRC.setdefault(n, set()).add("海外/两岸")

print("\n候选池 %d 件" % len(SRC))

# ── 信号 ────────────────────────────────────────────────────────────────────
def counts(title):
    q = urllib.parse.urlencode({
        "action": "query", "format": "json", "redirects": "1", "titles": title,
        "prop": "langlinks|linkshere", "lllimit": "500",
        "lhlimit": "500", "lhnamespace": "0"})
    d = get("https://zh.wikipedia.org/w/api.php?" + q)
    if d in (None, "?"):
        return d
    p = list(d["query"]["pages"].values())[0]
    if "missing" in p:
        return None
    return {"ll": len(p.get("langlinks", [])), "lh": len(p.get("linkshere", [])),
            "title": p["title"]}

def views(title):
    t = urllib.parse.quote(title.replace(" ", "_"), safe="")
    d = get("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
            "zh.wikipedia/all-access/user/%s/monthly/2025070100/2026070100" % t)
    if d in (None, "?"):
        return 0 if d is None else "?"
    return sum(i["views"] for i in d.get("items", []))

todo = [n for n in SRC if n not in sig]
print("待查信号 %d(缓存 %d)" % (len(todo), len(SRC) - len(todo)))
for i, n in enumerate(todo, 1):
    c = counts(n)
    if c in (None, "?"):
        if c is None:
            sig[n] = {"ll": 0, "lh": 0, "pv": 0, "title": n, "gone": 1}
        continue
    v = views(c["title"])
    if v == "?":
        continue
    c["pv"] = v
    sig[n] = c
    if i % 25 == 0:
        json.dump(sig, io.open(SIG, "w", encoding="utf-8"), ensure_ascii=False)
        print("  …%d/%d" % (i, len(todo)))
json.dump(sig, io.open(SIG, "w", encoding="utf-8"), ensure_ascii=False)

rows = [n for n in SRC if n in sig and not sig[n].get("gone")]
lg = lambda v: math.log1p(max(v, 0))
def z(vals):
    mu = sum(vals) / len(vals)
    sd = (sum((v - mu) ** 2 for v in vals) / len(vals)) ** 0.5 or 1.0
    return [(v - mu) / sd for v in vals]
zs = list(zip(z([lg(sig[n]["ll"]) for n in rows]),
              z([lg(sig[n]["lh"]) for n in rows]),
              z([lg(sig[n]["pv"]) for n in rows])))
scored = sorted(((a + b + c, n) for (a, b, c), n in zip(zs, rows)), reverse=True)
json.dump([{"n": n, "score": round(s, 3), "src": sorted(SRC[n]),
            "ll": sig[n]["ll"], "lh": sig[n]["lh"], "pv": sig[n]["pv"]}
           for s, n in scored],
          io.open(os.path.join(HERE, "relic_rank.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=0)
print("\n共 %d 件有信号 → relic_rank.json" % len(scored))
print("\n前 45:")
for s, n in scored[:45]:
    print("  %6.2f  %-22s %-14s ll=%-3d lh=%-4d pv=%d"
          % (s, n, "/".join(sorted(SRC[n])), sig[n]["ll"], sig[n]["lh"], sig[n]["pv"]))
by = defaultdict(list)
for s, n in scored:
    for t in SRC[n]:
        by[t].append(s)
print("\n各来源的分数中位数(看看哪一份名单系统性地偏高或偏低):")
for t, v in sorted(by.items()):
    v = sorted(v)
    print("  %-10s n=%-4d 中位 %6.2f" % (t, len(v), v[len(v) // 2]))
