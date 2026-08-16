# -*- coding: utf-8 -*-
"""《成語典》倒查雅名 · 精筛版。

v1 只按事件名词干在全文里搜,召回够了但准头很差:「焚书坑儒」的词干在
「因陋就简」的典故说明里被顺带提了一句,就成了候选。三道筛子解决大半:

  一、只留**主條成語**——副條是「拉朽摧枯」这类异序变体,当标签毫无用处
  二、词干须出现在**典源文獻名稱或典故說明**里,不算釋義(那是今人的白话释义)
  三、典源若是纪传体史书,该书**覆盖的年代须罩得住事件那一年**——
      出自《漢書》的成语不可能在说唐朝的事。这一条杀伤力最大。

余下的仍要人(或 agent)读典故说明定夺:成语是否真**指**这件事,
还是只在讲别的事时提到了它。本脚本只负责把三百多条压到可读的量。
"""
import io, json, os, re
import pandas as pd
from zhconv import convert

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
t2s = lambda s: convert(s, "zh-cn")

# 纪传体史书所记年代(宽松取整,只用来否掉隔代的误配)
SHU = [
    ("史記", -2100, -91), ("漢書", -209, 24), ("後漢書", 25, 220), ("三國志", 184, 280),
    ("晉書", 265, 420), ("宋書", 420, 479), ("南齊書", 479, 502), ("梁書", 502, 557),
    ("陳書", 557, 589), ("魏書", 386, 550), ("北齊書", 534, 577), ("周書", 535, 581),
    ("隋書", 581, 618), ("南史", 420, 589), ("北史", 386, 618),
    ("唐書", 618, 907), ("五代史", 907, 960), ("宋史", 960, 1279), ("遼史", 907, 1125),
    ("金史", 1115, 1234), ("元史", 1206, 1368), ("明史", 1368, 1644), ("清史稿", 1644, 1912),
    ("資治通鑑", -403, 959), ("世說新語", 150, 420), ("戰國策", -475, -221),
    ("左傳", -722, -468), ("國語", -900, -453),
]

df = pd.read_excel(os.path.join(HERE, "dict_idioms_2020_20260625.xlsx"), dtype=str).fillna("")
clean = lambda v: re.sub(r"_x000D_|\*\d+\*|[#＃]", "", str(v)).replace("\n", " ")
df = df[df["主條成語／非主條成語"] == "主條成語"].copy()
df["srcname"] = df["典源文獻名稱"].map(clean)
df["story"] = df["典故說明"].map(clean)
df["hay_s"] = (df["srcname"] + " ｜ " + df["story"]).map(t2s)
print("主条成语 %d 条" % len(df))

def covers(srcname, y):
    """典源是纪传体史书时,书所记年代须罩得住事件年份;非史书不设限"""
    known = False
    for name, a, b in SHU:
        if name in srcname:
            known = True
            if a - 30 <= y <= b + 30:
                return True
    return not known

src = io.open(os.path.join(ROOT, "js/events.js"), encoding="utf-8").read()
evs = []
for line in src[src.index("export const EVENTS = ["):].splitlines():
    m = re.match(r"\s*\{ (.*) \},?$", line)
    if not m:
        continue
    d = {}
    for kv in re.finditer(r"(\w+): (?:'([^']*)'|(-?\d+))", m.group(1)):
        k, sv, nv = kv.groups()
        d[k] = sv if sv is not None else int(nv)
    if "w" in d and d.get("k") != "era":
        evs.append(d)

GENERIC = re.compile(
    r"(之戰|之战|之亂|之乱|之變|之变|之役|之圍|之围|之禍|之祸|之盟|之議|之议|之治|"
    r"戰役|战役|起義|起义|起事|之獄|之狱|兵變|兵变|政變|政变|之難|之难|之爭|之争|"
    r"成書|成书|開修|开修|建成|創立|创立|頒行|颁行|設立|设立|之死|北伐|南征|西征|東征|东征)$")
STOP = {"中国", "天下", "皇帝", "朝廷", "长安", "洛阳", "北京", "南京"}

def stems(ev):
    out = set()
    for nm in [ev["n"], ev["w"]]:
        nm = t2s(re.sub(r"[《》〈〉·・、]", "", nm))
        core = GENERIC.sub("", nm)
        if len(core) >= 2 and core not in STOP:
            out.add(core)
    return {s for s in out if len(s) >= 2}

fy = lambda y: ("前%d" % -y) if y < 0 else str(y)
hits = []
for ev in evs:
    if ev.get("ya"):
        continue
    seen = set()
    for st in sorted(stems(ev), key=len, reverse=True):
        m = df[df["hay_s"].str.contains(re.escape(st), regex=False)]
        if len(m) > 15:
            continue
        for _, r in m.iterrows():
            if r["成語"] in seen or not covers(r["srcname"], ev["y"]):
                continue
            seen.add(r["成語"])
            hits.append({
                "y": ev["y"], "n": ev["n"], "k": ev["k"], "stem": st,
                "idiom": t2s(r["成語"]), "src": r["srcname"],
                "story": r["story"][:300],
            })

json.dump(hits, io.open(os.path.join(HERE, "idiom_hits2.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
by = {}
for h in hits:
    by.setdefault((h["y"], h["n"]), []).append(h)
print("\n%d 条事件、%d 组候选(v1 是 77 条 / 355 组)→ idiom_hits2.json\n" % (len(by), len(hits)))
for (y, n), g in sorted(by.items()):
    print("%-7s %-18s %s" % (fy(y), n, "、".join("%s〔%s〕" % (h["idiom"], h["src"][:20]) for h in g[:5])))
