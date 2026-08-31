# -*- coding: utf-8 -*-
"""建线 payload → 库文转录（2026-08-31 管线体检补缺齿）。

    python tools/mining/apply_line_payload.py <key>

吃 docs/desk/build-<key>-payload.json（判官交卷件，schema 见既有 build-*-payload.json），
产出两样：

  1. js/line-text-<key>.js         —— PROLOGUE / TEXT / EPILOGUE 直写（json.dumps 转义，
                                      双引号与反斜杠一次写死——此步从前各班在 scratchpad
                                      手转，长文解析器双引号静默丢散文实案即出于此）
  2. <key>-lines-snippet.txt       —— lines.js 需手插的三段（import／站表数组／LINES 入口），
                                      印到 stdout 兼落盘 scratchpad；lines.js 里手写注释多，
                                      结构性插入仍走人手（Edit 工具核对着插），机器只管转义。

不碰 lines.js 本身；js/line-text-<key>.js 已存在则拒写（防覆盖已改文本）。
craft 正本另行归位 docs/line-<key>-craft.md（build_line.py 认这个名，勿带日期后缀）。
"""
import io, json, os, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))


def js_str(s):
    """单引号 JS 字面量（lines.js 手写体例）。解说词家法禁 ASCII 引号，故 ' 出现即报错。"""
    if "'" in s:
        sys.exit('  ✗ 站表文案含 ASCII 单引号（家法禁）：%s' % s[:60])
    return "'%s'" % s.replace('\\', '\\\\')


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    key = sys.argv[1]
    pj = os.path.join(ROOT, 'docs', 'desk', 'build-%s-payload.json' % key)
    with open(pj, encoding='utf-8') as f:
        d = json.load(f)
    for need in ('name', 'sub', 'lede', 'prologue', 'epilogue', 'stops', 'text'):
        if need not in d:
            sys.exit('  ✗ payload 缺键 %s' % need)

    # sources json：payload 生线不走 craft_to_sources（判官卷系自由体，无「## 三、解说词」
    # 节可抽），考据卡由此直产；「顺序」＝序＋ev 名＋落点、「站」按站题为键，皆照姊妹体例
    sj = os.path.join(ROOT, 'docs', 'sources-%s.json' % key)
    if 'sources' in d and not os.path.exists(sj):
        doc = {
            '说明': '%s长文的考据与出处，自 desk 判官 payload 经 apply_line_payload.py 转录；'
                   '「复核」一节留给事后独立重查。' % d['name'],
            '顺序': ['序'] + [s['ev'] for s in d['stops']] + ['落点'],
            '站': d['sources'],
            '复核': [],
        }
        with open(sj, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(doc, f, ensure_ascii=False, indent=1)
            f.write('\n')
        print('✔ 写出 %s（%d 站考据）' % (sj, len(d['sources'])))

    out = os.path.join(ROOT, 'js', 'line-text-%s.js' % key)
    if os.path.exists(out):
        sys.exit('  ✗ %s 已存在，拒覆盖（要重出请先手动移走）' % out)

    j = lambda o: json.dumps(o, ensure_ascii=False, indent=2)
    body = (
        '// line-text-%s.js — %s的长文。\n//\n'
        '// 与 lines.js 分开放的理由见 line-text-shiku.js 开头：那边是站表，这边是散文。\n'
        '// 本文件由 tools/mining/apply_line_payload.py 自 desk 判官 payload 转录，\n'
        '// 正本 docs/line-%s-craft.md。\n\n'
        'export const PROLOGUE = %s;\n\n'
        'export const TEXT = %s;\n\n'
        'export const EPILOGUE = %s;\n' % (
            key, d['name'], key, j(d['prologue']), j(d['text']), j(d['epilogue']))
    )
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(body)
    print('✔ 写出 %s（%d 站散文）' % (out, len(d['text'])))

    up = key.upper()
    ab = key[:2].upper()
    rows = []
    for s in d['stops']:
        rows.append('  {\n    t: %s,\n    b: %s,\n    b2: %s,\n    ev: %s,\n    card: true,\n  },'
                    % (js_str(s['t']), js_str(s['b']), js_str(s['b2']), js_str(s['ev'])))
    n = len(d['stops'])
    snippet = (
        '── ① import（与其余 line-text import 并排）──\n'
        "import { PROLOGUE as %s_PRO, TEXT as %s_TEXT, EPILOGUE as %s_EPI } from './line-text-%s.js';\n\n"
        '── ② 站表数组（与 SHENHOU 等并排）──\n'
        'const %s = [\n%s\n];\n\n'
        '── ③ LINES 入口（照 shenhou 体例）──\n'
        '  %s: {\n'
        "    key: '%s',\n"
        '    name: %s,\n'
        '    sub: %s,\n'
        '    lede: %s,\n'
        '    // 题辞（shi）留空：全线定场诗由库主（No-Macaroon1670）亲作，建线时不代拟\n'
        '    stops: [\n'
        "      { t: %s_PRO.t, b: %s_PRO.p[0], long: %s_PRO.p, full: true, read: 'story/%s.html#s0' },\n"
        '      ...%s.map((s, i) => ({\n'
        '        ...s, read: `story/%s.html#s${i + 1}`,\n'
        '        ...(%s_TEXT[s.ev] ? { long: %s_TEXT[s.ev] } : {}),\n'
        '      })),\n'
        "      { t: %s_EPI.t, b: %s_EPI.p[0], long: %s_EPI.p, full: true, read: 'story/%s.html#s%d' },\n"
        '    ],\n'
        '    prologue: %s_PRO,\n'
        '    epilogue: %s_EPI,\n'
        "    doc: 'line-%s',\n"
        '    // 地理档未建：GEO.%s 尚无，消费处皆守空（app-map 判 !L.geo、tour 判 opts.geo），\n'
        '    // 故本线暂不上舆图与走线小地图；建 geo 档时在 build_geo.py 的 PLACES 补一节\n'
        '  },\n' % (
            ab, ab, ab, key,
            up, '\n'.join(rows),
            key, key, js_str(d['name']), js_str(d['sub']), js_str(d['lede']),
            ab, ab, ab, key, up, key, ab, ab, ab, ab, ab, key, n + 1,
            ab, ab, key, key)
    )
    print(snippet)


if __name__ == '__main__':
    main()
