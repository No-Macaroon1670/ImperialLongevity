# -*- coding: utf-8 -*-
"""故事线散文的稿本往返：js/line-text-<key>.js ⇄ docs/text-<key>.md。

为什么（库主 2026-09-04）：长文正本是 JS 里一段段拼接的字符串，人手改一处要顾引号、加号与转义，
改故事线用词因此「挺麻烦」。稿本是普通 Markdown：一个 `## 序 …`、每站一个 `## 站 …`、一个 `## 落点 …`，
下面就是段落，加粗照旧 **…**，「」照旧。库主在 GitHub 网页、VS Code、Obsidian 或手机上改稿本，
主循环跑 import 转回 JS，再 build_line 重出页面。**稿本是正本，JS 由它生成**（自本工具落地起）。

用法：
    python tools/mining/line_text_io.py export <key>   # JS → docs/text-<key>.md（首次建稿本或 JS 另有改动时同步）
    python tools/mining/line_text_io.py import <key>   # docs/text-<key>.md → JS（站名键、段数对账，改坏会拦）
    python tools/mining/line_text_io.py check  [<key>] # 往返自检：export→import 后 JS 语义不变
    python tools/mining/line_text_io.py export all      # 全部线

对账（import 时）：① 站名键集合与顺序须与现 JS 一致（增删站是 lines.js 的事，不在稿本里做；
要改站名须先改 lines.js）；② 每站至少一段、段内无空串；③ 串内 ASCII 单引号与反斜杠自动转义；
④ 段数变化只报不拦。JS 头部的 `//` 注释块原样保留。
读 JS 用 node 真解析（ESM import），不用正则猜。
"""
import io, json, os, re, subprocess, sys

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
IDENT = re.compile(r"^[A-Za-z_$\u4e00-\u9fff][\w$\u4e00-\u9fff]*$")


def js_path(key):
    return os.path.join(ROOT, "js", "line-text-%s.js" % key)


def md_path(key):
    return os.path.join(ROOT, "docs", "text-%s.md" % key)


def load_js(key):
    js = ("import { pathToFileURL } from 'node:url';"
          "const m = await import(pathToFileURL(process.argv[1]).href);"
          "process.stdout.write(JSON.stringify({PROLOGUE: m.PROLOGUE, TEXT: m.TEXT, EPILOGUE: m.EPILOGUE}));")
    p = subprocess.run(["node", "--input-type=module", "-e", js, js_path(key)], cwd=ROOT, capture_output=True)
    if p.returncode:
        raise SystemExit(p.stderr.decode("utf-8", "replace"))
    return json.loads(p.stdout.decode("utf-8"))


def header_of(key):
    """JS 文件头部的 // 注释块（到第一个非注释非空行为止），原样保留。"""
    out = []
    for ln in io.open(js_path(key), encoding="utf-8").read().split("\n"):
        if ln.startswith("//") or not ln.strip():
            out.append(ln)
        else:
            break
    while out and not out[-1].strip():
        out.pop()
    return "\n".join(out)


def export(key):
    d = load_js(key)
    L = ["# %s 稿本" % key, "",
         "> 这份 Markdown 是这条线散文的**正本**（2026-09-04 起）。改完跑 `python tools/mining/line_text_io.py import %s`，" % key,
         "> 再 `python tools/mining/build_line.py %s` 重出页面。" % key,
         "> 规矩：`##` 行是站名键，别改（增删站在 lines.js）；段落之间空一行，一段内别手动换行；加粗 **…**；「」只留真引文；",
         "> 不写 ASCII 单引号以外的 JS 记号，转义由脚本管。", ""]
    L += ["## 序 " + d["PROLOGUE"]["t"], ""]
    for para in d["PROLOGUE"]["p"]:
        L += [para, ""]
    for k, paras in d["TEXT"].items():
        L += ["## 站 " + k, ""]
        for para in paras:
            L += [para, ""]
    L += ["## 落点 " + d["EPILOGUE"]["t"], ""]
    for para in d["EPILOGUE"]["p"]:
        L += [para, ""]
    io.open(md_path(key), "w", encoding="utf-8", newline="\n").write("\n".join(L).rstrip("\n") + "\n")
    print("→ docs/text-%s.md（序 %d 段、%d 站、落点 %d 段）" % (key, len(d["PROLOGUE"]["p"]), len(d["TEXT"]), len(d["EPILOGUE"]["p"])))


