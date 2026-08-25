# -*- coding: utf-8 -*-
"""给一条故事线做地理档：docs/geo-<key>.json。

**一站一个点是错的模型**，两条线都立刻证明了这一点：

  · 赤壁线的「赤壁之战」有七说（嘉鱼、蒲圻、武昌、汉阳、汉川、黄冈、钟祥），
    「隆中对」有两说（南阳卧龙岗、襄阳古隆中）。按本库通例，各源不一致就
    一个都不给——但地图上「不给」不等于空白，而是**把几个候选一起画出来**。
    读者看见三个空心点，就知道这地方至今没定论，比给他一个实心点诚实。
  · 文物在地图上是两个点：《前赤壁赋》写于黄州，真迹在台北；
    《金刚经》出自莫高窟第十七窟，现藏伦敦。「出→藏」这条线本身就是叙事。

故每站的地理项有四种形态：
    {"点": [lat, lon]}                 确定的一处
    {"诸说": [{"名": ..., "点": [..]}]}  争议，全部画出，不选边
    {"现藏": [lat, lon], "藏于": "..."}  文物的第二个点，可与上二者并存
    null                                 本站没有地点（如《三国演义》成书）

图上写的名字未必等于查坐标用的条目名，故 dict 形态另收 `出名`/`藏名`：
熹平石经的残石大部分在西安碑林，但上博、国博、洛阳博物馆亦有零星——
标「西安碑林」是独家，标「西安碑林等处」才是实情，而查坐标仍得用前者。

坐标来源：Wikidata P625（CC0）。条目名先经 zhwiki 归一（本库的 `w` 存的是
维基正题，含繁体与消歧义后缀，wbgetentities 对重定向并不宽容——实测
「云冈石窟」直接查会落空）。查不到的写进 MANUAL 并注明依据，不许瞎填。

用法：python tools/mining/build_geo.py <key>
"""
import io, json, os, re, sys, time
import urllib.parse, urllib.request

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_line_doc import load_line, load_events  # noqa: E402

UA = {"User-Agent": "ImperialLongevity-geo/1.0 (storyline minimap)"}

