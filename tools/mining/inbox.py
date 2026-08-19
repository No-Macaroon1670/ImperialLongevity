# -*- coding: utf-8 -*-
"""看一眼 img/own/ 里有什么：尺寸、拍摄日期、字节数。

自摄照片是用户随手丢进来的，文件名多半是相机原名（PXL_20231215_… 之类）。
本脚本先把能自动读出来的读出来——**拍摄日期从 EXIF 取，不靠回忆**，
署名那一栏要写「摄于某年某月」，记错了比不写更糟。

认领与改名由人做（看图认地方这件事机器不该替人拍板），改名用 --rename。

用法：
    python tools/mining/inbox.py                       # 列出现有
    python tools/mining/inbox.py --rename 旧名=新名 ...  # 批量改名（新名不带扩展名）
"""
import io, os, sys
from PIL import Image
from PIL.ExifTags import TAGS

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
DIR = os.path.join(ROOT, 'img', 'own')
EXT = ('.jpg', '.jpeg', '.png', '.webp', '.heic')


def shot_date(im):
    """EXIF 里的拍摄时间。取不到就返回 None——**不拿文件修改时间充数**，
    那是拷贝进来的时间，不是按快门的时间。"""
    try:
        ex = im.getexif()
        for k, v in ex.items():
            if TAGS.get(k) in ('DateTimeOriginal', 'DateTime'):
                return str(v)[:10].replace(':', '-')
        ifd = ex.get_ifd(0x8769)
        for k, v in (ifd or {}).items():
            if TAGS.get(k) == 'DateTimeOriginal':
                return str(v)[:10].replace(':', '-')
    except Exception:
        pass
    return None


def main():
    if not os.path.isdir(DIR):
        os.makedirs(DIR, exist_ok=True)
    if '--rename' in sys.argv:
        for pair in sys.argv[sys.argv.index('--rename') + 1:]:
            if '=' not in pair:
                continue
            old, new = pair.split('=', 1)
            src = os.path.join(DIR, old)
            if not os.path.exists(src):
                print('  找不到 %s' % old)
                continue
            ext = os.path.splitext(old)[1].lower()
            ext = '.jpg' if ext in ('.jpeg', '.heic') else ext
            dst = os.path.join(DIR, new + ext)
            os.rename(src, dst)
            print('  %s → %s' % (old, os.path.basename(dst)))
        return 0

    files = sorted(f for f in os.listdir(DIR) if f.lower().endswith(EXT))
    if not files:
        print('img/own/ 还是空的')
        return 0
    print('%-40s %11s %10s %9s' % ('文件', '尺寸', '拍摄', '大小'))
    for f in files:
        p = os.path.join(DIR, f)
        try:
            im = Image.open(p)
            wh = '%dx%d' % im.size
            d = shot_date(im) or '（EXIF 无）'
        except Exception as e:
            wh, d = '读不出', str(e)[:20]
        print('%-40s %11s %10s %8.0f KB' % (f[:40], wh, d, os.path.getsize(p) / 1024))
    print('\n共 %d 张。看图认领后用：python tools/mining/inbox.py --rename 旧名=新名' % len(files))
    return 0


if __name__ == '__main__':
    sys.exit(main())
