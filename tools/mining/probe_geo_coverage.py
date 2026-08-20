# -*- coding: utf-8 -*-
"""量一下：库里有多少条目，它自己的维基页就带主坐标。

写出 docs/geo-events-probe.json，供 build_geo_events.py 当「自动」那一路的输入。

**这只是探测，不是数据。** 一个条目的维基页带坐标，不等于这个坐标就该画在
这条目上——文物条目的维基页讲的是「器」不是「地」，坐标多半指向现藏的博物馆。
该不该用、该用出土地还是现藏地，是策展判断，走 events.js 里手写的 `p` 字段。

取坐标的活全部交给 build_geo_events.coords_of()，本脚本不自己发请求：
上一版自己抄了一份，抄坏了（见那个函数的注释），从此不许有第二份。

用法：python tools/mining/probe_geo_coverage.py [每批条数] [每批间隔秒]
      默认 40 条 / 1.2 秒——慢，但打不出 429。
"""
import collections, io, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_geo_events import ROOT, coords_of, load_events  # noqa: E402

LB = {'her': '遗址·建筑', 'art': '文物', 'cul': '文化·科技', 'gov': '制度',
      'war': '战事', 'rev': '民变', 'out': '外患·外交', 'fig': '名人轶事',
      'era': '治世·中兴', 'inst': '制度存续', 'dis': '灾疫'}


def main():
    chunk = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    pace = float(sys.argv[2]) if len(sys.argv) > 2 else 1.2
    evs = [e for e in load_events() if e['w']]
    titles = [e['w'] for e in evs]

    def tick(done, total, hits):
        sys.stderr.write('  %d/%d 已查，命中 %d\n' % (done, total, hits))
        sys.stderr.flush()

    got = coords_of(titles, pace=pace, chunk=chunk, log=tick)

    hit = {e['n']: got[e['w']] for e in evs if e['w'] in got}
    print('全库 %d 条（有维基页的 %d 条），带主坐标 %d 条（%.0f%%）\n'
          % (len(load_events()), len(evs), len(hit), 100.0 * len(hit) / len(evs)))
    byk, hk = collections.Counter(), collections.Counter()
    for e in evs:
        byk[e['k']] += 1
        if e['n'] in hit:
            hk[e['k']] += 1
    for k, c in byk.most_common():
        print('  %-10s %3d 条，带坐标 %3d（%3.0f%%）' % (LB.get(k, k), c, hk[k], 100.0 * hk[k] / c))

    io.open(os.path.join(ROOT, 'docs/geo-events-probe.json'), 'w',
            encoding='utf-8', newline='\n').write(json.dumps({
        '说明': ('库内条目的 zhwiki 主坐标探测，由 tools/mining/probe_geo_coverage.py 生成。'
                 '**探测用，不是数据**：维基页带坐标不等于这个坐标该画在这条目上——'
                 '文物条目讲的是器不是地，坐标多半指向现藏的博物馆。'
                 '该不该用、用出土地还是现藏地，是策展判断，走 events.js 的 `p` 字段。'),
        '总条目': len(load_events()), '有维基页': len(evs), '带坐标': len(hit),
        '点': {e['n']: {'w': e['w'], 'k': e['k'], '点': list(hit[e['n']])}
               for e in evs if e['n'] in hit},
    }, ensure_ascii=False, indent=1))
    print('\n写出 docs/geo-events-probe.json')


if __name__ == '__main__':
    main()
