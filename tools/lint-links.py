# -*- coding: utf-8 -*-
"""边表 lint：js/links.js 每一行的两头都得指到真节点，动词都得在 VERBS 登记过。

    python tools/lint-links.py

硬错（exit 1）：
  1. 端点不存在——ev: 不在 events.js、r: 不在君主表、p: 不在 persons.js、d: 不在 dynasties.js、
     loc: 不在 events.js 任何 p 字段里。写错一个字，边就静悄悄从图上消失，这是最坏的失败。
  2. 动词未登记——不在 VERBS 且不带 `?`。逆读与角色名都从 VERBS 取，未登记的动词在卡上会开天窗。
  3. 同一 (src, verb, dst) 出现两次。
  4. 引文为空。
软警（只报不拦）：`?` 拟新动词清单；入度最高的十个节点（一个枢纽堆上几十条弱边，是错型形成的样子）。
读：js/links.js、js/events.js、js/data-*.js（经 node）、js/persons.js、js/dynasties.js
"""
import collections, io, json, os, re, subprocess, sys

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")


def rulers():
    js = ("import { pathToFileURL } from 'node:url'; import fs from 'node:fs';"
          "const fs2 = fs.readdirSync('js').filter(f => /^data-\\d/.test(f) && !/pinyin|nianhao/.test(f)).sort();"
          "const out = []; for (const f of fs2) { const m = await import(pathToFileURL('js/' + f).href);"
          "for (const r of m.default) out.push(r.n + '@' + r.d); } process.stdout.write(JSON.stringify(out));")
    p = subprocess.run(["node", "--input-type=module", "-e", js], cwd=ROOT, capture_output=True)
    if p.returncode:
        raise SystemExit(p.stderr.decode("utf-8", "replace"))
    return set(json.loads(p.stdout.decode("utf-8")))


def main():
    ev_src = io.open(os.path.join(ROOT, "js/events.js"), encoding="utf-8").read()
    body = ev_src[ev_src.index("export const EVENTS"):]
    evs = set(re.findall(r"\bn: '((?:[^'\\]|\\.)*)'", body))
    locs = set()
    for pm in re.finditer(r"\bp: \[([^\]]*)\]", body):
        for t in re.findall(r"'([^':]+):", pm.group(1)):
            locs.add(t)
    dyns = set(re.findall(r"D\('([a-z_0-9]+)'", io.open(os.path.join(ROOT, "js/dynasties.js"), encoding="utf-8").read()))
    persons = set()
    pp = os.path.join(ROOT, "js/persons.js")
    if os.path.exists(pp):
        persons = set(x.replace("\\'", "'") for x in re.findall(r"id: '((?:[^'\\]|\\.)*)'", io.open(pp, encoding="utf-8").read()))
    rs = rulers()
    src = io.open(os.path.join(ROOT, "js/links.js"), encoding="utf-8").read()
    verbs = set(re.findall(r"^  '([^']+)':\s*\{", src[src.index("export const VERBS"):src.index("export const LINKS")], re.M))
    gen_path = os.path.join(ROOT, "js/links-gen.js")
    gen = io.open(gen_path, encoding="utf-8").read() if os.path.exists(gen_path) else ""
    ROWRE = r"^\s*l\('((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'"
    rows = re.findall(ROWRE, src, re.M) + re.findall(ROWRE, gen, re.M)
    rows = [tuple(x.replace("\\'", "'") for x in r) for r in rows]
    print("手核边 %d｜生成边 %d" % (len(re.findall(ROWRE, src, re.M)), len(re.findall(ROWRE, gen, re.M))))

    errs, seen, pend = [], collections.Counter(), collections.Counter()
    indeg = collections.Counter()
    for s, v, d, cite in rows:
        for node in (s, d):
            typ, _, name = node.partition(":")
            ok = {"ev": name in evs, "r": name in rs, "p": name in persons, "d": name in dyns, "loc": name in locs}.get(typ)
            if ok is None:
                errs.append("未知前缀 %s" % node)
            elif not ok:
                errs.append("端点不存在 %s（于 %s %s %s）" % (node, s, v, d))
        if v.startswith("?"):
            pend[v] += 1
        elif v not in verbs:
            errs.append("动词未登记「%s」（%s → %s）" % (v, s, d))
        if not cite:
            errs.append("引文为空（%s %s %s）" % (s, v, d))
        seen[(s, v, d)] += 1
        indeg[d] += 1
    for k, n in seen.items():
        if n > 1:
            errs.append("重复 %d 次：%s %s %s" % (n, *k))
    print("边 %d 行｜动词表 %d｜人物表 %d｜君主 %d" % (len(rows), len(verbs), len(persons), len(rs)))
    if pend:
        print("拟新动词（候库主）：", dict(pend))
    print("入度前十：", indeg.most_common(10))
    if errs:
        print("\n".join("✗ " + e for e in errs[:60]))
        print("共 %d 处硬错" % len(errs))
        sys.exit(1)
    print("边表 lint 零错")


if __name__ == "__main__":
    main()
