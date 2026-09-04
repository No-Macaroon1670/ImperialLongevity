# -*- coding: utf-8 -*-
"""机械生成的边 → js/links-gen.js（生成物，勿手改；手核边在 js/links.js）。

三族都是库里已经写死、只是没写成边的关系（总则：库内已成立之边视同核实）：
  血亲／承继  data/kinship.json——每对前后任出一条「前任」边；血亲按 rel 出一条长辈→晚辈边
              （父／母／祖／曾祖／叔／叔祖／从叔／养父；兄弟三种对称，存前任→继任一行）。
              Wikidata 机读的记 lv 2，人核补层（src 以「人核」起）按其 cf 记 lv。
              「三代内无血缘」不出血亲边，只出承继边并把缘由写进 note。
  事对地      events.js 每条的 p 字段：'地名:角色*~' → 事 →角色动词→ 地。地名若恰是库内条目名
              （二里头遗址、明定陵），靶写 ev: 而非 loc:，遗址与文物就此接上；* 主点、~ 低置信记进 note。
  时段涵盖    era 类（治世·中兴）→ 同政权、在位与 [y, y2] 相交的君主。

用法：python tools/mining/links_gen.py
读：data/kinship.json、js/events.js、js/data-*.js（经 node）、js/links.js（取角色字→动词表）
写：js/links-gen.js
"""
import collections, io, json, os, re, subprocess, sys

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
ROLE_VERB = {"生": "生于", "显": "显于", "卒": "卒于", "葬": "葬于", "贬": "贬至", "行": "行至", "造": "造于",
             "立": "立于", "发": "出土于", "现": "现藏于", "址": "址在", "战": "战于", "起": "起于", "都": "都于",
             "迁": "迁至", "陪": "陪都", "说": "一说在", "灾": "灾于", "颁": "颁于", "摹": "摹于", "仿": "仿于"}
KIN_VERB = {"父子": "父", "母子": "母", "祖孙": "祖", "曾祖孙": "曾祖", "叔侄": "叔", "叔祖侄孙": "叔祖",
            "从叔侄": "从叔", "养父子": "养父", "兄弟": "兄弟", "从兄弟": "从兄弟", "再从兄弟": "再从兄弟"}


def esc(s):
    return str(s).replace("\\", "\\\\").replace("'", "\\'")


def rulers():
    js = ("import { pathToFileURL } from 'node:url'; import fs from 'node:fs';"
          "const fs2 = fs.readdirSync('js').filter(f => /^data-\\d/.test(f) && !/pinyin|nianhao/.test(f)).sort();"
          "const out = []; for (const f of fs2) { const m = await import(pathToFileURL('js/' + f).href);"
          "for (const r of m.default) out.push({n: r.n, t: r.t, d: r.d, a: r.a, z: r.z, x: r.x}); }"
          "process.stdout.write(JSON.stringify(out));")
    p = subprocess.run(["node", "--input-type=module", "-e", js], cwd=ROOT, capture_output=True)
    if p.returncode:
        raise SystemExit(p.stderr.decode("utf-8", "replace"))
    return json.loads(p.stdout.decode("utf-8"))


def year(s):
    if not s:
        return None
    return -int(s[2:].split("-")[0]) if s.startswith("BC") else int(s.split("-")[0])


