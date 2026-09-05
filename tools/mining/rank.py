# -*- coding: utf-8 -*-
"""给每条大事记定一个「分量」(r: 1/2/3),供图上分级显示。

为什么不由我拍脑袋定:三百多条要排得前后一致,人手做不到,也无从复核。
维基本身带着三个各自独立、可机读的知名度信号,取它们的合成:

  ll  语言链接数——多少种语言为它单独写了条目(国际知名度)
  lh  入链数——中文维基里多少条目指向它(在中文史叙述里的结构中心度)
  pv  年访问量——读者实际去查了多少次(当代关注度)

三者各有偏:pv 偏近现代与影视热点(《红楼梦》高于租庸调制),ll 偏国际上
说得清的(丝路、鸦片战争),lh 偏制度与长时段(反而利于租庸调制)。
故取三者 log 后的 z 分等权相加——一个信号的偏,另两个多半不共享。

分三等:一等约五十条(手机上只显示这一等)、二等约一百一十条、余为三等。
另加**类别保底**:war/gov/rev/out/cul/dis/inst 每类至少若干条进一等,
否则纯按分数排,一等会挤满战争与政变,文化与外交近乎绝迹——
那不是「重要」,那是维基的写作偏好。
"""
import io, json, math, os, re, sys, time, urllib.parse, urllib.request
from collections import defaultdict

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
HERE = os.path.dirname(os.path.abspath(__file__))
SIG = os.path.join(HERE, "signals.json")
UA = {"User-Agent": "ImperialLongevity/1.0 (timeline importance ranking)"}

def get(url):
    for attempt in range(6):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40)
            time.sleep(0.4)
            return json.load(r)
        except urllib.error.HTTPError as ex:
            if ex.code == 404:
                return None
            time.sleep(4 * (attempt + 1))
        except Exception:
            time.sleep(4 * (attempt + 1))
    return "?"

def wiki_counts(title):
    """一次请求同时取语言链接与入链(各封顶 500,排序用足够)。

    `en:` 前缀分流到英文站(先例:build_geo_events.coords_of 按前缀分流)。
    此前这些标题原样丢给 zh 站,回的是 query.interwiki 没有 query.pages,
    被当「无条目」记零或算 missing——脚本末尾 sys.exit(1) 恒真,合成永远
    走不到,signals.json 长期停在旧快照(文库终审 2026-08-20 记账)。"""
    host, t = "zh.wikipedia.org", title
    if title.startswith("en:"):
        host, t = "en.wikipedia.org", title[3:]
    q = urllib.parse.urlencode({
        "action": "query", "format": "json", "redirects": "1", "titles": t,
        # converttitles:中文维基靠字词转换显示繁简,**不建繁简重定向页**——`w` 写成维基
        # 没建的那种写法(黨錮之禍/伤寒杂病论/澶渊之盟…)按标题精确查一律 missing,
        # 三信号全零、分量全压三等,库内 58 条正撞在上头(出链层员 2026-09-02 查出)。
        # 加这个参数让 API 先做转换再查,回的 title 即正题,pageviews 也据此查。
        "converttitles": "1",
        "prop": "langlinks|linkshere", "lllimit": "500",
        "lhlimit": "500", "lhnamespace": "0"})
    d = get("https://%s/w/api.php?" % host + q)
    if d in (None, "?"):
        return d
    # `w` 带 `en:` 前缀的条目(树色平远图、捣练图…)在 zh 站上是**跨语言链接**不是页面,
    # API 回的是 query.interwiki 而没有 query.pages ——原先直接下标取 pages,
    # 一撞上就 KeyError 整轮中断,而已缓存的部分照旧写回,看不出是谁绊的。
    # 当作「zh 站无此条目」处理:信号取零,与 missing 同路。
    if "pages" not in d.get("query", {}):
        return None
    p = list(d["query"]["pages"].values())[0]
    if "missing" in p:
        return None
    # en 站条目把前缀带回,pageviews 才知道该查哪个项目;
    # 注意 en 访问量与 zh 不同池,z 分会偏高——库里带 en: 的仅四条,
    # apply 前过目一等名单时人工留意即可,不为四条建双池
    out = {"ll": len(p.get("langlinks", [])), "lh": len(p.get("linkshere", [])),
           "title": p["title"]}
    if host.startswith("en."):
        out["title"] = "en:" + out["title"]
    return out

def pageviews(title):
    """近十二个月访问量之和(user 流量,排除爬虫)。en: 前缀查英文项目"""
    project = "zh.wikipedia"
    if title.startswith("en:"):
        project, title = "en.wikipedia", title[3:]
    t = urllib.parse.quote(title.replace(" ", "_"), safe="")
    url = ("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
           "%s/all-access/user/%s/monthly/2025070100/2026070100" % (project, t))
    d = get(url)
    if d in (None, "?"):
        return 0 if d is None else "?"
    return sum(i["views"] for i in d.get("items", []))

