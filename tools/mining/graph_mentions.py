# -*- coding: utf-8 -*-
"""提及图：把库内各层已有的关系合成一张有向图，算核心节点，与现行 r 并排出差异单。

**为什么要这张图。** 现行分量 `r`（tools/mining/rank.py）量的是**库外**的知名度：
维基语言链接数、入链数、年访问量。那三个信号回答的是「外面的人有多认得它」，
答不了「**在本库自己的叙述里，它有多要紧**」。一条事件被库内三十条别的条目
在正文里提到，被两条故事线各设一站，挂着考据卡，却因为维基上冷清而落在三等——
这种落差正是本脚本要照出来的东西。两根尺各有各的用处，不是谁替换谁：
`r` 管抢标签位子的先后（图上写不下那么多名字），本图管「库内叙述的重心在哪」。

**图是怎么搭的。** 节点五类、边两大类：

  节点  事件 ev / 政权 dyn / 君主 ruler / 地点 place / 故事线 line
  字段边 src='field'  ——  库里**已经写死**的关系：d 归属、p 地名、rel 互挂、
                          君主属政权、政权承继/汇入/裂出、都城、故事线站
  提及边 src='mention' ——  某条的 yc/yl 正文里出现了另一个节点的名字

提及边是本图的主体，也是唯一一处「新算出来的」关系。它的依据是：这个库的
散文是一条条写出来的，写的时候顺手把相关的人、地、事、政权都点了名——那些
点名本身就是一张没人画过的关系网。

**名字匹配的三条自律**（宁可少连，不可连错）：
  ① 只匹配长度 ≥3 的名字。二字名歧义太大（「大同」既是地名又是年号又是常语）。
  ② 二字**政权**名（成汉、北魏…）另开一档：先量它在全库的出现广度，
     超过阈值的入停用表（那已是时代背景词，不是提及），未超的入主图。
  ③ 一个名字撞上多类节点时按 事件 > 政权 > 君主 > 地点 择一，冲突名单印在报告里。
  自指不算边；同一条对同一目标只记一次。

用法与可调参数见文件末的 CLI 段与报告里的同名两节。

    python tools/mining/graph_mentions.py                 # 全跑，出 JSON 与报告
    python tools/mining/graph_mentions.py --no-md         # 只出 JSON 与终端摘要
    python tools/mining/graph_mentions.py --stop-ratio .07

产出（默认写到 --out 指定的目录，缺省为脚本旁的 scratchpad/graph）：
    graph.json        nodes[] / edges[]（全图）
    metrics.json      逐节点的度、PageRank、库内权重
    report_data.json  报告用的各榜单（供别的工具复用）
报告写到 docs/desk/graph-core-20260902.md（--md 可改），**生成物，勿手改**。
"""
import argparse, glob, io, json, math, os, re, sys
from collections import defaultdict, Counter

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
HERE = os.path.dirname(os.path.abspath(__file__))

# ── 可调参数（报告「可调参数」一节与此处同源） ────────────────────────────────
MIN_NAME_LEN   = 3      # 提及匹配的最短名字长度；二字名走低置信档
STOP_DOC_RATIO = 0.10   # 二字政权名出现在超过这个比例的条目里 → 停用表
DAMPING        = 0.85   # PageRank 阻尼
TOL            = 1e-12  # PageRank 收敛阈
MAX_ITER       = 300
T1_SHARE       = 0.15   # 库内权重一等占比（与 rank.py 的 N1 同口径）
T2_SHARE       = 0.32   # 二等占比
W_COEF = {"indeg": 1.0, "pagerank": 1.0, "stops": 0.5, "rel": 0.5, "yl": 0.25, "src": 0.25}
NORM = "log"            # 'log' = min-max(log1p(x))，'raw' = min-max(x)

ERA_BANDS = [("xsz", "夏商西周", -2069, -770), ("cqzg", "春秋战国", -769, -220),
             ("qh", "秦汉", -220, 220), ("wjnb", "三国两晋南北朝", 220, 589),
             ("st", "隋唐", 581, 907), ("wdsg", "五代十国", 907, 979),
             ("sljx", "宋辽金夏", 960, 1279), ("ymq", "元明清", 1271, 1912)]
KIND_NAME = {"war": "战事", "gov": "制度", "rev": "民变·政变", "out": "外患·外交",
             "cul": "文化", "sci": "科技", "dis": "灾疫", "era": "治世·中兴",
             "her": "遗址·建筑", "art": "文物", "fig": "名人轶事", "liv": "存续期"}


# ── 逐字段解析（events.js / dynasties.js / data-*.js 共用） ───────────────────
BS = chr(92)
_STR = r"\b%s:\s*'((?:[^'" + BS + BS + r"]|" + BS + BS + r".)*)'"
_NUM = r"\b%s:\s*(-?\d+)"
_ARR = r"\b%s:\s*\[([^\]]*)\]"


def _unesc(s):
    """JS 字符串字面量还原：\\' → ' ，\\n → 换行。yc/yl 里两者都常见。"""
    return re.sub(r"\\(.)", lambda m: {"n": "\n", "t": "\t"}.get(m.group(1), m.group(1)), s)


def gs(body, key):
    m = re.search(_STR % key, body)
    return _unesc(m.group(1)) if m else None


def gn(body, key):
    m = re.search(_NUM % key, body)
    return int(m.group(1)) if m else None


def ga(body, key):
    m = re.search(_ARR % key, body)
    if not m:
        return []
    return [_unesc(x) for x in re.findall(r"'((?:[^'" + BS + BS + r"]|" + BS + BS + r".)*)'", m.group(1))]


def read(path):
    return io.open(path, encoding="utf-8").read()


def strip_line_comments(txt):
    """按行去掉 // 注释。只用在三张关系表那种「值都是裸 key」的段落上，
    那里没有含 // 的字符串；对 events/dynasties 的散文字段一律不用。"""
    out = []
    for ln in txt.splitlines():
        i = ln.find("//")
        out.append(ln[:i] if i >= 0 else ln)
    return "\n".join(out)


def section(txt, head, end="};"):
    i = txt.index(head)
    j = txt.index(end, i)
    return txt[i:j]


# ── 一、读事件 ───────────────────────────────────────────────────────────────
def load_events():
    """events.js 一条一行（lint-events.py 逐行体检的同一前提）。"""
    src = read(os.path.join(ROOT, "js/events.js"))
    body = src[src.index("export const EVENTS = ["):]
    evs = []
    for ln in body.splitlines():
        t = ln.strip()
        if not t.startswith("{ y:"):
            continue
        e = {"y": gn(t, "y"), "y2": gn(t, "y2"), "k": gs(t, "k"), "n": gs(t, "n"),
             "ya": gs(t, "ya"), "b": gs(t, "b"), "w": gs(t, "w"), "wt": gs(t, "wt"),
             "d": gs(t, "d"), "r": gn(t, "r"), "cf": gn(t, "cf"),
             "p": ga(t, "p"), "rel": ga(t, "rel"),
             "yc": gs(t, "yc") or "", "yl": gs(t, "yl") or ""}
        if e["n"] and e["k"]:
            evs.append(e)
    return evs


