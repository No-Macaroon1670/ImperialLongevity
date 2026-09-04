# -*- coding: utf-8 -*-
"""把立边员的载荷合并进 js/links.js（幂等），并把新出现的 p: 人物登记进 js/persons.js。

用法：python tools/mining/links_merge.py <员名> docs/desk/links-<员名>-payload-<日期>.json [更多载荷…]

规矩：
  · 按 (src, verb, dst) 去重——同一事实只存一行；已在表里的行原样保留，不用载荷覆盖
    （载荷若改了引文，先在表里手改，再跑本脚本不会回滚）。
  · 载荷每条须有 src/verb/dst/cite；lv 缺省 1；note 缺省空串。串内的 ASCII 单引号转义为 \\'。
  · 带 `?` 的拟新动词照录，交 lint 警告，候库主裁；裁定后在 links.js 的 VERBS 登记并把行里的 `?` 去掉。
  · p: 人物：persons.js 里没有的，登记为 { id, name }（name 即维基条目名，括注剥掉作显示名）；
    生卒等字段留给日后补，本脚本不删不改既有人物。
写：js/links.js（@rows-begin／@rows-end 之间按员分节）、js/persons.js。
"""
import io, json, os, re, sys

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
LINKS = os.path.join(ROOT, "js", "links.js")
PERSONS = os.path.join(ROOT, "js", "persons.js")
ROW = re.compile(r"^\s*l\('((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'")


def esc(s):
    return str(s).replace("\\", "\\\\").replace("'", "\\'")


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    who, paths = sys.argv[1], sys.argv[2:]
    src = io.open(LINKS, encoding="utf-8").read()
    a, b = src.index("// @rows-begin\n") + len("// @rows-begin\n"), src.index("// @rows-end")
    head, rows, tail = src[:a], src[a:b], src[b:]
    have = set()
    for ln in rows.split("\n"):
        m = ROW.match(ln)
        if m:
            have.add(tuple(x.replace("\\'", "'") for x in m.groups()))
    print("表内已有 %d 行" % len(have))

    new_lines, n_new, n_dup, n_bad = [], 0, 0, 0
    persons_new = {}
    for p in paths:
        data = json.load(io.open(p, encoding="utf-8"))
        for e in data:
            key = (e.get("src", ""), e.get("verb", ""), e.get("dst", ""))
            if not all(key) or not e.get("cite"):
                n_bad += 1; print("  跳过（缺字段）:", json.dumps(e, ensure_ascii=False)[:120]); continue
            if key in have:
                n_dup += 1; continue
            have.add(key); n_new += 1
            new_lines.append("  l('%s', '%s', '%s', '%s', %d, '%s', '%s');" % (
                esc(key[0]), esc(key[1]), esc(key[2]), esc(e["cite"]), int(e.get("lv") or 1), esc(e.get("note") or ""), esc(e.get("q") or "")))
            for node in (key[0], key[2]):
                if node.startswith("p:"):
                    persons_new.setdefault(node[2:], None)
    if new_lines:
        rows = rows.rstrip("\n") + ("\n" if rows.strip() else "") + "  // ── %s ──\n" % who + "\n".join(new_lines) + "\n"
    io.open(LINKS, "w", encoding="utf-8", newline="\n").write(head + rows + tail)
    print("新增 %d 行，重复 %d，跳过 %d → js/links.js" % (n_new, n_dup, n_bad))

    # persons.js
    if os.path.exists(PERSONS):
        ps = io.open(PERSONS, encoding="utf-8").read()
        known = set(re.findall(r"id: '((?:[^'\\]|\\.)*)'", ps))
    else:
        ps = ("// 人物表（非君主）：边表 p: 节点的登记处。id 即中文维基条目名（消歧义后正名），name 为显示名。\n"
              "// 由 tools/mining/links_merge.py 按边表出现顺序登记；生卒、简介日后补，本表不存政权归属\n"
              "// （一个人在不同年份属不同政权，背景由他挂着的事件的 d／y 推，见 docs/idea-graph.md）。\n"
              "export const PERSONS = [\n  // @persons-begin\n  // @persons-end\n];\n")
        known = set()
    add = [k for k in persons_new if k not in known]
    if add:
        lines = "".join("  { id: '%s', name: '%s' },\n" % (esc(k), esc(re.sub(r"\s*[（(][^（）()]*[）)]$", "", k))) for k in add)
        ps = ps.replace("  // @persons-end", lines + "  // @persons-end")
    io.open(PERSONS, "w", encoding="utf-8", newline="\n").write(ps)
    print("人物表 +%d（共 %d）→ js/persons.js" % (len(add), len(known) + len(add)))


if __name__ == "__main__":
    main()
