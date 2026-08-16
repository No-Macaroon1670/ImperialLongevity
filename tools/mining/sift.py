# -*- coding: utf-8 -*-
"""把导航模板抓来的一千七百多个候选筛成可读的量。

模板收的是**全集**:人物(刘邦、劉縯)、概念(刺史、侨置)、政权(三国)、
边角战事(东冶五县之乱)、以及真正的缺口(五胡乱华、三长制、书同文)混在一起。
让 agent 逐条读一千七百个不现实,也没必要。

先用**语言链接数**做粗筛:一条五十个标题批量查,三十几个请求就能问完全部,
比逐条查便宜两个数量级。语言链接是「多少种语言单独为它写了条目」,
噪声(某场边角战事、某个不出名的人物)几乎都是 0–2,而真缺口(五胡乱华)
通常有十几到几十。

粗筛留下的再交给 agent 判断:是不是事件、系年是哪年。本脚本不做取舍。
"""
import io, json, os, re, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
UA = {"User-Agent": "ImperialLongevity/1.0 (candidate sift)"}
CACHE = os.path.join(HERE, "llcache.json")
cache = json.load(io.open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}

def api(**kw):
    kw.setdefault("format", "json"); kw.setdefault("action", "query")
    u = "https://zh.wikipedia.org/w/api.php?" + urllib.parse.urlencode(kw)
    for a in range(5):
        try:
            r = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=45)
            time.sleep(0.35)
            return json.load(r)
        except Exception:
            time.sleep(4 * (a + 1))
    return None

# 明显不是「事件」的:政权名、人物列表、纯概念——先用词形挡掉一批
DROP = re.compile(
    r"(列表|年表|世系|皇帝$|君主$|汗国$|王朝$|^(三国|五代十国|五胡十六国|南北朝|唐朝|宋朝|明朝|清朝|元朝)$"
    r"|钱币|文化$|艺术$|文学$|宗教$|官制$|地图|行政区)")

groups = {}
for fn in sorted(os.listdir(HERE)):
    if fn.startswith("nav_") and fn.endswith(".txt"):
        names = [l.strip() for l in io.open(os.path.join(HERE, fn), encoding="utf-8")
                 if l.strip() and not DROP.search(l.strip())]
        groups[fn[4:-4]] = names
allnames = sorted({n for v in groups.values() for n in v})
todo = [n for n in allnames if n not in cache]
print("候选 %d(词形初筛后),待查语言链接 %d" % (len(allnames), len(todo)))

for i in range(0, len(todo), 50):
    chunk = todo[i:i + 50]
    d = api(prop="langlinks", lllimit="500", redirects="1", titles="|".join(chunk))
    if not d:
        print("  批 %d 失败,跳过" % i); continue
    pages = d.get("query", {}).get("pages", {})
    norm = {x["from"]: x["to"] for x in d.get("query", {}).get("normalized", [])}
    redir = {x["from"]: x["to"] for x in d.get("query", {}).get("redirects", [])}
    got = {}
    for pg in pages.values():
        got[pg["title"]] = 0 if "missing" in pg else len(pg.get("langlinks", []))
    for t in chunk:
        t2 = redir.get(norm.get(t, t), norm.get(t, t))
        cache[t] = got.get(t2, 0)
    if i % 250 == 0:
        json.dump(cache, io.open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
        print("  …%d/%d" % (i, len(todo)))
json.dump(cache, io.open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)

# 与本库现有事件比:现有事件的语言链接中位数是多少?低于它的候选多半不必看
src = io.open(os.path.join(ROOT, "js/events.js"), encoding="utf-8").read()
have_w = re.findall(r"w: '([^']+)'", src)
sig = json.load(io.open(os.path.join(HERE, "signals.json"), encoding="utf-8"))
mine = sorted(sig[w]["ll"] for w in have_w if w in sig)
med = mine[len(mine) // 2] if mine else 5
print("\n本库现有事件的语言链接:中位数 %d、四分位 %d/%d"
      % (med, mine[len(mine) // 4], mine[len(mine) * 3 // 4]))

rows = sorted(((cache.get(n, 0), g, n) for g, v in groups.items() for n in v), reverse=True)
keep = [r for r in rows if r[0] >= med]
print("候选中语言链接 ≥ %d 的:%d 条" % (med, len(keep)))
out = {}
for ll, g, n in keep:
    out.setdefault(g, []).append("%3d  %s" % (ll, n))
for g, v in out.items():
    io.open(os.path.join(HERE, "sift_%s.txt" % g), "w", encoding="utf-8").write("\n".join(v))
    print("  sift_%s.txt  %d 条" % (g, len(v)))
print("\n分数最高的 40:")
for ll, g, n in keep[:40]:
    print("  %3d  %-9s %s" % (ll, g, n))
