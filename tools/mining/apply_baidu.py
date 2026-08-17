# -*- coding: utf-8 -*-
"""把两批百度链接核验的结果写回 events.js。

## 为什么会积到 112 条坏链

维基那一侧有 CORS，本项目一路都在机器核（今天就核了三遍）。**百度这一侧从来
没有**——它没有 CORS 接口，链接是盲发的：代码直接拼 `baike.baidu.com/item/<名字>`，
对不对全靠人工抽查。于是错了很久也没人知道，实测 725 条里坏 112 条（15.4%）。

两个 agent 各自发现：WebFetch 与 curl 一律被百度 403 挡回，**唯一可行的探法是
在已经停在 baike.baidu.com 的浏览器标签页里同源 fetch**。这一条记下来，
以后再核不必重新摸索。

## 三类系统性病因（都是机械可改的）

一、**维基的消歧义后缀漏进了 URL**：`石鼓 (先秦)`、`李密 (隋朝)`、
    `玉壁之战 (546年)` 一律 404。本脚本之外另在 knowledge.js 里加了兜底剥离。
二、**掌机游戏《物华弥新》给著名青铜器加了角色词条**，把 利簋、毛公鼎、
    皇后之玺、长信宫灯 挤成了消歧义页。加朝代前缀（`西周利簋`）每次都能解决。
    这一类项目笔记里此前完全没有记载。
三、**繁体字多数能重定向、但不是全部**：`散氏盤`、`景雲鐘`、`七女為父報仇`
    都 404，而另外六十来条繁体名却落得好好的——不能想当然。

## 两种处理

`fix` 有值   → 写进 `b` 字段（`spec.baidu || spec.title`，`b` 优先）
`fix` 为空   → 打 `nb: 1`，**把百度按钮整个藏掉**。百度确实没有这个词条，
              给一个明知打不开的链接，不如不给。
"""
import io, json, os, re, sys
from collections import Counter

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
SCRATCH = (r"C:/Users/ziyi_/AppData/Local/Temp/claude/C--Users-ziyi--Claude/"
           r"1fabfb86-a26a-4b09-be7f-6c753fa25f61/scratchpad")
EVENTS = os.path.join(ROOT, "js/events.js")

dec = {}
for f in ["baidu_early.json", "baidu_late.json"]:
    for r in json.load(io.open(os.path.join(SCRATCH, f), encoding="utf-8")):
        dec[r["n"]] = r

src = io.open(EVENTS, encoding="utf-8").read()
cut = src.index("export const EVENTS")
head, body = src[:cut], src[cut:]

out, fixed, hidden, untouched, unknown = [], 0, 0, 0, []
for ln in body.split("\n"):
    m = re.match(r"^(  \{ )(.*?)(,?\s*\},?)$", ln)
    if not m:
        out.append(ln)
        continue
    inner = m.group(2)
    mn = re.search(r"n: '([^']+)'", inner)
    if not mn:
        out.append(ln)
        continue
    d = dec.get(mn.group(1))
    if not d:
        unknown.append(mn.group(1))
        out.append(ln)
        continue
    if d["verdict"] == "ok":
        untouched += 1
        out.append(ln)
        continue
    # 重跑时先清掉上一次写的
    inner = re.sub(r",\s*b: '[^']*'", "", inner)
    inner = re.sub(r",\s*nb: 1", "", inner)
    inner = inner.rstrip().rstrip(",")
    if d.get("fix"):
        inner += ", b: '%s'" % d["fix"].replace("'", "\\'")
        fixed += 1
    else:
        inner += ", nb: 1"
        hidden += 1
    out.append("%s%s }," % (m.group(1), inner))

io.open(EVENTS, "w", encoding="utf-8", newline="\n").write(head + "\n".join(out))
print("改写 %d 条（补 b 字段 %d、藏百度按钮 %d），本就正常的 %d 条未动"
      % (fixed + hidden, fixed, hidden, untouched))
if unknown:
    print("！核验结果里没有的条目 %d 条：%s" % (len(unknown), unknown[:6]), file=sys.stderr)
