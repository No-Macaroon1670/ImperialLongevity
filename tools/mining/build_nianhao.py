# -*- coding: utf-8 -*-
"""把中文维基「中国年号列表」总表搜刮成 js/data-nianhao.js，供时间轴年号细线层用。

设计案见 docs/idea-timeline-nianhao.md；用户授权见该次会话（"可以用agent搜刮年号，
Wiki上还是很全的"）。

## 源与结构
维基该页是**按表分权政**的：每张 wikitable 有自己的 `|+ '''caption'''`，caption
本身就点名了是哪个政权的年号——比表所在的 `==`/`===` 节标题更可靠（节标题常常
一节装好几个同期并存的政权，如「唐朝」节下还挂着吐蕃、于阗、渤海、南诏及大理）。
故本脚本按 **caption 精确匹配** 分派到库内政权键，不按节标题分派。

## 三条硬规矩，全部是从源数据的结构里读出来的，不是外部强加的
  1. **借用他家年号的行不算**：吴越、马楚、荆南等政权的表里，凡是备注写着
     「用后唐XX年号」一类的行，维基自己用 `|- bgcolor=#C0C0C0` 标灰。这正好是
     「奉正朔」的机器可读信号——不必去猜，直接按这个灰色标记过滤。马楚、荆南
     整张表全灰，太平天国的年号声称（天德）被表自身的备注引《太平天国史料》
     否定（太平天国用的是「国号+干支」，不是传统年号）——这三个不进数据。
  2. **cameo 政权只收该政权代表人物本人的行**：大燕（安禄山）、大齐（黄巢）、
     桓楚（桓玄）、陈汉（陈友谅）、大顺（李自成）、中华帝国（袁世凯）这六个库内
     政权，dynasties.js 明写"仅收XX一位"或按其 bio 只框定一人；而维基对应的
     年号都混在"唐朝/东晋/元朝/明朝/中华民国统治地区其他势力年号"这种大杂烩表
     里，表里同时还站着史思明、桓谦、宫文彩这类同期或后续人物。故这六个不按
     caption 分派，按 **caption + 君主姓名** 两个条件一起过滤，见 CAMEO_ROWS。
  3. **年份不明的行不进数据**：日期栏是「？」「预定…启用」或整行被 colspan
     吞掉（如唐朝乾通"敕令改元、旋即敕停不行"，压根没真正用过）的，一律跳过、
     计入 SKIPPED 供人工复核——宁可库里缺一条，不猜一个年份。

## 起讫年换算
库规「前N年」→ y = -(N-1)（天文纪年，无公元0年），与 dynasties.js 及
tools/mining/ingest.py 的既有换算口径一致；公元后 N年 → y = N，不作偏移。
起讫按年粒度：日期栏若只有一个「NNNN年」（同年改元的下半段，如"692年四月－九月"
省略了结尾的年份数字），起=讫。

## rowspan 陷阱
维基表格里monarch/备注列常用 `rowspan="N"` 跨行共享一个值，这会让后续行在
wikitext 里**整列缺失**（不是空字符串，是这一格压根不出现在那一行里）。上一版
若按固定列数切 `||`，rowspan 一出现就全错位。故本脚本按列角色（而非列序号）
在多行之间"接力"：某格声明 rowspan=N，接下来 N-1 行处理到那一列时不吃新
cell，直接续用同一个值。

用法：python tools/mining/build_nianhao.py
读：js/dynasties.js（政权键全表）、zh.wikipedia.org「中国年号列表」（实时抓）
写：js/data-nianhao.js
"""
import io, json, os, re, sys, time
import urllib.parse, urllib.request, urllib.error

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
UA = {"User-Agent": "ImperialLongevity-nianhao/1.0 (github.com/No-Macaroon1670/ImperialLongevity)"}
TITLE = '中国年号列表'


def get(url, tries=8):
    """取一次 API。退不出去就抛，不返回 None——见 build_geo_events.py 同名函数的
    注释：静悄悄 return None 会把"限流丢的"和"真没有"混成一回事。"""
    wait = 2
    for a in range(tries):
        try:
            return json.load(urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=60))
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503) or a == tries - 1:
                raise
            time.sleep(wait); wait = min(wait * 2, 60)
        except (urllib.error.URLError, TimeoutError):
            if a == tries - 1:
                raise
            time.sleep(wait); wait = min(wait * 2, 60)
    raise RuntimeError('取不到：%s' % url)


