# -*- coding: utf-8 -*-
"""文物候选池清洗:按 pageid 去重、剔非器物、剔与既有事件重复的,再交 agent 定年。

池子里混着三类杂物,信号分数分不出来,只能按条目本身的性质剔:
  一、同物异名——永樂大典/永乐大典、铜奔马/马踏飞燕、太阳神鸟金饰/商周太阳神鸟金饰
      是同一个 pageid,繁简与全称简称之别。
  二、不是器物——龙泉窑、钧窑、汝窑、越窑是**窑口**(一类瓷器的产地),
      三星堆是遗址,智化寺是建筑;它们没有单件器物的营造年代。
  三、已在事件层——永乐大典、资治通鉴、四库全书、清明上河图这些,
      本库早已作为 cul 事件收着;再以文物身份收一遍就是同年两个点。
"""
import io, json, os, re, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
UA = {"User-Agent": "ImperialLongevity/1.0 (relic clean)"}
PID = os.path.join(HERE, "relic_pid.json")
pid = json.load(io.open(PID, encoding="utf-8")) if os.path.exists(PID) else {}

def pageid(t):
    if t in pid:
        return pid[t]
    u = "https://zh.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(t, safe="")
    v = None
    for a in range(5):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30))
            v = [d.get("pageid"), d.get("title"), d.get("type")]
            break
        except urllib.error.HTTPError as ex:
            if ex.code == 404:
                v = None; break
            time.sleep(4 * (a + 1))
        except Exception:
            time.sleep(4 * (a + 1))
    pid[t] = v
    time.sleep(0.4)
    return v

rank = json.load(io.open(os.path.join(HERE, "relic_rank.json"), encoding="utf-8"))
print("候选 %d 件" % len(rank))

# 既有事件的条目名 → pageid,用来剔重
src = io.open(os.path.join(ROOT, "js/events.js"), encoding="utf-8").read()
ev_w = sorted(set(re.findall(r"w: '([^']+)'", src[src.index("export const EVENTS"):])))
print("既有事件条目 %d 个,查其 pageid…" % len(ev_w))
ev_pid = set()
for w in ev_w:
    v = pageid(w)
    if v:
        ev_pid.add(v[0])

# 明确不是「单件器物」的:窑口、遗址、建筑群、名单本身、书画以外的类目
NOT_OBJECT = re.compile(r"(窑$|窯$|秘色瓷|遗址$|遺址$|寺$|塔$|墓$|碑林|禁止出境展览文物"
                        r"|一级文物|故宮|故宫|博物院|博物馆|文化$|三星堆$)")

keep, drop = [], []
for r in rank:
    n = r["n"]
    v = pageid(n)
    if not v:
        drop.append((n, "条目查不到")); continue
    if v[2] != "standard":
        drop.append((n, "非正文条目(%s)" % v[2])); continue
    if NOT_OBJECT.search(n):
        drop.append((n, "不是单件器物(窑口/遗址/建筑/名单)")); continue
    if v[0] in ev_pid:
        drop.append((n, "已在事件层")); continue
    keep.append({**r, "pageid": v[0], "title": v[1]})

json.dump(pid, io.open(PID, "w", encoding="utf-8"), ensure_ascii=False)

# 同 pageid 只留分数最高的那个名字
best = {}
for r in sorted(keep, key=lambda x: -x["score"]):
    if r["pageid"] in best:
        drop.append((r["n"], "与「%s」同条目" % best[r["pageid"]]["n"]))
        continue
    best[r["pageid"]] = r
keep = sorted(best.values(), key=lambda x: -x["score"])

json.dump(keep, io.open(os.path.join(HERE, "relic_keep.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=0)
print("\n留下 %d 件,剔除 %d 件" % (len(keep), len(drop)))
from collections import Counter
for why, c in Counter(w for _, w in drop).most_common():
    print("  %-28s %d" % (why, c))
print("\n留下的前 40:")
for r in keep[:40]:
    print("  %6.2f  %-22s %s" % (r["score"], r["n"], "/".join(r["src"])))
