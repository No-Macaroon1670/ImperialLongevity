# -*- coding: utf-8 -*-
"""帝制君主的血亲承继：每位君主与本朝前一任是什么亲属关系（父子／兄弟／叔侄／祖孙／……／无血缘）。

为什么先做这一条：出链层总则（docs/idea-graph.md）要的是「必然联系」而不是互访，
而血亲承继是关系类型天然闭合、来源可机读的一种边——Wikidata 的 P22（父）P25（母）
P40（子）P3373（兄弟姊妹）对帝王覆盖极好（探针：西汉四帝 P22 全有）。
做完它，边表（js/links.js）就有了第一批带类型、带出处的边，schema 也就有了实物可对。

判法：不是逐对问「你们是不是父子」，是先把每位君主往上溯三代（P22/P25 逐层补抓），
然后拿前任与继任在这棵祖先树上的位置定名——两人到最近公共祖先的代数 (a, b)：
  (0,1) 父子／母子   (1,1) 兄弟   (0,2) 祖孙   (1,2) 叔侄   (2,2) 从兄弟
  (0,3) 曾祖孙       (1,3) 叔祖侄孙   (2,3) 从叔侄   (3,3) 再从兄弟
三代内无公共祖先而两边祖先都抓到了 → 「三代内无血缘」（篡、禅、推举、异姓）；
任一边祖先缺 → 「未定」，列给人核（员或库主）。注意父子边不看 P40（子女表常年不全），
只看继任的 P22/P25；而 Wikidata 的 P22 偶尔填的是养父，本脚本照录并标 P1039 限定词。

数据来源三层，报告里分开记：
  wikidata  Wikidata 实体（QID 可回查）
  未命中    本库君主在 Wikidata 找不到条目（多为僭称、短命、十六国小朝廷）——留给人补
用法：
    python tools/mining/kinship.py            # 抓取（带缓存）＋出报告
    python tools/mining/kinship.py --offline  # 只用缓存重出报告
读：js/data-[1-9]*.js（经 node 读 ESM，避免手写解析器）
读（可选）：data/kinship-fill.json——考据员补核的未定对（卷 docs/desk/kinship-fill-<日期>.md），叠在机读结果之上
写：tools/mining/kinship-cache.json（Wikidata 实体缓存）、data/kinship.json（成对关系）、
    docs/desk/kinship-<日期>.md（报告）
"""
import collections, io, json, os, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "kinship-cache.json")
OUT = os.path.join(ROOT, "data", "kinship.json")
API = "https://www.wikidata.org/w/api.php"
UA = {"User-Agent": "imperial-longevity-curation/1.0 (github.com/No-Macaroon1670/ImperialLongevity)"}
PROPS = ("P22", "P25", "P3373", "P570", "P31")
HUMAN = "Q5"
NAMES = {(0, 1): "父子", (1, 1): "兄弟", (0, 2): "祖孙", (1, 2): "叔侄", (2, 2): "从兄弟",
         (0, 3): "曾祖孙", (1, 3): "叔祖侄孙", (2, 3): "从叔侄", (3, 3): "再从兄弟"}
DEPTH = 3
OFFLINE = "--offline" in sys.argv


def load_rulers():
    js = ("import { pathToFileURL } from 'node:url'; import fs from 'node:fs';"
          "const fs2 = fs.readdirSync('js').filter(f => /^data-[1-9]/.test(f)).sort();"
          "const out = []; for (const f of fs2) { const m = await import(pathToFileURL('js/' + f).href);"
          "for (const r of m.default) out.push(Object.assign({_f: f}, r)); }"
          "process.stdout.write(JSON.stringify(out));")
    p = subprocess.run(["node", "--input-type=module", "-e", js], cwd=ROOT, capture_output=True)
    if p.returncode:
        raise SystemExit(p.stderr.decode("utf-8", "replace"))
    return json.loads(p.stdout.decode("utf-8"))