def main():
    rows, seen = [], set()
    def l(src, verb, dst, cite, lv, note=""):
        # 同一事实只存一行：p 字段里同一地名出现两次（苏武牧羊 西安市:行 去而复返）只出一边
        if (src, verb, dst) in seen:
            return
        seen.add((src, verb, dst))
        rows.append("  l('%s', '%s', '%s', '%s', %d, '%s');" % (esc(src), esc(verb), esc(dst), esc(cite), lv, esc(note)))

    # ── 血亲／承继 ──
    kin = json.load(io.open(os.path.join(ROOT, "data/kinship.json"), encoding="utf-8"))["pairs"]
    nk = nh = 0
    for p in kin:
        a, b = "r:%s@%s" % (p["pred_n"], p["d"]), "r:%s@%s" % (p["succ_n"], p["d"])
        human = str(p.get("src", "")).startswith("人核")
        lv = (int(p.get("cf") or 2) if human else 2)
        cite = ("人核：" + p.get("src", "")[3:])[:80] if human else "Wikidata %s／%s（P22/P25 溯三代）" % (p.get("pred_qid"), p.get("succ_qid"))
        rel = p["rel"]
        base = rel.split("（")[0]
        note = p.get("why", "")
        l(a, "前任", b, cite, 1 if human or p.get("pred_qid") else 3, ("%s；" % rel) + note if rel != "未定" else "血亲未定；" + note)
        nh += 1
        if base in KIN_VERB:
            verb = KIN_VERB[base]
            rev = "逆向" in rel
            src, dst = (b, a) if rev else (a, b)
            l(src, verb, dst, cite, lv, note)
            nk += 1
    print("血亲 %d、承继 %d" % (nk, nh))

    # ── 事对地 ──
    ev_src = io.open(os.path.join(ROOT, "js/events.js"), encoding="utf-8").read()
    body = ev_src[ev_src.index("export const EVENTS"):]
    names = set(re.findall(r"\bn: '((?:[^'\\]|\\.)*)'", body))
    np = 0
    bridged = 0
    eras = []
    for ln in body.split("\n"):
        m = re.match(r"\s*\{ y: (-?\d+)(?:, y2: (-?\d+))?.*?\bk: '(\w+)', n: '((?:[^'\\]|\\.)*)'", ln)
        if not m:
            continue
        y, y2, k, n = int(m.group(1)), (int(m.group(2)) if m.group(2) else None), m.group(3), m.group(4).replace("\\'", "'")
        dm = re.search(r"\bd: '([a-z_0-9]+)'", ln)
        if k == "era" and y2 is not None and dm:
            eras.append((n, y, y2, dm.group(1)))
        pm = re.search(r"\bp: \[([^\]]*)\]", ln)
        if not pm:
            continue
        for item in re.findall(r"'([^']+)'", pm.group(1)):
            mm = re.match(r"([^:]+):(.)([*~]*)$", item)
            if not mm:
                continue
            place, role, flags = mm.groups()
            verb = ROLE_VERB.get(role)
            if not verb:
                continue
            if place in names and place != n:
                dst = "ev:" + place; bridged += 1
            else:
                dst = "loc:" + place
            note = "；".join(x for x in ("主点" if "*" in flags else "", "低置信" if "~" in flags else "") if x)
            l("ev:" + n, verb, dst, "库内 p 字段", 1, note)
            np += 1
    print("事对地 %d（其中靶为库内条目 %d）" % (np, bridged))

    # ── 时段涵盖 ──
    rs = rulers()
    by_d = collections.defaultdict(list)
    for r in rs:
        by_d[r["d"]].append(r)
    ne = 0
    for n, y, y2, d in eras:
        lst = by_d.get(d, [])
        for i, r in enumerate(lst):
            a = year(r.get("a"))
            end = year(r.get("z")) or (year(lst[i + 1].get("a")) if i + 1 < len(lst) else None) or year(r.get("x"))
            if a is None:
                continue
            if end is None:
                end = a
            if a <= y2 and end >= y:
                l("ev:" + n, "涵盖", "r:%s@%s" % (r["n"], d), "库内 era 起讫与君主表在位相交", 1, "%s 在位 %s–%s" % (r.get("t"), a, end))
                ne += 1
    print("时段涵盖 %d" % ne)

    out = ("// 机械生成的边（生成物，勿手改）：由 tools/mining/links_gen.py 从 data/kinship.json、events.js 的 p 字段、\n"
           "// era 起讫与君主表在位推出。动词与 id 体例同 links.js；血亲 Wikidata 机读记 lv 2，人核记其 cf。\n"
           "export const LINKS_GEN = [];\n"
           "function l(src, verb, dst, cite, lv, note) {\n"
           "  LINKS_GEN.push({ src, verb, dst, cite: cite || '', lv: lv || 1, note: note || '' });\n"
           "}\n" + "\n".join(rows) + "\n")
    io.open(os.path.join(ROOT, "js/links-gen.js"), "w", encoding="utf-8", newline="\n").write(out)
    print("→ js/links-gen.js %d 行" % len(rows))


if __name__ == "__main__":
    main()
