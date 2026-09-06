# -*- coding: utf-8 -*-
"""照片总账（2026-09-05 库主立）：一张原片一行，记它从 inbox 到出品的全程，并为日后另立的
「中华文物小图库」预留美国馆藏著录（tombstone）体例的字段。

为什么要一张总账：此前照片的判定散在闸1 三层分拣、各轮识别 JSON、几张榜单与 pics-own.md
账册里，「这张看过没有、判了什么、现在在哪」要翻四处才知道。库主 09-05：处理过的全部
移出 inbox，有推荐的另放待上站夹，「我只想要一个好的办法 track 这一切」。

五层文件夹在 crop.py 档头基础上加两层（皆本地不入库）：
  img/inbox/               没过管线的原片（文件数＝欠账数）
  img/processed/<馆次>/    过了识别、无推荐者（弃／无对应／纯语境）
  img/awaiting/<馆次>/     有推荐（可挂／候立条）、待裁切上站者
  img/originals/           已出品者的原片，改名 <成品名>-orig.jpg（既有规矩）
  img/own/ → img/used/     成品库 → 上线层（既有）

账本：img/catalog.jsonl（一张一行，全字段，含私有的拍摄时刻与 GPS）＋ img/catalog.csv（开表看）。
公开版：`export` 去掉私有字段，按 tombstone 字段出 CSV，供小图库直接用。

用法：
  python tools/mining/photo_ledger.py build            # 从闸0、识别结果、榜、出品对账合成账本
  python tools/mining/photo_ledger.py status           # 各状态计数
  python tools/mining/photo_ledger.py move [--dry] [--with-deployed]   # 按状态搬文件（幂等，写 img/catalog-moves.log；已出品者默认不搬，须目验）
  python tools/mining/photo_ledger.py export           # 公开版 img/catalog-public.csv
  python tools/mining/photo_ledger.py patch <json…>    # 并入著录员产物（只填空栏）

字段（本库侧）：file／path／id（dHash）／taken（私）／lat／lon（私）／session／museum／pass（识别批次·模型）／
  kind／name／name_src／era／label_text／match_n／match_how／verdict／q／role／faces／crop_needed／dup_of／note／
  status（inbox|processed|awaiting|deployed）／deployed_as
字段（tombstone，参照 CDWA／各馆藏品页常见栏）：title／object_type／culture_period／date／materials／color／
  dimensions／provenance／current_location／accession_no／description／inscription（未著录者留空，另派著录员补）
"""
import csv, glob, io, json, os, re, shutil, sys, time, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IMG = os.path.join(ROOT, 'img')
DESK = os.path.join(ROOT, 'docs', 'desk')
LEDGER = os.path.join(IMG, 'catalog.jsonl')
SCRATCH = os.environ.get('PHOTO_SCRATCH') or r'C:\Users\ziyi_\AppData\Local\Temp\claude\C--Users-ziyi--Claude-imperial-longevity\48811d4a-955a-4472-b299-02c9390bb59c\scratchpad\photos'
PRIVATE = ('taken', 'lat', 'lon', 'file', 'path', 'session')
TOMB = ('title', 'object_type', 'culture_period', 'date', 'materials', 'color', 'dimensions', 'provenance', 'current_location', 'accession_no', 'description', 'inscription')
FIELDS = ('file', 'path', 'id', 'taken', 'lat', 'lon', 'session', 'museum', 'pass', 'kind', 'name', 'name_src', 'era', 'label_text', 'match_n', 'match_how',
          'verdict', 'q', 'role', 'faces', 'crop_needed', 'dup_of', 'note', 'status', 'deployed_as') + TOMB

def load_json(p):
    return json.load(io.open(p, encoding='utf-8'))

def slug(museum):
    # 先抓「××博物馆／博物院／美术馆／石窟／遗址公园」这样的机构名，抓不到再取首段
    m = re.search(r'([一-鿿A-Za-z· ]{2,14}?(?:艺术博物馆|博物馆|博物院|美术馆|石窟|遗址公园|遗址博物馆|龙亭公园|啤酒博物馆))', museum or '')
    s = m.group(1) if m else re.split(r'[（(—\-—·,，;；:：]', museum or '')[0]
    s = re.sub(r'\s+', '', s.strip())[:14]
    return s or '未定馆'

