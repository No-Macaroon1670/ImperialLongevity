#!/usr/bin/env python3
"""
合并「Wikidata 骨架」与「人工判定层」，生成 js/civ-data.js（ES 模块）。

写成 JS 模块而非 JSON，是为了让页面同步加载——应用的渲染流程是同步的，
若改用 fetch 会把整条链路染成异步，得不偿失。

本脚本同时充当校验器：人工层与骨架必须**双向对齐**——
既不许标注了骨架里不存在的 QID（多半是记错了编号），
也不许有骨架人物无人判定。任一不齐即报错退出，不产出半成品。

关于「失位」这个变量：初版按各文明手工标注 deposed（是否被废黜），
但该概念跨文明不可比——日本的譲位是制度常态（多数天皇生前让位给继承人），
奥斯曼的废立有乌理玛法特瓦的正式程序，中国则多为政变所迫。把三者压成同一个
0/1 变量，等于把「制度化交班」和「政变夺位」混为一谈。
故改用**可机械推导**的口径：`lost_throne` = 在位终于身死之前。
它不判断自愿与否，只陈述「王位先于生命结束」，各文明定义完全一致；
自愿与被迫之别，交给它与 violent 的组合去体现（高失位＋低暴力＝制度化交班）。
"""
import json, io, pathlib, sys, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA, JS = ROOT / "data", ROOT / "js"

REALMS = [
    ("ottoman",   "奥斯曼"),
    ("byzantine", "拜占庭"),
    ("japan",     "日本天皇"),
    ("shogun",    "日本幕府"),
]
VIOLENT_WORDS = ("homicide", "murder", "killing", "assassination", "suicide", "battle",
                 "capital punishment", "execution")


def load(p):
    return json.load(io.open(p, encoding="utf-8"))


def year(s):
    if not s:
        return None
    body = s.lstrip("-")
    return int(body.split("-")[0]) * (-1 if s.startswith("-") else 1)


def _parts(s):
    neg = s.startswith("-")
    b = s.lstrip("-").split("-")
    return [int(b[0]) * (-1 if neg else 1)] + [int(x) for x in b[1:]]


def lost_throne(end, death):
    """
    在位是否终于身死之前。

    不能直接比字符串：两端精度常不一致（退位只知年、卒日精确到日），
    而 "1616" < "1616-06-01" 在字典序下恒真——德川家康等一大批人会被误判为失位，
    结果整个幕府 39/39 都成了「生前失位」。故按两者**较粗**的精度逐段比较，
    在可比精度内相同即保守记 0（年精度同年者无法区分「死于任上」与「当年退位后卒」）。
    """
    if not end or not death:
        return 0
    a, b = _parts(end), _parts(death)
    for i in range(min(len(a), len(b))):
        if a[i] != b[i]:
            return 1 if a[i] < b[i] else 0
    return 0


def build(key, realm):
    skel = load(DATA / f"wikidata-{key}.json")
    man = load(DATA / f"{key}-manual.json")

    judged = dict(man.get("rulers", {}))
    for qid, v in man.get("deposed_only", {}).items():          # 奥斯曼沿用的旧结构
        if qid.startswith("Q"):
            judged.setdefault(qid, {}).update(v)
    excluded = {q: v for q, v in man.get("exclude", {}).items() if q.startswith("Q")}

    kept = [r for r in skel["rulers"] if r["qid"] not in excluded]
    skel_ids = {r["qid"] for r in kept}
    need = {r["qid"] for r in kept if not r.get("manner")}       # 无 Wikidata 死亡方式者必须人工判定

    unknown = sorted((set(judged) | set(excluded)) - {r["qid"] for r in skel["rulers"]})
    missing = sorted(need - set(judged))
    if unknown or missing:
        by_name = {r["qid"]: (r.get("name_zh") or r["name_en"]) for r in skel["rulers"]}
        for q in unknown:
            print(f"  [{realm}] 人工层标注了骨架中不存在的 QID：{q}", file=sys.stderr)
        for q in missing:
            print(f"  [{realm}] 缺人工判定：{q} {by_name.get(q,'')}", file=sys.stderr)
        raise SystemExit(f"{realm}：人工层与骨架未对齐，拒绝产出")

    rows = []
    for r in kept:
        j = judged.get(r["qid"], {})
        violent = j.get("violent")
        if violent is None:
            m = (r.get("manner") or "").lower()
            violent = 1 if any(k in m for k in VIOLENT_WORDS) else 0
        acc = r["reigns"][0][0]
        end = r["reigns"][-1][1] or r["death"]
        rows.append({
            "qid": r["qid"], "realm": realm,
            "name": r.get("name_zh") or r["name_en"],
            "birth": r["birth"], "death": r["death"], "acc": acc, "end": end,
            "violent": violent,
            "lost": lost_throne(end, r["death"]),
            "disputed": j.get("disputed", 0),
            "manner": r.get("manner"),
        })
    n = len(rows)
    v = sum(x["violent"] for x in rows)
    l = sum(x["lost"] for x in rows)
    print(f"{realm:>4}：{n:>3} 位　非正常死亡 {v:>2}（{v/n*100:>2.0f}%）　生前失位 {l:>2}（{l/n*100:>2.0f}%）"
          f"　排除 {len(excluded)}", file=sys.stderr)
    return rows


def main():
    rows = []
    for key, realm in REALMS:
        rows += build(key, realm)
    body = ",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in rows)
    out = (
        "// 由 tools/build_civ.py 生成，请勿手改。\n"
        "// 骨架来自 Wikidata（CC0），死亡方式的缺口与名册排除见 data/*-manual.json。\n"
        f"// 生成于 {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}\n"
        "export const CIV_ROWS = [\n" + body + "\n];\n"
    )
    (JS / "civ-data.js").write_text(out, encoding="utf-8")
    print(f"合计 {len(rows)} 位 → js/civ-data.js", file=sys.stderr)


if __name__ == "__main__":
    main()
