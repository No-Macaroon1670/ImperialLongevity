# -*- coding: utf-8 -*-
"""维基出链层：每条大事记的维基页，链到库内哪些**别的**条目；又被哪些页链到。

为什么要这一层：库内已有的关系是人写的（`rel` 显式互指、`d` 归属政权、
同年同地），条数少而且只记得住写的人当时想到的那几条。维基的正文链接是
另一套人写的关系——几万名编者在写正文时顺手打的方括号，谁也没统筹过，
可正因为没统筹，它逼近的是「讲这件事时绕不开哪些别的事」这个问题的
群体答案。把它与库内的分量 `r` 摆在一起，能看出两处不一致：

  * 维基上四通八达、库内却只给三等的（本库可能低估了）
  * 库内给一等、维基上却无人链接的（多半是本库自己立的题，或专名太生僻）

**难处在异写**。中文维基一个条目有一大串写法：繁简（三星堆遺址／三星堆遗址）、
异名重定向（金杖／三星堆金杖）、带不带消歧义括号。库里的 `w` 用的是入库那天
抄下的那个写法，实测**一千四百五十个 `w` 里有一百四十九个与维基今日的正名对不上**。
而正文里的方括号写的又是编者当时敲的第三种写法，prop=links 原样回传、不解重定向。
拿字符串硬碰，漏掉多少无从知晓（库内先例：pid.py 按 pageid 判重，因为
「繁简异名同条目字符串判不出来」）。

本脚本的解法是**先把每个库内条目的别名一次问齐**（prop=redirects，五十个一发），
再拿正文写法去查这张表。维基的规矩帮了忙：正文若写了一个没有重定向页的写法，
那是红链，压根不会出现在 prop=links 里——所以别名表齐，匹配就齐。

边因此有两个独立来源，**取并集**：
  out  甲页的出链里出现了乙的某个写法（prop=links + 别名表）
  in   乙页的入链里出现了甲（prop=linkshere，按 pageid 认人，写法无关）
两者各有各的洞：出链侧漏中文维基**字词转换**自动落地的写法（LanguageConverter
让 [[三星堆遺址]] 不必建重定向页就能落到简体页上）；入链侧则被 500 条封顶截断，
热门条目的来源取不全。并起来互相补，差额则量出各自盲点有多大（报告「盲点」节）。

**`en:` 前缀的条目单成一池**：pageid 是每个站自己发的号，zh 的 12345 与
en 的 12345 毫不相干，混在一个字典里会凭空造出假边。分流照 rank.py。

**请求数是本脚本的设计约束**。这台机器上同时有五到七路脚本在打同一个维基
API，配额按 IP 共享，撞 429 时服务器让等十几到五十几秒——逐条抓一千四百五十个页
要发两千发，等不起。故出链与入链合在一发请求里取，并且一发带八个标题
（`fetch_batch`），让 pllimit／lhlimit 的额度在这几个页之间分配：0.71 发/页。
两条反直觉的实测，都记在报告第二节：**批大不等于快**（continue 轮数随批大小
一起涨，总请求数几乎不变，而一批拖得越久落盘越稀）；**主动放慢反而快**
（间隔 0.9 秒时每两三发撞一次 429、均 20–34 秒/页，调到 4 秒后均 7.4 秒/页）。

缓存 tools/mining/wikilinks.json 按 `w` 原字符串作键（照 signals.json 之例），
每批落一次盘：这台机器会掉电，掉了重跑接着抓，已抓的一条不重抓。
零外呼复跑（改停用表、改榜单口径后重算）用 --offline。

**注意缓存的一处取舍**：抓完会自动 `compact()`——每页那份五百条的入链页名，
折成「命中库内者」＋全局的 `__outside__`（同一个库外页在几百条入链表里各出现
一次，折起来只存一次）。折过之后，出链命中与入链命中都是**对着当时的索引**
算好的：日后往 events.js 加了新条目，旧条不会回溯认出新条——那时得
`--refresh` 重抓。这个文件是数 MB 量级，比库里别的 json 大一个档次，
留着它是为了让改停用表／改判类／改名次口径这些事都能零外呼重算。

用法见文件末尾 main() 的 --help，或 docs/desk/graph-wikilinks-20260902.md。
"""
import argparse
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "wikilinks.json")
UA = {"User-Agent": "ImperialLongevity/1.0 (article link graph)"}

# 抓取节流。SLEEP 是**起始值**，跑起来之后由 get() 自己调（AIMD：撞 429 就
# 乘性退到 1.25 倍，连着二十五发顺当就乘 0.9 收回来，区间 0.5–6 秒）。
#
# 之所以要自适应，是因为 2026-09-02 这一轮把这个 429 的脾气摸出来了：
# 它是**每分钟配额**，不是「每秒别超过几发」。同一台机器上曾有七路脚本
# 一起抓（配额按 IP 共享），间隔设 0.9 秒时每两三发就撞一次、每次白等
# 四五十秒，均 20–34 秒/页；把间隔调到 4 秒，429 率反倒降到 18%，
# 均 7.4 秒/页——**主动放慢反而更快**。可最优值随机器上还有谁在跑而变，
# 猜一个固定数总是猜不准，索性让它自己贴着配额边缘走。
# 起始值可用环境变量 WL_SLEEP 给（独占机器时给 0.5，热闹时给 3–4）。
SLEEP = float(os.environ.get("WL_SLEEP", "1.5"))
MAX_LINK_PAGES = 4         # 出链翻页上限（500/页）：唐朝一类总述页出链上千，
                           # 越往后越是「本朝人物一览」那种泛链，命中的早在前几页
BACKLINK_CAP = 500         # 入链只取头一页——排行只需要量级，不需要全表

STATS = {"req": 0, "http429": 0, "backoff": [], "err": 0, "streak": 0}


