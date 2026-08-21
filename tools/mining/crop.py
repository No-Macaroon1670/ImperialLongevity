# -*- coding: utf-8 -*-
"""裁一张自摄照片，并压到上站的尺寸。

自摄的照片是随手拍的，画面里常有游客、护栏、监控探头这类与内容无关的东西；
公共图源那边多半已经被人挑过一轮，自己拍的没有。故留这把刀。

**裁切按比例给**（0–1），不按像素：手机换了、原图尺寸变了，同一组参数照样用。

长边压到 1600px（2026-08-21 前是宽 880，竖图吃亏、说明牌糊字，已废）——版面上最宽
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
    python tools/mining/crop.py <图> --box ... --out img/own/子图名.jpg  # 子图另存，母图不动

四层文件夹（用户 2026-08-21 改定，原三夹制 2026-08-20 定）：
  img/inbox/       只放没动过的原始存入——它的文件数就是欠账数
  img/processing/  案头：处理中的工作稿、-orig 原图、重做的中间产物（不进 git）
  img/own/         成品库（**本地，不进 git**）。出品一律先落这儿；
                   成品核过之后，processing 里的原图可清
  img/used/        上线层（**唯一入库推送的照片目录**）：站点真引用到的那些

供料指南（2026-08-21，用户复盘「需要更谨慎的 pre-select」后共立）：
  · 预选到**场次**粒度即可（整场馆访保留、生活杂片场次整场不进）——张级预选不划算；
  · **说明牌照永远保留**：据比像贵，人工预选最易误删的恰是漏斗最值钱的一类
    （金鱼村前言板/假期史展板/流散名录皆出于「无聊的拍牌照」）。

管线规矩（越攒越多，都是实测立下的）：
  · **先 EXIF 转正再裁**——否则竖拍的裁框方向全错（勾践剑那张实测踩到）。
  · **裁人群优于逐个打码**（用户 2026-08-20 定）：能用构图把观众裁出画面就裁，
    比十个模糊块干净；糊脸是裁不掉时的退路。
  · 重存即剥 EXIF（含 GPS）；署名只写年月，不写日子。
  · 说明牌以 inbox 放大重读为准，对话里的初判不算定案。
  · **一图多产**（用户 2026-08-20 定）：群像照按需拆成单件子图；说明牌与文物本体
    分开裁——牌是据、物是像，用途不同。子图用 --out 另存新名，母图保持不动；
    子图优先从 processing/ 的 -orig 原图裁（880px 成品再裁会糊），无原图才裁成品。
    子图继承母图的场馆前缀，说明牌子图一律 -shuopai 后缀（shuomingpai 已废弃归一）；
    账册里子图行注明「出自某母图」。**按需拆**：故事线/条目用到单件才拆，不预拆囤货。
  · **四夹流转，开工即移，完工即清，上站才晋升**（2026-08-21 用户加第四夹；
    流转部分 2026-08-20 重申定案，实案：元旦国博组判毕未移出 inbox，
    隔批整组被重复吃工）：inbox 是用户放料区；一开始处理就把该批移入
    processing（inbox 只剩未开工者，文件数才配叫欠账数）；完工时成品入
    own/，processing 里该批 WIP（含 -orig 与中间产物）删除——原图正本在用户
    自己的相册里，这里的副本不必囤。落选照片同批一并清走。
    **出品默认进 own 本地库**：own/ 只是成品库，不是上线层，整个目录不进 git
    （库存两百余张近 40 MB，真被站点引用的不过二十来张——只有被用的才值得 push）。
    **接线／点将上站那一步才晋升 used 并入库推送**：被 js/pics-own-cards.js
    的 OWN_PIC 点名，或被某条故事线接线配图，才 `git mv img/own/x.jpg
    img/used/x.jpg`（文件名不动）、同步改引用路径、连同引用一笔提交。
    **顺序不能颠倒**：先搬文件再加引用行，反过来线上就是 404。
    下站（引用被撤）不必回搬，但也别留孤儿——按账册核。
    **三条护栏（2026-08-20 knock-on 审计补）**：①「完工」按张计不按批计——
    点将未决、验收未出品、被引为证据者不算完工，留 processing 勿清；
    ②清仓前先拆——可预见的子图（证据说明牌、单件特写）趁 -orig 在时拆出，
    清仓后重裁须请用户从相册重供；③凡被候选底稿/账册引为证据的说明牌照
    一律出成品入 own/——牌是据，据不清仓（撞「按需拆」时以本条为先）。
  · **复原建筑照片过层级关**（用户 2026-08-20 定）：重建/复原物（应天门、天堂明堂、
    大报恩寺琉璃塔）照收，但账册与图注必须标「复原建筑，非原构」；只当「遗址今貌」
    用，绝不当「古代形制证据」用——照片与文字同一套层级纪律。
    **翻拍件**（2026-08-22 立，起于沈阳故宫实体照片）：扫描/翻拍的老照片，
    EXIF 日期是翻拍日不是拍摄日——「摄于」以用户口述原拍年月为准、账册标
    「据回忆」；翻拍属性本身记入内容栏（相纸的年代感是信息不是瑕疵）。
    三级阶梯（应天门一役立全）：**原物**（夯土墩台）随便用；**复原建筑**只当
    今貌；**当代创作**（新绘武则天壁画之类）配图基本不用，唯「形象接受史」
    语境可用且必须标「当代创作」——后世怎么画她是另一条史料线，不是她本人。

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

MAXW = 1600   # 长边上限。880 时代的病：竖构图里器物只分到三百像素、说明牌小字
              # 到分辨率地板、高分屏灯箱再拉伸一遍（2026-08-21 用户目检定案）。
              # 1600 = 版面最宽 800 × DPR2，灯箱与视网膜屏同时喂饱。


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
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else None
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
    # **先转正再动刀**（管线规矩，2026-08-20 立）：手机竖拍常靠 EXIF 方向标记
    # 而像素本身是横的。不转正，--box 的「上下左右」就全是错的方向，
    # 出来的片还躺着。转正后 EXIF 随重存丢弃，正好也把定位等隐私字段一并剥掉。
    im = ImageOps.exif_transpose(im)
    w0, h0 = im.size
    if keep and not out:  # --out 模式母图本身就是原图,不必再另存一份
        stem, ext = os.path.splitext(path)
        orig = stem + '-orig' + ext
        if not os.path.exists(orig):
            shutil.copy2(path, orig)
            print('原图另存 %s' % os.path.basename(orig))
    if box:
        l, t, r, b = box
        im = im.crop((int(l * w0), int(t * h0), int(r * w0), int(b * h0)))
        print('裁：%dx%d → %dx%d' % (w0, h0, im.size[0], im.size[1]))
    long_edge = max(im.size)
    if long_edge > MAXW:
        ratio = MAXW / long_edge
        nw, nh = int(im.size[0] * ratio), int(im.size[1] * ratio)
        im = im.resize((nw, nh), Image.LANCZOS)
        print('压到 %dx%d（长边 %d）' % (nw, nh, MAXW))
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
    if out:
        # 子图另存:强制 .jpg 后缀,母图一个字节都不动
        path = os.path.splitext(out)[0] + '.jpg'
    elif ext.lower() != '.jpg':
        out_path = stem + '.jpg'
        if os.path.exists(path) and out_path != path:
            os.remove(path)
        path = out_path
    clean.save(path, 'JPEG', quality=90, optimize=True, progressive=True)
    print('写回 %s（%.0f KB）' % (os.path.basename(path), os.path.getsize(path) / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
