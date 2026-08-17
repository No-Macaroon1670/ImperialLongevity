# -*- coding: utf-8 -*-
"""把馆藏页核验结果写进 events.js 的 `m` 字段。

`m` 是文物条目里**最硬的一档来源**:百科是二手的转述,馆藏页是持有机构对
自己那件东西的著录——尺寸、文物号、出土地点、断代依据都在那里。河南博物院
那套页面就是范本。

与 apply_baidu.py 的区别:那边是「链接坏了要修」,这边是「本来就没有要补」,
所以不动任何既有字段,只加。found=false 的原样跳过——没找到就是没找到,
`note` 里写着试过哪些机构,留给下一轮。

    python apply_museum.py museum_early.json museum_late.json
"""
import io, json, os, re, sys

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
EV = os.path.join(ROOT, "js/events.js")

rec = {}
for path in sys.argv[1:]:
    for r in json.load(io.open(path, encoding="utf-8")):
        if not r.get("found") or not r.get("url"):
            continue
        if "'" in r["url"]:                       # 单引号会拆掉字面量
            print("  ! %s 的 url 带单引号,跳过" % r["n"], file=sys.stderr); continue
        rec[r["n"]] = r

src = io.open(EV, encoding="utf-8").read()
cut = src.index("export const EVENTS")
head, body = src[:cut], src[cut:]

out, added, replaced, unmatched = [], 0, 0, set(rec)
for ln in body.split("\n"):
    m = re.match(r"^(  \{ )(.*?)(\s*\},?)$", ln)
    mn = re.search(r"n: '([^']*)'", ln) if m else None
    if not mn or mn.group(1) not in rec:
        out.append(ln); continue
    unmatched.discard(mn.group(1))
    inner, url = m.group(2), rec[mn.group(1)]["url"]
    if re.search(r"\bm: '", inner):
        inner = re.sub(r"m: '[^']*'", "m: '%s'" % url, inner); replaced += 1
    else:
        # 放在 yc 之前、r 之后都行,但要落在一个稳定的位置:紧跟 b/nb,
        # 与 merge_batch.py 的 ORDER 一致
        mm = re.search(r"(,\s*)(yc: ')", inner)
        if mm:
            inner = inner[:mm.start()] + ", m: '%s'" % url + inner[mm.start():]
        else:
            inner = inner.rstrip().rstrip(",") + ", m: '%s'" % url
        added += 1
    out.append("%s%s }," % (m.group(1), inner))

io.open(EV, "w", encoding="utf-8", newline="\n").write(head + "\n".join(out))
print("补馆藏页 %d 条,覆盖既有 %d 条" % (added, replaced))
if unmatched:
    print("! 核验结果里有 %d 条在库中找不到同名条目:%s"
          % (len(unmatched), "、".join(sorted(unmatched))), file=sys.stderr)