def fetch_wikitext(title):
    url = ('https://zh.wikipedia.org/w/api.php?action=query&format=json&formatversion=2'
           '&prop=revisions&rvprop=content&rvslots=main&titles=' + urllib.parse.quote(title))
    d = get(url)
    p = d['query']['pages'][0]
    if p.get('missing'):
        sys.exit('✗ 页面不存在：%s（源改名了？先去核实）' % title)
    return p['revisions'][0]['slots']['main']['content']


def load_dynasty_keys():
    """读 js/dynasties.js 的 D('key','名',…) 全表，返回 {key: 名}。"""
    src = io.open(os.path.join(ROOT, 'js/dynasties.js'), encoding='utf-8').read()
    src = src[src.find('export const DYNASTIES'):src.find('export const SUCCESSION')]
    out = {}
    for m in re.finditer(r"D\('([a-z0-9_]+)',\s*'([^']+)'", src):
        out[m.group(1)] = m.group(2)
    return out


# ── wikitext 解析 ───────────────────────────────────────────────────────────

LINK_RE = re.compile(r'\[\[([^\]|]+)(?:\|([^\]]+))?\]\]')
YEAR_RE = re.compile(r'(前)?(\d+)年')


def link_displays(text):
    """[[目标|显示]] → 显示；[[目标]] → 目标。没有链接就退回「（」之前的纯文字。
    可能不止一个人（"[[林桂方]]、[[赵良钤]]"），全部取出。"""
    out = [m.group(2) if m.group(2) else m.group(1) for m in LINK_RE.finditer(text)]
    if not out:
        t = re.split(r'[（(]', text)[0].strip()
        if t and t not in ('？', '？？'):
            out.append(t)
    return out


def strip_templates(text):
    """剥掉 {{...}}（可能嵌套，如 {{noteTag|...{{sfn|...}}...}}）。日期栏常见
    "756年－757年{{noteTag|...李崇智作...757年－759年...}}" 这种：花括号里是
    另一家的异说考订，年份数字比比皆是——不剥掉，"取最后一个年份数字"这条
    启发式会把异说里的年份当成正文的讫年（安禄山「圣武」756-757 曾被误读成
    756-759，就是从这条异说文本里带出来的 759）。反复剥、剥到不动为止，
    从最内层往外层剥，处理任意深度的嵌套。"""
    prev = None
    while prev != text:
        prev = text
        text = re.sub(r'\{\{[^{}]*\}\}', '', text)
    return text


def parse_year_cell(cell):
    """"前140年－前135年" → (-139,-134)；"692年四月－九月"（同年改元，
    结尾只剩月份没有年份数字）→ (692,692)；解析不出（"？"/空/预定未启用）→ None。"""
    cell = strip_templates(cell)
    ms = list(YEAR_RE.finditer(cell))
    if not ms:
        return None
    def conv(m):
        n = int(m.group(2))
        return -(n - 1) if m.group(1) else n
    return conv(ms[0]), conv(ms[-1])


class Table:
    __slots__ = ('caption', 'header', 'rows')
    def __init__(self, caption, header, rows):
        self.caption, self.header, self.rows = caption, header, rows
        # rows: list of dict {era, date, monarch, note_raw, grey}


