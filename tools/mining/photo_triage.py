# -*- coding: utf-8 -*-
"""三层分拣（2026-08-21 库主定纲）：闸1 账面 -> L1/L2/L3，零 token。

L1 必过闸2 = 需求表关键词命中（cat+what）且 keep=true，外加「说明牌伴读」
  （命中行前后正负3位内的说明牌/展板行）；需求命中不限段——demand-driven 是纲。
L2 备胎 = 库主择段内 keep=true 而未命中者，按路封存，L1 未达目标时按路启用。
L3 不看 = keep=false，或段外无命中。

词表即需求表：改需求先改这里，跑完把 docs/desk/photo-triage-3layer.json 重写。
已过闸2的路（样片与旧批）在 DONE 里，不再进漏斗。
"""
import io, json, glob, re
from collections import Counter

DONE = {'longmen-e','longmen-g','suining-a','suining-b','suining-c','suining-d','suining-e','suining-f','gugong','misc'}
CHOSEN = {'longmen-a','longmen-d','longmen-f',
          'luoyang-b','luoyang-c','luoyang-h','luoyang-i','luoyang-j',
          'luoyang-l','luoyang-a',
          'chengdu-b','chengdu-c','chengdu-g'}
DEMANDS = [
 ('D1石窟线升级',   '卢舍那|奉先寺|迦叶|阿难|宾阳|万佛洞|古阳|莲花洞|药方洞|二十品|题记|造像记|香山寺|白园|看经寺|擂鼓台|伊阙'),
 ('D2身后之言胚',   '白居易|墓志|墓碑|神道|石碑|碑刻|墓表'),
 ('D3演艺线',      '皮影|木偶|傀儡|戏俑|说唱|俳优|乐舞|舞俑|乐俑|杂技|百戏|戏台|戏楼|优伶|戏曲'),
 ('D4香火线',      '关帝|关林|城隍|钟馗|香炉|祭祀|祠|买地券|镇墓'),
 ('D5应天门洛阳城', '应天门|天堂|明堂|定鼎门|里坊|城墙|洛阳城|城门遗址'),
 ('D6成都三案',    '石犀|犀牛|老官山|织机|提花|经穴|漆人|蜀王府|明蜀|交子'),
 ('D7批十一配图',  '蹴鞠|货郎|麻将|骨牌|剪纸|春牛|岁时|年画'),
]
PLATE = re.compile('说明牌|展板|标题|前言|图版|铭牌')

def main():
    demands = [(t, re.compile(p)) for t, p in DEMANDS]
    rows_all = []
    for f in sorted(glob.glob('docs/desk/photo-gate1-*.json')):
        key = f.split('photo-gate1-')[1].replace('.json', '')
        if key in DONE:
            continue
        d = json.load(io.open(f, encoding='utf-8'))
        for i, r in enumerate(d['rows']):
            rows_all.append({'route': key, 'idx': i, 'file': r['file'],
                             'cat': r.get('cat', ''), 'what': r.get('what', ''),
                             'keep': bool(r.get('keep')), 'faces': bool(r.get('faces'))})
    by_route = {}
    for r in rows_all:
        by_route.setdefault(r['route'], []).append(r)
    for r in rows_all:
        text = r['cat'] + ' ' + r['what']
        hits = [t for t, p in demands if p.search(text)]
        if hits and r['keep']:
            r['layer'] = 1
            r['demand'] = '+'.join(hits)
    for route, rs in by_route.items():
        l1_idx = [r['idx'] for r in rs if r.get('layer') == 1]
        for r in rs:
            if r.get('layer') is None and r['keep'] and PLATE.search(r['cat'] + ' ' + r['what']):
                if any(abs(r['idx'] - j) <= 3 for j in l1_idx):
                    r['layer'] = 1
                    r['demand'] = '说明牌伴读'
    for r in rows_all:
        if r.get('layer') is None:
            r['layer'] = 2 if (r['route'] in CHOSEN and r['keep']) else 3
    c = Counter(r['layer'] for r in rows_all)
    print('L1=%d L2=%d L3=%d 总%d' % (c[1], c[2], c[3], len(rows_all)))
    out = {'说明': '三层分拣：L1 必过闸2（需求命中+说明牌伴读）；L2 择段备胎；L3 不看。词表与规则正本在 tools/mining/photo_triage.py',
           'rows': rows_all}
    json.dump(out, io.open('docs/desk/photo-triage-3layer.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('写出 docs/desk/photo-triage-3layer.json')

if __name__ == '__main__':
    main()
