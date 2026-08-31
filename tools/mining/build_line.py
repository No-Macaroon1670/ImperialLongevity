# -*- coding: utf-8 -*-
"""一条故事线的全部生成物，一条命令重出。

    python tools/mining/build_line.py [key]

顺序有讲究：先抽考据（它会保住已有的复核栏），再出资料文本与长文页——
后两样都读那份 JSON。改完 lines.js / line-text-*.js / events.js 之后跑这个，
别一个一个手动跑，漏一个就会出现「页面和账本对不上」。

全流程见 docs/idea-storylines.md 第八节。
"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable


def run(script, *a):
    print('── %s %s' % (script, ' '.join(a)))
    r = subprocess.run([PY, os.path.join(HERE, script)] + list(a),
                       env={**os.environ, 'PYTHONIOENCODING': 'utf-8'})
    if r.returncode:
        sys.exit('  ✗ %s 失败' % script)


def main():
    key = sys.argv[1] if len(sys.argv) > 1 else 'shiku'
    # 两种叙事稿形态各有抽取脚本：石窟线是一页 HTML（原稿），此后各线是 Markdown
    docs = os.path.join(HERE, '..', '..', 'docs')
    craft = os.path.join(docs, 'line-%s-craft.md' % key)
    if os.path.exists(os.path.join(docs, 'line-%s-original.html' % key)):
        run('extract_shiku_sources.py')
    elif os.path.exists(craft) and '## 三、解说词' in open(craft, encoding='utf-8').read():
        run('craft_to_sources.py', key)
    elif os.path.exists(os.path.join(docs, 'sources-%s.json' % key)):
        # payload 生线（判官卷 craft 系自由体）：考据卡已由 apply_line_payload.py 直产，抽取步跳过
        print('── craft 无解说词节而 sources-%s.json 在，视为 payload 生线，跳过抽取' % key)
    run('build_line_doc.py', key)
    run('build_line_page.py', key)
    print('全部重出完毕。别忘了 sh tools/lint-js.sh，以及浏览器里走一遍。')


if __name__ == '__main__':
    main()
