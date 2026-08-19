# -*- coding: utf-8 -*-
"""文物的两个点：从库内简注里抽出**出土地**与**现藏地**。

地图模式的评估把排期倒了过来（见 docs/idea-map.md）：不先做底图，先做这层数据。
理由是它不依赖地图就能验证价值——一件器物在地图上不是一个点而是两个，
「出土地 → 现藏地」本身就是流散叙事，正对上两岸故宫线与石窟线里
克孜尔壁画运柏林、藏经洞文书散落多国那几站。

**先从自己的散文里抽，而不是先去问 Wikidata**：实测库内 152 条文物中，
88 条的 `yc` 已写明现藏、73 条写明出土——比 Wikidata 的 P276 50%／P189 17%
覆盖得更好，因为那是当初一条条核着写下的。Wikidata 只作补漏与互校。

本脚本只做**抽取**，不做地理编码：产出的是地名字符串与出处（哪个字段、哪一句），
坐标另由 tools/mining/probe_coords.py 那条路解决。分两步是有意的——
抽错了地名，后面编码得再准也是错的，先让人能一眼核。

用法：python tools/mining/extract_places.py
产出：tools/mining/places.json（逐条：出土地／现藏地／出处片段／置信）
"""
import io, json, os, re, sys
from collections import Counter

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
OUT = os.path.join(ROOT, "tools/mining/places.json")
BS = chr(92)
FIELD = r"\b%s:\s*'((?:[^'" + BS + BS + r"]|" + BS + BS + r".)*)'"

# 现藏：动词在前，地名在后。「现藏于中国国家博物馆」「今藏大英图书馆」
HELD = re.compile(r'(?:现藏|現藏|今藏|藏于|藏於|收藏[于於]|现存[于於]|入藏)'
                  r'([\u4e00-\u9fff·（）()A-Za-z]{2,20}?(?:博物院|博物馆|美术馆|图书馆|研究院|'
                  r'纪念馆|文物局|考古所|大学|书院|寺|宫|院|馆))')
# 出土：抓到的必须像个**地方**。四类毛病是实测抽验出来的：
#   ① 量词残片被吞——「年长沙马王堆汉墓」（前面是「1972 年」）；
#   ② 器物名一并抓走——「朱然墓的漆木屐」「曾侯乙墓的战国早期青铜器」；
#   ③ 「出自」多半接的是作者不是地点——「出自南唐后主李煜手笔」「雷氏家族设计」；
#   ④ 泛指不成地点——「诸侯王墓」。
# 故：动词只认出土/发现（弃用「出自」），地名须以政区或遗迹字样收尾，
# 开头再削掉残留量词。宁可少抽，抽到的要能一眼核。
PLACE_TAIL = (r'(?:省|市|县|區|区|镇|乡|村|旗|盟|州|岛|屿|海域|遗址|遺址|墓地|墓|窖藏|'
              r'石窟|故城|古城|寺|塔|宫|陵|滩|坑|沟|山|原|地)')
FOUND = re.compile(r'(?:出土[于於]|发现[于於]|發現[於于])\s*'
                   r'([一-鿿]{2,20}?%s)' % PLACE_TAIL)
FOUND2 = re.compile(r'([一-鿿]{2,20}?%s)(?:出土|发现)(?![于於])' % PLACE_TAIL)
LEAD = re.compile(r'^(?:年|月|日|的|在|於|于)+')                    # 削掉被吞进来的量词残片
GENERIC = re.compile(r'^(?:诸侯王墓|王墓|墓|古墓|某墓|遗址|遺址|墓地)$')  # 泛指不算地点


def load(kinds=('art', 'her')):
    src = io.open(os.path.join(ROOT, 'js/events.js'), encoding='utf-8').read()
    rows = []
    for m in re.finditer(r'\{([^{}]*?y:\s*-?\d+[^{}]*?)\},', src):
        b = m.group(1)
        def g(k):
            mm = re.search(FIELD % k, b)
            return mm.group(1) if mm else None
        if g('k') in kinds and g('n'):
            rows.append({'n': g('n'), 'k': g('k'), 'w': g('w'), 'm': g('m'),
                         'y': int(re.search(r'y:\s*(-?\d+)', b).group(1)),
                         'yc': g('yc') or ''})
    return rows


def first(rx, text):
    mm = rx.search(text)
    if not mm:
        return None, None
    val = LEAD.sub('', mm.group(1))
    if len(val) < 2 or GENERIC.match(val):
        return None, None
    span = text[max(0, mm.start() - 12):mm.end() + 8]
    return val, span


def main():
    rows = load()
    out, stat = [], Counter()
    for r in rows:
        yc = r['yc']
        held, held_src = first(HELD, yc)
        found, found_src = first(FOUND, yc)
        if not found:
            found, found_src = first(FOUND2, yc)
        # 馆藏页的域名本身也是一条现藏线索，且比散文更硬
        dom = None
        if r.get('m'):
            mm = re.search(r'https?://([^/]+)', r['m'])
            dom = mm.group(1) if mm else None
        rec = {'n': r['n'], 'k': r['k'], 'y': r['y'], 'w': r['w']}
        if held:
            rec['held'] = held
            rec['held_src'] = held_src
        if found:
            rec['found'] = found
            rec['found_src'] = found_src
        if dom:
            rec['held_domain'] = dom
        out.append(rec)
        stat[r['k'] + ':held'] += 1 if held else 0
        stat[r['k'] + ':found'] += 1 if found else 0
        stat[r['k'] + ':both'] += 1 if (held and found) else 0
        stat[r['k'] + ':total'] += 1
        stat[r['k'] + ':domain'] += 1 if dom else 0

    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(out, ensure_ascii=False, indent=1))
    for k in ('art', 'her'):
        t = stat[k + ':total'] or 1
        print('%-4s 共 %3d｜现藏 %3d（%d%%）｜出土 %3d（%d%%）｜两者俱全 %3d（%d%%）｜有馆藏页 %3d'
              % (k, stat[k + ':total'],
                 stat[k + ':held'], 100 * stat[k + ':held'] // t,
                 stat[k + ':found'], 100 * stat[k + ':found'] // t,
                 stat[k + ':both'], 100 * stat[k + ':both'] // t,
                 stat[k + ':domain']))
    print('写出 %s' % OUT)


if __name__ == '__main__':
    main()