# ── 取数 ────────────────────────────────────────────────────────────────────
def get(url, tries=18):
    """回 JSON；404 回 None；实在拿不到回 '?'（留待重跑，不写坏缓存）。

    军规：外呼批取失败必不写盘——429 覆写过石窟 geo 档，一次把好数据换成空。
    故此处失败一律回哨兵值，由调用方决定跳过，绝不把空结果当成「查过了没有」。

    429 不作「退几次就放弃」处理，而是**耗着等**：本轮实测这台机器上五到七路
    脚本同时打维基，配额是按 IP 共享的，退避六次就放弃只会让这一条永远抓不到，
    而等下去它总会轮到——服务器给的 Retry-After 就是它自己说的「多久之后再来」，
    照它睡最省事。快速连撞时把间隔往上顶（本进程自己降速），别人停了自然就快。
    """
    global SLEEP
    for attempt in range(tries):
        try:
            r = urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=60)
            STATS["req"] += 1
            STATS["streak"] += 1
            # 连着顺当就把间隔收一点回来（下限守住维基的礼貌区间 0.4–0.6）
            if STATS["streak"] >= 25 and SLEEP > 0.5:
                SLEEP = round(max(SLEEP * 0.9, 0.5), 2)
                STATS["streak"] = 0
            time.sleep(SLEEP)
            return json.load(r)
        except urllib.error.HTTPError as ex:
            if ex.code == 404:
                return None
            if ex.code == 429:
                STATS["http429"] += 1
                ra = ex.headers.get("Retry-After") if ex.headers else None
                try:
                    wait = max(int(ra), 5)
                except (TypeError, ValueError):
                    wait = min(15 * (attempt + 1), 120)
                # 撞一次就退一步（AIMD：撞了乘性退、连顺当加性进）。
                # 实测这个 429 是**每分钟配额**，跟间隔设多少没有直接关系——
                # 与其猜一个固定值，不如让它自己贴着配额边缘走。
                STATS["streak"] = 0
                if SLEEP < 6.0:
                    SLEEP = round(min(SLEEP * 1.25, 6.0), 2)
            else:
                wait = min(6 * (attempt + 1), 60)
            STATS["backoff"].append((time.strftime("%H:%M:%S"), ex.code, wait))
            if attempt == 0 or attempt % 4 == 3:
                print("    [%s] HTTP %d，退避 %ds（第 %d 次，本进程间隔 %.2fs）"
                      % (time.strftime("%H:%M:%S"), ex.code, wait, attempt + 1, SLEEP))
            time.sleep(wait)
        except Exception as ex:
            STATS["err"] += 1
            wait = min(6 * (attempt + 1), 60)
            STATS["backoff"].append((time.strftime("%H:%M:%S"), type(ex).__name__, wait))
            time.sleep(wait)
    return "?"


def split_host(title):
    """`en:` 前缀分流到英文站（先例：rank.py / build_geo_events.coords_of）。"""
    if title.startswith("en:"):
        return "en.wikipedia.org", title[3:]
    return "zh.wikipedia.org", title


def api(host, params):
    params = dict(params, action="query", format="json", formatversion="2")
    return get("https://%s/w/api.php?" % host + urllib.parse.urlencode(params))


def resolve_batch(host, titles):
    """阶段〇：一次问五十个页的正名、pageid 与**全部重定向别名**。

    别名这一层是本脚本能不能算准的关键。正文里写的是编者当时敲的那个写法
    ——「三星堆遺址」「郧县直立人」「三星堆金杖」——prop=links 原样回传，
    不替我们解重定向（解重定向的 generator 写法每条要单独发一次请求，
    在被限流的机器上发不起）。反过来，把每个库内条目的别名一次问清，
    再拿正文里的写法去查这张表，一样能对上，而且五十个页只花一发请求。

    维基的规矩帮了忙：正文若写了一个没有重定向页的写法，那就是红链，
    根本不会出现在 prop=links 的结果里。所以「别名表齐＝匹配齐」——
    唯一漏网的是中文维基特有的**字词转换**（LanguageConverter 会让
    [[三星堆遺址]] 直接落到简体页上而不需要重定向页），那一层由入链侧
    兜底：linkshere 回的是实打实的页面，不受写法影响。两侧取并集，
    各自补对方的洞（报告「盲点」节量的就是这个差额）。
    """
    # `converttitles=1` 是这一版补上的，补的是一个把本库坑了很久的洞：
    # 中文维基**不为繁简异写建重定向页**，简繁之间靠 LanguageConverter 在显示时
    # 转换。于是 API 按标题精确查找时，「东林党争」在正名为「東林黨爭」的站上
    # 就是 missing——不是没这个条目，是没这个**写法的页**。
    # 本库 1450 个 `w` 里有 60 个正撞在这上头（党锢之祸、澶渊之盟、天演论、
    # 昆阳之战……），而 rank.py 的 signals.json 把它们一律记成 ll=lh=pv=0，
    # 三个信号全零，分量因此一律压到三等。converttitles 让 API 在查不到时
    # 试一遍语言变体，这 60 条就都回来了。
    d = api(host, {"titles": "|".join(titles), "redirects": "1",
                   "converttitles": "1",
                   "prop": "redirects", "rdnamespace": "0", "rdlimit": "500"})
    if d in (None, "?"):
        return d
    q = d.get("query", {})
    nmap = {x["from"]: x["to"] for x in q.get("normalized", [])}
    cmap = {x["from"]: x["to"] for x in q.get("converted", [])}
    rmap = {x["from"]: x["to"] for x in q.get("redirects", [])}

    def canon(w):
        # 顺序照 API 自己的处理链：归一化 → 变体转换 → 解重定向
        t = nmap.get(w, w)
        t = cmap.get(t, t)
        hop = 0
        while t in rmap and hop < 5:
            t, hop = rmap[t], hop + 1
        return t

    by_title = {p.get("title"): p for p in q.get("pages", []) or []}
    out = {}
    for w in titles:
        p = by_title.get(canon(w))
        if not p or p.get("missing"):
            out[w] = None
            continue
        al = [x["title"] for x in (p.get("redirects") or [])]
        out[w] = {"title": p["title"], "pageid": p["pageid"], "aliases": al}
    return out


def fetch_batch(host, titles, cap_rounds=None):
    """阶段一：一发请求推进**十几个页**的出链与入链，把额度填满为止。

    这是被限流逼出来的写法。逐条抓时，一发请求只处理一个页：那个页若只有
    五十条出链，这一发就只带回五十条，而 pllimit 允许的五百条额度白白扔掉。
    限流数的是**请求数**不是数据量——2026-09-02 这轮实测，机器上五路脚本
    共用一个 IP 配额，每撞一次 429 服务器让等三十五秒，逐条抓一千四百五十个页
    要发两千发，等不起。改成一次传十二个标题，links 与 linkshere 的额度
    （各五百）由 API 在这十二个页之间自行分配，continue 一轮轮推到完：
    每发请求实打实带回一千条，请求总数降到八百上下。

    传进来的必须是**正名**（阶段〇解析过的 title），所以这里不带 redirects=1
    ——省掉解析开销，回来的 pages[].title 就是传进去的那个，不必再映射。
    """
    res = {t: {"links": [], "bl": [], "blids": [],
               "lt": False, "bt": False, "pageid": None} for t in titles}
    cont, rounds = {}, 0
    cap = cap_rounds or max(6, len(titles) + 2)
    while True:
        params = {"titles": "|".join(titles),
                  "prop": "links|linkshere",
                  "plnamespace": "0", "pllimit": "500",
                  "lhnamespace": "0", "lhlimit": "500", "lhshow": "!redirect"}
        params.update(cont)
        d = api(host, params)
        if d in (None, "?"):
            if rounds == 0:
                return d
            for t in titles:                 # 半截数据照收，但标明没取全
                res[t]["lt"] = res[t]["bt"] = True
            return res
        q = d.get("query", {})
        for p in q.get("pages", []) or []:
            t = p.get("title")
            if t not in res:
                continue
            if p.get("missing"):
                res[t]["missing"] = True
                continue
            res[t]["pageid"] = p.get("pageid")
            res[t]["links"].extend(x["title"] for x in (p.get("links") or []))
            lh = p.get("linkshere") or []
            res[t]["bl"].extend(x["title"] for x in lh)
            res[t]["blids"].extend(x["pageid"] for x in lh)
        cont = d.get("continue") or {}
        rounds += 1
        # 入链只要头 BACKLINK_CAP 条：够排名次了，取全会被「唐朝」那种
        # 上万入链的页吃掉整批额度
        if all(len(v["bl"]) >= BACKLINK_CAP for v in res.values()):
            cont.pop("lhcontinue", None)
        if not cont or rounds >= cap:
            break
    for t in titles:
        res[t]["lt"] = "plcontinue" in cont
        res[t]["bt"] = ("lhcontinue" in cont) or len(res[t]["bl"]) >= BACKLINK_CAP
    return res


