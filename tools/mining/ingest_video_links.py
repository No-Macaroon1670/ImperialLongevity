# -*- coding: utf-8 -*-
"""回填核验：读 Gemini Spark 填好的 docs/video-brief.md，抽出每站的链接，
存入 tools/mining/video_links.json（入库，故事线构建时读它）。

本脚本只做**解析与机器可查的核验**，人工过目仍是硬门槛（房规「看过才敢挂」）：
  · 解析 ▢ 请填 行的 ｜ 分隔字段；写「无」的记为 none 并保留「找过」说明；
  · URL 实测可达（HEAD/GET 状态码），YouTube 链接另查 oEmbed 拿到真实标题与频道
    ——填单人写的频道名与 oEmbed 返回不符即报警（防张冠李戴与已下架）；
  · 同一 URL 跨站重复出现即报警（跨线撞车的两站要不同视频，见征集单总则）；
  · 明显的排斥项（标题含「震惊」「揭秘」「AI 配音」等）报警但不自动删——由人定夺。

用法：python tools/mining/ingest_video_links.py [--no-net]
"""
import io, json, os, re, sys, time
import urllib.request, urllib.parse, urllib.error

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
DOC = os.path.join(ROOT, 'docs/video-brief.md')
OUT = os.path.join(ROOT, 'tools/mining/video_links.json')
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) IL-linkcheck/1.0'}
BAD_WORDS = ('震惊', '揭秘', '真相了', 'AI配音', 'AI 配音', '你不知道的', '细思极恐')


def parse(md):
    """按 ### 站点标题分块，抽出 ▢ 请填 行。"""
    rows = []
    line_now = None
    for block in re.split(r'\n(?=##+ )', md):
        head = block.split('\n', 1)[0]
        m2 = re.match(r'##\s+(\S+线)\s*$', head)
        if m2:
            line_now = m2.group(1)
            continue
        m3 = re.match(r'###\s+\S+?-\d+\s+(.+?)（', head)
        if not m3:
            continue
        name = m3.group(1).strip()
        fill = re.search(r'▢\s*请填[：:]\s*(.*)', block)
        val = (fill.group(1).strip() if fill else '')
        rows.append({'line': line_now, 'n': name, 'raw': val})
    return rows


def split_fields(raw):
    parts = [p.strip() for p in re.split(r'[｜|]', raw) if p.strip()]
    if not parts:
        return None
    if parts[0] in ('无', 'None', 'none', '—'):
        return {'status': 'none', 'note': '｜'.join(parts[1:])}
    url = parts[0]
    if not url.startswith('http'):
        return {'status': 'unparsed', 'note': raw}
    out = {'status': 'ok', 'url': url}
    for p in parts[1:]:
        m = re.match(r'(频道|类型|时长|语言|为何合适)[：:]\s*(.+)', p)
        if m:
            key = {'频道': 'channel', '类型': 'kind', '时长': 'duration',
                   '语言': 'lang', '为何合适': 'why'}[m.group(1)]
            out[key] = m.group(2).strip()
    return out


def yt_id(url):
    m = re.search(r'(?:v=|youtu\.be/|/shorts/)([A-Za-z0-9_-]{11})', url)
    return m.group(1) if m else None


def check(url):
    """返回 (ok, 说明)。YouTube 走 oEmbed 拿标题与频道，其余走 HTTP 状态码。"""
    vid = yt_id(url)
    try:
        if vid:
            api = 'https://www.youtube.com/oembed?format=json&url=' + urllib.parse.quote(
                'https://www.youtube.com/watch?v=' + vid, safe='')
            d = json.load(urllib.request.urlopen(urllib.request.Request(api, headers=UA), timeout=20))
            return True, {'title': d.get('title', ''), 'author': d.get('author_name', '')}
        req = urllib.request.Request(url, headers=UA)
        r = urllib.request.urlopen(req, timeout=20)
        return (r.status == 200), {'status': r.status}
    except urllib.error.HTTPError as e:
        return False, {'error': 'HTTP %s' % e.code}
    except Exception as e:
        return False, {'error': str(e)[:60]}


def main():
    net = '--no-net' not in sys.argv
    if not os.path.exists(DOC):
        raise SystemExit('找不到 %s' % DOC)
    rows = parse(io.open(DOC, encoding='utf-8').read())
    print('解析到 %d 站' % len(rows))

    result, warn, seen = [], [], {}
    for r in rows:
        f = split_fields(r['raw'])
        if not f:
            warn.append('%s / %s：未填' % (r['line'], r['n']))
            continue
        rec = {'line': r['line'], 'n': r['n'], **f}
        if f['status'] == 'ok':
            if f['url'] in seen:
                warn.append('%s / %s：URL 与「%s」重复' % (r['line'], r['n'], seen[f['url']]))
            seen[f['url']] = r['n']
            if net:
                ok, info = check(f['url'])
                rec['check'] = info
                if not ok:
                    warn.append('%s / %s：链接不可达 %s' % (r['line'], r['n'], info))
                else:
                    title = (info.get('title') or '')
                    if any(b in title for b in BAD_WORDS):
                        warn.append('%s / %s：标题疑似标题党「%s」' % (r['line'], r['n'], title[:30]))
                    ch = f.get('channel')
                    au = info.get('author')
                    if ch and au and ch not in au and au not in ch:
                        warn.append('%s / %s：频道名不符（单上「%s」实为「%s」）' % (r['line'], r['n'], ch, au))
                time.sleep(0.4)
        result.append(rec)

    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(result, ensure_ascii=False, indent=1))
    n_ok = sum(1 for r in result if r['status'] == 'ok')
    print('写出 %s：%d 条（有链接 %d，明确无 %d）' % (
        OUT, len(result), n_ok, sum(1 for r in result if r['status'] == 'none')))
    for w in warn:
        print('  ⚠ ' + w, file=sys.stderr)
    if not warn:
        print('机器核验无警告——但仍需人工打开过目后才算通过（房规：看过才敢挂）')


if __name__ == '__main__':
    main()
