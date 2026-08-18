# -*- coding: utf-8 -*-
"""生成 js/data-0b-lieguo.js —— 春秋战国列国君主（P2）。

输入：P2 工作流八路 agent 的结构化王表（scratchpad/lg_rows.json，
由主循环从 workflow journal 提取），每行 {t,n,wk,a,e,end_kind,tc,c,f,l,Y,no}。

本脚本只做**校验与格式转换**，不做任何史实判断——判断都在 agent 的
report 里、由主循环人工复核后才落到输入文件：
  · 年份「前N」→ BC 字符串（换算语义与 ingest.py 同源：只此一处）
  · end_kind: died→x（终年即卒年）；deposed/unknown→z（不虚构卒年，
    删失让统计层自己处理——齐王建迁共饿死、燕王喜下落这些都不该编年份）
  · Y:1 → F 旗 Y（斜纹）
  · 校验：tc 合法值、a≤e、落在该国允许区间、国内继位链空隙 >2 年告警、
    wk 非空、同国重名告警

末尾追加**秦王政**一条（qinguo 的末段，前247–前221）：这是秦交接方案的
另一半——'qin' 嬴政已删 r 字段，秦王期由本条承载，六国的 MERGED_INTO
才有活着的河道可汇入。无生卒、以 z 收尾，不进寿命统计；与秦朝嬴政为
同一人，本条使君主总数比实际人数多一（472 条 / 471 人），P4 的文案
处理这一句。
"""
import io, json, os, sys

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
SC = (r"C:/Users/ziyi_/AppData/Local/Temp/claude/C--Users-ziyi--Claude/"
      r"1fabfb86-a26a-4b09-be7f-6c753fa25f61/scratchpad")
OUT = os.path.join(ROOT, "js/data-0b-lieguo.js")

D_OF = {'晋': 'jinguo', '姜齐': 'jiangqi', '田齐': 'tianqi', '楚': 'chuguo',
        '秦': 'qinguo', '燕': 'yanguo', '吴': 'wuguo', '越': 'yueguo',
        '韩': 'hanguo', '赵': 'zhaoguo', '魏': 'weiguo', '宋': 'songguo', '郑': 'zhengguo'}
# 允许区间（BC 年，含卿段的前伸；出界即报错拒收）
RANGE = {'晋': (785, 345), '姜齐': (800, 375), '田齐': (390, 218), '楚': (795, 220),
         '秦': (782, 244), '燕': (870, 219), '吴': (590, 470), '越': (545, 328),
         '韩': (460, 227), '赵': (480, 225), '魏': (460, 221), '宋': (655, 635), '郑': (748, 698)}
HEAD = {'晋': '晋国（前780–前349）', '姜齐': '姜齐（约前794–前379）',
        '田齐': '田齐（前386–前221）', '楚': '楚国（前790–前223）',
        '秦': '秦国（前777–前221）', '燕': '燕国（前864–前222）',
        '吴': '吴国（前585–前473）', '越': '越国（约前538–前333）',
        '韩': '韩国（前453–前230）', '赵': '赵国（约前457–前228）', '魏': '魏国（前453–前225）',
        '宋': '宋国（仅收襄公，五霸补全）', '郑': '郑国（仅收庄公，五霸补全）'}

def bc(s):
    s = str(s).strip()
    if not s.startswith('前'):
        raise SystemExit('年份必须写「前N」：%r' % s)
    return int(s[1:])

def rec(state, r):
    d = D_OF[state]
    lo, hi = RANGE[state]
    a, e = bc(r['a']), bc(r['e'])
    if not (hi <= e <= a <= lo):
        raise SystemExit('%s %s 年份出界：%s–%s（允许 前%d–前%d）' % (state, r['t'], r['a'], r['e'], lo, hi))
    if r['tc'] not in ('王', '公', '侯', '子', '卿'):
        raise SystemExit('%s %s tc 非法：%r' % (state, r['t'], r['tc']))
    if not r.get('wk'):
        raise SystemExit('%s %s 缺 wk' % (state, r['t']))
    parts = ["n: '%s'" % r['n'], "t: '%s'" % r['t'], "d: '%s'" % d, "a: 'BC%d'" % a]
    if r.get('end_kind') == 'died':
        parts.append("x: 'BC%d'" % e)
    else:
        parts.append("z: 'BC%d'" % e)          # 被虏/被废/不明：不虚构卒年
        if r.get('x2'):                        # 离位后另有确切卒年（赵武灵王沙丘）
            parts.append("x: 'BC%d'" % bc(r['x2']))
    if r.get('c'): parts.append("c: %d" % r['c'])
    if r.get('f'): parts.append("f: 1")
    if r.get('l'): parts.append("l: 1")
    F = ('Y' if r.get('Y') else '') + ('N' if r.get('N') else '')
    if F: parts.append("F: '%s'" % F)
    parts.append("tc: '%s'" % r['tc'])
    parts.append("wk: '%s'" % r['wk'].replace("'", "\\'"))
    if r.get('no'): parts.append("no: '%s'" % r['no'].replace("'", "\\'"))
    return '  { %s },' % ', '.join(parts)

data = json.load(io.open(os.path.join(SC, 'lg_rows.json'), encoding='utf-8'))

lines = [
    '// 先秦 · 春秋战国列国（P2）。**由 tools/mining/gen_lieguo.py 生成**，手改会被覆盖。',
    '// 王表由八路 agent 按军规抓取（wk 逐一 API 核验、±1 口径差入注、锚源分段声明），',
    '// 校验与年份换算只在生成器一处做。Y 旗＝年代拟测（图上斜纹）。',
    'export default [',
]
warn = []
total = 0
for state in ['晋', '姜齐', '田齐', '楚', '秦', '燕', '吴', '越', '韩', '赵', '魏', '宋', '郑']:
    rows = data.get(state) or []
    if not rows:
        warn.append('%s 无数据！' % state); continue
    lines.append('  // ── %s ──────────────────────────────────────' % HEAD[state])
    prev_e = None
    seen = set()
    for r in rows:
        if r['t'] in seen: warn.append('%s 重名：%s' % (state, r['t']))
        seen.add(r['t'])
        a, e = bc(r['a']), bc(r['e'])
        if prev_e is not None and prev_e - a > 2:
            warn.append('%s 链隙 %d 年：…前%d → %s 前%d' % (state, prev_e - a, prev_e, r['t'], a))
        if prev_e is not None and a - prev_e > 2:
            warn.append('%s 重叠 %d 年：…前%d ↔ %s 前%d' % (state, a - prev_e, prev_e, r['t'], a))
        prev_e = e
        lines.append(rec(state, r))
        total += 1

# ── 秦王政：秦国河道的末段（见文件头注） ─────────────────────────────────────
lines.append('  // ── 秦国 → 秦朝的交接段 ──────────────────────────')
lines.append("  { n: '嬴政（秦王期）', t: '秦王政', d: 'qinguo', a: 'BC247', z: 'BC221', tc: '王', wk: '秦始皇', "
             "no: '即秦朝嬴政的秦王期（前247–前221），为河道连续单列一条；前221并六国后称皇帝，见秦朝。"
             "本条无生卒、不入寿命统计——君主总数因此比实际人数多一' },")
total += 1
lines.append('];')
io.open(OUT, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')
print('写出 %s：%d 条（含秦王政）' % (OUT, total))
for w in warn:
    print('  ⚠ ' + w, file=sys.stderr)
