# -*- coding: utf-8 -*-
"""把独立复核的结果并进 docs/sources-<key>.json 的「复核」一栏。

复核与原稿考据**并列，不覆盖**：原稿的账是写稿时逐条核过的，复核是事后
另派人手拿着同样的句子重查一遍。两边打架就两边都摆出来——读者自己判，
比我替他判可靠。这也是本库对「出处」的一贯态度：不求一个权威口径，
求把分歧摆在明处。

输入是若干 JSON 数组（每条 {stop, claim, verdict, source_title, source_url, note}），
verdict 四档：证实／部分／存疑／未能核实。

用法：python tools/mining/merge_recheck.py <key> <json...>
"""
import io, json, os, sys
from collections import Counter

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
ORDER = {'部分': 1, '存疑': 2, '未能核实': 3, '证实': 4}


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    key, files = sys.argv[1], sys.argv[2:]
    path = os.path.join(ROOT, 'docs/sources-%s.json' % key)
    data = json.load(io.open(path, encoding='utf-8'))

    rows, seen = [], set()
    for f in files:
        d = json.load(io.open(f, encoding='utf-8'))
        for r in (d if isinstance(d, list) else d.get('claims', [])):
            k = (r.get('stop', ''), r.get('claim', ''))
            if k in seen:                     # 同一断言被两路都核到，留先到的那条
                continue
            seen.add(k)
            rows.append({
                'stop': r.get('stop', ''), 'claim': r.get('claim', ''),
                'verdict': r.get('verdict', '未能核实'),
                'source_title': r.get('source_title', ''),
                'source_url': r.get('source_url', ''),
                'note': r.get('note', ''),
            })
    # 排序：先摆站不住的。读的人最先要看见的是哪几句不能当真
    rows.sort(key=lambda r: (ORDER.get(r['verdict'], 9), r['stop']))
    data['复核'] = rows
    data['说明'] = (data.get('说明', '') +
                    '　复核共 %d 条，另派人手事后逐条重查所得。' % len(rows))
    io.open(path, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(data, ensure_ascii=False, indent=1))

    t = Counter(r['verdict'] for r in rows)
    print('并入 %s：复核 %d 条（%s）' % (path, len(rows),
          '、'.join('%s %d' % (k, t[k]) for k in sorted(t, key=lambda x: ORDER.get(x, 9)))))
    per = Counter(r['stop'] for r in rows if r['verdict'] != '证实')
    for s, n in per.most_common():
        print('  %-12s 待留意 %d 条' % (s, n))
    nourl = sum(1 for r in rows if not r['source_url'])
    if nourl:
        print('  · 无出处链接 %d 条（多为「未能核实」，属预期）' % nourl)
    return 0


if __name__ == '__main__':
    sys.exit(main())