def load_events():
    """解析 js/events.js（先例：rank.py）。

    与 rank.py 的一处不同：先把 `yc:`/`yl:` 之后的长文截掉再上正则。
    简介动辄两千字，里头「××：『……』」的引文格式与字段正则形近，
    截掉最省心——本脚本要的字段（y k n w wt ya cf d b）全在 yc 之前。
    """
    src = io.open(os.path.join(ROOT, "js/events.js"), encoding="utf-8").read()
    body = src[src.index("export const EVENTS = ["):]
    evs = []
    for line in body.splitlines():
        m = re.match(r"\s*\{ (.*) \},?$", line)
        if not m:
            continue
        seg = m.group(1)
        cut = len(seg)
        for key in (", yc: ", ", yl: ", ", no: "):
            i = seg.find(key)
            if i >= 0:
                cut = min(cut, i)
        d = {}
        # 字符串取值要认转义引号。`'([^']*)'` 这个写法（rank.py 至今在用）
        # 会在 `\'` 处把值截断：全库唯一一条带转义引号的 `w`——
        # `en:The General\'s Garden (Tangut translation)`——被截成
        # `en:The General\`，于是「查无此条目」，`signals.json` 里也是这么坏的。
        for kv in re.finditer(r"(\w+): (?:'((?:[^'\\]|\\.)*)'|(-?\d+))", seg[:cut]):
            k, sv, nv = kv.groups()
            if sv is not None:
                sv = re.sub(r"\\(.)", r"\1", sv)
            d[k] = sv if sv is not None else int(nv)
        mr = re.search(r",\s*r: (\d)\s*$", seg)      # r 排在行尾，在截断段之外
        if mr:
            d["r"] = int(mr.group(1))
        if "n" in d:
            evs.append(d)
    return evs


def norm(s):
    """字符串索引用的轻归一：空格/下划线/大小写。

    **不做繁简折叠**——这台机器上 opencc 与 zhconv 都没有，而手写对照表
    在人名地名上错得比对得多。繁简这一层交给 pageid 去合并；本函数只管
    「三星堆 遗址」与「三星堆_遗址」这种纯书写差异。字符串索引在本脚本里
    不参与判边，只用来量盲点（见 report 的「字符串独有」一栏）。
    """
    return re.sub(r"[\s_]+", "", (s or "")).strip().lower()


