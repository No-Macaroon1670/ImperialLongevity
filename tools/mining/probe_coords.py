# -*- coding: utf-8 -*-
"""坐标可得性探测：地图模式的地基调查。

问的是一个很具体的问题——**库里这 859 条大事记，有多少能落到地图上**。
答案按类别差别极大，故本脚本按 k 分类统计而不是给一个总数：

    her 遗址·建筑   直接带坐标 97%          —— 本来就是地点，零成本可上图
    war 战事        直接 28%，另 59% 有 location  —— 多数要走第二跳解析地名实体
    art 文物        直接 11%，但 50% 有现藏地、17% 有出土地
                    —— 文物在地图上不是一个点而是**两个点**，
                       「出土地→现藏地」本身就是流散叙事

另一个必须先解决的工程问题：条目名→实体的解析率只有 75–90%。库里的 `w` 存的是
维基**正题**（当初为了链接准确特意核过，含繁体与消歧义后缀），而 Wikidata 的
sitelink 索引对重定向并不宽容，故上图前要先做一遍重定向归一。

数据来源与许可：Wikidata（CC0）。取三个属性——
  P625 coordinate location（坐标）
  P276 location（所在地；文物是现藏地，战事是发生地——同一属性，按语境读）
  P189 location of discovery（出土地）

用法：
    python tools/mining/probe_coords.py            # 按类别抽样 40 条
    python tools/mining/probe_coords.py --all her  # 某一类全量
结果写入 tools/mining/coords_probe.json，便于对比历次探测。
"""
import io, json, os, random, re, sys, time
import urllib.parse, urllib.request

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
OUT = os.path.join(ROOT, "tools/mining/coords_probe.json")
UA = {"User-Agent": "ImperialLongevity-coordprobe/1.0 (map-mode feasibility)"}
BS = chr(92)
FIELD = r"\b%s:\s*'((?:[^'" + BS + BS + r"]|" + BS + BS + r".)*)'"


def load_events():
    src = io.open(os.path.join(ROOT, "js/events.js"), encoding="utf-8").read()
    rows = []
    for m in re.finditer(r"\{([^{}]*?y:\s*-?\d+[^{}]*?)\},", src):
        b = m.group(1)
        def g(k):
            mm = re.search(FIELD % k, b)
            return mm.group(1) if mm else None
        if g("w"):
            rows.append({"n": g("n"), "w": g("w"), "k": g("k"), "y": int(re.search(r"y:\s*(-?\d+)", b).group(1))})
    return rows


def wikidata(titles):
    """zhwiki 条目名 → {qid: {P625,P276,P189}}。二十条一批，失败退避重试。"""
    got = {}
    for i in range(0, len(titles), 20):
        chunk = titles[i:i + 20]
        url = ("https://www.wikidata.org/w/api.php?action=wbgetentities&sites=zhwiki"
               "&props=claims&format=json&titles=" + urllib.parse.quote("|".join(chunk)))
        for attempt in range(4):
            try:
                d = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
                for qid, ent in (d.get("entities") or {}).items():
                    if qid.startswith("-"):      # 未命中的占位项
                        continue
                    cl = ent.get("claims") or {}
                    got[qid] = {p: (p in cl) for p in ("P625", "P276", "P189")}
                break
            except Exception as e:
                if attempt == 3:
                    print("  批次失败：%s" % str(e)[:50], file=sys.stderr)
                time.sleep(4)
        time.sleep(0.4)                          # 限速：这是别人的公共接口
    return got


def main():
    rows = load_events()
    full = "--all" in sys.argv
    only = sys.argv[sys.argv.index("--all") + 1] if full and len(sys.argv) > sys.argv.index("--all") + 1 else None
    kinds = [only] if only else ["her", "war", "art"]
    random.seed(11)                              # 固定种子：历次探测可比
    report = {}
    for k in kinds:
        pool = [r for r in rows if r["k"] == k]
        samp = pool if (full and only == k) else random.sample(pool, min(40, len(pool)))
        got = wikidata([r["w"] for r in samp])
        n = len(got) or 1
        rec = {
            "全库": len(pool), "抽样": len(samp), "命中实体": len(got),
            "有坐标": sum(1 for v in got.values() if v["P625"]),
            "有所在地": sum(1 for v in got.values() if v["P276"]),
            "有出土地": sum(1 for v in got.values() if v["P189"]),
        }
        rec["坐标覆盖率"] = round(100 * rec["有坐标"] / n)
        rec["实体解析率"] = round(100 * len(got) / max(len(samp), 1))
        report[k] = rec
        print("%-4s 全库 %3d｜抽样 %2d → 命中 %2d（解析 %d%%）｜坐标 %2d（%d%%）｜所在地 %2d｜出土地 %2d"
              % (k, rec["全库"], rec["抽样"], rec["命中实体"], rec["实体解析率"],
                 rec["有坐标"], rec["坐标覆盖率"], rec["有所在地"], rec["有出土地"]))
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(report, ensure_ascii=False, indent=1))
    print("写出 %s" % OUT)


if __name__ == "__main__":
    main()