def build():
    lib = {r['n'] for r in load_json(os.path.join(SCRATCH, 'lib-index.json'))}
    # ① 闸0：两份清单，原片所在夹不同
    rows = collections.OrderedDict()
    # 闸0 清单按文件名序全读（后来的同名文件覆盖先前的）；原片所在夹取清单自记的 folder
    for gf in sorted(glob.glob(os.path.join(DESK, 'photo-gate0-*.json'))):
        g = load_json(gf)
        folder = os.path.relpath(g.get('folder') or os.path.join(ROOT, 'img', 'inbox'), ROOT).replace(os.sep, '/')
        for r in g['rows']:
            rows[r['file']] = {'file': r['file'], 'path': folder + '/' + r['file'], 'id': r.get('hash', ''), 'taken': r.get('ts') or '', 'lat': r.get('lat'), 'lon': r.get('lon'),
                               'session': (r.get('ts') or '未知')[:10], 'museum': '', 'pass': '', 'status': 'inbox'}
    # ② 识别结果：主库各包（Fable 09-05）＋ DiffTest（Opus 闸2 优先，Fable 补）
    day_of = {c['id']: c['day'] for c in load_json(os.path.join(SCRATCH, 'chunks.json'))}
    for b in ('bA', 'bB', 'bC'): day_of[b] = '2023-12-26'
    museum_votes = collections.defaultdict(collections.Counter)
    def absorb(p, chunk_json, tag):
        for ph in chunk_json.get('photos', []):
            f = ph['file']
            if f not in rows: continue
            r = rows[f]
            prefer = tag.startswith('opus') or not r.get('name')
            if prefer or (ph.get('label_text') and not r.get('label_text')):
                for k in ('kind', 'name', 'name_src', 'era', 'label_text', 'match_n', 'match_how', 'role', 'dup_of', 'note'):
                    if ph.get(k) or prefer: r[k] = ph.get(k) or ''
                r['q'] = ph.get('usable_q') or 0; r['faces'] = bool(ph.get('faces')); r['crop_needed'] = bool(ph.get('crop_needed'))
                r['new_candidate'] = bool(ph.get('new_candidate'))
                r['pass'] = tag
            if chunk_json.get('museum'): museum_votes[r['session']][slug(chunk_json['museum'])] += 1
    for f in sorted(glob.glob(os.path.join(SCRATCH, 'out', '*.json'))):
        absorb(f, load_json(f), 'fable-20260905')
    for f in sorted(glob.glob(os.path.join(SCRATCH, 'difftest', 'out', 'o*.json'))):
        absorb(f, load_json(f), 'opus-20260905')
    for f in sorted(glob.glob(os.path.join(SCRATCH, 'difftest', 'out', 'f*.json'))):
        absorb(f, load_json(f), 'fable-20260905')
    # 各站（stations/<站>/out）：Opus 闸2 优先，Fable 补
    for st in sorted(glob.glob(os.path.join(SCRATCH, 'stations', '*'))):
        for f in sorted(glob.glob(os.path.join(st, 'out', 'o*.json'))): absorb(f, load_json(f), 'opus-' + os.path.basename(st))
        for f in sorted(glob.glob(os.path.join(st, 'out', 'f*.json'))): absorb(f, load_json(f), 'fable-' + os.path.basename(st))
    # ②′ 闸1 判 keep=false 而未进闸2 的：也算过了管线（判定「闸1弃」）
    for gf in sorted(glob.glob(os.path.join(SCRATCH, 'stations', '*', 'out', 'gate1-*.json'))) + sorted(glob.glob(os.path.join(SCRATCH, 'difftest', 'out', 'gate1-*.json'))):
        for ph in load_json(gf).get('photos', []):
            r = rows.get(ph.get('file'))
            if not r or r.get('pass'): continue
            r['pass'] = 'gate1-' + os.path.basename(os.path.dirname(os.path.dirname(gf)))
            r['kind'] = ph.get('cat') or ''; r['name'] = ph.get('what') or ''; r['name_src'] = '闸1'; r['q'] = 0; r['faces'] = bool(ph.get('faces')); r['gate1_only'] = True
    # ③ 馆次名：本包多数票；DiffTest 定名
    for r in rows.values():
        v = museum_votes.get(r['session'])
        r['museum'] = v.most_common(1)[0][0] if v else ''
        if r['path'].startswith('img/inbox/DiffTest'): r['museum'] = '广东省博物馆'
    # ④ 判定与状态
    for r in rows.values():
        n = (r.get('match_n') or '').strip(); q = r.get('q') or 0
        if not r.get('pass'): r['verdict'] = '未判'; r['status'] = 'inbox'; continue
        if r.get('gate1_only'): r['verdict'] = '闸1弃'; r['status'] = 'processed'; continue
        if n in lib and q >= 2: r['verdict'] = '可挂'
        elif r.get('new_candidate'): r['verdict'] = '候立条'
        elif n in lib: r['verdict'] = '对库·q低'
        else: r['verdict'] = '弃' if (r.get('kind') in ('人物', '生活杂照', '重复', '看不清') or q == 0) else '无对应'
        r['status'] = 'awaiting' if r['verdict'] in ('可挂', '候立条') else 'processed'
    # ⑤ 已出品对账（感知哈希配 own／used）
    pm = os.path.join(SCRATCH, 'produced_in_inbox.json')
    if os.path.exists(pm):
        d = load_json(pm); back = collections.defaultdict(list)
        for grp in ('used', 'own'):
            for prod, orig in d[grp].items(): back[orig].append(grp + '/' + prod)
        for orig, prods in back.items():
            if orig in rows:
                rows[orig]['status'] = 'deployed'; rows[orig]['deployed_as'] = '、'.join(sorted(set(prods)))
    # ⑥ tombstone 预填（能从识别字段直推的先推，其余留空候著录员）
    for r in rows.values():
        lt = r.get('label_text') or ''
        r['title'] = r.get('name') or ''
        r['object_type'] = r.get('kind') or ''
        r['culture_period'] = r.get('era') or ''
        r['date'] = r.get('era') or ''
        r['current_location'] = r.get('museum') or ''
        m = re.search(r'(?:编号|藏品号|馆藏号|No\.?|编号：)\s*([A-Za-z0-9\-—·]{2,20})', lt); r['accession_no'] = m.group(1) if m else ''
        m = re.search(r'([^，。；\s]{2,12}(?:出土|征集|旧藏|捐赠))', lt); r['provenance'] = m.group(1) if m else ''
        r['description'] = (lt or r.get('note') or '')[:400]
        for k in ('materials', 'color', 'dimensions', 'inscription'): r.setdefault(k, '')
    # ⑦ 保住已搬动的 path（幂等）
    old = {}
    if os.path.exists(LEDGER):
        for ln in io.open(LEDGER, encoding='utf-8'):
            try: o = json.loads(ln); old[o['file']] = o
            except Exception: pass
    for f, r in rows.items():
        if f in old and old[f].get('path') and os.path.exists(os.path.join(ROOT, old[f]['path'])) and not os.path.exists(os.path.join(ROOT, r['path'])):
            r['path'] = old[f]['path']
        for k in TOMB:   # 著录员手填的不覆盖
            if old.get(f, {}).get(k) and not r.get(k): r[k] = old[f][k]
    out = [{k: r.get(k, '') for k in FIELDS} for r in rows.values()]
    with io.open(LEDGER, 'w', encoding='utf-8', newline='\n') as fh:
        for o in out: fh.write(json.dumps(o, ensure_ascii=False) + '\n')
    with io.open(os.path.join(IMG, 'catalog.csv'), 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS); w.writeheader(); w.writerows(out)
    print('账本 %d 行 → img/catalog.jsonl / catalog.csv' % len(out)); status()

