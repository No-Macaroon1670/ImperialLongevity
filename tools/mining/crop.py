# -*- coding: utf-8 -*-
"""裁一张自摄照片，并压到上站的尺寸。

自摄的照片是随手拍的，画面里常有游客、护栏、监控探头这类与内容无关的东西；
公共图源那边多半已经被人挑过一轮，自己拍的没有。故留这把刀。

**裁切按比例给**（0–1），不按像素：手机换了、原图尺寸变了，同一组参数照样用。

宽度压到 880px，与 vendor_pics.py 收 Commons 图时同一档——版面上最宽也就
用到 640px，再大只是白占字节。**原图另存 `-orig` 一份**：裁错了能重来，
而且原图是作者的东西，不该被工具单向吃掉。

用法：
    python tools/mining/crop.py <图> --box 左,上,右,下        # 比例，如 0.10,0.20,0.70,0.76
    python tools/mining/crop.py <图> --box ... --keep-orig no  # 不留原图
"""
import io, os, shutil, sys
from PIL import Image

MAXW = 880


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    path = sys.argv[1]
    box = None
    if '--box' in sys.argv:
        box = [float(x) for x in sys.argv[sys.argv.index('--box') + 1].split(',')]
        if len(box) != 4:
            sys.exit('--box 要四个数：左,上,右,下（0–1 的比例）')
    keep = 'no' not in sys.argv[sys.argv.index('--keep-orig') + 1:][:1] if '--keep-orig' in sys.argv else True

    im = Image.open(path)
    w0, h0 = im.size
    if keep:
        stem, ext = os.path.splitext(path)
        orig = stem + '-orig' + ext
        if not os.path.exists(orig):
            shutil.copy2(path, orig)
            print('原图另存 %s' % os.path.basename(orig))
    if box:
        l, t, r, b = box
        im = im.crop((int(l * w0), int(t * h0), int(r * w0), int(b * h0)))
        print('裁：%dx%d → %dx%d' % (w0, h0, im.size[0], im.size[1]))
    if im.size[0] > MAXW:
        h = int(im.size[1] * MAXW / im.size[0])
        im = im.resize((MAXW, h), Image.LANCZOS)
        print('压到 %dx%d' % (MAXW, h))
    # **剥掉全部 EXIF**：自摄照片可能带 GPS、机型、序列号。这批实测没有 GPS，
    # 但不能指望每一张都没有——上传到公开仓库之前一律剥净（用户要求）。
    # PIL 重新构造一个 Image 再存，元数据不会跟过来
    im = im.convert('RGB')
    clean = Image.new('RGB', im.size)
    clean.putdata(list(im.getdata()))
    clean.save(path, 'JPEG', quality=88, optimize=True, progressive=True)
    print('写回 %s（%.0f KB）' % (os.path.basename(path), os.path.getsize(path) / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