def candidates(r):
    """zhwiki 条目名候选：wk 显式指定 > 通称 > 去括注 > 括注+帝 > 本名。同 diff_china.py。"""
    import re
    t = r.get("t", "")
    base = re.sub(r"（[^）]*）$", "", t)
    inner = (re.search(r"（([^）]*)）$", t) or [None, None])[1]
    cs = ([r["wk"]] if r.get("wk") else []) + [t, base]
    if inner:
        cs += [inner + "帝", inner]
    if r.get("n"):
        cs.append(r["n"])
    seen, out = set(), []
    for c in cs:
        if c and c not in seen:
            seen.add(c); out.append(c)
    return out


def api(params):
    q = urllib.parse.urlencode(dict(params, format="json"))
    for i in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(API + "?" + q, headers=UA), timeout=60) as r:
                d = json.load(r)
            time.sleep(1.5)
            return d
        except urllib.error.HTTPError as ex:
            wait = 40 * (i + 1) if ex.code == 429 else 6 * (i + 1)
            print("  重试 %d（HTTP %s，等 %ds）" % (i + 1, ex.code, wait), file=sys.stderr); time.sleep(wait)
        except Exception as ex:                                     # noqa: BLE001
            print("  重试 %d（%s）" % (i + 1, ex), file=sys.stderr); time.sleep(6 * (i + 1))
    return {}                                                      # 空＝这一发没抓到，调用方不得当「查无」


def slim(e):
    cl = e.get("claims", {})
    out = {"label": (e.get("labels", {}).get("zh") or {}).get("value"),
           "zh": (e.get("sitelinks", {}).get("zhwiki") or {}).get("title")}
    for p in PROPS:
        vals = []
        for st in cl.get(p, []):
            v = st["mainsnak"].get("datavalue", {}).get("value")
            if not v:
                continue
            if p == "P570":
                t = v.get("time", "")
                vals.append(-int(t[1:5]) if t.startswith("-") else int(t[1:5]))
            elif p == "P31":
                vals.append(v.get("id"))
            else:
                quals = [q["datavalue"]["value"].get("id") for q in st.get("qualifiers", {}).get("P1039", [])
                         if "datavalue" in q]
                vals.append({"id": v.get("id"), "q": quals} if quals else v.get("id"))
        out[p] = vals
    return out


def year(s):
    if not s:
        return None
    return -int(s[2:].split("-")[0]) if s.startswith("BC") else int(s.split("-")[0])


