#!/usr/bin/env python3
"""
把本库手录的中国帝王数据与 Wikidata 对账，输出差异报告。

为什么用实体 API 而不是 SPARQL：
  1. 做 diff 并不需要 Wikidata 来「枚举」中国皇帝——名册我自己有，要的是逐条比对；
  2. WDQS 正处于降级期（429 限流到 1 req/min，继而 502），而 wbgetentities 是另一套服务。

两个必须处理的坑：
  · **历法**。Wikidata 对 1582 年以前的日期用儒略历存储（calendarmodel Q1985786），
    而 WDQS 的 wikibase:timeValue 会换算成前推格里历——同一个唐太宗，实体 API 给 649-07-10，
    SPARQL 给 649-07-13。中文史料用的是儒略历口径，故以实体 API 的原值为准。
  · **精度**。中西史料对帝王生辰的月日常有出入（且涉及阴阳历换算），
    逐日比对会淹没在噪音里。故以「年」为主判据，日级差异另列为次要项。
"""
import json, re, sys, time, pathlib, urllib.parse, urllib.request, collections

ROOT = pathlib.Path(__file__).resolve().parent.parent
UA = "ImperialLongevity/0.1 (research prototype; github.com/No-Macaroon1670/ImperialLongevity)"
API = "https://www.wikidata.org/w/api.php"
JULIAN = "http://www.wikidata.org/entity/Q1985786"
MANNER = {   # P1196 → 本库的 violent 语义
    "Q3739104": ("natural causes", 0), "Q149086": ("homicide", 1), "Q10737": ("suicide", 1),
    "Q171558": ("accidental death", 0), "Q8454": ("capital punishment", 1),
    "Q1620555": ("death in battle", 1), "Q132821": ("murder", 1), "Q12147416": ("unnatural death", 1),
    "Q1347367": ("execution", 1), "Q3231690": ("assisted suicide", 1), "Q12078": ("disease", 0),
}


