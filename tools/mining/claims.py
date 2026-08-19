# -*- coding: utf-8 -*-
"""从长文里抽出**可核的硬断言**，并标出哪些已有考据管着。

这是核验流水线的第一段，**不派 agent**（见 docs/idea-storylines.md 八之四）。
石窟线一次核 145 条烧了约 62 万 subagent token，其中大半是机械活：
数字比对、算术、以及重核那些原稿考据里已经写明出处的句子。本脚本把这两样
从 agent 手里拿回来，只把**真正没人管过的断言**递出去。

抽三类（一句里可能同时命中多类，按句去重）：
    数    汉字数字与阿拉伯数字（年份、尺寸、件数、卷数、工时、金额）
    引    「」括起来的逐字引文
    名    人名／书名／机构名后紧跟数字或断言的（较弱，仅作提示）

覆盖判定：一条断言若与某条考据（或本库简注）**共享足够多的数字与专名**，
即认为已有人管过。判定宁松勿紧——漏判只是多派一次核，误判会让真问题溜过去。

用法：
    python tools/mining/claims.py shiku            # 打印待核清单
    python tools/mining/claims.py shiku --json out.json
"""
import io, json, os, re, sys
from collections import Counter

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_line_doc import load_long, load_events, load_sources, load_line  # noqa: E402

# 汉字数字（含「〇」与位值字），阿拉伯数字，以及百分比、点数
CJK_NUM = '〇零一二三四五六七八九十百千万亿两'
NUM = re.compile(r'[%s]{2,}|\d[\d.,]*' % CJK_NUM)
QUOTE = re.compile(r'「([^」]{2,60})」')
# 专名：连续汉字里带《》的书名，或 2–6 字后接「寺／窟／院／馆／帝／师／王」等
TITLE = re.compile(r'《[^》]{1,20}》')
SENT = re.compile(r'[^。！？；\n]+[。！？；]?')

# 汉字数字 → 值。只求够用：断言比对靠的是**字面共现**，不是算术
CN2AR = {c: i for i, c in enumerate('〇一二三四五六七八九')}
CN2AR.update({'零': 0, '两': 2})


def cn_digits(s):
    """把一串汉字数字拆成它包含的阿拉伯位（三八六 → {3,8,6}），供跨写法比对。"""
    return {str(CN2AR[c]) for c in s if c in CN2AR}


def fingerprint(text):
    """一句话的指纹：出现过的数字（两种写法都归一）＋ 书名。"""
    fp = set()
    for m in NUM.finditer(text):
        t = m.group(0)
        if t[0].isdigit():
            fp.add(t.replace(',', ''))
            fp |= set(t.replace(',', '').replace('.', ''))
        else:
            fp |= cn_digits(t)
            fp.add(t)
    fp |= {m.group(0) for m in TITLE.finditer(text)}
    return fp


def sentences(paras):
    for p in paras:
        for m in SENT.finditer(p):
            s = m.group(0).strip()
            if len(s) >= 6:
                yield s


def main():
    key = sys.argv[1] if len(sys.argv) > 1 else 'shiku'
    _, stops = load_line(key)
    pro, text, epi = load_long(key)
    ev = load_events()
    srcs = load_sources(key)
    per = srcs.get('站', {})
    done = {(r.get('stop'), r.get('claim')) for r in srcs.get('复核', [])}

    blocks = []
    if pro:
        blocks.append(('序', pro['p']))
    for s in stops:
        n = s['ev'] or ''
        if text.get(n):
            blocks.append((n, text[n]))
    if epi:
        blocks.append(('落点', epi['p']))

    out, stat = [], Counter()
    for name, paras in blocks:
        rec = per.get(name) or {}
        # 已有的「管过」文本：考据条目 ＋ 本库简注 ＋ 引文出处
        covered = [k.get('文', '') for k in rec.get('考据', [])]
        covered.append((ev.get(name) or {}).get('yc') or '')
        cov_fp = set()
        for c in covered:
            cov_fp |= fingerprint(c)
        cov_txt = ''.join(covered)

        for s in sentences(paras):
            fp = fingerprint(s)
            q = QUOTE.findall(s)
            if not fp and not q:
                continue                       # 没数字没引文，不算硬断言
            stat['抽出'] += 1
            # 覆盖：数字指纹被考据吃掉大半，或引文原样出现在考据里
            hit = len(fp & cov_fp)
            ratio = hit / len(fp) if fp else 1.0
            q_cov = all(x in cov_txt for x in q) if q else True
            if ratio >= 0.6 and q_cov:
                stat['已有考据管'] += 1
                continue
            if any(name == a and s[:20] in (b or '') for a, b in done):
                stat['已复核'] += 1
                continue
            stat['待核'] += 1
            out.append({'stop': name, 'claim': s,
                        '数字': sorted(x for x in fp if not x.startswith('《')),
                        '引文': q,
                        '考据覆盖率': round(ratio, 2)})

    print('%s：抽出硬断言 %d 句｜已有考据管 %d｜已复核 %d｜**待核 %d**'
          % (key, stat['抽出'], stat['已有考据管'], stat['已复核'], stat['待核']))
    per_stop = Counter(r['stop'] for r in out)
    for k, n in per_stop.most_common():
        print('  %-12s %d' % (k, n))
    if '--json' in sys.argv:
        p = sys.argv[sys.argv.index('--json') + 1]
        io.open(p, 'w', encoding='utf-8', newline='\n').write(
            json.dumps(out, ensure_ascii=False, indent=1))
        print('写出 %s' % p)
    else:
        for r in out[:24]:
            print('  · [%s] %s' % (r['stop'], r['claim'][:56]))
        if len(out) > 24:
            print('  …另 %d 条（加 --json 出全表）' % (len(out) - 24))


if __name__ == '__main__':
    main()