def main():
    rulers = load_rulers()
    cache = json.load(io.open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {"by_title": {}, "ent": {}}
    ent, by_title = cache["ent"], cache["by_title"]
    print("帝制君主 %d 条" % len(rulers), file=sys.stderr)

    # ── 一、按条目名认领 QID（同名多人按卒年就近） ──
    cand_map = collections.defaultdict(list)
    for i, r in enumerate(rulers):
        for c in candidates(r):
            cand_map[c].append(i)
    todo = [t for t in cand_map if t not in by_title]
    if todo and not OFFLINE:
        print("待查条目名 %d 个" % len(todo), file=sys.stderr)
        for b in range(0, len(todo), 40):
            batch = todo[b:b + 40]
            d = api({"action": "wbgetentities", "sites": "zhwiki", "titles": "|".join(batch),
                     "props": "labels|claims|sitelinks", "languages": "zh"})
            if not d.get("entities"):
                print("  这一批没抓到，留待重跑", file=sys.stderr); continue
            got = {}
            for qid, e in (d.get("entities") or {}).items():
                if "missing" in e or not qid.startswith("Q"):
                    continue
                ent[qid] = slim(e)
                for k in (ent[qid]["zh"], ent[qid]["label"]):
                    if k in cand_map:
                        got[k] = qid
            for t in batch:
                by_title[t] = got.get(t)          # None＝查无此条目，也记，免得重查
            json.dump(cache, io.open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
            print("  条目名 %d/%d" % (min(b + 40, len(todo)), len(todo)), file=sys.stderr)
    # ── 一之二、第一遍没认到的，走 zh.wikipedia 的 converttitles+redirects（rank.py 同法）──
    # wbgetentities 的 titles 只认 zhwiki 站内链接的原写法（唐肅宗），简体请求（唐肃宗）直接落空；
    # 而「前少帝」这种通称在 zhwiki 是重定向（→汉少帝，且是消歧义页）。zh.wikipedia 的 query
    # 端点会把繁简转换与重定向都走完，并顺手给出 wikibase_item；消歧义页按 pageprops 剔除。
    def human(q):
        e = ent.get(q) or {}
        return HUMAN in (e.get("P31") or [])
    # 老缓存里没有 P31 的实体先补一遍（一次性）
    stale = sorted(q for q, e in ent.items() if "P31" not in e)
    if stale and not OFFLINE:
        print("补 P31：%d 个实体" % len(stale), file=sys.stderr)
        for b in range(0, len(stale), 50):
            d = api({"action": "wbgetentities", "ids": "|".join(stale[b:b + 50]),
                     "props": "labels|claims|sitelinks", "languages": "zh"})
            for qid, e in (d.get("entities") or {}).items():
                if "missing" not in e:
                    ent[qid] = slim(e)
            json.dump(cache, io.open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    unresolved = sorted({c for i, r in enumerate(rulers)
                         if not any(by_title.get(c) and human(by_title[c]) for c in candidates(r))
                         for c in candidates(r) if c not in cache.setdefault("by_zh", {})})
    if unresolved and not OFFLINE:
        print("第二遍（zhwiki converttitles）待查 %d 个" % len(unresolved), file=sys.stderr)
        ZH = "https://zh.wikipedia.org/w/api.php"
        for b in range(0, len(unresolved), 40):
            batch = unresolved[b:b + 40]
            q = urllib.parse.urlencode({"action": "query", "titles": "|".join(batch), "converttitles": "1",
                                        "redirects": "1", "prop": "pageprops",
                                        "ppprop": "wikibase_item|disambiguation", "format": "json"})
            d = {}
            for i in range(5):
                try:
                    with urllib.request.urlopen(urllib.request.Request(ZH + "?" + q, headers=UA), timeout=60) as rr:
                        d = json.load(rr)
                    time.sleep(1.5); break
                except Exception as ex:                             # noqa: BLE001
                    print("  重试 %d（%s）" % (i + 1, ex), file=sys.stderr); time.sleep(30 * (i + 1))
            qd = d.get("query") or {}
            if not qd.get("pages"):
                print("  这一批没抓到，留待重跑", file=sys.stderr); continue
            hop = {}
            for x in (qd.get("normalized") or []) + (qd.get("converted") or []) + (qd.get("redirects") or []):
                hop[x["from"]] = x["to"]
            final = {}
            for p in qd["pages"].values():
                pp = p.get("pageprops") or {}
                if "missing" in p or "disambiguation" in pp or not pp.get("wikibase_item"):
                    continue
                final[p["title"]] = pp["wikibase_item"]
            for t in batch:
                x = t
                for _ in range(4):
                    x = hop.get(x, x)
                cache["by_zh"][t] = final.get(x)
            json.dump(cache, io.open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
        need = sorted({q for q in cache["by_zh"].values() if q and q not in ent})
        for b in range(0, len(need), 50):
            d = api({"action": "wbgetentities", "ids": "|".join(need[b:b + 50]),
                     "props": "labels|claims|sitelinks", "languages": "zh"})
            for qid, e in (d.get("entities") or {}).items():
                if "missing" not in e:
                    ent[qid] = slim(e)
            json.dump(cache, io.open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    by_zh = cache.get("by_zh", {})
    qid_of = {}
    taken = set()
    for i, r in enumerate(rulers):
        opts = [by_title.get(c) or by_zh.get(c) for c in candidates(r)]
        opts = [q for q in opts if q and q in ent and human(q)]
        if not opts:
            continue
        my = year(r.get("x"))
        # 同名多人：卒年就近，且不重复认领
        opts.sort(key=lambda q: abs((ent[q]["P570"][0] if ent[q]["P570"] else 9999) - (my or 9999)))
        for q in opts:
            if q not in taken:
                dy = ent[q]["P570"][0] if ent[q]["P570"] else None
                if dy is not None and my is not None and abs(dy - my) > 30:
                    continue                    # 同名而卒年差三十年以上：不是这个人
                qid_of[i] = q; taken.add(q); break

    # ── 二、往上补祖先三代（P22/P25 的实体） ──
    def ancestors_missing():
        need = set()
        frontier = set(qid_of.values())
        for _ in range(DEPTH):
            nxt = set()
            for q in frontier:
                e = ent.get(q)
                if not e:
                    need.add(q); continue
                for p in ("P22", "P25"):
                    for v in e[p]:
                        vid = v["id"] if isinstance(v, dict) else v
                        if vid not in ent:
                            need.add(vid)
                        nxt.add(vid)
            frontier = nxt
        return sorted(need)
    if not OFFLINE:
        for rnd in range(DEPTH + 1):
            need = ancestors_missing()
            if not need:
                break
            print("补祖先第 %d 轮：%d 个实体" % (rnd + 1, len(need)), file=sys.stderr)
            for b in range(0, len(need), 50):
                d = api({"action": "wbgetentities", "ids": "|".join(need[b:b + 50]),
                         "props": "labels|claims|sitelinks", "languages": "zh"})
                if not d.get("entities"):
                    print("  这一批没抓到，留待重跑", file=sys.stderr); continue
                for qid, e in (d.get("entities") or {}).items():
                    ent[qid] = slim(e) if "missing" not in e else {"label": None, "zh": None, **{p: [] for p in PROPS}}
                json.dump(cache, io.open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)

    # ── 三、定名 ──
    def parents(q):
        e = ent.get(q) or {}
        out = []
        for p in ("P22", "P25"):
            for v in e.get(p, []):
                out.append(v["id"] if isinstance(v, dict) else v)
        return out
    def anc(q):
        """{祖先QID: 代数}，含自身 0；只算 DEPTH 代。"""
        res, frontier = {q: 0}, [q]
        for k in range(1, DEPTH + 1):
            nxt = []
            for x in frontier:
                for p in parents(x):
                    if p not in res:
                        res[p] = k; nxt.append(p)
            frontier = nxt
        return res
    def complete(q):
        """三代祖先是否都抓到了（用来区分「无血缘」与「未定」）：至少父系每层都有 P22。"""
        x = q
        for _ in range(DEPTH):
            e = ent.get(x)
            if not e or not e["P22"]:
                return False
            v = e["P22"][0]; x = v["id"] if isinstance(v, dict) else v
        return True
    def adoptive(q):
        e = ent.get(q) or {}
        return any(isinstance(v, dict) and v.get("q") for v in e.get("P22", []))

    by_d = collections.defaultdict(list)
    for i, r in enumerate(rulers):
        by_d[r["d"]].append(i)
    pairs = []
    for d, idx in by_d.items():
        for a, b in zip(idx, idx[1:]):
            pa, pb = rulers[a], rulers[b]
            row = {"d": d, "pred": pa["t"], "succ": pb["t"], "pred_n": pa.get("n"), "succ_n": pb.get("n"),
                   "pred_qid": qid_of.get(a), "succ_qid": qid_of.get(b)}
            qa, qb = qid_of.get(a), qid_of.get(b)
            if not qa or not qb:
                row.update(rel="未定", why="未命中 Wikidata：" + ("前任" if not qa else "") + ("继任" if not qb else ""), src="缺")
            else:
                A, B = anc(qa), anc(qb)
                common = [(A[x] + B[x], A[x], B[x], x) for x in A if x in B]
                if common:
                    tot, da, db, x = min(common)
                    key = (min(da, db), max(da, db))
                    name = NAMES.get(key, "%d/%d 代远亲" % (da, db))
                    if key == (0, 1):
                        if da == 0:                                  # 前任是继任的父／母
                            name = "母子" if qa in (ent[qb].get("P25") or []) else "父子"
                        else:                                        # 继任是前任的父／母（睿宗→武则天）
                            name = ("母子" if qb in (ent[qa].get("P25") or []) else "父子") + "（逆向：继任是前任的长辈）"
                    elif da > db:
                        name = name + "（逆向：继任是前任的长辈）"
                    row.update(rel=name, why="最近公共祖先 %s（%s）" % (x, (ent.get(x) or {}).get("label")), src="wikidata",
                               gen=[da, db], adopt=bool(adoptive(qb)))
                elif complete(qa) and complete(qb):
                    row.update(rel="三代内无血缘", why="两边父系三代俱全而无公共祖先", src="wikidata")
                else:
                    row.update(rel="未定", why="祖先链不全（Wikidata 缺 P22）", src="wikidata")
            pairs.append(row)

    # ── 三之二、人核层叠上：data/kinship-fill.json（考据员补核未定对，含 src 引文与 cf）──
    # 机读判「未定」的对，若人核层有同名对就以人核为准；人核层不覆盖机读已判的对。
    FILL = os.path.join(ROOT, "data", "kinship-fill.json")
    if os.path.exists(FILL):
        fill = {(f["d"], f["pred"], f["succ"]): f for f in json.load(io.open(FILL, encoding="utf-8"))}
        n = 0
        for row in pairs:
            f = fill.get((row["d"], row["pred"], row["succ"]))
            if f and row["rel"] == "未定":
                row.update(rel=f["rel"], why=f["why"], src="人核·" + f.get("src", ""), cf=f.get("cf"), gen=f.get("gen"))
                n += 1
        print("人核层叠上 %d 对" % n, file=sys.stderr)

    json.dump({"generated": time.strftime("%Y-%m-%d"), "depth": DEPTH, "pairs": pairs},
              io.open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # ── 四、报告 ──
    cnt = collections.Counter(p["rel"] for p in pairs)
    hit = sum(1 for i in range(len(rulers)) if i in qid_of)
    L = ["# 帝制君主血亲承继（Wikidata 机读＋人核补层，%s）" % time.strftime("%Y-%m-%d"), "",
         "本库帝制君主 %d 位（js/data-1～9），Wikidata 认领 %d 位（%.0f%%）；本朝前后任成对 %d 对。"
         % (len(rulers), hit, hit * 100 / len(rulers), len(pairs)),
         "判法见脚本头注：先溯三代祖先，再按两人到最近公共祖先的代数定名。父子只看继任的 P22/P25，不看 P40。", "",
         "## 总账", "", "| 关系 | 对数 |", "|---|---:|"]
    for k, v in cnt.most_common():
        L.append("| %s | %d |" % (k, v))
    L += ["", "## 逐朝", ""]
    for d, idx in by_d.items():
        rows = [p for p in pairs if p["d"] == d]
        if not rows:
            continue
        L.append("### %s（%d 位，%d 对）" % (d, len(idx), len(rows)))
        L.append("")
        L.append("| 前任 | 继任 | 关系 | 依据 |")
        L.append("|---|---|---|---|")
        for p in rows:
            tag = "（P22 带养/继限定）" if p.get("adopt") else ("〔人核 cf%s〕" % p.get("cf") if str(p.get("src", "")).startswith("人核") else "")
            L.append("| %s | %s | %s%s | %s |" % (p["pred"], p["succ"], p["rel"], tag, p["why"]))
        L.append("")
    und = [p for p in pairs if p["rel"] == "未定"]
    L += ["## 未定（候人核，%d 对）" % len(und), "", "| 政权 | 前任 | 继任 | 缘由 |", "|---|---|---|---|"]
    for p in und:
        L.append("| %s | %s | %s | %s |" % (p["d"], p["pred"], p["succ"], p["why"]))
    miss = [rulers[i]["t"] for i in range(len(rulers)) if i not in qid_of]
    L += ["", "## Wikidata 未命中的君主（%d 位）" % len(miss), "", "、".join(miss)]
    rp = os.path.join(ROOT, "docs", "desk", "kinship-%s.md" % time.strftime("%Y%m%d"))
    io.open(rp, "w", encoding="utf-8", newline="\n").write("\n".join(L) + "\n")
    print("→ %s；%s" % (OUT, rp), file=sys.stderr)
    print("\n".join(L[:14]))


if __name__ == "__main__":
    main()
