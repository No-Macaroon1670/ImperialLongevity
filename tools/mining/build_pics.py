# -*- coding: utf-8 -*-
"""把选定的配图连同署名做成 docs/pics-<key>.json 与 js/pics.js。

**选哪一张是策展判断，写在这里；许可与署名是事实，从 Commons 抓。**
两者分开的理由：前者会随文案改，后者不该由人手抄——手抄的署名迟早会错，
而 CC-BY／CC-BY-SA 的署名要求是硬的，错了就是侵权，不是「差不多」。

选图的准绳（用户定的）：**这张图就是这段话在讲的那个东西**。
条目首图不算——那张事件卡上已经有了，再来一张只是重复。
故金刚经那站配卷首扉画（不是莫高窟外景），藏经洞那站配伯希和在洞里挑卷的
照片（不是洞窟外观），克孜尔那站配一块**已经在美国博物馆里**的壁画残片
——那正是那一段在讲的事。

`卡` 决定这张图进不进讲解卡：不是每站都进，只有图即主语的站才进（用户指定）。
长文页不受这个限制，那是读物，图多一些无妨。

用法：python tools/mining/build_pics.py <key>
读：tools/mining/pic_candidates.json（许可与署名）
写：docs/pics-<key>.json、js/pics.js
"""
import io, json, os, re, sys, glob

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"

# 站 → (Commons 文件名, 进不进讲解卡, 一句配文/替代文本)
PICKS = {
    'shiku': {
        # 传说那一段，图只能给寺——故不进卡，只进长文页
        '白马寺': ('2011-06 White Horse Temple 03.jpg', False, '洛阳白马寺'),
        # **进卡**：这一段讲壁画被从墙上割走运往欧美，而这就是其中一块，
        # 现在在堪萨斯城。图与文说的是同一件事
        '克孜尔石窟': ('Fragments of Buddhist Wall Painting, Kyzil, Sinkiang, China, '
                       'Central Asian art, 6th century - Nelson-Atkins Museum of Art - DSC09161.JPG',
                       True, '克孜尔壁画残片，现藏堪萨斯城纳尔逊-阿特金斯艺术博物馆'),
        '敦煌石窟': ('莫高窟九层楼 - panoramio.jpg', False, '莫高窟九层楼'),
        # **进卡**：崖面与泥塑同框，正是「石太酥、改塑泥」「洞开在离地数十米处」那两句
        '麦积山石窟': ('Majishan huge sculptures 20090226.jpg', True, '麦积山崖面上的大型造像'),
        # **进卡**：文里点名第二十窟，图就是它
        '云冈石窟': ('Cave 20, Yungang Grottoes.jpg', True, '云冈第二十窟大佛，前壁已塌，坐在露天里'),
        # **进卡**：文里点名奉先寺卢舍那
        '龙门石窟': ('Ancient Buddhist Grottoes at Longmen- Fengxian Temple, '
                     'Colossal Statue of Vairocana.jpg', True, '龙门奉先寺卢舍那大像'),
        # **不进卡**：那一段讲的是第三窟的取经图（猴形行者与白马），
        # 而 Commons 上没有那铺壁画。拿峡谷外景去配会误导，故只作长文页的地景
        '榆林窟': ('Yulin Caves Jiuquan Gansu China 酒泉 楡林窟 - panoramio (1).jpg',
                   False, '榆林河峡谷。文中所述第三窟取经图未见于可用许可的图源'),
        '峨眉山乐山大佛': ('Giant Buddha of Leshan.jpg', True, '乐山大佛'),
        # **进卡**：整条线上最该有图的一站——文里点到编号，图就是那一卷的卷首
        '金刚经印本': ('Diamond Sutra of 868 AD - The Diamond Sutra (868), '
                       'frontispiece and text - BL Or. 8210-P.2.jpg',
                       True, '咸通九年《金刚经》卷首扉画与经文，大英图书馆 Or.8210/P.2'),
        # **不进卡**：文里讲的是《父母恩重经变相》那一龛，手上只有宝顶山泛拍
        '大足石刻': ('Baodingshan Cliff Carvings (50620551337).jpg', False, '大足宝顶山摩崖造像'),
        # **进卡**：斯坦因自己拍的，洞口堆着待检的写本——文里那一刻的现场
        '藏经洞发现': ('Photo showing Cave 16 and the manuscripts piled up for Stein '
                       'to examine near the entrance to Cave 17, the “library cave.jpg',
                       True, '第十六窟，写本堆在第十七窟入口外待检。斯坦因摄于一九〇七年'),
    },
}


# 自己拍的照片。**不走 Commons**：署名与许可由拍摄者本人给，本表就是出处。
# 与抓来的图分开列，因为两者的可信来源不同——那边的署名是抓的，这边是给的。
OWN = {
    'shiku': {
        '序': {
            '文件': 'baimasi-stone-horse-2023.jpg',
            '署名': 'No-Macaroon1670 摄，2023 年 12 月',
            '许可': '作者本人拍摄',
            '说明': '白马寺山门外的石马。相传是汉代驮经的那匹，实为北宋魏咸信墓前的石像，'
                    '一九三五年才迁到这里',
            '卡': True,
            # 竖幅：裁成横条会把马头切掉，故整幅显示
            '整幅': True,
        },
    },
}