def parse_tables(wikitext):
    """把整页切成表；每张表再切成行，行内按列角色接力处理 rowspan。"""
    lines = wikitext.split('\n')
    tables = []
    i, n = 0, len(lines)
    while i < n:
        if lines[i].strip().startswith('{|'):
            j = i + 1
            caption = None
            header = []
            rows = []
            pending_grey = False
            cur_monarch = None
            carries = {}  # col_idx -> [value, remaining]
            while j < n and not lines[j].strip().startswith('|}'):
                s = lines[j].strip()
                if not s:
                    j += 1; continue
                if s.startswith('|+'):
                    m = re.match(r"^\|\+\s*'''(.*?)'''", s)
                    caption = m.group(1) if m else s[2:].strip(" '")
                elif s.startswith('!style='):
                    hm = re.search(r'\|([^|]*)$', s)
                    header.append(hm.group(1).strip() if hm else '')
                elif s.startswith('!colspan'):
                    text = re.sub(r'^!colspan="?\d+"?\s*\|', '', s)
                    disp = link_displays(text)
                    cur_monarch = disp[0] if disp else None
                    pending_grey = False
                elif s.startswith('|-'):
                    pending_grey = 'bgcolor' in s
                elif s.startswith('|'):
                    raw = s[1:]
                    row_grey = pending_grey
                    pending_grey = False
                    if 'colspan=' in raw:
                        rows.append({'skip': 'colspan标记，该年号未实际使用', 'raw': raw})
                        j += 1; continue
                    ncols = len(header) if header else 4
                    has_monarch_col = '君主' in header
                    raw_cells = raw.split('||')
                    resolved = [None] * ncols
                    ci = ri = 0
                    while ci < ncols:
                        if ci in carries and carries[ci][1] > 0:
                            resolved[ci] = carries[ci][0]
                            carries[ci][1] -= 1
                            if carries[ci][1] == 0:
                                del carries[ci]
                            ci += 1
                            continue
                        if ri < len(raw_cells):
                            cell = raw_cells[ri]; ri += 1
                            rm = re.match(r'^\s*rowspan="?(\d+)"?\s*\|(.*)$', cell)
                            if rm:
                                cnt, val = int(rm.group(1)), rm.group(2)
                                resolved[ci] = val
                                if cnt > 1:
                                    carries[ci] = [val, cnt - 1]
                            else:
                                resolved[ci] = cell
                        else:
                            resolved[ci] = ''
                        ci += 1
                    era_raw = resolved[0] if ncols > 0 else ''
                    date_raw = resolved[1] if ncols > 1 else ''
                    if has_monarch_col:
                        mi = header.index('君主')
                        monarch_raw = resolved[mi] if mi < ncols else ''
                        m_disp = link_displays(monarch_raw)
                        monarch = '、'.join(m_disp) if m_disp else None
                    else:
                        monarch = cur_monarch
                    note_raw = resolved[-1] if ncols > 0 else ''
                    era_disp = link_displays(era_raw)
                    era = era_disp[0] if era_disp else None
                    rows.append({'era': era, 'era_raw': era_raw, 'date_raw': date_raw,
                                 'monarch': monarch, 'note_raw': note_raw, 'grey': row_grey})
                j += 1
            tables.append(Table(caption, header, rows))
            i = j + 1
        else:
            i += 1
    return tables


# ── caption → 库内政权键 ────────────────────────────────────────────────────
# key: 完全照抄维基页 `|+ '''...'''` 的原文（未剥 [[ ]]）。凡是这里列出的 caption，
# 脚本末尾会断言"实测在页面里出现过"——打错字会立刻报错，不会静悄悄漏收。

