# -*- coding: utf-8 -*-
"""把 agent 交回的「年份写成字符串」的批次转成本库格式,再交给 apply.py 合并。

为什么要多这一道:本项目内部用**天文纪年**(无公元 0 年,前221 记作 -220),
而 events.js 一度用的是「负数即公元前」,两套并存了很久没人发现,直到用户
指着白登之围问「为什么写前201」才查出来——全库五十五条公元前事件整体错一年。

根子在于**同一条换算规则散在多处各写一遍**(charts.js 一份、search.js 一份、
每个 agent 的说明里一份)。所以这次不让 agent 换算:它们照人话写「前221」,
换算只在这里做一次。

用法: python ingest.py out_qinhan.json out_weijin.json ... > merged.json
"""
import io, json, re, sys

def to_astro(s):
    """「前221」→ -220、「1842」→ 1842。天文纪年:公元前 N 年 = -(N-1)"""
    s = str(s).strip().replace("年", "")
    m = re.match(r"^前\s*(\d+)$", s)
    if m:
        return -(int(m.group(1)) - 1)
    m = re.match(r"^-\s*(\d+)$", s)
    if m:
        raise SystemExit("拒收带负号的年份 %r——请照约定写「前N」,免得又错一年" % s)
    m = re.match(r"^(\d+)$", s)
    if m:
        return int(m.group(1))
    raise SystemExit("看不懂的年份:%r" % s)

VALID_K = {"war", "gov", "rev", "out", "cul", "dis", "inst", "her", "era"}
out, seen = [], set()
for path in sys.argv[1:]:
    raw = io.open(path, encoding="utf-8").read()
    m = re.search(r"\[.*\]", raw, re.S)          # 容忍 agent 在 JSON 前后写了散文
    rows = json.loads(m.group(0)) if m else []
    for r in rows:
        if r.get("k") not in VALID_K:
            print("  ! %s 类别不合法 %r,跳过" % (r.get("n"), r.get("k")), file=sys.stderr); continue
        if not r.get("w") or not r.get("n"):
            print("  ! 缺 n 或 w,跳过:%r" % r, file=sys.stderr); continue
        e = {"y": to_astro(r["y"]), "k": r["k"], "n": r["n"], "w": r["w"]}
        if r.get("ws"):
            e["ws"] = r["ws"]          # 段落锚点:该事无独立条目,链到某条目的某一节
        if r.get("y2"):
            e["y2"] = to_astro(r["y2"])
            if e["y2"] < e["y"]:
                print("  ! %s 的 y2 早于 y,跳过" % r["n"], file=sys.stderr); continue
        if len(e["n"]) > 8:
            print("  ! %s 名字超过八字,图上写不下,跳过" % r["n"], file=sys.stderr); continue
        key = (e["y"], e["n"])
        if key in seen:
            print("  ! 批次内重复:%s,跳过" % r["n"], file=sys.stderr); continue
        seen.add(key)
        out.append(e)
out.sort(key=lambda e: (e["y"], e.get("y2", e["y"])))
print("转出 %d 条" % len(out), file=sys.stderr)
sys.stdout.write(json.dumps(out, ensure_ascii=False, indent=0))