# ── 二、读政权 ───────────────────────────────────────────────────────────────
def load_dynasties():
    """D(key, name, s, e, u, era, {cap, bio, note…}) 跨多行，按 `\\n  D(` 切块。"""
    src = read(os.path.join(ROOT, "js/dynasties.js"))
    blk = src[src.index("export const DYNASTIES = ["):]
    blk = blk[:blk.index("\nexport const SUCCESSION")]
    dyns = []
    for chunk in re.split(r"\n  D\(", blk)[1:]:
        m = re.match(r"'(\w+)'\s*,\s*'([^']+)'\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(\d+)\s*,\s*'(\w+)'", chunk)
        if not m:
            continue
        key, name, s, e, u, era = m.groups()
        dyns.append({"key": key, "name": name, "s": int(s), "e": int(e),
                     "u": int(u), "era": era, "cap": ga(chunk, "cap"),
                     "bio": gs(chunk, "bio") or "", "note": gs(chunk, "note") or ""})

    def table(head):
        t = strip_line_comments(section(src, "export const %s = {" % head))
        return dict(re.findall(r"(\w+):\s*'(\w+)'", t))

    succ, merged, sprang = table("SUCCESSION"), table("MERGED_INTO"), table("SPRANG_FROM")
    trans = {}
    for m in re.finditer(r"'(\w+)>(\w+)':\s*\{([^}]*)\}", section(src, "export const TRANSITIONS = {")):
        a, b, body = m.groups()
        trans[(a, b)] = {"n": gs(body, "n"), "w": gs(body, "w")}
    return dyns, succ, merged, sprang, trans


# ── 三、读君主 ───────────────────────────────────────────────────────────────
def load_rulers():
    rows = []
    for path in sorted(glob.glob(os.path.join(ROOT, "js/data-[0-9]*.js"))):
        if os.path.basename(path) in ("data-nianhao.js", "data-pinyin.js"):
            continue
        src = read(path)
        for chunk in re.split(r"\n  \{ ?n ?:", src)[1:]:
            chunk = "n:" + chunk
            n, t, d = gs(chunk, "n"), gs(chunk, "t"), gs(chunk, "d")
            if not (n and d):
                continue
            rows.append({"n": n, "t": t or n, "d": d, "no": gs(chunk, "no") or "",
                         "src": os.path.basename(path)})
    return rows


# ── 四、故事线站与考据卡 ─────────────────────────────────────────────────────
def load_line_stops():
    src = read(os.path.join(ROOT, "js/line-stops.js"))
    body = src[src.index("{"):src.rindex("}") + 1]
    return json.loads(body)


def load_ranks():
    """rank.py 的产物：为差异单补一列**它自己的分数**。

    只有把 score 摆在旁边，「借光的」那张表才分得清两种病：分数高而库内静默＝
    真借光（信号量的是维基那个热条目）；分数低却仍在一等＝被类别保底或时代保底
    捞进来的。ranks.json 可能比 events.js 旧几笔（新入库的条目还没跑过 rank），
    也可能因为某条的 y 事后校正过而对不上——杯酒释兵权就是（ranks 存 960，
    库内已改 961）。故先按 (y, n) 精确对，对不上再退到**名字在 ranks 里唯一**
    的那一档；同名多条的不退，留空不猜。"""
    p = os.path.join(HERE, "ranks.json")
    if not os.path.exists(p):
        return {}, {}
    rows = json.loads(read(p))
    exact = {(r["y"], r["n"]): r.get("score") for r in rows}
    seen = defaultdict(list)
    for r in rows:
        seen[r["n"]].append(r.get("score"))
    return exact, {n: v[0] for n, v in seen.items() if len(v) == 1}


def load_kaozheng():
    """docs/sources-*.json：站名 → 该站是否真有考据/出处/引文。空壳站不算有卡。"""
    got = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "docs/sources-*.json"))):
        try:
            d = json.loads(read(path))
        except Exception:
            continue
        stops = d.get("站") or {}
        if not isinstance(stops, dict):
            continue
        for name, v in stops.items():
            if not isinstance(v, dict):
                continue
            n = sum(len(v.get(k) or []) for k in ("考据", "出处", "引文") if isinstance(v.get(k), list))
            if n:
                got[name] = got.get(name, 0) + n
    return got


# ── 五、搭图 ─────────────────────────────────────────────────────────────────
def nid(kind, key):
    return "%s:%s" % (kind, key)


PLACE_RE = re.compile(r"^(.*?):(.)([*~]*)$")


def split_place(item):
    """'菏泽市:战*~' → ('菏泽市', '战')。角色后的 * ~ 是画法旗标，不进边类型。"""
    m = PLACE_RE.match(item)
    if not m:
        return item.strip(), "?"
    return m.group(1).strip(), m.group(2)


class Graph(object):
    def __init__(self):
        self.nodes = {}
        self.edges = []
        self._seen = set()

    def node(self, kind, key, label, **kw):
        i = nid(kind, key)
        if i not in self.nodes:
            self.nodes[i] = {"id": i, "type": kind, "label": label}
            self.nodes[i].update(kw)
        else:
            for k, v in kw.items():
                if self.nodes[i].get(k) is None:
                    self.nodes[i][k] = v
        return i

    def edge(self, s, t, etype, src, label=None):
        if s == t or s not in self.nodes or t not in self.nodes:
            return False
        k = (s, t, etype, src)
        if k in self._seen:
            return False
        self._seen.add(k)
        e = {"s": s, "t": t, "type": etype, "src": src}
        if label:
            e["label"] = label
        self.edges.append(e)
        return True


def build_field_graph(evs, dyns, succ, merged, sprang, trans, rulers, stops, kz):
    g = Graph()
    for d in dyns:
        g.node("dyn", d["key"], d["name"], y=d["s"], k="dyn", r=None,
               y2=d["e"], era=d["era"], u=d["u"])
    for e in evs:
        g.node("ev", e["n"], e["n"], y=e["y"], k=e["k"], r=e["r"],
               ya=e["ya"], w=e["w"], wt=e["wt"], cf=e["cf"],
               has_yl=bool(e["yl"]), ylen=len(e["yl"]))
    for m in rulers:
        g.node("ruler", m["n"], m["t"], y=None, k="ruler", r=None, dyn=m["d"])
    for name, ls in stops.items():
        for s in ls:
            g.node("line", s["key"], s["name"], y=None, k="line", r=None)

    # 事件 → 政权 / 地点 / 事件（rel）/ 故事线
    for e in evs:
        se = nid("ev", e["n"])
        if e["d"]:
            g.edge(se, nid("dyn", e["d"]), "d", "field")
        for item in e["p"]:
            pl, role = split_place(item)
            if pl:
                g.node("place", pl, pl, y=None, k="place", r=None)
                g.edge(se, nid("place", pl), "p:" + role, "field")
        for other in e["rel"]:
            g.edge(se, nid("ev", other), "rel", "field")
        for s in stops.get(e["n"], []) + (stops.get(e["ya"], []) if e["ya"] else []):
            g.edge(se, nid("line", s["key"]), "stop", "field")

    # 君主 → 政权
    for m in rulers:
        g.edge(nid("ruler", m["n"]), nid("dyn", m["d"]), "d", "field")

    # 政权 → 政权（三张表）＋ 都城
    for tbl, et in ((succ, "succ"), (merged, "merge"), (sprang, "sprang")):
        for a, b in tbl.items():
            lab = None
            for (x, y), v in trans.items():
                if {x, y} == {a, b}:
                    lab = v.get("n")
                    break
            g.edge(nid("dyn", a), nid("dyn", b), et, "field", label=lab)
    for d in dyns:
        for item in d["cap"]:
            pl, role = split_place(item)
            if pl:
                g.node("place", pl, pl, y=None, k="place", r=None)
                g.edge(nid("dyn", d["key"]), nid("place", pl), "cap:" + role, "field")
    return g