CAPTION_MAP = {
    "[[西汉]]年號": 'xhan',
    "[[新朝]]年號": 'xin',
    "[[更始政權|更始]]年號": 'xuanhan',
    "[[东汉]]年號": 'ehan',
    "[[曹魏]]年號": 'wei',
    "[[蜀汉]]年號": 'shu',
    "[[孫吳]]年號": 'wu',
    "[[西晋]]年號": 'xjin',
    "[[东晋]]年號": 'ejin',
    "[[汉赵]]年號": 'hanzhao',
    "[[成汉]]年號": 'chenghan',
    "[[前凉]]年號": 'qianliang',
    "[[后赵]]年號": 'houzhao',
    "[[冉魏]]": 'ranwei',
    "[[前燕]]年號": 'qianyan',
    "[[前秦]]年號": 'qianqin',
    "[[后秦]]年號": 'houqin',
    "[[後燕]]年號": 'houyan',
    "[[西燕]]年號": 'xiyan',
    "[[后凉]]年號": 'houliang',
    "[[南燕 (十六國)|南燕]]年號": 'nanyan',
    "[[夏 (十六國)|夏]]年號": 'xia',
    "[[北燕]]年號": 'beiyan',
    "[[北凉]]年號": 'beiliang',
    "[[刘宋|宋]]年號": 'song_l',
    "[[南齐|齊]]年號": 'nanqi',
    "[[梁 (南朝)|梁]]年號": 'liang',
    "[[西梁]]年号": 'xiliang',
    "[[陳 (南朝)|陳]]年號": 'chen',
    "[[北魏]]年號": 'bwei',
    "[[东魏]]年號": 'dwei',
    "[[西魏]]年號": 'xwei',
    "[[北齐]]年號": 'bqi',
    "[[北周]]年號": 'bzhou',
    "[[隋朝]]年號": 'sui',
    "[[唐朝]]年號": 'tang',
    "[[武周]]年号": 'tang',       # 武周不单列（用户裁定），并入唐
    "续[[唐朝]]年号": 'tang',
    "[[大理国|大理]]年号": 'dali',
    "[[大中 (國家)|大中]]年号": 'dali',    # 高氏篡立的「大中国」，dynasties.js 的
                                            # dali note 明写"史称后理"一并框在这条泳道里
    "[[大理国|後大理]]年号": 'dali',
    "[[后梁]]年號": 'hliang',
    "[[后唐]]年號": 'htang',
    "[[后晋]]年號": 'hjin',
    "[[後漢]]年號": 'hhan',
    "[[后周]]年號": 'hzhou',
    "[[杨吴|吳]]年號": 'wuten',
    "[[南唐]]年號": 'ntang',
    "[[前蜀]]年號": 'qshu',
    "[[後蜀]]年號": 'hshu',
    "[[南汉]]年號": 'nhan',
    "[[闽国|閩]]年號": 'min',
    "[[北汉]]年號": 'bhan',
    "[[北宋]]年號": 'nsong',
    "[[南宋]]年號": 'ssong',
    "[[辽朝]]年號": 'liao',
    "[[西夏]]年號": 'xixia',
    "[[金朝]]年號": 'jin',
    "[[元朝]]年號": 'yuan',
    "[[北元]]年号": 'byuan',
    "[[明朝]]年號": 'ming',
    "[[南明]]年号": 'nming',
    "[[后金]]年号": 'qing',
    "[[清朝]]年号": 'qing',
}

# 吴越、马楚、荆南三张表也在 CAPTION_MAP 外单独处理：不是不分派，是分派了之后
# 还要按行过滤掉借用来的年号（见下方"奉正朔"过滤），caption 照样要断言存在。
CAPTION_MAP_FILTERED = {
    "[[吴越国|吳越]]年號": 'wuyue',
    "[[马楚|楚]]年號": 'chu',
    "[[荆南]]（南平）年號": 'nanping',
}

# cameo 政权：只收「caption 里 君主字段命中这个名字」的行。见文件头注释第 2 条。
# 找到源头："唐朝统治地区其他势力的年号"表里安禄山旁边就站着安庆绪、史思明、
# 史朝义；dayan 的 dynasties.js note 明写"仅收安禄山一位"，故只挑他。
CAMEO_ROWS = {
    ("唐朝统治地区其他势力的年号", "安祿山"): 'dayan',
    ("唐朝统治地区其他势力的年号", "黄巢"): 'daqi',
    ("东晋统治地区出现的其他年号", "桓玄"): 'huanchu',
    ("元朝统治地区其他势力年号", "陈友谅"): 'chenhan',
    ("明朝统治地区其他势力年号", "李自成"): 'dashun',
    ("中華民國時期的中國君主政權年號", "袁世凯"): 'hongxian',
}


