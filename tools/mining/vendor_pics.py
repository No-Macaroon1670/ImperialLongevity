# -*- coding: utf-8 -*-
"""把选定的配图收进仓库：img/<key>/，并写出 img/CREDITS.md。

**为什么不直接挂 upload.wikimedia.org 的链接**（实测过才决定的）：

  · 零依赖。站点其余部分不挂任何外部运行时依赖，图挂着就破了这条通例。
  · 隐私。挂链的话，读者每翻一页，IP 都送到 Wikimedia 一次。
  · 会断。Commons 的缩略图 URL 里嵌着文件名，人家改个名图就没了。

代价可以忽略：实测十一张 880px 缩略图合计 2.85 MB（每张均 265 KB），
GitHub Pages 的软上限是仓库与站点各 1 GB、月流量 100 GB，十条线也才 29 MB。

下载的是 Wikimedia 自己渲染的 880px 版本，**不重新编码**——少一层「衍生作品」
的麻烦，也少一次画质损失。

署名随图走：img/CREDITS.md 逐张列出作者、许可与 Commons 文件页。
这不是客气，是 CC-BY／CC-BY-SA 的硬要求；CC0 与公有领域虽不强制，
本库照署（有名字就署，见 build_pics.py 的 credit_of）。

用法：python tools/mining/vendor_pics.py <key>
产出：img/<key>/*.jpg、img/CREDITS.md，并把 pics-<key>.json 的 `缩略图` 改成本地路径
"""
import io, json, os, re, sys, time, glob
import urllib.request

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
UA = {"User-Agent": "ImperialLongevity-vendor/1.0 (self-hosting curated storyline images)"}


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
            if i == tries - 1:
                print('    取失败(%s)：%s' % (code, str(e)[:50]), file=sys.stderr)
                return None
            time.sleep(8 * (i + 1) if code == 429 else 4)
    return None


def main():
    key = sys.argv[1] if len(sys.argv) > 1 else 'shiku'
    path = os.path.join(ROOT, 'docs/pics-%s.json' % key)
    doc = json.load(io.open(path, encoding='utf-8'))
    outdir = os.path.join(ROOT, 'img', key)
    os.makedirs(outdir, exist_ok=True)

    total = 0
    for ev, v in doc['站'].items():
        url = v.get('远端') or v.get('缩略图')
        if not url or url.startswith('img/'):
            url = v.get('远端')
        if not url:
            print('  %-12s 已是本地，跳过' % ev)
            continue
        ext = '.jpg' if not url.lower().endswith('.png') else '.png'
        fn = slug(v['文件']) + ext
        dest = os.path.join(outdir, fn)
        if os.path.exists(dest):
            n = os.path.getsize(dest)
        else:
            data = fetch(url)
            if not data:
                continue
            io.open(dest, 'wb').write(data)
            n = len(data)
            time.sleep(2.0)
        total += n
        v['远端'] = url                      # 留着原始地址，便于日后重取或核对
        v['缩略图'] = 'img/%s/%s' % (key, fn)
        print('  %-12s %7.0f KB  %s' % (ev, n / 1024, fn[:44]))

    io.open(path, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(doc, ensure_ascii=False, indent=1))
    print('共 %.2f MB 收进 img/%s/' % (total / 1048576, key))

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
            L.append('| %s | `%s` | %s | %s | [Commons](%s) |'
                     % (ev, os.path.basename(v.get('缩略图', '')),
                        (v.get('署名') or v.get('作者') or '—').replace('|', '｜'),
                        v.get('许可') or '—', v.get('说明页') or ''))
        L.append('')
    io.open(os.path.join(ROOT, 'img/CREDITS.md'), 'w', encoding='utf-8',
            newline='\n').write(chr(10).join(L))
    print('写出 img/CREDITS.md')


if __name__ == '__main__':
    main()
