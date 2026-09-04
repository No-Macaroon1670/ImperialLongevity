# -*- coding: utf-8 -*-
"""把核验员的改稿载荷（docs/desk/verify-<key>-edits-<日期>.json）机械贴进正本。

载荷体例见 docs/desk/verify-brief-20260904.md：每条 {id, kind, file, old, new, why}，或考据卡回填
{id, kind:'考据卡', file:'docs/sources-<key>.json', op:'append', 站, 级, 文}。

规矩：
  · old 在 file 里须恰好命中一次，否则该条跳过并报出（不猜、不模糊匹配）；
  · 默认全部 kind 都贴（驳／连坐／语感／存疑／考据卡），--no-doubt 则跳过 kind 为「存疑」的条；
  · 长文改在稿本 docs/text-<key>.md（正本）上，贴完须 `line_text_io.py import <key>` 再 `build_line.py <key>`；
    若载荷仍指向 js/line-text-<key>.js（旧体例），照贴，但提醒之后 export 一次同步稿本；
  · 改到 js/events.js 的，提醒跑 lint-events／build_geo_events／受影响线重出。
用法：python tools/mining/apply_edits.py <载荷路径> [--no-doubt] [--dry]
"""
import io, json, os, sys

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        raise SystemExit(__doc__)
    no_doubt, dry = "--no-doubt" in sys.argv, "--dry" in sys.argv
    edits = json.load(io.open(args[0], encoding="utf-8"))
    texts, jsons = {}, {}
    ok, skip, touched = [], [], set()
    for e in edits:
        kind = e.get("kind", "")
        if no_doubt and kind == "存疑":
            skip.append((e.get("id"), "存疑跳过")); continue
        f = e["file"].replace("\\", "/")
        path = os.path.join(ROOT, f)
        if e.get("op") == "append":
            if f not in jsons:
                jsons[f] = json.loads(io.open(path, encoding="utf-8").read())
            d = jsons[f]
            st = e.get("站")
            if st not in d.get("站", {}):
                skip.append((e.get("id"), "考据卡无此站 %s" % st)); continue
            row = {"级": e.get("级", ""), "文": e.get("文", "")}
            if any(x.get("文") == row["文"] for x in d["站"][st]["考据"]):
                skip.append((e.get("id"), "考据卡已有")); continue
            d["站"][st]["考据"].append(row); ok.append(e.get("id")); touched.add(f)
            continue
        if f not in texts:
            texts[f] = io.open(path, encoding="utf-8").read()
        s = texts[f]
        old, new = e["old"], e["new"]
        c = s.count(old)
        if c == 0 and new and s.count(new) == 1:
            skip.append((e.get("id"), "已改过")); continue
        if c != 1:
            skip.append((e.get("id"), "old 命中 %d 次（%s）" % (c, f))); continue
        texts[f] = s.replace(old, new); ok.append(e.get("id")); touched.add(f)
    if not dry:
        for f, s in texts.items():
            if f in touched:
                io.open(os.path.join(ROOT, f), "w", encoding="utf-8", newline="\n").write(s)
        for f, d in jsons.items():
            if f in touched:
                io.open(os.path.join(ROOT, f), "w", encoding="utf-8", newline="\n").write(json.dumps(d, ensure_ascii=False, indent=1) + "\n")
    print("贴上 %d 条：%s" % (len(ok), "、".join(str(x) for x in ok)))
    for i, why in skip:
        print("  跳过 %s：%s" % (i, why))
    print("动到的文件：", sorted(touched))
    for f in touched:
        if f.startswith("docs/text-"):
            key = f[len("docs/text-"):-3]
            print("→ 接着跑：python tools/mining/line_text_io.py import %s && python tools/mining/build_line.py %s" % (key, key))
        if f.startswith("js/line-text-"):
            print("→ 载荷指向旧正本 %s：贴完请 line_text_io.py export 同步稿本" % f)
        if f == "js/events.js":
            print("→ 动了 events.js：跑 lint-events、build_geo_events，受影响的线重出")


if __name__ == "__main__":
    main()