# ── 六、提及边 ───────────────────────────────────────────────────────────────
PRIORITY = {"ev": 0, "dyn": 1, "ruler": 2, "place": 3, "line": 4}


def build_name_index(g, evs, dyns, rulers):
    """名字 → 节点。同名撞车按 PRIORITY 择一，冲突另记（报告「已知盲点」引用）。"""
    cand = defaultdict(list)          # name -> [(priority, node_id, 来源类型)]

    def put(name, i):
        if not name:
            return
        name = name.strip()
        if len(name) < 2:
            return
        kind = i.split(":", 1)[0]
        cand[name].append((PRIORITY[kind], i, kind))

    for e in evs:
        put(e["n"], nid("ev", e["n"]))
        put(e["ya"], nid("ev", e["n"]))
        put(e["b"], nid("ev", e["n"]))
    for d in dyns:
        put(d["name"], nid("dyn", d["key"]))
    for m in rulers:
        put(m["t"], nid("ruler", m["n"]))
        put(m["n"], nid("ruler", m["n"]))
    for i, nd in g.nodes.items():
        if nd["type"] == "place":
            put(nd["label"], i)

    index, conflicts = {}, []
    for name, lst in cand.items():
        uniq = sorted(set(lst))
        index[name] = uniq[0][1]
        tgt = {x[1] for x in uniq}
        if len(tgt) > 1:
            conflicts.append({"name": name, "taken": uniq[0][1],
                              "dropped": [x[1] for x in uniq[1:]]})
    return index, conflicts


def scan_mentions(evs, index, stop_ratio, log=print):
    """先量二字名的出现广度定停用表，再逐条扫全部名字。

    扫法：对每条正文枚举 [i, i+L) 子串查字典（L 由字典里最长的名字定），
    只在字典首字集合命中的位置起扫。1500 条 × 二百余万字，秒级。"""
    by_first = defaultdict(set)
    maxlen = 0
    for name in index:
        by_first[name[0]].add(len(name))
        maxlen = max(maxlen, len(name))

    def hits(text):
        out = set()
        for i, ch in enumerate(text):
            lens = by_first.get(ch)
            if not lens:
                continue
            for L in lens:
                if i + L > len(text):
                    continue
                sub = text[i:i + L]
                if sub in index:
                    out.add(sub)
        return out

    texts = [(e, (e["yc"] or "") + "\n" + (e["yl"] or "")) for e in evs]
    raw = [(e, hits(t)) for e, t in texts]

    # 二字名的广度统计 → 停用表
    df = Counter()
    for _, names in raw:
        for nm in names:
            if len(nm) == 2:
                df[nm] += 1
    total = len(evs)
    stop, keep2 = [], []
    for nm, c in df.most_common():
        row = {"name": nm, "df": c, "ratio": c / float(total),
               "target": index[nm], "kind": index[nm].split(":", 1)[0]}
        if row["kind"] == "dyn" and row["ratio"] <= stop_ratio:
            keep2.append(row)
        else:
            stop.append(row)
    stopset = {r["name"] for r in stop}
    keepset = {r["name"] for r in keep2}
    log("二字名 %d 个：政权名且广度 ≤%.0f%% 者入主图 %d 个，其余 %d 个入低置信档"
        % (len(df), stop_ratio * 100, len(keep2), len(stop)))

    mentions, low = [], []
    for e, names in raw:
        me = nid("ev", e["n"])
        for nm in names:
            tgt = index[nm]
            if tgt == me:
                continue
            if len(nm) >= MIN_NAME_LEN or nm in keepset:
                mentions.append((me, tgt, nm))
            else:
                low.append((me, tgt, nm))
    return mentions, low, stop, keep2, df


# ── 七、PageRank ─────────────────────────────────────────────────────────────
def pagerank(nodes, edges, damping=DAMPING, tol=TOL, max_iter=MAX_ITER):
    ids = list(nodes)
    idx = {i: k for k, i in enumerate(ids)}
    n = len(ids)
    if not n:
        return {}, 0
    out = [[] for _ in range(n)]
    for e in edges:
        if e["s"] in idx and e["t"] in idx:
            out[idx[e["s"]]].append(idx[e["t"]])
    deg = [len(o) for o in out]
    pr = [1.0 / n] * n
    it = 0
    for it in range(1, max_iter + 1):
        new = [(1.0 - damping) / n] * n
        dangling = sum(pr[i] for i in range(n) if deg[i] == 0)
        share = damping * dangling / n
        for i in range(n):
            if deg[i]:
                c = damping * pr[i] / deg[i]
                for j in out[i]:
                    new[j] += c
        if share:
            new = [v + share for v in new]
        d = sum(abs(new[i] - pr[i]) for i in range(n))
        pr = new
        if d < tol:
            break
    return {ids[i]: pr[i] for i in range(n)}, it


# ── 八、度与库内权重 ─────────────────────────────────────────────────────────
def degrees(nodes, edges):
    m = {i: {"in": 0, "out": 0, "in_by": Counter(), "out_by": Counter(),
             "in_src": Counter(), "mention_in": 0, "srcs": Counter()} for i in nodes}
    for e in edges:
        s, t = e["s"], e["t"]
        if s in m:
            m[s]["out"] += 1
            m[s]["out_by"][e["type"]] += 1
        if t in m:
            m[t]["in"] += 1
            m[t]["in_by"][e["type"]] += 1
            m[t]["in_src"][e["src"]] += 1
            if e["src"] == "mention":
                m[t]["mention_in"] += 1
    return m


def minmax(vals, mode=NORM):
    xs = [math.log1p(max(v, 0)) if mode == "log" else float(v) for v in vals]
    lo, hi = min(xs), max(xs)
    rng = (hi - lo) or 1.0
    return [(x - lo) / rng for x in xs]


def era_of(y):
    if y is None:
        return "未系年"
    if y < -2069:
        return "史前"
    for _, name, s, e in ERA_BANDS:
        if s <= y <= e:
            return name
    return "近代以后" if y > 1912 else "未系年"