def credit_of(m):
    """署名。**规则：有名字就署，不管许可是什么**（用户定的）。

    CC0 与公有领域在法律上不要求署名，但拍照片、扫卷子的是具体的人或机构，
    白拿人家的东西连名字都不写，说不过去。故取值顺序：
        Artist（作者）→ Credit（出处，多为提供数字化件的机构）→ 都没有才只写许可。
    Commons 的 Credit 常裹着一句套话（「This file has been provided by …
    from its digital collections」），削掉套话留机构名。
    """
    a = (m.get('作者') or '').strip()
    if a:
        return a
    c = (m.get('出处') or '').strip()
    if not c:
        return ''
    c = re.sub(r'^This file has been provided by\s+', '', c, flags=re.I)
    c = re.split(r'\s+from its\b|\s*\.\s|Links to\b', c)[0].strip(' .,;')
    return c[:48]


def main():
    key = sys.argv[1] if len(sys.argv) > 1 else 'shiku'
    picks = PICKS.get(key) or {}
    if not picks:
        sys.exit('还没给 %s 选图，先填 PICKS' % key)
    cands = json.load(io.open(os.path.join(ROOT, 'tools/mining/pic_candidates.json'),
                              encoding='utf-8'))
    meta = {}
    for r in cands:
        for c in r['候选']:
            meta[c['文件'].replace('File:', '')] = c

    out, miss = {}, []
    for ev, (fname, on_card, cap) in picks.items():
        m = meta.get(fname)
        if not m:
            miss.append((ev, fname))
            continue
        if not m.get('可用'):
            miss.append((ev, fname + '（许可不可用）'))
            continue
        out[ev] = {
            '文件': fname, '缩略图': m.get('缩略图'), '原图': m.get('原图'),
            '许可': m.get('许可'), '作者': m.get('作者'),
            '署名': credit_of(m), '说明页': m.get('说明页'),
            '说明': cap, '卡': bool(on_card),
            # 裁不裁看长宽比：**只有接近横幅的才裁**。
            # 长卷（>1.6）裁了会切掉画心；竖幅（<0.95）裁成横条会切掉主体
            # ——那张石马照就是 0.75，按 cover 裁正好把马头切没。
            '整幅': not (0.95 <= (m.get('宽') or 1) / (m.get('高') or 1) <= 1.6),
        }

    # 自己拍的接在后面：没有 Commons 元数据可抓，本表即出处
    for ev, v in (OWN.get(key) or {}).items():
        local = 'img/%s/%s' % (key, v['文件'])
        if not os.path.exists(os.path.join(ROOT, local)):
            print('  ⚠ %s 的自摄图还没放进来：%s' % (ev, local))
            continue
        out[ev] = {**v, '缩略图': local, '作者': v['署名'], '说明页': ''}

    path = os.path.join(ROOT, 'docs/pics-%s.json' % key)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(json.dumps({
        '说明': ('故事线的配图。选图是策展判断（准绳：这张图就是这段话在讲的那个东西），'
                 '许可与署名从 Commons 抓、不手抄。`卡` 为真者进讲解卡，'
                 '其余只进长文页。'),
        '站': out,
    }, ensure_ascii=False, indent=1))

    rows = {}
    for f in sorted(glob.glob(os.path.join(ROOT, 'docs/pics-*.json'))):
        k = os.path.basename(f)[5:-5]
        rows[k] = json.load(io.open(f, encoding='utf-8')).get('站', {})
    head = [
        '// pics.js — 各故事线的配图与署名。**生成物，不要手改**：',
        '// 改了去跑 tools/mining/build_pics.py。',
        '//',
        '// 署名是硬要求不是装饰：CC-BY／CC-BY-SA 要求给出作者与许可，',
        '// 故每张图都带 作者／许可／说明页，渲染时必须一起显示。',
        'export const PICS = %s;' % json.dumps(rows, ensure_ascii=False, indent=1),
        '',
    ]
    io.open(os.path.join(ROOT, 'js/pics.js'), 'w', encoding='utf-8',
            newline=chr(10)).write(chr(10).join(head))

    print('写出 %s：%d 站（进卡 %d）' % (path, len(out), sum(1 for v in out.values() if v['卡'])))
    for ev, v in out.items():
        print('  %-12s %-14s %-30s%s' % (ev, v['许可'] or '?',
                                       (v['署名'] or '（无署名可给）')[:30],
                                       '　[卡]' if v['卡'] else ''))
    if miss:
        print('  ⚠ 候选里找不到：', miss)
    print('  写出 js/pics.js：%s' % '、'.join('%s %d' % (k, len(v)) for k, v in rows.items()))


if __name__ == '__main__':
    main()
