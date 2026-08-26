# -*- coding: utf-8 -*-
"""把选定的配图收进仓库：img/story/<key>/，并写出 img/CREDITS.md。

**为什么不直接挂 upload.wikimedia.org 的链接**（实测过才决定的）：

  · 零依赖。站点其余部分不挂任何外部运行时依赖，图挂着就破了这条通例。
  · 隐私。挂链的话，读者每翻一页，IP 都送到 Wikimedia 一次。
  · 会断。Commons 的缩略图 URL 里嵌着文件名，人家改个名图就没了。

代价可以忽略：实测十一张缩略图合计数 MB 量级，GitHub Pages 的软上限是
仓库与站点各 1 GB、月流量 100 GB，十条线也才几十 MB。

下载的是 Wikimedia 自己渲染的缩略版，**不重新编码**——少一层「衍生作品」
的麻烦，也少一次画质损失。

**取档策略（2026-08-21 定，实测过才写的）**：Wikimedia 的缩略图服务只认
一份固定的「常用尺寸」白名单（见 https://www.mediawiki.org/wiki/Common_thumbnail_sizes），
不是任意宽度都能取——实测 1600 这个数字不在白名单里，逐一试过白马寺、
乐山大佛、麦积山三张不同原图，一律 400。故逐文件按 1600 → 1280 → 原档
的顺序试，**取到哪档就把哪档的 URL 记进 `远端`**——`pics-*.json` 是出处记录，
记录层写实际取到的那份，不写注定 404 的愿望链；也免得下次重取时白打一炮。

署名随图走：img/CREDITS.md 逐张列出作者、许可与 Commons 文件页。
这不是客气，是 CC-BY／CC-BY-SA 的硬要求；CC0 与公有领域虽不强制，
本库照署（有名字就署，见 build_pics.py 的 credit_of）。

用法：python tools/mining/vendor_pics.py <key> [--force]
    --force   已有本地档也重取（用于整批升分辨率；平时增补新图不用，
              免得每加一张就把整条线的老图重打一遍）
产出：img/story/<key>/*.jpg、img/CREDITS.md，并把 pics-<key>.json 的
      `缩略图` 改成本地路径、`远端` 改成实际取到的那档 URL
"""
import io, json, os, random, re, sys, time, glob
import urllib.request

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
UA = {"User-Agent": "ImperialLongevity-vendor/1.0 (self-hosting curated storyline images)"}

PX_TIERS = (1600, 1280)          # 先试大档，白名单里没有就退一档
PX_RE = re.compile(r'/(\d+)px-')  # Commons thumb URL 里嵌的尺寸段


def slug(name):
    """文件名要能进 URL、也要人看得懂：留汉字与字母数字，其余压成短横。"""
    s = re.sub(r'\.(jpg|jpeg|png|JPG|JPEG|PNG)$', '', name)
    s = re.sub(r'[^\w\u4e00-\u9fff]+', '-', s).strip('-')
    return s[:60].lower()