# ── 读事件 ──────────────────────────────────────────────────────────────────
src = io.open(os.path.join(ROOT, "js/events.js"), encoding="utf-8").read()
body = src[src.index("export const EVENTS = ["):]
evs = []
for line in body.splitlines():
    m = re.match(r"\s*\{ (.*) \},?$", line)
    if not m:
        continue
    d = {}
    # 字符串值允许 \' 转义(将苑西夏文译本的 w 带 General\'s):旧式 '([^']*)' 在 \' 处截断,
    # signals.json 里存的就是坏串(出链层员 2026-09-02 查出);读出后反转义
    for kv in re.finditer(r"(\w+): (?:'((?:[^'\\]|\\.)*)'|(-?\d+))", m.group(1)):
        k, sv, nv = kv.groups()
        d[k] = sv.replace("\\'", "'") if sv is not None else int(nv)
    if "w" in d:
        evs.append(d)
print("事件 %d 条" % len(evs))

sig = json.load(io.open(SIG, encoding="utf-8")) if os.path.exists(SIG) else {}
todo = [e for e in evs if e["w"] not in sig]
print("待查 %d 条(缓存 %d)" % (len(todo), len(evs) - len(todo)))
for i, e in enumerate(todo, 1):
    c = wiki_counts(e["w"])
    if c in (None, "?"):
        print("  ? %s %s" % (e["n"], "无条目" if c is None else "限流,留待重跑"))
        if c is None:
            sig[e["w"]] = {"ll": 0, "lh": 0, "pv": 0, "title": e["w"]}
        continue
    pv = pageviews(c["title"])
    if pv == "?":
        print("  ? %s 访问量限流,留待重跑" % e["n"]); continue
    c["pv"] = pv
    sig[e["w"]] = c
    if i % 25 == 0:
        json.dump(sig, io.open(SIG, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
        print("  …%d/%d" % (i, len(todo)))
json.dump(sig, io.open(SIG, "w", encoding="utf-8"), ensure_ascii=False, indent=0)

missing = [e["n"] for e in evs if e["w"] not in sig]
if missing:
    print("仍缺 %d 条,重跑本脚本即可(已有的走缓存):%s" % (len(missing), missing[:10]))
    sys.exit(1)

# ── 合成 ────────────────────────────────────────────────────────────────────
def z(vals):
    mu = sum(vals) / len(vals)
    sd = (sum((v - mu) ** 2 for v in vals) / len(vals)) ** 0.5 or 1.0
    return [(v - mu) / sd for v in vals]

lg = lambda v: math.log1p(max(v, 0))
zll = z([lg(sig[e["w"]]["ll"]) for e in evs])
zlh = z([lg(sig[e["w"]]["lh"]) for e in evs])
zpv = z([lg(sig[e["w"]]["pv"]) for e in evs])
for e, a, b, c in zip(evs, zll, zlh, zpv):
    e["score"] = a + b + c
    e["_s"] = (sig[e["w"]]["ll"], sig[e["w"]]["lh"], sig[e["w"]]["pv"])

# ── 页型折中(2026-09-05 库主定「A 折中」)──────────────────────────────
# 三个信号量的是 `w` 指向的那一页,不是这条事;而页有页型:`wt: person` 的 w 是人物页、
# `wt: parent` 是母题页,其余是事件页。09-05 实测中位数(能对库的 1465 条):
#     事件页 1070 条  语言链 4  入链 138  年访问  6449
#     人物页  265 条  语言链 16 入链 290  年访问 28759
#     母题页  130 条  语言链 8  入链 241  年访问 10236
# 人物页三信号都是事件页的二到四倍——挂人物页的事自带一截借来的分(公孙度自立案:
# 借《公孫度》人物页 lh 500 走 rev 类保底进一等)。上面的 fig 上限只治名人轶事一类,
# 别类挂人物页不管。这里把每条的分改成「全库同池 z」与「本页型内 z」各半:
# 全 A(只在页型内比)干跑会让一等线上换血 135 条、人物页条 98→37,力度过大,故折中。
PAGETYPE_BLEND = 0.5
_grp = lambda e: e.get("wt") if e.get("wt") in ("person", "parent") else "event"
for _g in ("event", "person", "parent"):
    _P = [e for e in evs if _grp(e) == _g]
    if len(_P) < 2:
        continue
    _ga = z([lg(sig[e["w"]]["ll"]) for e in _P])
    _gb = z([lg(sig[e["w"]]["lh"]) for e in _P])
    _gc = z([lg(sig[e["w"]]["pv"]) for e in _P])
    for e, a, b, c in zip(_P, _ga, _gb, _gc):
        e["score"] = (1 - PAGETYPE_BLEND) * e["score"] + PAGETYPE_BLEND * (a + b + c)

# era(治世·中兴)不参与分级:它们画成皇帝格子的外套,根本不在事件轨上,
# 占了锚点名额等于让卡片跟随一个图上找不到的东西。
rankable = [e for e in evs if e["k"] != "era"]
order = sorted(rankable, key=lambda e: -e["score"])
# 按**比例**取,不按绝对条数:日后补进夏商周,事件会从三百多涨到四五百,
# 写死的 52/112 会让一等的占比悄悄缩水。锚点占一成半,二等占三成。
N1 = max(20, round(len(rankable) * 0.15))
N2 = max(40, round(len(rankable) * 0.32))
tier = {}
for i, e in enumerate(order):
    tier[id(e)] = 1 if i < N1 else 2 if i < N1 + N2 else 3

# 类别保底:每类按自身分数取前若干进一等,免得一等清一色是战争与政变
# 类别保底同样按比例:每类至少拿到 N1 的这个份额,免得一等清一色是战争政变
FLOOR_SHARE = {"war": .19, "rev": .15, "gov": .15, "cul": .15, "out": .10, "inst": .07, "dis": .05}
FLOOR = {k: max(2, round(N1 * v)) for k, v in FLOOR_SHARE.items()}

# ── 定年存疑者不当锚点 ──────────────────────────────────────────────────────
# 一等是「锚点」:知识卡自动跟随它们,手机上只显示这一等。也就是说锚点是
# 本库主动推到读者眼前的那一批。**连哪一年都拿不准的条目,不该享受这个待遇**。
#
# `cf: 3`(低)是入库时 agent 自报的定年把握。眼下最扎眼的例子:青梅竹马靠
# 《长干行》系于 726,而那首诗本无确年,726 是据李白行迹推的;它却因为
# `w` 指向李白(全站最热条目之一)而在名人轶事里排第一。
# 把它推到读者面前,等于拿全库最不确定的一条当门面。
#
# 只降 `cf: 3`,不动 `cf: 2`——「中」是常态,史事本来就多半只能定到那个程度。
low = [e for e in rankable if e.get("cf") == 3 and tier[id(e)] == 1]
for e in low:
    tier[id(e)] = 2
if low:
    print("定年存疑降级 %d 条:%s" % (len(low), "、".join(e["n"] for e in low)))

# ── 类别上限:名人轶事要封顶,不是保底 ────────────────────────────────────────
# 别类的 `w` 指向**事件**条目,fig 的 `w` 指向**人**——苏轼、谢安、王羲之。
# 人物条目的入链与访问量系统性地高出一大截,实测中位数:
#     fig  入链 392 / 年访问 43509
#     war  入链 138 / 年访问 10746
#     art  入链 113 / 年访问  3091
# 也就是说这三个信号在 fig 身上量的是「这个人有多有名」,不是「这条轶事有多重要」。
# 闻鸡起舞分数高,是因为祖逖条目写得全、读得多,与那件轶事本身够不够格无关。
#
# 这与本脚本开头警告的是同一种病,只是换了个轴:「那不是重要,那是维基的写作偏好」。
# 不封顶时 fig 一类独占 29 个锚点,是全库最多的——而它只占全库 9%。
#
# 故 fig 的分数**不与别类比**,只在自己内部排,按人口比例取一份额度。
CEIL_SHARE = {"fig": None}          # None = 按该类占全库的比例
for k in CEIL_SHARE:
    pool = [e for e in rankable if e["k"] == k]
    if not pool:
        continue
    quota = max(3, round(N1 * len(pool) / len(rankable)))
    keep = {id(e) for e in sorted(pool, key=lambda e: -e["score"])[:quota]}
    cut = 0
    for e in pool:
        if tier[id(e)] == 1 and id(e) not in keep:
            tier[id(e)] = 2
            cut += 1
    print("类别上限 %s:额度 %d,降级 %d 条(信号量的是人不是事,不与别类同池排)"
          % (k, quota, cut))
bycat = defaultdict(list)
for e in order:
    bycat[e["k"]].append(e)
for k, need in FLOOR.items():
    got = [e for e in bycat[k] if tier[id(e)] == 1]
    for e in bycat[k]:
        if len(got) >= need:
            break
        # cf:3 降级在前面已裁,保底不得捞回——否则太康失国(-8.02,传说档)照进一等
        if tier[id(e)] != 1 and e.get("cf") != 3:
            tier[id(e)] = 1
            got.append(e)

# ── 时代保底 ────────────────────────────────────────────────────────────────
# 纯按分数排,一等里七成落在 1500 年以后:访问量偏近现代,语言链接偏国际上
# 说得清的,两个信号同向。对**时间轴**来说这是致命的——锚点是给读者导航用的,
# 而读者滚到秦汉那一段会一个锚点都碰不到。
# 故每两百年一格,不足三个锚点的,从该格里分数最高的补足。
#
# **只辖信史段(y >= -3000,库主 2026-09-02 裁)**:史前条散布在前 50 万年到
# 前 3000 年的稀疏区,每条独占一格,「每格保三锚」会把几十条负分遗址条机械
# 推进一等(大窑遗址 -2.45 分进一等,2026-09-01 夜 diff 审出撤案)。史前条
# 全凭分数与类别保底竞争,不再独格必进。
BIN = 200
bins = defaultdict(list)
for e in order:
    if e["y"] < -3000:
        continue
    bins[(e["y"] // BIN) * BIN].append(e)
promoted = []
for b0 in sorted(bins):
    got = [e for e in bins[b0] if tier[id(e)] == 1]
    for e in bins[b0]:
        if len(got) >= 3:
            break
        if tier[id(e)] != 1 and e.get("cf") != 3:   # 传说档同样不经此门
            tier[id(e)] = 1
            got.append(e)
            promoted.append((b0, e))
if promoted:
    print()
    print("时代保底补进 %d 个锚点:" % len(promoted))
    for b0, e in promoted:
        print("  %5d 年代格  %-6s %-4s %s (%.2f)"
              % (b0, ("前%d" % -e["y"]) if e["y"] < 0 else e["y"], e["k"], e["n"], e["score"]))

for e in evs:
    e["_r0"] = e.get("r")            # events.js 现行 r,供 --dry 对照
    e["r"] = tier.get(id(e), 3)
cnt = defaultdict(int)
for e in evs:
    cnt[e["r"]] += 1
print("\n一等 %d、二等 %d、三等 %d" % (cnt[1], cnt[2], cnt[3]))
print("\n一等各类:", dict((k, sum(1 for e in evs if e["r"] == 1 and e["k"] == k))
                        for k in sorted({e["k"] for e in evs})))
fy = lambda y: ("前%d" % -y) if y < 0 else str(y)
print("\n一等全表(按分数):")
for e in sorted([e for e in evs if e["r"] == 1], key=lambda e: -e["score"]):
    print("  %6.2f  %-6s %-4s %-14s ll=%-3d lh=%-4d pv=%d"
          % (e["score"], fy(e["y"]), e["k"], e["n"], e["_s"][0], e["_s"][1], e["_s"][2]))
print("\n三等里分数最高的 15 条(复核用,看看有没有被埋掉的):")
for e in sorted([e for e in evs if e["r"] == 3], key=lambda e: -e["score"])[:15]:
    print("  %6.2f  %-6s %-4s %s" % (e["score"], fy(e["y"]), e["k"], e["n"]))
print("\n一等里分数最低的 15 条(复核用,看看类别保底有没有捞进不该进的):")
for e in sorted([e for e in evs if e["r"] == 1], key=lambda e: e["score"])[:15]:
    print("  %6.2f  %-6s %-4s %s" % (e["score"], fy(e["y"]), e["k"], e["n"]))

DRY = "--dry" in sys.argv
out_rows = [{"y": e["y"], "n": e["n"], "w": e["w"], "k": e["k"], "r": e["r"],
             "score": round(e["score"], 3)} for e in evs]
if DRY:
    # 干跑:不动 ranks.json,只出与 events.js 现行 r 的对照表(2026-09-05 页型折中案先看后落)
    json.dump(out_rows, io.open(os.path.join(HERE, "ranks-dry.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=0)
    ch = [e for e in evs if isinstance(e.get("_r0"), int) and e["_r0"] != e["r"]]
    up = sorted([e for e in ch if e["_r0"] > e["r"]], key=lambda e: -e["score"])
    dn = sorted([e for e in ch if e["_r0"] < e["r"]], key=lambda e: -e["score"])
    print("\n干跑对照:r 变动 %d 条(升 %d、降 %d)——现行 r 取自 events.js" % (len(ch), len(up), len(dn)))
    for tag, rows in (("升", up), ("降", dn)):
        print("\n%s级 %d 条:" % (tag, len(rows)))
        print("  %-6s %-4s %-7s %-16s %s  分数  ll/lh/pv" % ("年", "类", "页型", "条", "现→新"))
        for e in rows:
            print("  %-6s %-4s %-7s %-16s  %d→%d  %6.2f  %d/%d/%d" % (fy(e["y"]), e["k"], _grp(e), e["n"][:16], e["_r0"], e["r"], e["score"], e["_s"][0], e["_s"][1], e["_s"][2]))
    print("\n→ ranks-dry.json(未动 ranks.json)")
else:
    json.dump(out_rows, io.open(os.path.join(HERE, "ranks.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=0)
    print("\n→ ranks.json")