# 每条线的地理映射。键是站点的 ev，值说明「拿哪个（些）实体的坐标」。
#   str          → 查这一个 zhwiki 条目
#   [str, ...]   → 诸说，全部查、全部画
#   {'藏': str}  → 只有现藏地（书成于何处不可考者，如《三国演义》不给）
# 写在这里而不是自动推断：一站落在哪儿是**策展判断**，不是数据属性。
PLACES = {
    'shiku': {
        '白马寺': '白马寺',
        '克孜尔石窟': '克孜尔千佛洞',
        '敦煌石窟': '莫高窟',
        '麦积山石窟': '麦积山石窟',
        '云冈石窟': '云冈石窟',
        '龙门石窟': '龙门石窟',
        '榆林窟': '榆林窟',
        '乐山大佛': '乐山大佛',
        # 出自莫高窟第十七窟，今藏大英图书馆——两个点
        '金刚经印本': {'出': '莫高窟', '藏': '大英图书馆'},
        '大足石刻': '大足石刻',
        '藏经洞发现': '莫高窟',
    },
    # 碑帖线：每站取「写成/刻成之地」＋「今天在哪」两头，出→藏即挑选与流传
    'beitie': {
        '熹平石经': {'出': '洛阳市', '出名': '洛阳太学',
                 '藏': '西安碑林', '藏名': '西安碑林等处'},
        '兰亭集序': {'出': '兰亭', '藏': '故宫博物院', '藏名': '故宫（神龙本）'},
        '龙门二十品': '龙门石窟',
        '淳化阁帖': {'出': '开封市', '出名': '开封禁中',
                 '藏': '上海博物馆', '藏名': '上博（宋拓十卷本）'},
        '集古录': {'出': '开封市', '出名': '开封',
                '藏': '国立故宫博物院', '藏名': '台北故宫（手稿卷）'},
        '金石录': {'出': '莱州市', '出名': '东莱静治堂'},
        '广艺舟双楫': {'出': '西樵山', '出名': '西樵山'},
    },
    'yanyi': {
        # 演艺线：出土地→现藏是盆的两点；官署在长安；瓦舍汴杭两点；相声落天桥
        '舞蹈纹彩陶盆': {'出': '大通回族土族自治县', '出名': '上孙家寨',
                  '藏': '中国国家博物馆', '藏名': '国博'},
        '武帝立乐府': {'出': '西安市', '出名': '长安'},
        '玄宗教梨园弟子': {'出': '西安市', '出名': '长安禁苑'},
        '瓦舍勾栏': {'出': '开封市', '出名': '汴京', '藏': '杭州市', '藏名': '临安（南渡后）'},
        '录鬼簿': {'出': '杭州市', '出名': '杭州'},
        '魏良辅改昆腔': {'出': '太仓市', '出名': '太仓'},
        '徽班进京': {'出': '扬州市', '出名': '扬州', '藏': '北京市', '藏名': '进京'},
        '京剧成型': {'出': '北京市', '出名': '北京'},
        '相声开山': {'出': '北京市', '出名': '天桥'},
    },
    'xianghuo': {
        # 香火线：每站落在**办手续的那个地方**，不是神住的地方。
        # 两站是「出→藏」：买地券传出忻县、今在上博；唐英款花觚烧于景德镇、今在国博。
        # 门神条无 p 字段（w 挂西游记），故取它能系年的那一头——万历二十年
        # 金陵世德堂刊本，即南京。城隍（洪武颁诏）也在南京，两站同城相隔
        # 二百二十三年：同城而已，**不许接成因果**（craft §五·5）
        '一人得道鸡犬升天': {'出': '寿县', '出名': '寿春'},
        '买地券': {'出': '忻州市', '出名': '山西忻县（传出）',
                '藏': '上海博物馆', '藏名': '上博（中国古代玉器馆）'},
        '妈祖信仰': {'出': '湄洲岛', '出名': '湄洲岛'},
        '文昌帝君': {'出': '梓潼县', '出名': '梓潼七曲山'},
        '大封天下城隍': {'出': '南京市', '出名': '南京（洪武颁诏）'},
        '除夜赐钟馗': {'出': '开封市', '出名': '开封（除夜给赐）'},
        '门神': {'出': '南京市', '出名': '南京（世德堂刊本）'},
        '包公变阎罗': {'出': '开封市', '出名': '开封'},
        '关林': {'出': '关林', '出名': '洛阳关林'},
        '关羽累封': {'出': '运城市', '出名': '运城解州'},
        '唐英款花觚': {'出': '景德镇市', '出名': '景德镇御窑',
                  '藏': '中国国家博物馆', '藏名': '国博（同款烛台在伦敦V&A）'},
    },
    'shugui': {
        # 书库线：修书之地为主点；大典与四库各带一个「藏」点讲流散
        '七略': {'出': '未央宫', '出名': '未央宫天禄阁'},
        '江陵陷落焚书': {'出': '荆州区', '出名': '江陵'},
        '艺文类聚': {'出': '西安市', '出名': '长安'},
        '太平御览': {'出': '开封市', '出名': '开封'},
        '永乐大典': {'出': '南京市', '出名': '南京（初修）',
                 '藏': '中国国家图书馆', '藏名': '国图藏最多，余散全球'},
        '皇史宬': {'出': '皇史宬', '出名': '皇史宬'},
        '古今图书集成': {'出': '北京市', '出名': '北京'},
        '四库全书': {'出': '北京市', '出名': '北京（文渊阁）',
                 '藏': '国立故宫博物院', '藏名': '台北故宫（文渊阁本）'},
    },
    'chibi': {
        # 躬耕地两说，自清代争到今天：两个空心点，不选边
        '隆中对': ['古隆中', '南阳武侯祠'],
        # 七说。地图上照数画七个，那才是「今人统计七说」的样子
        '赤壁之战': ['赤壁市', '嘉鱼县', '武昌区', '汉阳区', '汉川市', '黄冈市', '钟祥市'],
        '刮目相看': {'出': '岳阳市', '出名': '岳阳'},   # 周瑜卒于巴丘，裴注谓即今巴陵（岳阳）
        '三国志': None,                  # 陈寿成书之地不可考，不给
        '前赤壁赋': {'出': '黄冈市', '出名': '黄冈', '藏': '国立故宫博物院'},
        '寒食帖': {'出': '黄冈市', '出名': '黄冈', '藏': '国立故宫博物院'},
        '赤壁图': {'藏': '国立故宫博物院'},   # 武元直作画之地不可考
        '三国演义': None,                # 成书地与年代皆无定论
    },
    # 勘合线讲的是「记录与实物对不对得上」，故每一站取的点是
    # **那份记录或那件东西今天在哪儿被对上的**，不是那个人在哪儿
    'kanhe': {
        # 627 年发现于宝鸡荒野，今藏北京故宫。两个点之间隔着一千三百年
        '石鼓': {'出': '宝鸡市', '出名': '宝鸡', '藏': '故宫博物院'},
        # 全境施行的制度，没有一个地点。宁可这一站没有图，也不硬编一个
        '书同文': None,
        # 175 年立于洛阳城南太学门外；1929 年洛阳故城出残石，大部分 1952 年
        # 入西安碑林，上博、国博、洛阳博物馆亦有零星——故标「等处」，不写成独家
        '熹平石经': {'出': '洛阳市', '出名': '洛阳太学',
                 '藏': '西安碑林', '藏名': '西安碑林等处'},
        # 查坐标用条目名，图上写地名——「洛阳市」跟旁边的「洛阳太学」
        # 「咸阳底张湾」摆在一起不齐，且那个「市」在这条线上没有意义
        '孝文帝汉化·迁都洛阳': {'出': '洛阳市', '出名': '洛阳'},
        '天龙山石窟': '天龙山石窟',
        # 这一站要看的是 1953 年咸阳底张湾出的那方墓志，不是那个人死在哪儿
        '独孤信之死': {'出': '咸阳市', '出名': '咸阳底张湾'},
        '开成石经': '西安碑林',
        # 1987 年法门寺塔基唐代地宫，十三件青瓷与《衣物帐》一一对应。
        # 上林湖窑址是它烧在哪儿，不是它被认出来在哪儿——这一站讲的是后者
        '秘色瓷': {'出': '法门寺', '出名': '法门寺地宫'},
        # 897 年唐昭宗颁予钱镠，颁于何地不可考，故只给现藏
        '钱镠铁券': {'藏': '中国国家博物馆'},
        '湖州镜': {'出': '湖州市', '出名': '湖州'},
        # 航迹远及东非，全在图外。南京是船队所出与所归，也是静海寺残碑所在
        '郑和下西洋': {'出': '南京市', '出名': '南京'},
        '皇史宬': '皇史宬',
    },
}