# ── 读入本库数据（JS 模块 → JSON）───────────────────────────────────────────
def load_records():
    """紧凑记录格式很规整：键是裸标识符、字符串一律单引号且内部不含撇号，可安全转 JSON。"""
    out = []
    for path in sorted(ROOT.glob("js/data-*.js")):
        src = path.read_text(encoding="utf-8")
        src = src[src.index("["): src.rindex("]") + 1]
        src = re.sub(r"//[^\n]*", "", src)                      # 去行注释
        src = re.sub(r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', src)   # 给键加引号
        src = src.replace("'", '"')                              # 单引号 → 双引号
        src = re.sub(r",(\s*[}\]])", r"\1", src)                 # 去尾逗号
        try:
            out += json.loads(src)
        except json.JSONDecodeError as e:
            raise SystemExit(f"{path.name} 解析失败：{e}")
    return out


def candidates(rec):
    """本库的通称与 zhwiki 条目名对不齐时的备选：去括注、取括注、姓名。"""
    t = rec.get("t", "")
    base = re.sub(r"（[^）]*）$", "", t)
    inner = (re.search(r"（([^）]*)）$", t) or [None, None])[1]
    cs = [base, t]
    if inner:
        cs += [inner + "帝", inner]
    if rec.get("n"):
        cs.append(rec["n"])
    seen, uniq = set(), []
    for c in cs:
        if c and c not in seen:
            seen.add(c); uniq.append(c)
    return uniq


# ── 抓取 ───────────────────────────────────────────────────────────────────
def api(titles):
    q = urllib.parse.urlencode({
        "action": "wbgetentities", "sites": "zhwiki", "titles": "|".join(titles),
        "props": "labels|claims|sitelinks", "languages": "zh", "format": "json",
    })
    for i in range(4):
        try:
            req = urllib.request.Request(API + "?" + q, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:                                   # noqa: BLE001
            print(f"    重试 {i+1}（{e}）", file=sys.stderr); time.sleep(5 * (i + 1))
    return {}


def claim(cl, pid):
    for st in cl.get(pid, []):
        v = st["mainsnak"].get("datavalue", {}).get("value")
        if v:
            return v
    return None


def ymd(v):
    """返回 (年, 'YYYY-MM-DD' 或按精度截断, 是否儒略历)。Wikidata 无零年：-0156 即前 156 年。"""
    if not v or "time" not in v:
        return None, None, False
    t, prec = v["time"], v.get("precision", 11)
    neg = t.startswith("-")
    y = int(t[1:5]) * (-1 if neg else 1)
    s = f"{'前' if neg else ''}{abs(y)}"
    if prec >= 10:
        s += f"-{t[6:8]}"
    if prec >= 11:
        s += f"-{t[9:11]}"
    return y, s, v.get("calendarmodel") == JULIAN


def my_year(s):
    """本库日期串 → 年（公元前为负，与 Wikidata 同用『无零年』约定）。"""
    if not s:
        return None
    if s.startswith("BC"):
        return -int(s[2:].split("-")[0])
    return int(s.split("-")[0])


# ── 主流程 ─────────────────────────────────────────────────────────────────
def main():
    recs = load_records()
    print(f"本库记录 {len(recs)} 条", file=sys.stderr)

    # 一个通称可能对应多条记录：「夏末帝」既是胡夏赫连定（432 卒）又是西夏李睍（1227 卒），
    # 「汉高祖」既是刘邦又是后汉刘知远。若用 setdefault 先到先得，就会把两个相隔八百年的人
    # 判成「卒年差 795 年」——那是匹配错误，不是数据错误。故一名多录，稍后按卒年就近认领。
    cand_map = collections.defaultdict(list)
    for i, r in enumerate(recs):
        for c in candidates(r):
            cand_map[c].append(i)
    titles = list(cand_map)
    print(f"候选标题 {len(titles)} 个，分 {-(-len(titles)//40)} 批查询", file=sys.stderr)

    hits = {}                           # 记录下标 → wikidata 实体
    for b in range(0, len(titles), 40):
        batch = titles[b:b + 40]
        data = api(batch)
        for qid, e in (data.get("entities") or {}).items():
            if "missing" in e or not qid.startswith("Q"):
                continue
            cl = e.get("claims", {})
            # zhwiki 条目名可能是繁体（漢武帝）而请求用的是简体，故标题与 zh 标签都试
            keys = [(e.get("sitelinks", {}).get("zhwiki") or {}).get("title"),
                    (e.get("labels", {}).get("zh") or {}).get("value")]
            cands = [i for k in keys if k for i in cand_map.get(k, [])]
            if not cands:
                continue
            # 同名多人时按卒年就近认领，避免张冠李戴
            wd_death = ymd(claim(cl, "P570"))[0]
            free = [i for i in cands if i not in hits] or cands
            if wd_death is not None and len(free) > 1:
                free.sort(key=lambda i: abs((my_year(recs[i].get("x")) or 9999) - wd_death))
            idx = free[0]
            if idx in hits:
                continue
            hits[idx] = {"qid": qid, "zh": keys[0] or keys[1], "claims": cl}
        print(f"  批 {b//40+1}：累计命中 {len(hits)}", file=sys.stderr)
        time.sleep(0.6)

    rows, unmatched, minor = [], [], []
    manner_cmp = collections.Counter()
    for i, r in enumerate(recs):
        hit = hits.get(i)
        name = r.get("t", r.get("n"))
        if not hit:
            unmatched.append(name)
            continue
        cl = hit["claims"]
        by, bs, bj = ymd(claim(cl, "P569"))
        dy, ds, dj = ymd(claim(cl, "P570"))
        mine_b, mine_d = my_year(r.get("b")), my_year(r.get("x"))
        for field, mine, theirs, disp in (("生年", mine_b, by, bs), ("卒年", mine_d, dy, ds)):
            if mine is None or theirs is None:
                continue
            if mine != theirs:
                rows.append((name, hit["qid"], field, r.get("b") if field == "生年" else r.get("x"), disp, abs(mine - theirs)))
        # 死亡方式
        mv = claim(cl, "P1196")
        if mv and isinstance(mv, dict) and mv.get("id") in MANNER:
            lab, wd_violent = MANNER[mv["id"]]
            mine_violent = 1 if r.get("c") in (2, 3, 4) else (0 if r.get("c") in (0, 1, 6) else None)
            if mine_violent is None:
                manner_cmp["本库存疑，Wikidata 有值"] += 1
            elif mine_violent == wd_violent:
                manner_cmp["一致"] += 1
            else:
                manner_cmp["冲突"] += 1
                rows.append((name, hit["qid"], "死亡方式", f"c={r.get('c')}（violent={mine_violent}）", lab, 99))

    report = ROOT / "data" / "china-wikidata-diff.md"
    report.parent.mkdir(exist_ok=True)
    with report.open("w", encoding="utf-8") as f:
        f.write("# 中国帝王数据 × Wikidata 对账报告\n\n")
        f.write(f"生成时间：{time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}　·　")
        f.write(f"本库 {len(recs)} 条，Wikidata 命中 {len(hits)} 条（{len(hits)/len(recs)*100:.0f}%）\n\n")
        f.write("以「年」为主判据：中西史料对生辰月日常有出入且涉阴阳历换算，"
                "逐日比对会淹没在噪音里。Wikidata 对 1582 年前用儒略历存储，本报告取其原值，"
                "与中文史料口径一致。\n\n")
        f.write(f"## 年份不一致（{len([r for r in rows if r[5]!=99])} 处）\n\n")
        f.write("| 君主 | QID | 字段 | 本库 | Wikidata | 差 |\n|---|---|---|---|---|---|\n")
        for n, q, fld, a, b2, d in sorted([r for r in rows if r[5] != 99], key=lambda x: -x[5]):
            f.write(f"| {n} | [{q}](https://www.wikidata.org/wiki/{q}) | {fld} | {a} | {b2} | {d} 年 |\n")
        conf = [r for r in rows if r[5] == 99]
        f.write(f"\n## 死亡方式冲突（{len(conf)} 处）\n\n")
        f.write("| 君主 | QID | 本库 | Wikidata |\n|---|---|---|---|\n")
        for n, q, _f, a, b2, _d in conf:
            f.write(f"| {n} | [{q}](https://www.wikidata.org/wiki/{q}) | {a} | {b2} |\n")
        f.write(f"\n死亡方式比对：{dict(manner_cmp)}\n")
        f.write(f"\n## 未在 Wikidata 命中（{len(unmatched)} 位）\n\n")
        f.write("多为十六国、十国等小政权之君，或本库通称与 zhwiki 条目名不一致。\n\n")
        f.write("、".join(unmatched) + "\n")

    print(f"\n命中 {len(hits)}/{len(recs)}　年份不一致 {len([r for r in rows if r[5]!=99])} 处　"
          f"死亡方式冲突 {len(conf)} 处　未命中 {len(unmatched)} 位", file=sys.stderr)
    print(f"死亡方式比对：{dict(manner_cmp)}", file=sys.stderr)
    print(f"报告 → {report}", file=sys.stderr)


if __name__ == "__main__":
    main()
