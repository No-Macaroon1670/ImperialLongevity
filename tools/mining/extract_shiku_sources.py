# -*- coding: utf-8 -*-
"""把石窟线原稿里的**考据**抽成结构化的 docs/sources-shiku.json。

原稿（docs/line-shiku-original.html，documentary-narrative skill 的产出）每一站
末尾都挂着一个 <details class="app">「考据」，里面是分级标注的条目与出处链接。
那是写的时候一条条核过的账，比事后重查更可信——搬进库里而不是重造。

三级标注照原稿保留，含义是本库的通例（缺失远好过猜错）在文本层的落实：
    信史／库内既有   有史料或本库既有简注支撑
    传统叙述         后世追记的说法，不是同时代记录
    补研究           原稿为这条线新查的、库内原先没有的
    推断             现代学者的重建，不是原始记载写的
    存疑／重要更正   各源不一致，或原稿明确否定了一个流行说法

另抽两样容易在转录中丢掉的东西：
    引文出处   <blockquote> 里的 <small>，如「自目可剜，佛财难得」下的
               韦皋《嘉州凌云寺大弥勒石像记》——引文没有出处等于没有引文
    站点出处   <details> 底部 .src 里的外链

用法：python tools/mining/extract_shiku_sources.py
产出：docs/sources-shiku.json
"""
import io, json, os, re

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
SRC = os.path.join(ROOT, 'docs/line-shiku-original.html')
OUT = os.path.join(ROOT, 'docs/sources-shiku.json')

# 原稿的 data-name → 本库 events.js 里的条目名（图上的落点靠它对上）
NAME2EV = {
    '白马寺': '白马寺', '克孜尔': '克孜尔石窟', '莫高窟': '敦煌石窟',
    '麦积山': '麦积山石窟', '云冈': '云冈石窟', '龙门': '龙门石窟',
    '榆林窟': '榆林窟', '乐山': '峨眉山乐山大佛', '金刚经': '金刚经印本',
    '大足': '大足石刻', '藏经洞': '藏经洞发现',
}
TAGGED = re.compile(r'<span class="tag t-\w+">([^<]+)</span>(.*?)</li>', re.S)
LINK = re.compile(r'<a href="([^"]+)"[^>]*>(.*?)</a>', re.S)
QUOTE = re.compile(r'<blockquote>(.*?)(?:<small>(.*?)</small>)?</blockquote>', re.S)


def txt(s):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', s or '')).strip()


def main():
    html = io.open(SRC, encoding='utf-8').read()
    stops, order = {}, []
    for m in re.finditer(r'<section id="(s\d+)"([^>]*)>(.*?)</section>', html, re.S):
        sid, attrs, body = m.group(1), m.group(2), m.group(3)
        nm = re.search(r'data-name="([^"]+)"', attrs)
        # 序与落点没有 data-name，按 id 认
        key = NAME2EV.get(nm.group(1)) if nm else {'s0': '序', 's12': '落点'}.get(sid)
        if not key:
            continue
        order.append(key)
        rec = {'考据': [], '出处': [], '引文': []}
        app = re.search(r'<details class="app">(.*?)</details>', body, re.S)
        if app:
            for tag, rest in TAGGED.findall(app.group(1)):
                rec['考据'].append({'级': txt(tag), '文': txt(rest)})
            src = re.search(r'<div class="src">(.*?)</div>', app.group(1), re.S)
            if src:
                for url, label in LINK.findall(src.group(1)):
                    rec['出处'].append({'题': txt(label), 'url': url})
        for q, attr in QUOTE.findall(body):
            rec['引文'].append({'文': txt(q), '出处': txt(attr)})
        stops[key] = rec

    data = {
        '说明': ('石窟线长文的考据与出处。抽自 docs/line-shiku-original.html'
                 '（documentary-narrative skill 的原稿），非事后重查。'
                 '「复核」一节是另派人手独立核过的结果，与原稿并列而不覆盖它。'),
        '顺序': order,
        '站': stops,
        '复核': [],
    }
    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(data, ensure_ascii=False, indent=1))
    nk = sum(len(v['考据']) for v in stops.values())
    nl = sum(len(v['出处']) for v in stops.values())
    nq = sum(len(v['引文']) for v in stops.values())
    print('写出 %s：%d 站，考据 %d 条，出处链接 %d 条，带出处的引文 %d 条'
          % (OUT, len(stops), nk, nl, nq))
    for k in order:
        v = stops[k]
        print('  %-10s 考据%2d 出处%2d 引文%d' % (k, len(v['考据']), len(v['出处']), len(v['引文'])))


if __name__ == '__main__':
    main()