# ── 抓取主循环 ──────────────────────────────────────────────────────────────
def save(cache):
    tmp = CACHE + ".tmp"
    json.dump(cache, io.open(tmp, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, CACHE)


def ws_of(evs):
    """事件表里出现过的 `w`，按首见顺序去重（一个页被几条共用时只抓一次）。"""
    seen, order = set(), []
    for e in evs:
        w = e.get("w")
        if w and w not in seen:
            seen.add(w)
            order.append(w)
    return order


def resolve_all(order, cache, batch=50, retry_missing=False):
    """阶段〇：把还没解析过的 `w` 批量问出正名／pageid／别名。"""
    if retry_missing:
        for w in order:
            c = cache.get(w) or {}
            if c.get("missing"):
                c.pop("aliases", None)
                c.pop("missing", None)
                c.pop("fetched", None)
    todo = [w for w in order if "aliases" not in (cache.get(w) or {})]
    if not todo:
        return
    print("阶段〇 别名解析：%d 个页待解（%d 个一发）" % (len(todo), batch))
    for host in ("zh.wikipedia.org", "en.wikipedia.org"):
        grp = [w for w in todo if split_host(w)[0] == host]
        for i in range(0, len(grp), batch):
            chunk = grp[i:i + batch]
            r = resolve_batch(host, [split_host(w)[1] for w in chunk])
            if r in (None, "?"):
                print("  ? 一批解析未成，留待重跑")
                continue
            for w in chunk:
                v = r.get(split_host(w)[1])
                if v is None:
                    cache.setdefault(w, {}).update(
                        {"title": split_host(w)[1], "pageid": None,
                         "aliases": [], "missing": True})
                else:
                    cache.setdefault(w, {}).update(v)
            save(cache)
            print("  …%d/%d" % (min(i + batch, len(grp)), len(grp)))


def compact(evs, cache, verbose=True):
    """瘦身：把入链的页名与 pageid 全表折起来。幂等，可反复跑。

    抓下来的原样是每页一份 500 条的入链页名＋500 个 pageid，重复得厉害：
    「中国历史」这种页名在几百条的入链表里各出现一次。

    折的办法：入链里**命中库内**的，直接记成条目名（`bl_hits`，判边只要这个）；
    没命中的是库外页，抽到全局的 `__outside__` 去，一个页名只存一次，
    值是「它指了库内哪几条」——库外指向榜要的正是这张表。

    省多少取决于抓到几成：抓完四百六十页时去重率才五成六，折下来几乎不省
    （3.48 MB → 3.43 MB）；页抓得越全，同一个库外页被重复记到的次数越多，
    折起来越划算。**这个文件终究是数 MB 量级**，比库里别的 json 大一个档次——
    留着它，是为了让改停用表、改判类、改名次口径这些事都能零外呼重算。

    代价说明白：折过之后，`bl_hits` 与 `out_hits` 一样是**对着当时的索引**算好的。
    日后往 events.js 加了新条目，旧条不会回溯认出它——那时得 --refresh 重抓。
    """
    by_pid = defaultdict(list)
    for e in evs:
        w = e.get("w")
        c = cache.get(w or "")
        if c and c.get("pageid"):
            by_pid[(split_host(w)[0], c["pageid"])].append(e["n"])
    ns_of = defaultdict(set)
    for e in evs:
        if e.get("w"):
            ns_of[e["w"]].add(e["n"])
    outside = cache.setdefault("__outside__", {})
    n, before = 0, 0
    for w, c in list(cache.items()):
        if w.startswith("__") or not isinstance(c, dict):
            continue
        if "backlink_ids" not in c:
            continue
        before += 1
        host = split_host(w)[0]
        me = ns_of.get(w, set())
        hits = set()
        ids = c.get("backlink_ids") or []
        tis = c.get("backlinks") or []
        for pid, ti in zip(ids, tis):
            got = by_pid.get((host, pid))
            if got:
                hits |= set(got) - me
            else:
                cur = outside.setdefault(ti, [])
                for x in me:
                    if x not in cur:
                        cur.append(x)
        c["bl_hits"] = sorted(hits)
        c.pop("backlinks", None)
        c.pop("backlink_ids", None)
        n += 1
    save(cache)
    if verbose:
        print("瘦身：折起 %d 页的入链全表；库外页名表 %d 条；缓存 %.1f MB"
              % (n, len(outside), os.path.getsize(CACHE) / 1048576.0))
    return cache


def build_str_index(evs, cache):
    """归一字符串 → 事件 n。两层分开建，为的是日后查得出一条边是怎么连上的。

    正轨 idx_w：`w`、维基正名、以及该页的全部重定向别名——都是「维基自己认
    这个写法指向这个条目」，可信。
    备轨 idx_nya：库内自拟的条目名 `n` 与雅名 `ya`。它们是本库的说法，不是
    维基的；同名未必同事（「网开三面」这种成语条尤其危险）。故单独一轨，
    命中另计，报告里分开报，谁也别混谁的账。
    """
    idx_w, idx_nya = defaultdict(set), defaultdict(set)
    for e in evs:
        w = e.get("w")
        if not w:
            continue
        host, t = split_host(w)
        c = cache.get(w) or {}
        for k in [t, c.get("title")] + list(c.get("aliases") or []):
            if k:
                idx_w[(host, norm(k))].add(e["n"])
        for k in (e["n"], e.get("ya")):
            if k:
                idx_nya[(host, norm(k))].add(e["n"])
    return idx_w, idx_nya


def crawl(evs, cache, limit=None, refresh=False, batch=12, retry_missing=False,
          rounds=0):
    """阶段一：成批推进出链＋入链，边抓边把出链目标对进索引。"""
    order = ws_of(evs)
    if refresh:
        for w in order:
            cache.pop(w, None)
    resolve_all(order, cache, retry_missing=retry_missing)
    idx_w, idx_nya = build_str_index(evs, cache)

    todo = [w for w in order
            if not (cache.get(w) or {}).get("fetched")
            and not (cache.get(w) or {}).get("missing")]
    print("有 w 的条目 %d 条，去重后 %d 个维基页；已抓 %d，待抓 %d%s"
          % (sum(1 for e in evs if e.get("w")), len(order),
             len(order) - len(todo) - sum(1 for w in order
                                          if (cache.get(w) or {}).get("missing")),
             len(todo), ("（本轮只抓前 %d 个）" % limit) if limit else ""))
    # **打乱再抓**，用固定种子保证可重现。events.js 是按年代排的，照原序抓，
    # 中途一停（限流、掉电）拿到的就是「史前到先秦」这一段，而那一段的条目
    # 彼此链得特别密（遗址条互相援引），算出来的入度榜会整片偏向早期——
    # 半截数据看着像结论，其实是抓取顺序的影子。打乱之后，任何时候停下来
    # 手里都是一份无偏样本，报告可以照实说「截至 N 条」。
    import random
    random.Random(20260902).shuffle(todo)
    if limit:
        todo = todo[:limit]
    ns_of = defaultdict(set)                  # 正名 → 用它的库内条目（可能不止一条）
    w_of = {}                                 # 正名 → 原 w（回写缓存用）
    for w in todo:
        c = cache.get(w) or {}
        t = c.get("title") or split_host(w)[1]
        w_of[(split_host(w)[0], t)] = w
        for e in evs:
            if e.get("w") == w:
                ns_of[(split_host(w)[0], t)].add(e["n"])

    t0, done = time.time(), 0
    for host in ("zh.wikipedia.org", "en.wikipedia.org"):
        grp = [w for w in todo if split_host(w)[0] == host]
        for i in range(0, len(grp), batch):
            chunk = grp[i:i + batch]
            titles = [(cache.get(w) or {}).get("title") or split_host(w)[1]
                      for w in chunk]
            titles = sorted(set(titles))
            r = fetch_batch(host, titles, cap_rounds=rounds or None)
            if r in (None, "?"):
                print("  ? 一批未取到（%s…），留待重跑" % titles[0])
                continue
            for t in titles:
                v = r.get(t)
                w = w_of.get((host, t))
                if not v or not w:
                    continue
                if v.get("missing"):
                    cache.setdefault(w, {}).update(
                        {"missing": True, "fetched": True,
                         "n_links": 0, "n_backlinks": 0})
                    continue
                me = ns_of.get((host, t), set())
                hits, hits_nya = set(), set()
                for ti in v["links"]:
                    k = (host, norm(ti))
                    hits |= (idx_w.get(k) or set()) - me
                    hits_nya |= (idx_nya.get(k) or set()) - me
                c = cache.setdefault(w, {})
                c.update({
                    "title": t, "pageid": v.get("pageid", c.get("pageid")),
                    "fetched": True,
                    "n_links": len(v["links"]), "links_truncated": v["lt"],
                    "out_hits": sorted(hits),
                    "out_hits_nya": sorted(hits_nya - hits),
                    "n_backlinks": len(v["bl"]), "bl_truncated": v["bt"],
                    # 入链留页名：库外指向榜按页名汇总，那一栏是给人读的
                    "backlinks": v["bl"], "backlink_ids": v["blids"],
                })
                done += 1
            save(cache)
            el = time.time() - t0
            print("  …%d/%d 页（%d 发请求，均 %.1fs/页，余约 %.0f 分）"
                  % (done, len(todo), STATS["req"], el / max(done, 1),
                     el / max(done, 1) * (len(todo) - done) / 60))
    return cache


# ── 计算 ────────────────────────────────────────────────────────────────────
# 库外指向榜的停用表：这些页链过来说明不了任何事。
# 「中国历史」链到库内四百条，不是因为它们相干，是因为它是一张总目。
# 判准写在报告里：**页名是一个时段／一个朝代／一个门类的总目，而不是一件事**。
STOPWORDS = [
    "中国历史", "中國歷史", "中华人民共和国", "中华文明", "中國文化",
    "中国历史年表", "中國歷史年表", "中国朝代", "中國朝代",
    "中国历史事件列表", "中國歷史事件列表",
    "世界遗产", "世界遺產", "中国全国重点文物保护单位",
    "全国重点文物保护单位", "全國重點文物保護單位",
    "中国国家博物馆", "故宫博物院", "国立故宫博物院", "國立故宮博物院",
    "中国大百科全书", "二十四史", "资治通鉴", "資治通鑑", "史记", "史記",
]
STOP_PAT = [
    r"^.{0,6}年表$", r"列表$", r"^.{0,10}历史$", r"^.{0,10}歷史$",
    r"^中国.{0,6}史$", r"^中國.{0,6}史$", r"^.{0,4}文化史$",
    r"一览$", r"^.{0,8}年鉴$", r"^.{0,8}年鑑$",
]


def is_stop(title):
    if title in STOPWORDS:
        return True
    return any(re.search(p, title) for p in STOP_PAT)


def compute(evs, cache, use_nya=False):
    """把缓存折成图：节点＝事件 n，边＝甲的维基页 --wikilink--> 乙。

    边有两个独立来源，**取并集**，各自补对方的洞：
      out  甲页的出链里出现了乙（按写法查别名表）——不受入链 500 封顶之限，
           但漏中文维基字词转换自动落地的那种写法
      in   乙页的入链里出现了甲（按 pageid 认人）——写法怎么变都认得出，
           但热门条目入链上万，只取得到头 500 条
    每条边记 `via`：both／out／in。两者的差额就是各自盲点的大小，
    报告「盲点」节量的正是它。
    """
    by_pid = defaultdict(list)
    for e in evs:
        w = e.get("w")
        c = cache.get(w or "")
        if not c or not c.get("pageid"):
            continue
        by_pid[(split_host(w)[0], c["pageid"])].append(e["n"])

    out_hits, in_hits = defaultdict(set), defaultdict(set)
    for e in evs:
        w = e.get("w")
        c = cache.get(w or "")
        if not c or not c.get("fetched"):
            continue
        me, host = e["n"], split_host(w)[0]
        h = set(c.get("out_hits") or [])
        if use_nya:
            h |= set(c.get("out_hits_nya") or [])
        out_hits[me] = h - {me}
        if "bl_hits" in c:                  # 瘦身过的缓存：命中已折好
            for s in c["bl_hits"]:
                if s != me:
                    in_hits[s].add(me)      # 甲链到我 ⇒ 边 甲→我
        else:
            for pid in c.get("backlink_ids") or []:
                for s in by_pid.get((host, pid), []):
                    if s != me:
                        in_hits[s].add(me)

    edges, out_deg, in_deg = [], Counter(), Counter()
    via_cnt = Counter()
    allpairs = {(s, t) for s, ts in out_hits.items() for t in ts}
    allpairs |= {(s, t) for s, ts in in_hits.items() for t in ts}
    for s, t in sorted(allpairs):
        o = t in out_hits.get(s, ())
        i = t in in_hits.get(s, ())
        via = "both" if (o and i) else ("out" if o else "in")
        via_cnt[via] += 1
        mut = (t, s) in allpairs
        edges.append({"s": s, "t": t, "type": "wikilink", "via": via,
                      "mutual": mut})
        out_deg[s] += 1
        in_deg[t] += 1

    # ── 互链＝导航模板的影子 ────────────────────────────────────────────────
    # 维基条目底部的导航模板（「禁止出国展览文物」「中国世界遗产」这类）会把
    # 同族的一二百个条目**两两全链一遍**，而 prop=links 与 linkshere 都照单
    # 收录——它们不区分「正文里编者顺手打的」与「模板机械展开的」。症状很好认：
    # 一批条目的入度会齐刷刷落在同一个数字附近（本轮实测 art 类扎堆在 87–94，
    # 那就是模板成员数），而那个数字量的是模板多大，不是这件东西多要紧。
    # 故另记一份**单向入度**：只数「甲链了乙、而乙没回链甲」的边。模板造的边
    # 一律成对，会在这一份里整片消失；真正的引用则多是单向的（讲安史之乱绕不开
    # 唐玄宗，唐玄宗条却未必回指安史之乱的某一件事）。两份并排看，差得越多，
    # 模板的成分越重。
    in_deg_one = Counter()
    for e in edges:
        if not e["mutual"]:
            in_deg_one[e["t"]] += 1
    return {"by_pid": by_pid, "edges": edges, "out_deg": out_deg,
            "in_deg": in_deg, "in_deg_one": in_deg_one,
            "hits": out_hits, "blhits": in_hits,
            "via": via_cnt, "ev_by_n": {e["n"]: e for e in evs}}


def outside_ranking(evs, cache, g):
    """库外指向榜：不在库内索引里的页，各自指向了库内多少条。"""
    inside_pid = set(g["by_pid"])
    tally = defaultdict(list)
    # 瘦身过的缓存把这张表折在 __outside__ 里；没折的照旧现算
    for t, v in (cache.get("__outside__") or {}).items():
        tally[t].extend(v)
    for e in evs:
        w = e.get("w")
        c = cache.get(w or "")
        if not c or not c.get("pageid") or "backlink_ids" not in c:
            continue
        host, _ = split_host(w)
        for pid, ti in zip(c.get("backlink_ids", []), c.get("backlinks", [])):
            if (host, pid) in inside_pid:
                continue
            tally[ti].append(e["n"])
    rows = [(t, sorted(set(v))) for t, v in tally.items()]
    rows.sort(key=lambda r: (-len(r[1]), r[0]))
    return rows


# 判类：先看维基自己的分类（准），拿不到才退回按页名猜（粗）。
# 按名字猜栽过的跟头留在这里当反面教材：单看「二到四字、没有消歧义括号」
# 就判人物，会把九寨沟、可可西里、圆明园、周原一齐判成人。中文地名与人名
# 的字数分布几乎重合，名字这一层根本分不开——所以才要去问分类。
CAT_RULES = [
    ("人物", r"(出生|逝世|人物|皇帝|君主|将领|將領|诗人|詩人|画家|畫家|作家|"
             r"政治家|军事家|軍事家|宰相|太守|状元|狀元|家族|氏族)"),
    ("事件", r"(战役|戰役|战争|戰爭|之战|之戰|政变|政變|起义|起義|民变|民變|"
             r"事变|事變|叛乱|叛亂|战斗|戰鬥|条约|條約|会盟|會盟)"),
    ("文物/著述", r"(文物|馆藏|館藏|青铜器|青銅器|绘画|繪畫|书法|書法|瓷器|"
                  r"古籍|典籍|文献|文獻|经书|經書|小说|小說|诗集|詩集|碑刻|"
                  r"简牍|簡牘|帛书|帛書|器物|一级文物|一級文物)"),
    ("遗址/考古", r"(遗址|遺址|考古|文化遗产|文化遺產|全国重点文物保护单位|"
                  r"全國重點文物保護單位|墓葬|古墓|世界遗产|世界遺產)"),
    ("建筑/地物", r"(建筑|建築|寺院|寺庙|寺廟|宫殿|宮殿|陵墓|园林|園林|城墙|城牆|"
                  r"塔|桥梁|橋樑|运河|運河|山脉|山脈|河流|湖泊|地理|城市|行政区|行政區)"),
    ("政权/时段", r"(朝代|政权|政權|国家|國家|王朝|时期|時期|年号|年號|帝国|帝國)"),
    ("制度", r"(制度|官制|法律|科举|科舉|赋税|賦稅|军制|軍制|礼制|禮制)"),
]


def kind_from_cats(cats):
    for name, pat in CAT_RULES:
        if any(re.search(pat, c) for c in cats):
            return name
    return None


def guess_kind(title, cats=None):
    """页名粗判——只在没有分类可查时用，判出来的东西一律当参考不当结论。"""
    if cats:
        k = kind_from_cats(cats)
        if k:
            return k
    if re.search(r"(之战|之戰|之役|起义|起義|之乱|之亂|之变|之變|兵变|兵變|战争|戰爭)$", title):
        return "事件"
    if re.search(r"(遗址|遺址|墓|陵|寺|塔|窟|城|宫|宮|楼|樓|台|臺|关|關|桥|橋|渠|运河|運河)$", title):
        return "遗址/建筑"
    if re.search(r"(鼎|尊|簋|盉|卣|罍|钟|鐘|镜|鏡|碑|帖|图|圖|卷|经|經|书|書|简|簡|器|剑|劍|玉|瓷|窑|窯)$", title):
        return "文物/著述"
    if re.search(r"(朝|国|國|王朝|政权|政權|帝国|帝國)$", title):
        return "政权/时段"
    if re.search(r"(制|法|令|科举|科舉|政策|改革|变法|變法)$", title):
        return "制度"
    return "—"


def probe_kinds(titles, cache, host="zh.wikipedia.org", batch=20):
    """给库外指向榜的候选批量取分类。结果存缓存 `__kinds__`，只取一次。

    键名带双下划线是为了与 `w` 分开——crawl 只按事件表里的 `w` 去查缓存，
    不遍历缓存的键，两者不会互相绊到。
    """
    kc = cache.setdefault("__kinds__", {})
    todo = [t for t in titles if t not in kc]
    if not todo:
        return kc
    print("判类探测：%d 个页名待查分类" % len(todo))
    for i in range(0, len(todo), batch):
        grp = todo[i:i + batch]
        got = {t: [] for t in grp}
        cont = None
        for _ in range(6):
            params = {"titles": "|".join(grp), "prop": "categories",
                      "cllimit": "max", "clshow": "!hidden", "redirects": "1"}
            if cont:
                params["clcontinue"] = cont
            d = api(host, params)
            if d in (None, "?"):
                break
            for p in d.get("query", {}).get("pages", []) or []:
                if p.get("title") in got:
                    got[p["title"]].extend(
                        c["title"].replace("Category:", "")
                        for c in (p.get("categories") or []))
            cont = (d.get("continue") or {}).get("clcontinue")
            if not cont:
                break
        for t in grp:
            kc[t] = got.get(t, [])
        if (i // batch) % 5 == 4:
            save(cache)
    save(cache)
    return kc


def probe_disambig(evs, cache, batch=40):
    """库内 `w` 有没有指到消歧义页上。

    events.js 的收录标准第 2 条自陈「`w` 逐条实测过（REST summary 返回 200
    且非消歧义页）」——那是入库当时测的。此处是复测：一千五百条里若有一条
    后来被改成了消歧义页，它的出链就全是「张三（唐朝）」「张三（宋朝）」
    这种义项列表，链出去的东西与本条毫不相干，会往图里灌一片假边。
    """
    fc = cache.setdefault("__flags__", {})
    pairs = []
    for e in evs:
        w = e.get("w")
        c = cache.get(w or "")
        if c and c.get("pageid") and w not in fc:
            pairs.append((w, split_host(w)))
    if not pairs:
        return fc
    print("消歧义复测：%d 个页待查" % len(pairs))
    for host in ("zh.wikipedia.org", "en.wikipedia.org"):
        grp_all = [(w, t) for w, (h, t) in pairs if h == host]
        for i in range(0, len(grp_all), batch):
            grp = grp_all[i:i + batch]
            d = api(host, {"titles": "|".join(t for _, t in grp),
                           "redirects": "1", "prop": "pageprops"})
            if d in (None, "?"):
                continue
            flag = {}
            for p in d.get("query", {}).get("pages", []) or []:
                pp = p.get("pageprops") or {}
                flag[p.get("pageid")] = "disambiguation" in pp
            for w, _ in grp:
                pid = cache[w]["pageid"]
                fc[w] = {"disambig": bool(flag.get(pid))}
    save(cache)
    return fc


def diagnose_asymmetry(cache, g, evs, pairs, n=15):
    """出链说「我链了它」、入链却说「没人这么链我」——查是不是重定向中转。

    维基的 linkshere 只记**直接**链接。若甲的正文写的是 `[[郧县直立人]]`
    而那是重定向页，则乙（郧县人）的入链表里出现的是那个重定向页，不是甲；
    而出链侧因为 redirects=1 已经把目标解到了乙。两侧于是各说各话——
    这不是缓存错，是 API 的两个端点本来就在数不同的东西。
    此函数拿实例把它坐实：取乙的重定向页，逐个看甲在不在它们的入链里。
    """
    ev_by_n = {e["n"]: e for e in evs}
    out = []
    for s, t in pairs[:n]:
        se, te = ev_by_n.get(s), ev_by_n.get(t)
        if not se or not te:
            continue
        host, _ = split_host(te["w"])
        s_pid = cache[se["w"]]["pageid"]
        d = api(host, {"titles": split_host(te["w"])[1], "redirects": "1",
                       "prop": "redirects", "rdlimit": "max", "rdnamespace": "0"})
        if d in (None, "?"):
            continue
        pages = d.get("query", {}).get("pages") or [{}]
        rds = [x["title"] for x in (pages[0].get("redirects") or [])]
        via = None
        if rds:
            d2 = api(host, {"titles": "|".join(rds[:20]), "prop": "linkshere",
                            "lhlimit": "500", "lhnamespace": "0"})
            if d2 not in (None, "?"):
                for p in d2.get("query", {}).get("pages", []) or []:
                    if any(x["pageid"] == s_pid for x in (p.get("linkshere") or [])):
                        via = p["title"]
                        break
        out.append({"s": s, "t": t, "redirects": rds[:8], "via": via,
                    "bl_truncated": cache[te["w"]].get("bl_truncated")})
    return out


# ── 输出 ────────────────────────────────────────────────────────────────────
def fy(y):
    return ("前%d" % (-y + 1)) if y < 0 else str(y)


def dump_json(evs, cache, g, rows, outdir, kinds=None):
    kinds = kinds or {}
    os.makedirs(outdir, exist_ok=True)
    # 节点 id 照 graph_mentions.py 的 nid('ev', n) 拼，两份图直接并起来就是一张
    nodes = [{"id": "ev:" + e["n"], "type": "ev", "label": e["n"],
              "y": e["y"], "k": e.get("k"), "r": e.get("r"),
              "w": e.get("w"), "wt": e.get("wt", "exact"),
              "wl_in": g["in_deg"].get(e["n"], 0),
              "wl_in_oneway": g["in_deg_one"].get(e["n"], 0),
              "wl_out": g["out_deg"].get(e["n"], 0),
              "n_links": (cache.get(e.get("w") or "") or {}).get("n_links", 0),
              "n_backlinks": (cache.get(e.get("w") or "") or {}).get("n_backlinks", 0)}
             for e in evs]
    edges = [{"s": "ev:" + x["s"], "t": "ev:" + x["t"],
              "type": "wikilink", "src": "wikilink",
              "via": x["via"], "mutual": x["mutual"]} for x in g["edges"]]
    p = os.path.join(outdir, "graph_wikilinks.json")
    json.dump({"node_key": "ev:<事件 n>（同 graph_mentions.py 的 nid）",
               "nodes": nodes, "edges": edges},
              io.open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    p2 = os.path.join(outdir, "wikilinks_outside.json")
    json.dump([{"title": t, "kind": guess_kind(t, kinds.get(t)), "n": len(v),
                "hits": v, "cats": (kinds.get(t) or [])[:6]}
               for t, v in rows if not is_stop(t)][:400],
              io.open(p2, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print("\n→ %s（节点 %d、边 %d）" % (p, len(nodes), len(g["edges"])))
    print("→ %s" % p2)
    return p


def report(evs, cache, g, rows, kinds=None, diag=None):
    """报告要用的数字全在这里打一遍——报告是照这份输出誊的，不另手算。"""
    kinds = kinds or {}
    have = [e for e in evs if e.get("w") and cache.get(e["w"], {}).get("fetched")
            and not cache[e["w"]].get("missing")]
    miss = [e for e in evs if e.get("w") and not cache.get(e["w"], {}).get("fetched")]
    nopage = [e["n"] for e in evs if e.get("w") and cache.get(e["w"], {}).get("missing")]
    print("\n══ 总账 ══")
    print("库内条目 %d，其中有 w 者 %d，抓到页者 %d，未抓 %d（其中维基无此条目 %d）"
          % (len(evs), sum(1 for e in evs if e.get("w")), len(have), len(miss), len(nopage)))
    print("去重维基页 %d；边 %d 条；平均每条牵出 %.2f 条库内条目"
          % (len({e["w"] for e in have}), len(g["edges"]),
             len(g["edges"]) / max(len(have), 1)))
    tot_links = sum(cache[e["w"]]["n_links"] for e in have)
    tot_bl = sum(cache[e["w"]]["n_backlinks"] for e in have)
    print("出链总数 %d（命中 %d，命中率 %.3f%%）；入链总数 %d"
          % (tot_links, g["via"]["both"] + g["via"]["out"],
             100.0 * (g["via"]["both"] + g["via"]["out"]) / max(tot_links, 1), tot_bl))
    trunc = [e["n"] for e in have if cache[e["w"]].get("links_truncated")]
    print("出链翻页截断 %d 条（各取前 %d 条出链）：%s"
          % (len(trunc), MAX_LINK_PAGES * 500, "、".join(trunc[:8])))
    bt = [e["n"] for e in have if cache[e["w"]].get("bl_truncated")]
    print("入链达 %d 封顶 %d 条" % (BACKLINK_CAP, len(bt)))
    print("请求 %d，429 %d 次，退避 %d 次" % (STATS["req"], STATS["http429"], len(STATS["backoff"])))

    print("\n══ 两向互证 ══")
    v = g["via"]
    print("边 %d ＝ 两侧都认 %d ＋ 只出链认 %d ＋ 只入链认 %d"
          % (len(g["edges"]), v["both"], v["out"], v["in"]))
    print("  两侧都认占 %.1f%%" % (100.0 * v["both"] / max(len(g["edges"]), 1)))
    ev_have = {e["n"]: e for e in have}
    only_out = [(x["s"], x["t"]) for x in g["edges"] if x["via"] == "out"]
    cut_bad = [(s, t) for s, t in only_out
               if cache.get((ev_have.get(t) or {}).get("w") or "", {}).get("bl_truncated")]
    print("  只出链认的 %d 条里，目标页入链已达封顶（截断所致，非错）：%d；"
          "余 %d 条多为经重定向中转（linkshere 只记直接链接）"
          % (len(only_out), len(cut_bad), len(only_out) - len(cut_bad)))
    only_in = [(x["s"], x["t"]) for x in g["edges"] if x["via"] == "in"]
    cut_in = [(s, t) for s, t in only_in
              if cache.get((ev_have.get(s) or {}).get("w") or "", {}).get("links_truncated")]
    print("  只入链认的 %d 条里，来源页出链被翻页截断：%d；"
          "余 %d 条多为字词转换写法（出链侧的写法不在别名表内）"
          % (len(only_in), len(cut_in), len(only_in) - len(cut_in)))
    for s, t in [p for p in only_out if p not in cut_bad][:8]:
        print("    只出链认：%s → %s" % (s, t))
    for s, t in [p for p in only_in if p not in cut_in][:8]:
        print("    只入链认：%s → %s" % (s, t))
    nya = sum(len(cache[e["w"]].get("out_hits_nya") or []) for e in have)
    print("  备轨（库内自拟名 n／雅名 ya 撞上的额外命中，默认不入边）：%d 处" % nya)
    if diag:
        print("\n  ── 不对称抽样诊断（查是不是重定向中转）──")
        for d in diag:
            print("    %s → %s ｜ 中转页：%s ｜ 该页重定向名：%s"
                  % (d["s"], d["t"], d["via"] or "未找到",
                     "、".join(d["redirects"]) or "无"))

    # 全站入链 lh 借 rank.py 的 signals.json（只读）：库内入度高而全站入链低的，
    # 是「在本库这张网里中心、在维基整体上冷门」——那正是本库自己的题眼。
    sigp = os.path.join(HERE, "signals.json")
    sig = json.load(io.open(sigp, encoding="utf-8")) if os.path.exists(sigp) else {}
    lh_of = lambda e: (sig.get(e.get("w") or "") or {}).get("lh", 0)
    print("\n══ 维基入度榜前 40 ══")
    print("  （库入＝库内多少条的维基页链到它；全站入链 lh 取自 signals.json，封顶 500）")
    top = sorted(have, key=lambda e: -g["in_deg"].get(e["n"], 0))[:40]
    for e in top:
        print("  库入%3d 库出%3d 全站%4d | r=%s k=%-4s wt=%-7s %-7s %s"
              % (g["in_deg"].get(e["n"], 0), g["out_deg"].get(e["n"], 0),
                 lh_of(e), e.get("r"), e.get("k"), e.get("wt", "exact"),
                 fy(e["y"]), e["n"]))

    print("\n══ 各类入度前 10 ══")
    bycat = defaultdict(list)
    for e in have:
        bycat[e.get("k")].append(e)
    for k in sorted(bycat, key=lambda k: -len(bycat[k])):
        pool = sorted(bycat[k], key=lambda e: -g["in_deg"].get(e["n"], 0))[:10]
        print("  %-5s（%d 条）: %s" % (k, len(bycat[k]), "、".join(
            "%s %d" % (e["n"], g["in_deg"].get(e["n"], 0)) for e in pool)))

    # wt 借光：w 指的不是这件事本身，是人／上级页。那种页出链多而泛，
    # 入度也高——高的是那个人、那个文化，不是这条轶事。单列免得混读。
    print("\n══ wt 分组（借光嫌疑）══")
    for wt in ("exact", "person", "parent", "related"):
        pool = [e for e in have if e.get("wt", "exact") == wt]
        if not pool:
            continue
        ind = sorted(g["in_deg"].get(e["n"], 0) for e in pool)
        outd = sorted(g["out_deg"].get(e["n"], 0) for e in pool)
        med = lambda a: a[len(a) // 2] if a else 0
        nl = sorted(cache[e["w"]]["n_links"] for e in pool)
        nb = sorted(cache[e["w"]]["n_backlinks"] for e in pool)
        print("  %-8s %4d 条 | 入度中位 %3d 均 %5.1f | 出度中位 %3d | 维基出链中位 %4d | 维基入链中位 %4d"
              % (wt, len(pool), med(ind), sum(ind) / len(ind), med(outd), med(nl), med(nb)))
    shared = defaultdict(list)
    for e in have:
        shared[e["w"]].append(e["n"])
    multi = sorted([(w, v) for w, v in shared.items() if len(v) > 1],
                   key=lambda x: -len(x[1]))
    print("  一页多条（同一个 w 被几条事件共用，边会被复制几份）：%d 个页、涉 %d 条"
          % (len(multi), sum(len(v) for _, v in multi)))
    for w, v in multi[:12]:
        print("    %s ×%d：%s" % (w, len(v), "、".join(v)))

    print("\n══ 高入度而 r=3 前 30 ══")
    c3 = [e for e in have if e.get("r") == 3]
    for e in sorted(c3, key=lambda e: -g["in_deg"].get(e["n"], 0))[:30]:
        print("  库入%3d 全站%4d | k=%-4s wt=%-7s %-7s %s"
              % (g["in_deg"].get(e["n"], 0), lh_of(e), e.get("k"),
                 e.get("wt", "exact"), fy(e["y"]), e["n"]))

    print("\n══ r=1 而入度 0 前 30 ══")
    z = [e for e in have if e.get("r") == 1 and g["in_deg"].get(e["n"], 0) == 0]
    print("  （共 %d 条，占 r=1 的 %.1f%%）"
          % (len(z), 100.0 * len(z) / max(sum(1 for e in have if e.get("r") == 1), 1)))
    for e in sorted(z, key=lambda e: -cache[e["w"]]["n_backlinks"])[:30]:
        print("  库出%3d 维基入链%4d | k=%-4s wt=%-7s %-7s %s"
              % (g["out_deg"].get(e["n"], 0), cache[e["w"]]["n_backlinks"],
                 e.get("k"), e.get("wt", "exact"), fy(e["y"]), e["n"]))

    print("\n══ 库外指向榜前 80（去总述页）══")
    kept = [(t, v) for t, v in rows if not is_stop(t)]
    for t, v in kept[:80]:
        print("  %3d %-10s %-20s %s"
              % (len(v), guess_kind(t, kinds.get(t)), t, "、".join(v[:6])))
    print("\n（被停用表滤掉的前 20）")
    for t, v in [(t, v) for t, v in rows if is_stop(t)][:20]:
        print("  %3d %s" % (len(v), t))


def main():
    ap = argparse.ArgumentParser(description="维基出链／入链图层")
    ap.add_argument("--limit", type=int, help="本轮最多抓几个页（试跑用）")
    ap.add_argument("--offline", action="store_true", help="零外呼，只用缓存算")
    ap.add_argument("--refresh", action="store_true", help="全量重取（不吃缓存）")
    ap.add_argument("--retry-missing", action="store_true",
                    help="拿 converttitles 重解一遍「查无此页」的 w（繁简变体）")
    ap.add_argument("--batch", type=int, default=8,
                    help="阶段一每发请求带几个页（默认 8）。**批大不等于快**："
                         "continue 的轮数随批大小一起涨，总请求数几乎不变，"
                         "而一批拖得越久，落盘越稀、掉电损失越大")
    ap.add_argument("--rounds", type=int, default=8, metavar="N",
                    help="每批最多 continue 几轮（默认 8）。轮数封顶＝允许出链／"
                         "入链取不全，取不全的标 truncated，由另一侧补")
    ap.add_argument("--probe-kinds", type=int, default=0, metavar="N",
                    help="给库外指向榜前 N 名查维基分类以判类（结果进缓存）")
    ap.add_argument("--probe-disambig", action="store_true",
                    help="复测库内 w 是否指到了消歧义页（结果进缓存）")
    ap.add_argument("--diagnose", type=int, default=0, metavar="N",
                    help="抽 N 条两向不对称的边，查是不是重定向中转")
    ap.add_argument("--compact", action="store_true",
                    help="瘦身缓存：把入链页名/pageid 全表折成命中表＋库外指向表"
                         "（幂等；抓完自动做一次，此参数用于对旧缓存补做）")
    ap.add_argument("--use-nya", action="store_true",
                    help="把库内自拟名 n／雅名 ya 撞上的命中也算作边（默认不算）")
    # 默认不写 JSON：这两份是分析中间物，不是库件，落进仓库只会积垢。
    # 要就显式给一个库外目录（如本轮的 scratchpad/wikilinks/）。
    ap.add_argument("--out", default="", help="JSON 输出目录（不给则只打印报告）")
    a = ap.parse_args()

    evs = load_events()
    print("事件 %d 条" % len(evs))
    cache = json.load(io.open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
    if not a.offline:
        cache = crawl(evs, cache, limit=a.limit, refresh=a.refresh,
                      batch=a.batch, retry_missing=a.retry_missing,
                      rounds=a.rounds)
        compact(evs, cache)          # 抓完顺手折起来，免得缓存越滚越肥
    elif a.compact:
        compact(evs, cache)
    g = compute(evs, cache, use_nya=a.use_nya)
    rows = outside_ranking(evs, cache, g)

    if a.probe_disambig and not a.offline:
        probe_disambig(evs, cache)
    if a.probe_kinds and not a.offline:
        probe_kinds([t for t, _ in rows if not is_stop(t)][:a.probe_kinds], cache)
    kinds = cache.get("__kinds__", {})

    diag = None
    if a.diagnose and not a.offline:
        ev_by_n = {e["n"]: e for e in evs}
        # 只诊断「只有出链认、且对方入链没被封顶截断」的那些——
        # 截断了的本来就解释得通，不必花请求去问
        bad = [(x["s"], x["t"]) for x in g["edges"] if x["via"] == "out"
               and not cache.get(ev_by_n[x["t"]].get("w") or "", {}).get("bl_truncated")]
        diag = diagnose_asymmetry(cache, g, evs, bad, n=a.diagnose)

    if a.out:
        dump_json(evs, cache, g, rows, a.out, kinds)
    report(evs, cache, g, rows, kinds, diag)

    flags = cache.get("__flags__", {})
    dis = [w for w, v in flags.items() if v.get("disambig")]
    if flags:
        print("\n══ 消歧义复测 ══ 查了 %d 个页，指到消歧义页的 %d 个：%s"
              % (len(flags), len(dis), "、".join(dis[:20]) or "无"))
    # `w` 与维基正名不一致的——正是「字符串比对会漏掉」的那一批，
    # 本脚本靠 pageid 归一躲过去了；数目就是这层盲点的大小
    diffw = [(e["n"], e["w"], cache[e["w"]]["title"]) for e in evs
             if e.get("w") and cache.get(e["w"], {}).get("title")
             and split_host(e["w"])[1] != cache[e["w"]]["title"].replace("en:", "")]
    print("\n══ w 与维基正名不一致 %d 条（字符串比对会漏，pageid 归一已合并）══" % len(diffw))
    for n, w, t in diffw[:25]:
        print("  %-16s w=%-18s → 正名 %s" % (n, w, t))


if __name__ == "__main__":
    main()
