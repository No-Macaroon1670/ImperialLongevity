#!/usr/bin/env python3
"""
从 Wikidata 抓取君主骨架数据（名册、生卒、在位起讫、死亡方式）。

为什么是「骨架」而不是全部：实测三个王朝的字段覆盖率——
    生卒日期  ~95%（多精确到日）      → 直接可用，比手录可靠
    在位起讫  ~84%（缺的是僭称者）    → 可用，按「有起始日期」过滤
    死亡方式  ~40%                    → 不足以支撑结论，须人工补齐
故本脚本只负责抓骨架；`violent`（非正常死亡）一栏留给人工判定，
但每条都锚定 QID，可核可回馈。

输出为 JSON，提交进仓库；站点运行时不访问网络，也就没有 CORS 与限流问题。

中国一侧不走这里：做对账并不需要 Wikidata 来「枚举」中国皇帝——名册本库自有，
要的是逐条比对，故 tools/diff_china.py 改用 wbgetentities 实体 API（另一套服务，
不受 WDQS 降级影响）。

用法：
    python tools/fetch_wikidata.py ottoman
    python tools/fetch_wikidata.py all
"""
import json, sys, time, urllib.parse, urllib.request, pathlib, collections

ENDPOINT = "https://query.wikidata.org/sparql"
UA = "ImperialLongevity/0.1 (research prototype; github.com/No-Macaroon1670/ImperialLongevity)"
OUT = pathlib.Path(__file__).resolve().parent.parent / "data"

# position QID → 该职位对应的君主名册
# end_year：政体终结之年。Wikidata 的 P39 名册把「王朝覆灭后的家族名誉族长」也算作在位
# （奥斯曼多出 1973–1983 两位），须按此裁掉，否则名册与传世谱系对不上。
REALMS = {
    "ottoman": {"pos": "Q15315411", "name": "奥斯曼", "end_year": 1922},
}

# 取到值节点以读出时间精度：9=年 10=月 11=日。
# 只取 datetime 会把「仅知年份」误当作 1 月 1 日，跨文明比较里这会系统性偏移登基年龄。
QUERY = """
SELECT ?p ?pLabel ?zhLabel ?start ?startPrec ?end ?endPrec
       ?birth ?birthPrec ?death ?deathPrec ?mannerLabel ?causeLabel
WHERE {
  ?p p:P39 ?st . ?st ps:P39 wd:%(pos)s .
  # 限定词的值节点用 pqv:（psv: 是语句主值的前缀，用错会静默返回零行）
  ?st pqv:P580 ?sv . ?sv wikibase:timeValue ?start ; wikibase:timePrecision ?startPrec .
  OPTIONAL { ?st pqv:P582 ?ev . ?ev wikibase:timeValue ?end ; wikibase:timePrecision ?endPrec }
  OPTIONAL { ?p p:P569/psv:P569 ?bv . ?bv wikibase:timeValue ?birth ; wikibase:timePrecision ?birthPrec }
  OPTIONAL { ?p p:P570/psv:P570 ?dv . ?dv wikibase:timeValue ?death ; wikibase:timePrecision ?deathPrec }
  OPTIONAL { ?p wdt:P1196 ?manner }
  OPTIONAL { ?p wdt:P509 ?cause }
  OPTIONAL { ?p rdfs:label ?zhLabel . FILTER(LANG(?zhLabel) = "zh") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?start
"""


def sparql(query, tries=6):
    """
    WDQS 有 60 秒查询超时，且在服务降级时会限流到「每分钟 1 次」
    （实测收到 429: Aggressively rate-limiting to 1 req / min）。
    故遇 429 一律等满 70 秒再试，短退避在这种限流下必然连续失败。
    """
    url = ENDPOINT + "?" + urllib.parse.urlencode({"query": query, "format": "json"})
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/sparql-results+json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)["results"]["bindings"]
        except Exception as e:                                    # noqa: BLE001
            last = e
            throttled = "429" in str(e)
            wait = 70 if throttled else 10 * (i + 1)
            if i == tries - 1:
                break
            print(f"  第 {i+1} 次失败（{e}），{wait}s 后重试", file=sys.stderr)
            time.sleep(wait)
    raise SystemExit(f"WDQS 连续失败：{last}")


