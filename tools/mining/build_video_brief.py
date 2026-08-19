# -*- coding: utf-8 -*-
"""生成 docs/video-brief.md —— 给 Gemini Spark 的视频/链接征集单。

拼装两半：docs/video-brief-header.md（总则，手写）＋工作流产出的逐站简报
（scratchpad/video_briefs.json，字段 n/line/want/keywords/fallback）。
站点数据取自 scratchpad/line_stops.json（由 events.js 抽出）。

每站渲染成一个可填的块：想看什么 / 检索词 / 退路 / ▢ 请填。
回填后用 tools/mining/ingest_video_links.py 核验入库（见故事线构想档）。
"""
import io, json, os, re

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
SC = (r"C:/Users/ziyi_/AppData/Local/Temp/claude/C--Users-ziyi--Claude/"
      r"1fabfb86-a26a-4b09-be7f-6c753fa25f61/scratchpad")

LINE_ORDER = ['赤壁线', '四大美人线', '北京线', '石窟线', '两岸故宫线', '史笔线', '沉船线']
LINE_INTRO = {
    '赤壁线': '一场战役九百年的回响：从赤壁鏖兵，到苏轼的赋，再到金人画笔下的赤壁。',
    '四大美人线': '三位在图上、一位不在——貂蝉是小说人物，无史源，但她「认识」的人都在。',
    '北京线': '一座城的四千年：从战国燕地，到元大都的中轴线，到清代三山五园。',
    '石窟线': '佛教东传与中国化的实物轴：白马驮经到大足石刻，一千八百年的凿壁。',
    '两岸故宫线': '一件器物两种命运：1933 年文物南迁之后，同一批藏品分处两岸。',
    '史笔线': '君权与史官争夺记载权——「历史由谁写下」是这个库的元主题。',
    '沉船线': '水下考古＝另一种史料：沉船不是遗址，是时间胶囊，船货就是沉没那年的贸易实况。',
}


def fmt_year(y):
    return ('前%d' % (-y + 1)) if y <= 0 else str(y)


def main():
    stops = json.load(io.open(os.path.join(SC, 'line_stops.json'), encoding='utf-8'))
    briefs = json.load(io.open(os.path.join(SC, 'video_briefs.json'), encoding='utf-8'))
    bmap = {(b['n'], b['line']): b for b in briefs}
    bynm = {b['n']: b for b in briefs}

    out = [io.open(os.path.join(ROOT, 'docs/video-brief-header.md'), encoding='utf-8').read()]
    grouped, miss = {}, []
    for s in stops:
        grouped.setdefault(s['line'], []).append(s)

    n_total = 0
    for line in LINE_ORDER:
        rows = grouped.get(line) or []
        if not rows:
            continue
        out.append('\n## %s\n' % line)
        out.append('*%s*\n' % LINE_INTRO.get(line, ''))
        for i, s in enumerate(rows, 1):
            b = bmap.get((s['n'], s['line'])) or bynm.get(s['n'])
            if not b:
                miss.append((line, s['n']))
                continue
            n_total += 1
            head = '### %s-%d　%s（%s）' % (line[:2], i, s['n'], fmt_year(s['y']))
            if s.get('ya'):
                head += '　※雅名「%s」' % s['ya']
            out.append(head + '\n')
            if s.get('yc'):
                out.append('> 本库简注：%s\n' % s['yc'])
            out.append('- **想看什么**：%s' % b['want'])
            out.append('- **检索词**：%s' % b['keywords'])
            out.append('- **找不到视频的退路**：%s' % b['fallback'])
            if s.get('m'):
                out.append('- 已有馆藏页：%s（可作旁证，但仍请找视频）' % s['m'])
            out.append('- ▢ 请填：\n')

    io.open(os.path.join(ROOT, 'docs/video-brief.md'), 'w', encoding='utf-8', newline='\n').write('\n'.join(out))
    print('写出 docs/video-brief.md：%d 站' % n_total)
    if miss:
        print('  ⚠ 无简报的站：', miss)


if __name__ == '__main__':
    main()