# 查不到坐标时的人工补录。**每条都要写依据**，宁可留空也不许估
MANUAL = {}


def qids(titles):
    """zhwiki 条目名（含重定向）→ QID。pageprops 一次解决归一与取号。"""
    out = {}
    for i in range(0, len(titles), 20):
        u = ('https://zh.wikipedia.org/w/api.php?action=query&format=json&formatversion=2'
             '&redirects=1&prop=pageprops&ppprop=wikibase_item&titles='
             + urllib.parse.quote('|'.join(titles[i:i + 20])))
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40))
        except Exception as e:
            print('  取失败：%s' % str(e)[:50], file=sys.stderr)
            continue
        norm = {r['from']: r['to'] for r in (d.get('query', {}).get('normalized') or [])}
        redir = {r['from']: r['to'] for r in (d.get('query', {}).get('redirects') or [])}
        back = {}
        for a in titles:
            b = norm.get(a, a)
            back.setdefault(redir.get(b, b), []).append(a)
        for p in d.get('query', {}).get('pages', []):
            q = (p.get('pageprops') or {}).get('wikibase_item')
            for orig in back.get(p.get('title'), []):
                if q:
                    out[orig] = q
        time.sleep(0.5)
    return out


def coords(ids):
    """QID → (lat, lon)，取 P625。"""
    out = {}
    ids = list(dict.fromkeys(ids))
    for i in range(0, len(ids), 40):
        u = ('https://www.wikidata.org/w/api.php?action=wbgetentities&format=json'
             '&props=claims&ids=' + '|'.join(ids[i:i + 40]))
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40))
        except Exception as e:
            print('  取失败：%s' % str(e)[:50], file=sys.stderr)
            continue
        for q, ent in (d.get('entities') or {}).items():
            cl = ((ent.get('claims') or {}).get('P625') or [])
            if cl:
                v = cl[0].get('mainsnak', {}).get('datavalue', {}).get('value', {})
                if 'latitude' in v:
                    out[q] = [round(v['latitude'], 4), round(v['longitude'], 4)]
        time.sleep(0.5)
    return out