def fetch(url, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as f:
                return f.read()
        except Exception as e:
            code = getattr(e, 'code', None)
            # 400 = 尺寸不在 Wikimedia 白名单，是永久性的、重试没用，直接放弃换档
            if code == 400 or i == tries - 1:
                print('    取失败(%s)：%s' % (code, str(e)[:50]), file=sys.stderr)
                return None
            time.sleep(8 * (i + 1) if code == 429 else 4)
    return None


def px_variant(url, px):
    return PX_RE.sub('/%dpx-' % px, url, count=1)


def fetch_best(url):
    """逐档试取：1600 → 1280 → 原档。返回 (数据, 实际拿到的 url, 档位标签)；
    全都取不到则返回 (None, None, None)。"""
    m = PX_RE.search(url)
    if not m:
        # 没有尺寸段的（如 thumbnail_unscaled，已是站方渲染的最大版本），原样取一次
        data = fetch(url)
        return (data, url, '原档') if data else (None, None, None)

    orig_px = int(m.group(1))
    candidates = [px for px in PX_TIERS]
    if orig_px not in candidates:
        candidates.append(orig_px)

    for px in candidates:
        cand_url = px_variant(url, px)
        label = '%dpx' % px if px != orig_px else '原档(%dpx)' % px
        print('    试 %s…' % label, end=' ')
        data = fetch(cand_url)
        if data:
            print('取到')
            return data, cand_url, label
        print('取不到')
        time.sleep(1.0)  # 换档重试前也歇一口气，别连着砸
    return None, None, None


def main():
    force = '--force' in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    key = args[0] if args else 'shiku'
    path = os.path.join(ROOT, 'docs/pics-%s.json' % key)
    doc = json.load(io.open(path, encoding='utf-8'))
    outdir = os.path.join(ROOT, 'img/story', key)
    os.makedirs(outdir, exist_ok=True)

    total = 0
    tiers = {}
    # 一站多图（列表）逐张走同一条路（2026-08-22 香火线首用；yanyi 落点那种自摄列表天然跳过）
    flat = []
    for ev, v in doc['站'].items():
        for one in (v if isinstance(v, list) else [v]):
            flat.append((ev, one))
    for ev, v in flat:
        url = v.get('远端') or v.get('缩略图')
        if not url or url.startswith('img/'):
            url = v.get('远端')
        if not url:
            print('  %-12s 已是本地，跳过' % ev)
            continue

        # 判扩展名前先剥查询串——远端 URL 常带 ?utm_… 记号，
        # 直接 endswith 会把 PNG 存成 .jpg（2026-08-26 眼药酸实踩）
        ext = '.png' if url.split('?')[0].lower().endswith('.png') else '.jpg'
        fn = slug(v['文件']) + ext
        dest = os.path.join(outdir, fn)

        if os.path.exists(dest) and not force:
            n = os.path.getsize(dest)
            total += n
            v['远端'] = url
            v['缩略图'] = 'img/story/%s/%s' % (key, fn)
            print('  %-12s %7.0f KB  %s  [已有，跳过取档]' % (ev, n / 1024, fn[:44]))
            continue

        data, used_url, label = fetch_best(url)
        if data:
            io.open(dest, 'wb').write(data)
            n = len(data)
            v['远端'] = used_url
            tiers[label] = tiers.get(label, 0) + 1
            time.sleep(random.uniform(1.0, 2.0))
        elif os.path.exists(dest):
            n = os.path.getsize(dest)
            print('    各档都取不到，保留本地旧档：%s' % fn)
            tiers['保留旧档'] = tiers.get('保留旧档', 0) + 1
        else:
            print('  %-12s 取失败且无本地备份，跳过' % ev)
            continue

        total += n
        v['缩略图'] = 'img/story/%s/%s' % (key, fn)
        print('  %-12s %7.0f KB  %s' % (ev, n / 1024, fn[:44]))

    io.open(path, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(doc, ensure_ascii=False, indent=1))
    print('共 %.2f MB 收进 img/story/%s/' % (total / 1048576, key))
    if tiers:
        print('各档张数：%s' % '、'.join('%s %d' % (k, n) for k, n in tiers.items()))

    # 署名总表：逐张列出，谁的、什么许可、原页在哪
    L = ['# 图片署名', '',
         '本目录下的图片取自维基共享资源（Wikimedia Commons），逐张列明作者、许可与原始文件页。',
         '',
         'CC-BY 与 CC-BY-SA 要求署名，这是法律义务；CC0 与公有领域不要求，'
         '但本库一律照署——拍照片、扫卷子的是具体的人或机构，白拿还不写名字说不过去。',
         '', '图片各自的许可以本表为准，不随本仓库的代码许可。', '']
    for f in sorted(glob.glob(os.path.join(ROOT, 'docs/pics-*.json'))):
        k = os.path.basename(f)[5:-5]
        d = json.load(io.open(f, encoding='utf-8'))
        L += ['## %s' % k, '', '| 站 | 文件 | 署名 | 许可 | 原始文件页 |', '|---|---|---|---|---|']
        for ev, v in d['站'].items():
            for one in (v if isinstance(v, list) else [v]):
                page = one.get('说明页') or ''
                link = '[Commons](%s)' % page if page else '—'
                L.append('| %s | `%s` | %s | %s | %s |'
                         % (ev, os.path.basename(one.get('缩略图', '')),
                            (one.get('署名') or one.get('作者') or '—').replace('|', '｜'),
                            one.get('许可') or '—', link))
        L.append('')
    io.open(os.path.join(ROOT, 'img/CREDITS.md'), 'w', encoding='utf-8',
            newline='\n').write(chr(10).join(L))
    print('写出 img/CREDITS.md')


if __name__ == '__main__':
    main()