def parse_md(key):
    src = io.open(md_path(key), encoding="utf-8").read()
    pro = {"t": None, "p": []}; epi = {"t": None, "p": []}; text = {}; order = []
    cur = None
    for block in re.split(r"\n\s*\n", src):
        block = block.strip("\n")
        if not block.strip():
            continue
        if block.startswith("## "):
            head = block[3:].strip()
            if head.startswith("序 "):
                pro["t"] = head[2:].strip(); cur = pro["p"]
            elif head.startswith("落点 "):
                epi["t"] = head[3:].strip(); cur = epi["p"]
            elif head.startswith("站 "):
                k = head[2:].strip(); text[k] = []; order.append(k); cur = text[k]
            else:
                raise SystemExit("稿本标题不认得：%s（只认 ## 序／## 站／## 落点）" % head)
            continue
        if block.startswith("# ") or block.startswith(">"):
            continue                                   # 文件题与说明引文
        if cur is None:
            raise SystemExit("段落出现在第一个 ## 之前：%s" % block[:40])
        para = "".join(ln.strip() for ln in block.split("\n"))   # 软换行合一段
        if not para:
            continue
        cur.append(para)
    return pro, text, order, epi


def esc(s):
    return s.replace("\\", "\\\\").replace("'", "\\'")


def emit_paras(paras):
    return "".join("    '%s',\n" % esc(p) for p in paras)


def import_(key):
    pro, text, order, epi = parse_md(key)
    cur = load_js(key)
    if list(cur["TEXT"].keys()) != order:
        raise SystemExit("站名键与现 JS 不一致——稿本 %s ／JS %s；增删改站名请先改 lines.js 与 JS，再 export 重建稿本"
                         % (order, list(cur["TEXT"].keys())))
    for k in order:
        if not text[k]:
            raise SystemExit("站「%s」没有段落" % k)
    if not pro["p"] or not epi["p"] or pro["t"] is None or epi["t"] is None:
        raise SystemExit("序或落点缺标题或段落")
    changed = []
    for k in order:
        if text[k] != cur["TEXT"][k]:
            changed.append("%s（%d→%d 段）" % (k, len(cur["TEXT"][k]), len(text[k])))
    if pro["p"] != cur["PROLOGUE"]["p"] or pro["t"] != cur["PROLOGUE"]["t"]:
        changed.append("序")
    if epi["p"] != cur["EPILOGUE"]["p"] or epi["t"] != cur["EPILOGUE"]["t"]:
        changed.append("落点")
    head = header_of(key)
    body = ["", "/** 序 */", "export const PROLOGUE = {", "  t: '%s'," % esc(pro["t"]), "  p: [", emit_paras(pro["p"]).rstrip("\n"), "  ],", "};", "",
            "/** 各站的长文，键即站点在 lines.js 里的 `ev`。由 docs/text-%s.md 稿本经 tools/mining/line_text_io.py import 生成，改文字请改稿本。 */" % key,
            "export const TEXT = {"]
    for k in order:
        kk = k if IDENT.match(k) else "'%s'" % esc(k)
        body += ["  %s: [" % kk, emit_paras(text[k]).rstrip("\n"), "  ],"]
    body += ["};", "", "/** 落点 */", "export const EPILOGUE = {", "  t: '%s'," % esc(epi["t"]), "  p: [", emit_paras(epi["p"]).rstrip("\n"), "  ],", "};", ""]
    io.open(js_path(key), "w", encoding="utf-8", newline="\n").write(head + "\n" + "\n".join(body))
    after = load_js(key)
    assert after["TEXT"] == text and after["PROLOGUE"] == pro and after["EPILOGUE"] == epi, "写回后再读不一致（转义问题？）"
    print("→ js/line-text-%s.js 重生成；改动：%s" % (key, "、".join(changed) if changed else "无"))


def check(key):
    before = load_js(key)
    export(key)
    import_(key)
    after = load_js(key)
    ok = before == after
    print("往返自检 %s：%s" % (key, "一致" if ok else "不一致！"))
    return ok


def all_keys():
    return sorted(f[len("line-text-"):-3] for f in os.listdir(os.path.join(ROOT, "js")) if f.startswith("line-text-") and f.endswith(".js"))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    keys = all_keys() if (len(sys.argv) < 3 or sys.argv[2] == "all") else [sys.argv[2]]
    if cmd == "export":
        for k in keys: export(k)
    elif cmd == "import":
        for k in keys: import_(k)
    elif cmd == "check":
        bad = [k for k in keys if not check(k)]
        print("全部一致" if not bad else "不一致：%s" % bad)
    else:
        raise SystemExit(__doc__)
