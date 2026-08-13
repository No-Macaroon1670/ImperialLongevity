#!/usr/bin/env python3
"""
合并「Wikidata 骨架」与「人工判定层」，生成 js/civ-data.js（ES 模块）。

写成 JS 模块而非 JSON，是为了让页面同步加载——应用的渲染流程是同步的，
若改用 fetch 会把整条链路染成异步，得不偿失。

本脚本同时充当校验器：人工层与骨架必须**双向对齐**——
既不许标注了骨架里不存在的 QID（多半是我记错了编号），
也不许有骨架人物无人判定。任一不齐即报错退出，不产出半成品。
"""
import json, io, pathlib, sys, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA, JS = ROOT / "data", ROOT / "js"


def load(p):
    return json.load(io.open(p, encoding="utf-8"))


def build_ottoman():
    skel = load(DATA / "wikidata-ottoman.json")
    man = load(DATA / "ottoman-manual.json")
    judged = dict(man["rulers"])
    for qid, v in man.get("deposed_only", {}).items():
        if qid.startswith("Q"):
            judged.setdefault(qid, {}).update(v)

    skel_ids = {r["qid"] for r in skel["rulers"]}
    unknown = sorted(set(judged) - skel_ids)
    missing = sorted(skel_ids - set(judged))
    if unknown or missing:
        by_name = {r["qid"]: (r["name_zh"] or r["name_en"]) for r in skel["rulers"]}
        if unknown:
            print("人工层标注了骨架中不存在的 QID（编号有误？）：", file=sys.stderr)
            for q in unknown:
                print(f"  {q}  note={judged[q].get('note','')}", file=sys.stderr)
        if missing:
            print("骨架中以下人物尚无人工判定：", file=sys.stderr)
            for q in missing:
                print(f"  {q}  {by_name[q]}", file=sys.stderr)
        raise SystemExit("人工层与骨架未对齐，拒绝产出")

    rows = []
    for r in skel["rulers"]:
        j = judged[r["qid"]]
        violent = j.get("violent")
        if violent is None:                       # 沿用 Wikidata 的死亡方式
            m = (r.get("manner") or "").lower()
            violent = 1 if any(k in m for k in ("homicide", "murder", "suicide", "battle", "capital punishment", "execution")) else 0
        rows.append({
            "qid": r["qid"], "realm": "奥斯曼",
            "name": r["name_zh"] or r["name_en"],
            "birth": r["birth"], "death": r["death"],
            "acc": r["reigns"][0][0],
            "end": r["reigns"][-1][1] or r["death"],
            "violent": violent,
            "deposed": j.get("deposed", 0),
            "disputed": j.get("disputed", 0),
            "manner": r.get("manner"),
            "note": j.get("note", ""),
        })
    return rows


def main():
    rows = build_ottoman()
    n = len(rows)
    v = sum(r["violent"] for r in rows)
    d = sum(r["deposed"] for r in rows)
    body = ",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in rows)
    out = (
        "// 由 tools/build_civ.py 生成，请勿手改。\n"
        "// 骨架来自 Wikidata（CC0），死亡方式与废黜判定见 data/*-manual.json。\n"
        f"// 生成于 {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}\n"
        "export const CIV_ROWS = [\n" + body + "\n];\n"
    )
    (JS / "civ-data.js").write_text(out, encoding="utf-8")
    print(f"奥斯曼 {n} 位 → js/civ-data.js　非正常死亡 {v}（{v/n*100:.0f}%）　被废 {d}（{d/n*100:.0f}%）", file=sys.stderr)


if __name__ == "__main__":
    main()