def read():
    return [json.loads(ln) for ln in io.open(LEDGER, encoding='utf-8') if ln.strip()]

def status():
    rows = read()
    c = collections.Counter(r['status'] for r in rows); v = collections.Counter(r['verdict'] for r in rows)
    print('状态：', dict(c)); print('判定：', dict(v))
    by = collections.defaultdict(collections.Counter)
    for r in rows: by[(r['session'], r['museum'])][r['status']] += 1
    for k in sorted(by): print('  %s %-12s %s' % (k[0], k[1][:12], dict(by[k])))

def move(dry=False, with_deployed=False):
    rows = read(); log = io.open(os.path.join(IMG, 'catalog-moves.log'), 'a', encoding='utf-8')
    moved = collections.Counter(); skipped = []
    for r in rows:
        src = os.path.join(ROOT, r['path'])
        if r['status'] == 'inbox': continue
        if r['status'] in ('processed', 'awaiting'):
            sess = '%s-%s' % (r['session'], r['museum'] or '未定馆')
            dst_dir = os.path.join(IMG, r['status'], sess); dst = os.path.join(dst_dir, r['file'])
        elif r['status'] == 'deployed':
            if not with_deployed: continue   # 感知哈希配对须库主目验后再搬（--with-deployed）
            prods = [p for p in (r.get('deployed_as') or '').split('、') if p]
            names = sorted({os.path.basename(p) for p in prods})
            if len(names) != 1: skipped.append((r['file'], '出品名不唯一 ' + '、'.join(names))); continue
            dst_dir = os.path.join(IMG, 'originals'); dst = os.path.join(dst_dir, os.path.splitext(names[0])[0] + '-orig' + os.path.splitext(r['file'])[1].lower())
        else: continue
        rel = os.path.relpath(dst, ROOT).replace('\\', '/')
        if os.path.abspath(src) == os.path.abspath(dst) or (not os.path.exists(src) and os.path.exists(dst)):
            r['path'] = rel; continue
        if not os.path.exists(src): skipped.append((r['file'], '源不在 ' + r['path'])); continue
        if os.path.exists(dst): skipped.append((r['file'], '目标已存在 ' + rel)); continue
        if not dry:
            os.makedirs(dst_dir, exist_ok=True); shutil.move(src, dst); r['path'] = rel
            log.write('%s\t%s\t%s\n' % (time.strftime('%Y-%m-%d %H:%M'), r['file'], rel))
        moved[r['status']] += 1
    log.close()
    if not dry:
        with io.open(LEDGER, 'w', encoding='utf-8', newline='\n') as fh:
            for r in rows: fh.write(json.dumps(r, ensure_ascii=False) + '\n')
    print('%s搬动：%s；跳过 %d' % ('（干跑）' if dry else '', dict(moved), len(skipped)))
    for s in skipped[:20]: print('   ', s[0], '|', s[1])

