# -*- coding: utf-8 -*-
"""动态信息季度体检（2026-09-01 冻结案立）。

两轮机制：
  常规轮（确定性）——扫 `dyn: 'YYYY-MM'` 登记牌，距今超一季的列出候复核；
  引导轮（启发式）——扫 yc/yl 内会过期的词，列出**尚未打 dyn 牌**的候选条，
  人审后补牌。词单抓的是「写下时为真、日后会变」的表述。

季度跑一次：PYTHONIOENCODING=utf-8 python tools/scan_dynamic.py
"""
import io, os, re, sys
from datetime import date

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = io.open(os.path.join(ROOT, "js/events.js"), encoding="utf-8").read()
body = s[s.index("export const EVENTS = ["):]

WORDS = ['申报中', '正在申报', '正联合', '至今仍', '至今没有', '延续至今', '挂周期体检',
         '尚未定案', '候后续', '正在争议', '仍在争议', '归属争议', '腾退', '在建',
         '本轮未核', '未能核实', '候补', '待核']

today = date.today()
overdue, tagged, candidates = [], [], []
for ln in body.splitlines():
    t = ln.strip()
    if not t.startswith("{ y:"):
        continue
    n = re.search(r"n: '([^']+)'", t)
    name = n.group(1) if n else t[:30]
    d = re.search(r"dyn: '(\d{4})-(\d{2})'", t)
    if d:
        yy, mm = int(d.group(1)), int(d.group(2))
        months = (today.year - yy) * 12 + (today.month - mm)
        tagged.append((name, d.group(0), months))
        if months >= 3:
            overdue.append((name, '%d-%02d' % (yy, mm), months))
    else:
        hits = [w for w in WORDS if w in t]
        if hits:
            candidates.append((name, hits[:4]))

print("=== dyn 登记牌 %d 条 ===" % len(tagged))
for name, tag, m in tagged:
    print("  %s %s（%d 个月前）" % (name, tag, m))
print()
print("=== 超一季候复核 %d 条 ===" % len(overdue))
for name, ym, m in overdue:
    print("  ✗ %s 上次核查 %s（%d 个月）" % (name, ym, m))
print()
print("=== 引导轮：含过期风险词而未打牌 %d 条（人审后补 dyn 牌） ===" % len(candidates))
for name, hits in candidates:
    print("  ? %-24s %s" % (name, '/'.join(hits)))