# ── 九、主流程 ───────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="库内提及图与核心节点")
    default_out = os.path.join(
        r"C:/Users/ziyi_/AppData/Local/Temp/claude/C--Users-ziyi--Claude-imperial-longevity",
        "48811d4a-955a-4472-b299-02c9390bb59c/scratchpad/graph")
    ap.add_argument("--out", default=default_out, help="图数据输出目录（不入库）")
    ap.add_argument("--md", default=os.path.join(ROOT, "docs/desk/graph-core-20260902.md"))
    ap.add_argument("--no-md", action="store_true")
    ap.add_argument("--stop-ratio", type=float, default=STOP_DOC_RATIO)
    ap.add_argument("--norm", default=NORM, choices=("log", "raw"))
    ap.add_argument("--damping", type=float, default=DAMPING)
    a = ap.parse_args()

    evs = load_events()
    dyns, succ, merged, sprang, trans = load_dynasties()
    rulers = load_rulers()
    stops = load_line_stops()
    kz = load_kaozheng()
    scores, scores_by_name = load_ranks()
    print("事件 %d、政权 %d、君主 %d、故事线站名 %d、考据卡站 %d"
          % (len(evs), len(dyns), len(rulers), len(stops), len(kz)))

    g = build_field_graph(evs, dyns, succ, merged, sprang, trans, rulers, stops, kz)
    n_field = len(g.edges)
    index, conflicts = build_name_index(g, evs, dyns, rulers)
    print("名字表 %d 条，同名撞车 %d 处" % (len(index), len(conflicts)))

    mentions, low, stoprows, keep2, df2 = scan_mentions(evs, index, a.stop_ratio)
    for s, t, nm in mentions:
        g.edge(s, t, "mention", "mention", label=nm)
    n_mention = len(g.edges) - n_field
    low_pairs = {(s, t) for s, t, _ in low}
    low_in = Counter(t for _, t in low_pairs)   # 二字名被提及数：只统计，不入图
    print("字段边 %d，提及边 %d，低置信提及 %d 对（不入图）"
          % (n_field, n_mention, len(low_pairs)))

    # PageRank：全图（含字段边）与只用提及边两算
    pr_all, it1 = pagerank(g.nodes, g.edges, a.damping)
    men_edges = [e for e in g.edges if e["src"] == "mention"]
    pr_men, it2 = pagerank(g.nodes, men_edges, a.damping)
    print("PageRank 收敛：全图 %d 轮，提及图 %d 轮" % (it1, it2))

    deg = degrees(g.nodes, g.edges)
    ev_nodes = [i for i, nd in g.nodes.items() if nd["type"] == "ev"]
    by_name = {e["n"]: e for e in evs}

    # 事件的四项库内证据
    ev_stat = {}
    for i in ev_nodes:
        e = by_name[g.nodes[i]["label"]]
        nstop = len(stops.get(e["n"], [])) + (len(stops.get(e["ya"], [])) if e["ya"] else 0)
        has_kz = (e["n"] in kz) or (bool(e["ya"]) and e["ya"] in kz)
        # 名字短于门槛的条目**根本没参加提及匹配**（殷墟、长城、汉书…）：
        # 它们的 mention_in=0 是量不到，不是没人提。低置信档的入度另存一列，
        # 差异单要靠这一列把「真的没人提」与「名字太短」分开。
        nm = e["ya"] or e["n"]
        ev_stat[i] = {"mention_in": deg[i]["mention_in"], "pr": pr_all[i],
                      "stops": nstop, "rel": deg[i]["out_by"].get("rel", 0) + deg[i]["in_by"].get("rel", 0),
                      "yl": 1 if e["yl"] else 0, "kz": 1 if has_kz else 0,
                      "ylen": len(e["yl"]), "r": e["r"], "k": e["k"], "y": e["y"],
                      "wt": e["wt"], "w": e["w"], "low_in": low_in.get(i, 0),
                      "score": scores.get((e["y"], e["n"]), scores_by_name.get(e["n"])),
                      "short": 1 if min(len(e["n"]), len(nm)) < MIN_NAME_LEN else 0}
    zin = dict(zip(ev_nodes, minmax([ev_stat[i]["mention_in"] for i in ev_nodes], a.norm)))
    zpr = dict(zip(ev_nodes, minmax([ev_stat[i]["pr"] for i in ev_nodes], a.norm)))
    for i in ev_nodes:
        s = ev_stat[i]
        s["w_graph"] = W_COEF["indeg"] * zin[i] + W_COEF["pagerank"] * zpr[i]
        s["w_curate"] = (W_COEF["stops"] * s["stops"] + W_COEF["rel"] * s["rel"]
                         + W_COEF["yl"] * s["yl"] + W_COEF["src"] * s["kz"])
        s["w_lib"] = s["w_graph"] + s["w_curate"]
        # 是被「别的条目在正文里点名」推上来的，还是被「策展人设站挂卡」推上来的
        s["driver"] = ("图" if s["w_graph"] > s["w_curate"] * 1.5 else
                       "策展" if s["w_curate"] > s["w_graph"] * 1.5 else "兼")

    # 三档：与 rank.py 同口径——era 不参与（它画成皇帝格子的外套，不在事件轨上）
    rankable = [i for i in ev_nodes if ev_stat[i]["k"] != "era"]
    order = sorted(rankable, key=lambda i: -ev_stat[i]["w_lib"])
    N1 = max(20, round(len(rankable) * T1_SHARE))
    N2 = max(40, round(len(rankable) * T2_SHARE))
    for rk, i in enumerate(order):
        ev_stat[i]["t_lib"] = 1 if rk < N1 else 2 if rk < N1 + N2 else 3
        ev_stat[i]["rank_lib"] = rk + 1
    for i in ev_nodes:
        ev_stat[i].setdefault("t_lib", 3)
        ev_stat[i].setdefault("rank_lib", None)
    print("库内权重三档：一等 %d、二等 %d、三等 %d（era %d 条不参与，同 rank.py）"
          % (N1, N2, len(rankable) - N1 - N2, len(ev_nodes) - len(rankable)))

    # ── 落盘 ────────────────────────────────────────────────────────────────
    os.makedirs(a.out, exist_ok=True)
    nodes_out = []
    for i, nd in g.nodes.items():
        row = {"id": i, "type": nd["type"], "label": nd["label"],
               "y": nd.get("y"), "k": nd.get("k"), "r": nd.get("r")}
        # w/wt 是**外部页**（维基锚及其挂法），照任务口径只记在节点上、不成边
        if nd["type"] == "ev":
            row["w"], row["wt"] = nd.get("w"), nd.get("wt")
        nodes_out.append(row)
    json.dump({"nodes": nodes_out, "edges": g.edges},
              io.open(os.path.join(a.out, "graph.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=0)
    met = {}
    for i, nd in g.nodes.items():
        met[i] = {"type": nd["type"], "label": nd["label"],
                  "in": deg[i]["in"], "out": deg[i]["out"],
                  "in_by": dict(deg[i]["in_by"]), "out_by": dict(deg[i]["out_by"]),
                  "mention_in": deg[i]["mention_in"],
                  "pr": pr_all[i], "pr_mention": pr_men[i]}
        if i in ev_stat:
            met[i].update({k: v for k, v in ev_stat[i].items()
                           if k in ("stops", "rel", "yl", "kz", "ylen", "r", "w_lib", "t_lib",
                                    "rank_lib", "w_graph", "w_curate", "driver", "low_in",
                                    "score", "short")})
    json.dump(met, io.open(os.path.join(a.out, "metrics.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=0)

    hit = sum(1 for i in ev_nodes if ev_stat[i]["score"] is not None)
    print("rank.py 分数对上 %d/%d 条（ranks.json 比 events.js 旧的那几笔对不上，留空）"
          % (hit, len(ev_nodes)))
    diag = {"ruler_rows": len(rulers), "ruler_nodes": sum(
        1 for nd in g.nodes.values() if nd["type"] == "ruler"),
        "score_hit": hit, "n_ev": len(ev_nodes)}
    deg_men = degrees(g.nodes, men_edges)
    rd = report_data(g, deg, pr_all, pr_men, ev_stat, evs, stoprows, keep2, conflicts,
                     low_pairs, n_field, n_mention, a, N1, N2, len(rankable), it1, it2,
                     kz, stops, diag, deg_men)
    json.dump(rd, io.open(os.path.join(a.out, "report_data.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=0)
    print("→ %s（graph.json / metrics.json / report_data.json）" % a.out)

    if not a.no_md:
        io.open(a.md, "w", encoding="utf-8").write(render_md(rd))
        print("→ %s" % a.md)


# ── 十、报告数据 ─────────────────────────────────────────────────────────────
def why_core(i, g, deg, edges_in, ev_stat):
    """一句「为何核心」：入边最多来自哪些条 + 边类型构成。"""
    srcs = edges_in.get(i, [])
    if not srcs:
        return "无入边（只出不入）"
    lab = Counter()
    for e in srcs:
        lab[g.nodes[e["s"]]["label"]] += 1
    types = deg[i]["in_by"]
    # 分隔用「／」不用「、」：事件名自己就带顿号（罢黜百家、独尊儒术），
    # 拿顿号连列表会把一条读成两条
    top = "／".join(n for n, _ in lab.most_common(3))
    tdesc = "／".join("%s×%d" % (t, c) for t, c in types.most_common(3))
    return "入边 %d（%s）；来源如 %s" % (deg[i]["in"], tdesc, top)


def report_data(g, deg, pr_all, pr_men, ev_stat, evs, stoprows, keep2, conflicts,
                low_pairs, n_field, n_mention, a, N1, N2, n_rankable, it1, it2,
                kz, stops, diag, deg_men):
    edges_in = defaultdict(list)
    for e in g.edges:
        edges_in[e["t"]].append(e)

    def row(i, extra=None):
        nd = g.nodes[i]
        d = {"id": i, "type": nd["type"], "label": nd["label"], "y": nd.get("y"),
             "k": nd.get("k"), "r": nd.get("r"), "pr": pr_all[i], "pr_men": pr_men[i],
             "in": deg[i]["in"], "out": deg[i]["out"], "mention_in": deg[i]["mention_in"],
             "men_out": deg_men[i]["out"],
             "why": why_core(i, g, deg, edges_in, ev_stat)}
        if i in ev_stat:
            d.update({k: ev_stat[i][k] for k in ("stops", "rel", "yl", "kz", "w_lib", "t_lib",
                                                 "rank_lib", "driver", "low_in", "score",
                                                 "short", "ylen", "wt", "w")})
        if extra:
            d.update(extra)
        return d

    ids = list(g.nodes)
    top_all = [row(i) for i in sorted(ids, key=lambda i: -pr_all[i])[:40]]
    per_type = {}
    for kind in ("ev", "dyn", "ruler", "place", "line"):
        sub = [i for i in ids if g.nodes[i]["type"] == kind]
        per_type[kind] = [row(i) for i in sorted(sub, key=lambda i: -pr_all[i])[:20]]
    top_men = [row(i) for i in sorted(ids, key=lambda i: -pr_men[i])[:20]]

    ev_ids = [i for i in ev_stat if ev_stat[i]["k"] != "era"]
    buried_pool = [i for i in ev_ids if ev_stat[i]["r"] == 3 and ev_stat[i]["t_lib"] == 1]
    buried = [row(i) for i in sorted(buried_pool, key=lambda i: -ev_stat[i]["w_lib"])[:40]]
    half = int(len(ev_ids) * 0.5)
    borrowed_pool = [i for i in ev_ids
                     if ev_stat[i]["r"] == 1 and ev_stat[i]["rank_lib"] and ev_stat[i]["rank_lib"] > half]
    # 末 50% 里大片条目的 w 同为 0（谁也没提、没设站、没挂卡），单按 w 升序排等于
    # 按年份列。次序键取 rank.py 自己的分数**降序**：同样库内静默，维基上越热的
    # 落差越大，那才是这张表要照的东西。
    borrowed = [row(i) for i in sorted(
        borrowed_pool,
        key=lambda i: (ev_stat[i]["w_lib"], -(ev_stat[i]["score"] or -9)))[:40]]

    def compose(sel):
        kc, ec = Counter(), Counter()
        for i in sel:
            kc[ev_stat[i]["k"]] += 1
            ec[era_of(ev_stat[i]["y"])] += 1
        return {"kind": kc.most_common(), "era": ec.most_common(), "n": len(sel)}

    t1_r = [i for i in ev_ids if ev_stat[i]["r"] == 1]
    t1_lib = [i for i in ev_ids if ev_stat[i]["t_lib"] == 1]
    both = set(t1_r) & set(t1_lib)
    driver = Counter(ev_stat[i]["driver"] for i in t1_lib)

    cnt_type = Counter(nd["type"] for nd in g.nodes.values())
    cnt_etype = Counter(e["type"] for e in g.edges)
    cnt_src = Counter(e["src"] for e in g.edges)
    return {
        "meta": {"stop_ratio": a.stop_ratio, "norm": a.norm, "damping": a.damping,
                 "min_name_len": MIN_NAME_LEN, "coef": W_COEF,
                 "t1_share": T1_SHARE, "t2_share": T2_SHARE,
                 "iters": [it1, it2], "N1": N1, "N2": N2, "n_rankable": n_rankable,
                 "n_events": len(evs), "n_kz": len(kz), "n_stopnames": len(stops),
                 "diag": diag},
        "counts": {"node_type": cnt_type.most_common(), "edge_type": cnt_etype.most_common(),
                   "edge_src": cnt_src.most_common(), "n_field": n_field,
                   "n_mention": n_mention, "n_low": len(low_pairs),
                   "n_nodes": len(g.nodes), "n_edges": len(g.edges),
                   "n_dyn_edges": sum(1 for e in g.edges if e["type"] in ("succ", "merge", "sprang")),
                   "n_labeled_dyn": sum(1 for e in g.edges
                                        if e["type"] in ("succ", "merge", "sprang") and e.get("label"))},
        "stopwords": stoprows, "keep2": keep2, "conflicts": conflicts[:60],
        "n_conflicts": len(conflicts),
        "top_all": top_all, "per_type": per_type, "top_mention_only": top_men,
        "buried": buried, "borrowed": borrowed,
        "n_buried": len(buried_pool), "n_borrowed": len(borrowed_pool),
        "n_short": sum(1 for i in ev_ids if ev_stat[i]["short"]),
        "short_top": sorted(
            [{"label": g.nodes[i]["label"], "low_in": ev_stat[i]["low_in"], "r": ev_stat[i]["r"]}
             for i in ev_ids if ev_stat[i]["short"] and ev_stat[i]["low_in"]],
            key=lambda x: -x["low_in"])[:15],
        "compose": {"r1": compose(t1_r), "lib1": compose(t1_lib),
                    "overlap": len(both), "n_r1": len(t1_r), "n_lib1": len(t1_lib),
                    "driver": driver.most_common()},
    }


# ── 十一、报告 ───────────────────────────────────────────────────────────────
def fy(y):
    if y is None:
        return "—"
    return "前%d" % (-y + 1) if y < 0 else str(y)


def render_md(rd):
    m, c = rd["meta"], rd["counts"]
    L = []
    A = L.append
    A("# 库内提及图与核心节点（2026-09-02）")
    A("")
    A("**本文件由 `tools/mining/graph_mentions.py` 生成，勿手改**；改判据去改脚本再重跑。")
    A("回答的问题只有一个：**在本库自己的叙述里，哪些条目是重心**——与 `rank.py` 那根"
      "「外面的人有多认得它」的尺子并排放，看两根尺在哪儿分岔。两根尺都不作废：`r` 管"
      "抢标签位子的先后，本图管库内叙述的引力。本文不改 `r`，不动任何库文件。")
    A("")
    A("## 一、总账")
    A("")
    A("| 项 | 数 |")
    A("|---|---|")
    A("| 节点 | %d |" % c["n_nodes"])
    for k, v in c["node_type"]:
        A("| ├ %s | %d |" % ({"ev": "事件", "dyn": "政权", "ruler": "君主",
                              "place": "地点", "line": "故事线"}.get(k, k), v))
    A("| 边 | %d |" % c["n_edges"])
    A("| ├ 字段边 field | %d |" % c["n_field"])
    A("| ├ 提及边 mention | %d |" % c["n_mention"])
    A("| 低置信提及（只统计，不入图） | %d 对 |" % c["n_low"])
    A("")
    A("事件的 `w`／`wt`（维基锚及其挂法）是**外部页**，只记在节点上、不成边；"
      "政权之间的三种关系边另挂 `TRANSITIONS` 的事件名作标签（%d/%d 条挂上，"
      "其余是库里本就留空的那些——「不必强凑」是那张表自己的规矩）。"
      % (c["n_labeled_dyn"], c["n_dyn_edges"]))
    A("")
    A("边按类型：")
    A("")
    A("| 类型 | 数 | 说明 |")
    A("|---|---|---|")
    ETYPE_DESC = {"mention": "yc/yl 正文里点了另一个节点的名字", "d": "事件/君主 → 所属政权",
                  "stop": "事件 → 故事线（该线为它设了一站）", "rel": "事件 ↔ 事件（rel 字段互挂）",
                  "succ": "政权承继（SUCCESSION），边标签取 TRANSITIONS 的那一场",
                  "merge": "政权汇入（MERGED_INTO），同上带标签",
                  "sprang": "政权裂出（SPRANG_FROM），同上带标签"}
    for k, v in c["edge_type"]:
        d = ETYPE_DESC.get(k, "")
        if k.startswith("p:"):
            d = "事件 → 地点，角色「%s」" % k[2:]
        elif k.startswith("cap:"):
            d = "政权 → 都城，角色「%s」" % k[4:]
        A("| `%s` | %d | %s |" % (k, v, d))
    A("")
    A("### 二字名怎么处理的")
    A("")
    A("二字名一律不进主图，**唯一的例外是二字政权名**（成汉、北魏这一类）——"
      "它们在库内散文里多半是真提及，不是巧合撞字。例外也有闸：一个二字政权名若出现在"
      "超过 **%.0f%%** 的条目里，那已经是时代背景词而不是提及，入停用表。" % (m["stop_ratio"] * 100))
    A("")
    dyn_stop = [r for r in rd["stopwords"] if r["kind"] == "dyn"]
    other = [r for r in rd["stopwords"] if r["kind"] != "dyn"]
    A("**停用表**（二字政权名超阈者，%d 个）：" % len(dyn_stop))
    A("")
    if dyn_stop:
        A("| 名字 | 命中条目数 | 广度 |")
        A("|---|---:|---:|")
        for r in dyn_stop:
            A("| %s | %d | %.1f%% |" % (r["name"], r["df"], r["ratio"] * 100))
    else:
        A("> **本轮空表**。广度最高的二字政权名是%s，尚未触到 %.0f%% 的闸。"
          "换句话说这条闸眼下没拦下任何东西——它是给日后阈值调低或库内散文改风格时留的。"
          % ("、".join("%s %.1f%%" % (r["name"], r["ratio"] * 100) for r in rd["keep2"][:3]),
             m["stop_ratio"] * 100))
    A("")
    A("**二字政权名获准入主图**（%d 个，按广度）：%s"
      % (len(rd["keep2"]), "、".join("%s(%.1f%%)" % (r["name"], r["ratio"] * 100)
                                    for r in rd["keep2"])))
    A("")
    A("**二字非政权名一律不入主图**（%d 个）——它们的命中数只进低置信档。"
      "广度最高的前 25 个如下，正好是一张「若把门槛降到二字会发生什么」的清单：" % len(other))
    A("")
    A("| 名字 | 命中条目数 | 广度 | 它会被连到 |")
    A("|---|---:|---:|---|")
    for r in other[:25]:
        A("| %s | %d | %.1f%% | `%s` |" % (r["name"], r["df"], r["ratio"] * 100, r["target"]))
    A("")
    A("> 这张表自己说明了门槛为什么要设在三字：`子之` 命中 22 条，多数是文言里的"
      "「…子之…」而不是燕王哙让位的那位；`金陵` 会被连到事件「房山金陵」（它的 `ya` 正是"
      "「金陵」），而库内散文里的金陵十有八九指南京。**代价也是真的**：`殷墟`、`长城`、"
      "`汉书`、`明史`、`尚书`、`左传` 这些真被反复引用的二字条目一并落进低置信档，"
      "它们在主图上的被提及数是 0——那是量不到，不是没人提。全库二字名的事件共 %d 条，"
      "差异单里已逐条标出（列「短名」）。" % rd["n_short"])
    if rd["short_top"]:
        A("")
        A("低置信档里被提及最多的二字事件名：%s。"
          % "、".join("%s(%d)" % (x["label"], x["low_in"]) for x in rd["short_top"][:10]))
    A("")
    A("## 二、核心节点榜")
    A("")
    A("PageRank 阻尼 %.2f，在「提及＋rel＋字段边」全图上迭代到收敛（%d 轮）；"
      "另算一遍只用提及边的对照（%d 轮）。" % (m["damping"], m["iters"][0], m["iters"][1]))
    A("")
    A("**读这张榜以前先知道一件事**：地点节点**出度恒为 0**（地名不指向任何东西），"
      "政权节点出度也只有二三条（承继/汇入/都城）。PageRank 里这叫吸收态——"
      "水流进去就不再流出，分数天然向它们堆积。所以全图前 40 被地名与政权包办不是发现，"
      "是图的形状使然；**真正要看的是同类之间的名次**，以及下面「只用提及边」的对照榜。")
    A("")
    A("### 全图前 40")
    A("")
    A("| # | 类 | 名 | 年 | PR | 只提及PR | 入 | 出 | 为何核心 |")
    A("|---:|---|---|---|---:|---:|---:|---:|---|")
    TN = {"ev": "事件", "dyn": "政权", "ruler": "君主", "place": "地点", "line": "线"}
    for i, r in enumerate(rd["top_all"], 1):
        A("| %d | %s | %s | %s | %.5f | %.5f | %d | %d | %s |"
          % (i, TN[r["type"]], r["label"], fy(r["y"]), r["pr"], r["pr_men"],
             r["in"], r["out"], r["why"]))
    A("")
    for kind, title in (("ev", "事件"), ("dyn", "政权"), ("ruler", "君主"),
                        ("place", "地点"), ("line", "故事线")):
        rows = rd["per_type"][kind]
        if not rows:
            continue
        A("### %s 前 %d" % (title, min(20, len(rows))))
        A("")
        if kind == "ev":
            A("| # | 名 | 年 | 类 | r | 库内档 | PR | 被提及 | 站 | 卡 | yl字数 | 为何核心 |")
            A("|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|")
            for i, r in enumerate(rows, 1):
                A("| %d | %s | %s | %s | %s | %s | %.5f | %d | %d | %s | %d | %s |"
                  % (i, r["label"], fy(r["y"]), KIND_NAME.get(r["k"], r["k"]),
                     r["r"], r.get("t_lib", "—"), r["pr"], r["mention_in"],
                     r.get("stops", 0), "有" if r.get("kz") else "", r.get("ylen", 0), r["why"]))
        else:
            A("| # | 名 | PR | 入 | 出 | 被提及 | 为何核心 |")
            A("|---:|---|---:|---:|---:|---:|---|")
            for i, r in enumerate(rows, 1):
                A("| %d | %s | %.5f | %d | %d | %d | %s |"
                  % (i, r["label"], r["pr"], r["in"], r["out"], r["mention_in"], r["why"]))
        A("")
    A("### 只用提及边的对照（前 20）")
    A("")
    A("字段边一撤，政权与地点失去 `d`／`p` 那一大批机械入边，榜单换成「谁在散文里被反复点名」。")
    A("")
    A("| # | 类 | 名 | 只提及PR | 全图PR | 被提及 | 提及出度 |")
    A("|---:|---|---|---:|---:|---:|---:|")
    for i, r in enumerate(rd["top_mention_only"], 1):
        A("| %d | %s | %s | %.5f | %.5f | %d | %d |"
          % (i, TN[r["type"]], r["label"], r["pr_men"], r["pr"],
             r["mention_in"], r["men_out"]))
    A("")
    A("> **这张榜要打个折扣**：提及图极稀（%d 条边铺在 %d 个节点上），"
      "两条互相点名、又几乎不点别人的条目会把流进来的分数困在彼此之间反复放大"
      "——PageRank 里叫 rank sink。看「被提及」与「提及出度」两列就能认出来："
      "入度不高而 PR 极高、出度又只有一两条的，多半是这么来的。"
      "**被提及数是更朴素也更可信的那个量**，PR 只在它旁边作参照。"
      % (c["n_mention"], c["n_nodes"]))
    A("")
    A("## 三、差异单")
    A("")
    A("库内权重 w 的草案公式（**可调，见第五节**）：")
    A("")
    A("```")
    A("w = %.2f·标准化(被提及入度) + %.2f·标准化(PageRank)" % (m["coef"]["indeg"], m["coef"]["pagerank"]))
    A("  + %.2f·故事线站数 + %.2f·rel 数 + %.2f·(有 yl) + %.2f·(有考据卡)"
      % (m["coef"]["stops"], m["coef"]["rel"], m["coef"]["yl"], m["coef"]["src"]))
    A("标准化 = min-max(%s)；三档 前 %.0f%% / 次 %.0f%% / 其余，与 rank.py 的 N1/N2 同口径"
      % ("log1p(x)" if m["norm"] == "log" else "x", m["t1_share"] * 100, m["t2_share"] * 100))
    A("era 类不参与分档（同 rank.py：它画成皇帝格子的外套，不在事件轨上）")
    A("```")
    A("")
    A("### 「被埋的」：现行 r=3，库内权重进前 15%%（共 %d 条，列前 40）" % rd["n_buried"])
    A("")
    A("「驱动」一列说这一条是被什么推上来的：**图**＝别的条目在正文里点它的名；"
      "**策展**＝故事线设站、挂了考据卡；**兼**＝两者都有。策展项是绝对分"
      "（一站 0.5），所以「策展」驱动的条目多半是被两三条线反复用到的那些——"
      "那是策展人亲手下过的判断，只是这判断从没回流到 `r`。")
    A("")
    A("| # | 名 | 年 | 类 | 库内名次 | w | 驱动 | 被提及 | 站 | rel | 卡 | rank分 | 为何核心 |")
    A("|---:|---|---|---|---:|---:|---|---:|---:|---:|---:|---:|---|")
    for i, r in enumerate(rd["buried"], 1):
        A("| %d | %s | %s | %s | %d | %.3f | %s | %d | %d | %d | %s | %s | %s |"
          % (i, r["label"], fy(r["y"]), KIND_NAME.get(r["k"], r["k"]), r["rank_lib"],
             r["w_lib"], r["driver"], r["mention_in"], r["stops"], r["rel"],
             "有" if r["kz"] else "", "%.2f" % r["score"] if r.get("score") is not None else "—",
             r["why"]))
    A("")
    A("### 「借光的」：现行 r=1，库内权重落末 50%%（共 %d 条，列前 40）" % rd["n_borrowed"])
    A("")
    A("`wt` 是维基锚的挂法：`person` 挂人、`parent` 挂上位条目、`related` 挂相关条目。"
      "三者都不是这件事自己的条目——**分数量的是那个条目有多热，不是这件事有多重**"
      "（`rank.py` 自己在 fig 类上已认过这个病并给 fig 单设了封顶，此处是同病的跨类扫描）。")
    A("")
    A("两列要一起读。`rank分` 是 `rank.py` 自己的合成分：**分高而库内静默＝真借光**"
      "（维基那边热，本库自己的散文里没人提、没设站、没挂卡）；**分低却仍在一等＝"
      "被类别保底或时代保底捞进来的**，那不是借光，是 `rank.py` 有意为之的补位，"
      "看这张表时不该算它的账。`短名` 打钩的条目名字不足 %d 字，压根没参加提及匹配——"
      "它的「被提及 0」是量不到，`低置信` 那一列才是它真实的被点名数。" % m["min_name_len"])
    A("")
    A("| # | 名 | 年 | 类 | 库内名次 | w | 被提及 | 低置信 | 短名 | 站 | 卡 | rank分 | 维基锚 | wt |")
    A("|---:|---|---|---|---:|---:|---:|---:|:-:|---:|---:|---:|---|---|")
    for i, r in enumerate(rd["borrowed"], 1):
        A("| %d | %s | %s | %s | %d | %.3f | %d | %d | %s | %d | %s | %s | %s | %s |"
          % (i, r["label"], fy(r["y"]), KIND_NAME.get(r["k"], r["k"]), r["rank_lib"],
             r["w_lib"], r["mention_in"], r.get("low_in", 0), "✓" if r.get("short") else "",
             r["stops"], "有" if r["kz"] else "",
             "%.2f" % r["score"] if r.get("score") is not None else "—",
             r.get("w") or "—", r.get("wt") or "自条目"))
    A("")
    nb = rd["borrowed"]
    if nb:
        bw = sum(1 for r in nb if r.get("wt"))
        bs = sum(1 for r in nb if r.get("short"))
        A("这 40 条里 **%d 条的维基锚不是自己的条目**（`wt` 非空），"
          "**%d 条名字不足 %d 字**因而未参加提及匹配。两者都占不小的比例——"
          "换句话说这张表照出的至少有三种东西混在一起：真借光、量不到、以及保底补位。"
          % (bw, bs, m["min_name_len"]))
    A("")
    A("## 四、类别与时段体检")
    A("")
    cp = rd["compose"]
    A("一等在两根尺下的名单：`r=1` 共 %d 条，库内权重一等共 %d 条，**两边都在的只有 %d 条**"
      "（重合率 %.0f%%）。两根尺量的显然不是同一件事——这个数本身就是本报告最要紧的一行。"
      % (cp["n_r1"], cp["n_lib1"], cp["overlap"], 100.0 * cp["overlap"] / max(cp["n_r1"], 1)))
    A("")
    A("库内一等是被什么推上来的：%s。**这个分布是公式的直接后果**，不是史实的发现——"
      "一条被三条故事线设站，光这一项就是 1.5 分，而标准化后的提及入度满打满算才 1 分。"
      "要看纯粹的「被点名」排序，请改用 `--norm raw` 或把 `W_COEF` 的 `stops` 调到 0.2 再跑一遍。"
      % "、".join("%s %d 条" % (k, v) for k, v in cp["driver"]))
    A("")
    A("### 类别构成")
    A("")
    A("| 类 | r=1 | 库内一等 | 差 |")
    A("|---|---:|---:|---:|")
    k1 = dict(cp["r1"]["kind"]); k2 = dict(cp["lib1"]["kind"])
    for k in sorted(set(k1) | set(k2), key=lambda k: -(k2.get(k, 0) + k1.get(k, 0))):
        d = k2.get(k, 0) - k1.get(k, 0)
        A("| %s | %d | %d | %+d |" % (KIND_NAME.get(k, k), k1.get(k, 0), k2.get(k, 0), d))
    A("")
    dk = sorted(((k2.get(k, 0) - k1.get(k, 0), k) for k in set(k1) | set(k2)))
    up = [KIND_NAME.get(k, k) for d, k in reversed(dk[-3:]) if d > 0]
    dn = [KIND_NAME.get(k, k) for d, k in dk[:3] if d < 0]
    zero = [KIND_NAME.get(k, k) for k in k1 if k2.get(k, 0) == 0 and k1.get(k, 0) >= 3]
    A("换尺之后**涨得最多的是%s，掉得最多的是%s**。"
      % ("、".join(up) or "无", "、".join(dn) or "无"))
    if zero:
        A("")
        A("`%s` 在 `r=1` 里有名额，在库内一等里**一条都没有**——这类条目在本库的散文里"
          "既没人引，也没有哪条故事线为它设站。是该补叙述，还是这一类本就只该做背景，"
          "得由人来判；本表只负责把它指出来。" % "、".join(zero))
    A("")
    A("### 时段构成")
    A("")
    A("| 时段 | r=1 | 库内一等 | 差 |")
    A("|---|---:|---:|---:|")
    e1 = dict(cp["r1"]["era"]); e2 = dict(cp["lib1"]["era"])
    ORD = ["史前", "夏商西周", "春秋战国", "秦汉", "三国两晋南北朝", "隋唐",
           "五代十国", "宋辽金夏", "元明清", "近代以后", "未系年"]
    for k in ORD:
        if k not in e1 and k not in e2:
            continue
        A("| %s | %d | %d | %+d |" % (k, e1.get(k, 0), e2.get(k, 0), e2.get(k, 0) - e1.get(k, 0)))
    A("")
    de = sorted(((e2.get(k, 0) - e1.get(k, 0), k) for k in set(e1) | set(e2)))
    A("时段上**%s涨、%s落**。`rank.py` 有一道「时代保底」专治访问量偏近现代"
      "（每两百年一格保三个锚点）；库内权重没有这道闸，它照出的是**库内叙述自己的"
      "重心落在哪一段**——两者不必一致，但差得太远的那一段值得回头看看是不是叙述欠账。"
      % (de[-1][1] if de and de[-1][0] > 0 else "无", de[0][1] if de and de[0][0] < 0 else "无"))
    A("")
    A("## 五、脚本用法 / 可调参数 / 已知盲点")
    A("")
    A("### 用法")
    A("")
    A("```")
    A("python tools/mining/graph_mentions.py            # 全跑：图 JSON + 本报告")
    A("python tools/mining/graph_mentions.py --no-md    # 只出 JSON 与终端摘要")
    A("python tools/mining/graph_mentions.py --stop-ratio .07 --norm raw")
    A("```")
    A("")
    A("零外呼、零改库：只读 `js/events.js`、`js/dynasties.js`、`js/data-[0-9]*.js`、"
      "`js/line-stops.js`、`docs/sources-*.json`。图数据（graph.json / metrics.json / "
      "report_data.json）写到 `--out` 指定的库外目录，本报告写到 `--md`。"
      "Windows 下打印中文请带 `PYTHONIOENCODING=utf-8`。")
    A("")
    A("### 可调参数")
    A("")
    A("| 参数 | 现值 | 调它会怎样 |")
    A("|---|---|---|")
    A("| `--stop-ratio` | %.2f | 二字政权名入停用表的广度阈值。调高→更多二字政权名入图，"
      "提及边暴涨且掺进时代背景词；调低→二字政权名近乎全灭 |" % m["stop_ratio"])
    A("| `--norm` | %s | `log`＝min-max(log1p)，`raw`＝线性 min-max。入度长尾极重，"
      "`raw` 会让最高的一条独占 1.0、其余全挤在 0.0x，等于把入度项废掉 |" % m["norm"])
    A("| `--damping` | %.2f | PageRank 阻尼。调低→更看重局部入度、更少全局传导 |" % m["damping"])
    A("| `MIN_NAME_LEN` | %d | 提及匹配的最短名字长度（脚本常量） |" % m["min_name_len"])
    A("| `W_COEF` | %s | 库内权重六项系数（脚本常量）。站数与 rel 数是**绝对项**不是"
      "标准化项——一条被两条线设站，凭这一项就抵得上一个不低的入度 |"
      % json.dumps(m["coef"], ensure_ascii=False))
    A("| `T1_SHARE`/`T2_SHARE` | %.2f / %.2f | 三档比例，与 rank.py 的 N1/N2 同口径 |"
      % (m["t1_share"], m["t2_share"]))
    A("")
    A("### 已知盲点")
    A("")
    A("1. **同名异指**。名字表里 %d 处撞车（一个名字对上多个节点），"
      "按 事件 > 政权 > 君主 > 地点 择一，被丢掉的那一侧就少算了入边。"
      "撞得最凶的几个：%s。"
      % (rd["n_conflicts"], "、".join("%s（取 %s，弃 %s）"
         % (x["name"], x["taken"], "／".join(x["dropped"]))
         for x in rd["conflicts"][:6]) or "无"))
    A("2. **别名未覆盖**。提及匹配只认 `n`／`ya`／`b`（事件）、`name`（政权）、"
      "`t`／`n`（君主）与地名原字。库内散文常用的**异称一概不认**：「玄宗」不等于"
      "「唐玄宗」、「魏武」不等于「曹操」、「长安」与「西安」在本图是两个地点。"
      "这一项会系统性地压低君主与地点的入度。")
    A("3. **文言人名与简称**。「帝」「上」「太祖」这类文言指代无法归指；"
      "二字君主名（如「刘裕」以外的多数本名）本就被 %d 字门槛挡在主图外。" % m["min_name_len"])
    A("4. **繁简与异体**。库内引文按军规逐字照录（嶽/岳案），"
      "而名字表存的是条目正名；引文里的繁体或异体写法匹配不上。")
    A("5. **提及不等于重要**。一条长 yl 顺手点了三十个名字，入边就多；"
      "yl 短的条目天然吃亏——`0.25·(有 yl)` 只补了「有没有」，没补「长不长」。"
      "`metrics.json` 里存了 `ylen`，要改成按字数折算是一行的事。")
    A("6. **rel 字段太稀**（全库仅个位数条目在用），故 `0.5·rel 数` 这一项"
      "眼下几乎不起作用；它留在公式里是为将来 rel 铺开后不必改公式。")
    A("7. **考据卡命中靠站名**。`docs/sources-*.json` 的键是**站名**不是事件名，"
      "两者多数重合但不全等；站名与事件名不同写法的那些条目会被判成「无卡」。")
    A("8. **同名君主并作一个节点**。君主节点键取 `n`（本名），"
      "%d 条君主记录并成 %d 个节点——不同政权的同名之君（列国里不少）在图上是一个点，"
      "入边算在一起。" % (m["diag"]["ruler_rows"], m["diag"]["ruler_nodes"]))
    A("9. **地名写法不统一**。`北京` 与 `北京市`、`南京` 与 `南京市` 在本图是不同节点，"
      "因为它们在 `p`／`cap` 里就是分开写的；提及匹配也照这个分。地名归一化是另一件事，"
      "本脚本不做（`build_geo_events.py` 那条线才是管坐标归一的）。")
    A("10. **`rank分` 一列可能对不上**。`ranks.json` 是 `rank.py` 上一次跑的快照，"
      "比 `events.js` 旧几笔；本轮 %d/%d 条对上，其余留空（新入库的、以及 y 事后校正过的）。"
      % (m["diag"]["score_hit"], m["diag"]["n_ev"]))
    A("")
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    main()