def iso(binding, prec_binding):
    """按精度截断：年精度只留年，月精度留到月，避免把未知的月日当成 1 月 1 日。"""
    if not binding:
        return None
    v = binding["value"]
    neg = v.startswith("-")
    body = v.lstrip("+-")
    y, m, d = body[:4], body[5:7], body[8:10]
    year = ("-" if neg else "") + str(int(y))
    prec = int(prec_binding["value"]) if prec_binding else 11
    if prec <= 9:
        return year
    if prec == 10:
        return f"{year}-{m}"
    return f"{year}-{m}-{d}"


def fetch(realm_key):
    cfg = REALMS[realm_key]
    print(f"抓取 {cfg['name']}（position {cfg['pos']}）…", file=sys.stderr)
    rows = sparql(QUERY % {"pos": cfg["pos"]})

    # 一人可有多段在位（穆拉德二世、穆罕默德二世、穆斯塔法一世皆两度即位），按 QID 归并
    people = collections.OrderedDict()
    for r in rows:
        qid = r["p"]["value"].rsplit("/", 1)[-1]
        rec = people.setdefault(qid, {
            "qid": qid,
            "name_en": r.get("pLabel", {}).get("value"),
            "name_zh": r.get("zhLabel", {}).get("value"),
            "birth": iso(r.get("birth"), r.get("birthPrec")),
            "death": iso(r.get("death"), r.get("deathPrec")),
            "manner": r.get("mannerLabel", {}).get("value"),
            "cause": r.get("causeLabel", {}).get("value"),
            "reigns": [],
        })
        span = [iso(r.get("start"), r.get("startPrec")), iso(r.get("end"), r.get("endPrec"))]
        if span not in rec["reigns"]:
            rec["reigns"].append(span)
    for rec in people.values():
        rec["reigns"].sort(key=lambda s: s[0] or "")

    # 策展：裁掉政体终结之后才「即位」的名誉族长
    cutoff = cfg.get("end_year")
    dropped = []
    if cutoff:
        for qid, rec in list(people.items()):
            first = (rec["reigns"][0][0] or "9999").lstrip("-")
            if int(first[:4]) > cutoff:
                dropped.append(rec["name_en"]); people.pop(qid)
        if dropped:
            print(f"  按 end_year={cutoff} 裁去 {len(dropped)} 位：{', '.join(dropped)}", file=sys.stderr)

    out = {
        "realm": cfg["name"],
        "realm_key": realm_key,
        "position": cfg["pos"],
        "source": "Wikidata (CC0)",
        "fetched_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "note": "骨架数据；violent 一栏须人工判定，Wikidata 的死亡方式覆盖率仅约 40%",
        "curation": {"end_year": cfg.get("end_year"), "dropped": dropped},
        "rulers": list(people.values()),
    }
    # 零行多半是查询写错（如误用 psv: 抓限定词），而不是「这个名册真的没人」。
    # 直接落盘会用空文件覆盖上一次的好数据，故在此拦截。
    if not people:
        raise SystemExit(f"{cfg['name']}：查询返回 0 行，疑为查询有误，拒绝写入")
    OUT.mkdir(exist_ok=True)
    path = OUT / f"wikidata-{realm_key}.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    have = lambda f: sum(1 for r in out["rulers"] if r.get(f))          # noqa: E731
    n = len(out["rulers"])
    print(f"  {n} 人 → {path.name}", file=sys.stderr)
    print(f"  生年 {have('birth')}/{n} · 卒年 {have('death')}/{n} · 死亡方式 {have('manner')}/{n}", file=sys.stderr)
    return out


if __name__ == "__main__":
    args = sys.argv[1:] or ["all"]
    keys = list(REALMS) if args == ["all"] else args
    for k in keys:
        if k not in REALMS:
            raise SystemExit(f"未知名册：{k}（可选 {', '.join(REALMS)}）")
        fetch(k)