def main():
    dyn_keys = load_dynasty_keys()
    print('库内政权键 %d 个' % len(dyn_keys))

    wikitext = fetch_wikitext(TITLE)
    print('抓到「%s」，%d 字节' % (TITLE, len(wikitext)))
    tables = parse_tables(wikitext)
    print('解出 %d 张表' % len(tables))

    by_caption = {}
    for t in tables:
        by_caption.setdefault(t.caption, []).append(t)

    out = {}          # key -> list of {n,s,e,emp}
    skipped = []       # 年份解析不出的行，供人工复核
    grey_excluded = {} # key -> [(era,date_raw,note)]，被"奉正朔"过滤掉的行
    matched_captions = set()

    def add_row(key, row, table_caption):
        if row.get('skip'):
            skipped.append((table_caption, row.get('raw', '')[:60], row['skip']))
            return
        # 灰行＝借用他家年号（"奉正朔"），维基自己用 bgcolor=#C0C0C0 标出来的——
        # 这条判断对全表通用，不止吴越/马楚/荆南三家：辽太祖称帝头十年沿用唐朝
        # 「天祐」年号（916年才改元神册）也是同一个标法，一开始漏掉过，
        # 靠这条 assert 网格把它捞回来了，见下方 sanity check。
        if row.get('grey'):
            grey_excluded.setdefault(key, []).append(
                (row.get('era') or row.get('era_raw', ''), row['date_raw'], row['note_raw'][:60]))
            return
        if not row['era'] or row['era'] in ('？', '？？'):
            skipped.append((table_caption, row.get('era_raw', '')[:40], '年号名不明'))
            return
        yr = parse_year_cell(row['date_raw'])
        if yr is None:
            skipped.append((table_caption, row['era'], '起讫年不明（%s）' % row['date_raw'][:30]))
            return
        s, e = yr
        out.setdefault(key, []).append({'n': row['era'], 's': s, 'e': e,
                                         'emp': row['monarch'] or ''})

    # 1) 直接按 caption 分派（含吴越/马楚/荆南——grey 过滤已经收进 add_row 通用逻辑，
    #    不必再单独分一路；CAPTION_MAP_FILTERED 留着只是给这三家一个"预期会被
    #    整表过滤掉"的名分，供下面的 sanity check 用）
    for cap, key in dict(CAPTION_MAP, **CAPTION_MAP_FILTERED).items():
        if cap not in by_caption:
            sys.exit('✗ caption 没找到，源页面结构变了或写错字：「%s」' % cap)
        matched_captions.add(cap)
        if key not in dyn_keys:
            sys.exit('✗ CAPTION_MAP 里的政权键「%s」不在 js/dynasties.js 里' % key)
        for t in by_caption[cap]:
            for row in t.rows:
                add_row(key, row, cap)

    # 3) cameo：caption + 君主姓名 两个条件一起过滤
    for (cap, monarch_name), key in CAMEO_ROWS.items():
        if cap not in by_caption:
            sys.exit('✗ caption 没找到：「%s」' % cap)
        matched_captions.add(cap)
        hit = False
        for t in by_caption[cap]:
            for row in t.rows:
                if row.get('skip'):
                    continue
                if row.get('monarch') == monarch_name:
                    hit = True
                    add_row(key, row, cap + '/' + monarch_name)
        if not hit:
            sys.exit('✗ cameo 「%s」在「%s」里一行都没匹配到，人名写错了？' % (monarch_name, cap))

    # ── 校验：pre-Qin ＋南越等"正常空"的库内政权，不该意外出现在任何 caption 里 ──
    EXPECT_EMPTY_NOTE = {}
    preqin = ['xiachao', 'youqiong', 'shang', 'qizhou', 'xzhou', 'gongguo', 'dzhou',
              'jinguo', 'jiangqi', 'tianqi', 'chuguo', 'qinguo', 'yanguo', 'wuguo',
              'yueguo', 'songguo', 'zhengguo', 'hanguo', 'zhaoguo', 'weiguo']
    for k in preqin:
        EXPECT_EMPTY_NOTE[k] = '先秦（早于前140年汉武帝建元，年号尚未发明）'
    EXPECT_EMPTY_NOTE['qin'] = '秦代无年号（早于前140年汉武帝建元）'
    EXPECT_EMPTY_NOTE['zhangchu'] = '秦末，早于年号发明'
    EXPECT_EMPTY_NOTE['xichu'] = '秦末，早于年号发明'
    EXPECT_EMPTY_NOTE['nanyue'] = '前202–前110年，早于年号发明，史料无自建年号记载'
    EXPECT_EMPTY_NOTE['chu'] = '十国马楚：维基逐行标注全部"用XX年号"，无自建年号（奉正朔）'
    EXPECT_EMPTY_NOTE['nanping'] = '十国荆南（南平）：维基逐行标注全部"用XX年号"，无自建年号（奉正朔）'
    EXPECT_EMPTY_NOTE['taiping'] = ('太平天国：《清史稿》称建元"天德"，但条目备注引《太平天国史料汇编》'
                                     '指出太平天国自身文书以"国号+干支"纪年（如"太平天国辛开元年"），'
                                     '并无传统年号——源冲突，不进数据')

    for key in preqin + ['qin', 'zhangchu', 'xichu', 'nanyue', 'chu', 'nanping', 'taiping']:
        if key in out:
            sys.exit('✗ 「%s」按预期不该有年号数据，但抓到了 %d 条，需要人工核实'
                     % (key, len(out[key])))

    # ── 写 js/data-nianhao.js ──────────────────────────────────────────────
    # 政权键按 js/dynasties.js 里的出现顺序排列，方便人工比对
    ordered = {}
    for k in dyn_keys:
        if k in out and out[k]:
            out[k].sort(key=lambda r: (r['s'], r['e']))
            ordered[k] = out[k]

    HEAD = ("// data-nianhao.js — 历代年号（起讫按年粒度）。**生成物，不要手改**：\n"
            "// 改了去跑 tools/mining/build_nianhao.py。\n"
            "//\n"
            "// 源：zh.wikipedia.org「中国年号列表」。按库内政权键分组；键的顺序同\n"
            "// js/dynasties.js 的 DYNASTIES 出现顺序。字段：\n"
            "//   n    年号名\n"
            "//   s/e  起/讫年（前N年 = -(N-1)，与 dynasties.js 同一套换算）\n"
            "//   emp  当时在位的君主名（温和的信息，非强约束——同一年号跨两朝\n"
            "//        沿用时，emp 记的是改元当时那位）\n"
            "// 政权自建年号才收；借用他国年号（吴越/马楚/荆南类「奉正朔」）与\n"
            "// 起讫年不明的行一律不进——见 docs/holding/raw/20260820-nianhao-harvest.md。\n"
            "export const NIANHAO = %s;\n")
    io.open(os.path.join(ROOT, 'js/data-nianhao.js'), 'w', encoding='utf-8', newline='\n').write(
        HEAD % json.dumps(ordered, ensure_ascii=False, indent=1))

    total_rows = sum(len(v) for v in ordered.values())
    print('\n写出 js/data-nianhao.js：%d 个政权键，共 %d 条年号' % (len(ordered), total_rows))
    print('\n逐政权计数：')
    for k in dyn_keys:
        if k in ordered:
            print('  %-10s %-8s %3d 条' % (k, dyn_keys[k], len(ordered[k])))

    print('\n未匹配 caption（不在库内 93 政权键覆盖范围内，报告里走"库外"清单）：')
    unmatched = [c for c in by_caption if c not in matched_captions]
    for c in sorted(unmatched, key=lambda x: x or ''):
        rowcount = sum(len(t.rows) for t in by_caption[c])
        print('  %-45s %3d 行' % (c, rowcount))

    print('\n"奉正朔"过滤掉的行（借用他家年号，不进数据）：')
    for k, rows in grey_excluded.items():
        print('  %s: %d 行被过滤' % (k, len(rows)))

    print('\n年份/年号名不明、跳过的行：%d 条' % len(skipped))
    for cap, era, reason in skipped:
        print('  [%s] %s —— %s' % (cap, era, reason))

    # 供报告用的机器可读旁料：未匹配 caption 明细、跳过明细、灰行明细
    debug = {
        'unmatched_captions': {c: [{'era': r.get('era') or r.get('era_raw'),
                                     'date': r.get('date_raw'), 'monarch': r.get('monarch')}
                                    for t in by_caption[c] for r in t.rows if not r.get('skip')]
                                for c in unmatched},
        'skipped': [{'caption': c, 'era': e, 'reason': r} for c, e, r in skipped],
        'grey_excluded': grey_excluded,
    }
    io.open(os.path.join(ROOT, 'tools/mining/nianhao_debug.json'), 'w', encoding='utf-8').write(
        json.dumps(debug, ensure_ascii=False, indent=1))
    print('\n调试旁料写到 tools/mining/nianhao_debug.json（未提交，供写报告时查）')


if __name__ == '__main__':
    main()
