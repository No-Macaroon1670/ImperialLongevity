# -*- coding: utf-8 -*-
"""裁一张自摄照片，并压到上站的尺寸。

自摄的照片是随手拍的，画面里常有游客、护栏、监控探头这类与内容无关的东西；
公共图源那边多半已经被人挑过一轮，自己拍的没有。故留这把刀。

**裁切按比例给**（0–1），不按像素：手机换了、原图尺寸变了，同一组参数照样用。

宽度压到 880px，与 vendor_pics.py 收 Commons 图时同一档——版面上最宽也就
用到 640px，再大只是白占字节。**原图另存 `-orig` 一份**：裁错了能重来，
而且原图是作者的东西，不该被工具单向吃掉。

裁不动的时候就**打码**：主体占满画面、路人挤在边上或透过玻璃站在主体背后时，
裁掉人等于把主体也裁没。用户 2026-08-19 定：「若是有人脸 blur 也可以。」
--blur 收一组或多组矩形（同样是比例），逐块高斯模糊，半径按块的短边自适应，
**保证认不出是谁**而不是意思一下。

用法：
    python tools/mining/crop.py <图> --box 左,上,右,下        # 比例，如 0.10,0.20,0.70,0.76
    python tools/mining/crop.py <图> --blur 左,上,右,下 [...]  # 可给多块，先裁后模糊
    python tools/mining/crop.py <图> --auto                     # 提亮＋拉对比＋锐化
    python tools/mining/crop.py <图> --box ... --keep-orig no  # 不留原图

--auto 是给**博物馆内景**用的（用户 2026-08-19 要求：内景常需处理，主体要更突出）。
展厅普遍照度低、玻璃压一层灰、手机又降噪抹细节，原片往往灰扁。三步：
  1 autocontrast(cutoff=0.4)——只掐掉最暗最亮各 0.4%，**不碰说明牌的白**，
    掐多了牌面就成一片白，字先没了，而牌就是出处；
  2 亮度与对比各提一档（1.12 / 1.10），幅度小，宁可欠一点也不要把暗部噪点抬出来；
  3 UnsharpMask(radius=1.6, percent=110, threshold=3)——threshold 留 3 是为了
    **只锐化边缘、不锐化平面噪点**，否则墙面和展台会长出一层砂。
顺序不能换：先拉直方图再锐化，反过来会把已被放大的噪点再锐一遍。
"""
import io, os, shutil, sys
from PIL import Image, ImageFilter, ImageOps, ImageEnhance

MAXW = 880


def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith('--'):
        print(__doc__)
        return 1
    path = sys.argv[1]
    box = None
    if '--box' in sys.argv:
        box = [float(x) for x in sys.argv[sys.argv.index('--box') + 1].split(',')]
        if len(box) != 4:
            sys.exit('--box 要四个数：左,上,右,下（0–1 的比例）')
    keep = 'no' not in sys.argv[sys.argv.index('--keep-orig') + 1:][:1] if '--keep-orig' in sys.argv else True
    auto = '--auto' in sys.argv
    blurs = []
    if '--blur' in sys.argv:
        for a in sys.argv[sys.argv.index('--blur') + 1:]:
            if a.startswith('--'):
                break
            v = [float(x) for x in a.split(',')]
            if len(v) != 4:
                sys.exit('--blur 每块要四个数：左,上,右,下（0-1 的比例）')
            blurs.append(v)

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
    if auto:
        before = im.convert('L').resize((64, 64)).getdata()
        im = ImageOps.autocontrast(im.convert('RGB'), cutoff=0.4)
        im = ImageEnhance.Brightness(im).enhance(1.12)
        im = ImageEnhance.Contrast(im).enhance(1.10)
        im = im.filter(ImageFilter.UnsharpMask(radius=1.6, percent=110, threshold=3))
        after = im.convert('L').resize((64, 64)).getdata()
        print('提亮：平均亮度 %.0f → %.0f' % (sum(before)/len(before), sum(after)/len(after)))
    for l, t, r, b in blurs:
        w, h = im.size
        box = (int(l * w), int(t * h), int(r * w), int(b * h))
        patch = im.crop(box)
        # 半径取块短边的六分之一：块越大糊得越狠，小块也不会只糊出个毛边。
        # 目的是**认不出是谁**，不是意思一下——脸只糊一点点等于没糊。
        rad = max(6, min(patch.size) // 6)
        im.paste(patch.filter(ImageFilter.GaussianBlur(rad)), box)
        print('打码 %dx%d 于 (%d,%d)，半径 %d' % (box[2]-box[0], box[3]-box[1], box[0], box[1], rad))
    # **剥掉全部 EXIF**：自摄照片可能带 GPS、机型、序列号。这批实测没有 GPS，
    # 但不能指望每一张都没有——上传到公开仓库之前一律剥净（用户要求）。
    # PIL 重新构造一个 Image 再存，元数据不会跟过来
    im = im.convert('RGB')
    clean = Image.new('RGB', im.size)
    clean.putdata(list(im.getdata()))
    # **一律存成 .jpg**：输入可能是 webp/png/heic（手机与网页图源常见），
    # 而这里存的是 JPEG 数据；若照原扩展名写回，就会出现「叫 .webp 的 JPEG 文件」，
    # 浏览器多半仍能显示，但 `<img>` 之外的工具会按扩展名判类型而读错。
    # 扩展名与内容必须一致——这是出处准确性的最低一档。
    stem, ext = os.path.splitext(path)
    if ext.lower() != '.jpg':
        out_path = stem + '.jpg'
        if os.path.exists(path) and out_path != path:
            os.remove(path)
        path = out_path
    clean.save(path, 'JPEG', quality=88, optimize=True, progressive=True)
    print('写回 %s（%.0f KB）' % (os.path.basename(path), os.path.getsize(path) / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