def export():
    rows = read(); out = os.path.join(IMG, 'catalog-public.csv')
    cols = ('id', 'museum') + TOMB + ('match_n', 'verdict', 'deployed_as', 'photo_month')
    with io.open(out, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.writer(fh); w.writerow(cols)
        for r in rows:
            if r['status'] == 'inbox' or r.get('faces'): continue
            w.writerow([r.get(c, '') if c != 'photo_month' else (r.get('taken') or '')[:7] for c in cols])
    print('公开版 →', os.path.relpath(out, ROOT), '（去私有字段、去人脸照）')

def patch(paths):
    """并入著录员产物（catalog-fill 工作流的 <batch>.json：{batch, rows:[{file, title, …, confidence}]}）：
    只填账本里为空的 tombstone 栏；著录员 confidence 记进 note 之外的 catalog_conf 栏。"""
    rows = read(); by = {r['file']: r for r in rows}; n = 0; touched = 0
    for p in paths:
        for row in load_json(p).get('rows', []):
            r = by.get(row['file'])
            if not r: continue
            ch = False
            for k in TOMB:
                v = (row.get(k) or '').strip()
                if v and not (r.get(k) or '').strip(): r[k] = v; ch = True
            if row.get('confidence'): r['catalog_conf'] = row['confidence']; ch = True
            n += 1; touched += ch
    with io.open(LEDGER, 'w', encoding='utf-8', newline='\n') as fh:
        for r in rows: fh.write(json.dumps(r, ensure_ascii=False) + '\n')
    print('著录并入：读 %d 行，改 %d 行' % (n, touched))

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
    {'build': build, 'status': status, 'move': lambda: move('--dry' in sys.argv, '--with-deployed' in sys.argv), 'export': export, 'patch': lambda: patch(sys.argv[2:])}[cmd]()