def main():
    key = sys.argv[1] if len(sys.argv) > 1 else 'chibi'
    spec = PLACES.get(key)
    if not spec:
        sys.exit('没有 %s 的地理映射，先写进 PLACES' % key)
    _, stops = load_line(key)

    want = []
    for v in spec.values():
        if isinstance(v, str):
            want.append(v)
        elif isinstance(v, list):
            want += v
        elif isinstance(v, dict):
            want += [v[k] for k in ('出', '藏') if v.get(k)]
    qs = qids(sorted(set(want)))
    cs = coords(list(qs.values()))

    def pt(title):
        q = qs.get(title)
        c = cs.get(q) if q else None
        return c or MANUAL.get(title)

    geo, miss = {}, []
    for s in stops:
        ev = s['ev']
        if not ev or ev not in spec:
            continue
        v = spec[ev]
        rec = {}
        if v is None:
            geo[ev] = None
            continue
        if isinstance(v, str):
            c = pt(v)
            if c:
                rec['点'] = c
                rec['地名'] = v
            else:
                miss.append((ev, v))
        elif isinstance(v, list):
            says = [{'名': t, '点': pt(t)} for t in v]
            got = [x for x in says if x['点']]
            miss += [(ev, x['名']) for x in says if not x['点']]
            if got:
                rec['诸说'] = got
        elif isinstance(v, dict):
            if v.get('出'):
                c = pt(v['出'])
                if c:
                    rec['点'] = c
                    rec['地名'] = v.get('出名') or v['出']
                else:
                    miss.append((ev, v['出']))
            if v.get('藏'):
                c = pt(v['藏'])
                if c:
                    rec['现藏'] = c
                    rec['藏于'] = v.get('藏名') or v['藏']
                else:
                    miss.append((ev, v['藏']))
        geo[ev] = rec or None

    out = os.path.join(ROOT, 'docs/geo-%s.json' % key)
    io.open(out, 'w', encoding='utf-8', newline='\n').write(json.dumps({
        '说明': ('坐标取自 Wikidata P625（CC0）。**一站不一定一个点**：'
                 '争议地写「诸说」全部画出、不选边；文物另有「现藏」，'
                 '「出→藏」那条线本身就是流散叙事；无地点者为 null。'),
        '站': geo,
    }, ensure_ascii=False, indent=1))

    n1 = sum(1 for v in geo.values() if v and '点' in v)
    n2 = sum(1 for v in geo.values() if v and '诸说' in v)
    n3 = sum(1 for v in geo.values() if v and '现藏' in v)
    print('写出 %s：%d 站｜确定点 %d｜诸说 %d｜带现藏 %d｜无地点 %d'
          % (out, len(geo), n1, n2, n3, sum(1 for v in geo.values() if not v)))
    for ev, v in geo.items():
        if v is None:
            print('  %-10s —' % ev)
        elif '诸说' in v:
            print('  %-10s 诸说 %d：%s' % (ev, len(v['诸说']), '、'.join(x['名'] for x in v['诸说'])))
        else:
            print('  %-10s %s%s' % (ev, v.get('地名', ''),
                                    ('　→ 现藏 ' + v['藏于']) if v.get('藏于') else ''))
    if miss:
        print('  ⚠ 没查到坐标（写进 MANUAL 并注明依据，别估）：', miss)
    emit_js()


def emit_js():
    """把各线的地理档并成 js/geo.js。前端不能直接 import JSON，
    而多开一个 fetch 又等于给一张角落里的小图加一次网络往返。"""
    import glob
    rows = {}
    for f in sorted(glob.glob(os.path.join(ROOT, 'docs/geo-*.json'))):
        k = os.path.basename(f)[4:-5]
        # docs/ 下同名花样的还有 geo-events-probe.json（全库覆盖率探测，
        # 不是故事线），照单全收会给前端塞进一条空线
        if k not in PLACES:
            continue
        rows[k] = json.load(io.open(f, encoding='utf-8')).get('站', {})
    head = [
        '// geo.js — 各故事线的地理档。**生成物，不要手改**：',
        '// 改了去跑 tools/mining/build_geo.py。',
        '//',
        '// 一站不一定一个点：`诸说` 是争议地（全部画出，不选边），',
        '// `现藏` 是文物的第二个点（「出→藏」那条线本身就是流散叙事），',
        '// null 是没有地点。坐标取自 Wikidata P625（CC0）。',
        'export const GEO = %s;' % json.dumps(rows, ensure_ascii=False, indent=1),
        '',
    ]
    js = chr(10).join(head)
    io.open(os.path.join(ROOT, 'js/geo.js'), 'w', encoding='utf-8', newline=chr(10)).write(js)
    print('  写出 js/geo.js：%s' % '、'.join('%s %d 站' % (k, len(v)) for k, v in rows.items()))


if __name__ == '__main__':
    main()
