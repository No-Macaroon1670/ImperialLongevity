# -*- coding: utf-8 -*-
"""把一条故事线生成成一页可滚动的长文（story-<key>.html）。

站内于是有两种读法，同一份数据两个出口：

    走图  timeline.html#line=<key>   逐站打光、跳年份、开卡——**这张图怎么读**
    读文  story-<key>.html            整段散文、考据折叠、出处外链——**这件事怎么讲**

两边互链：长文每节挂「在图上看这一站 →」（深链带 at= 落到那一站），
图上的窄屏面板挂「读长文 ↗」（宽屏本来就在读全文，故不重复给）。

**深色**：叙事长文默认深色，不跟站点浅色主题走（用户定的通例）。
故本页自带一套内联样式，不引 styles.css——那是给数据界面用的，
一进长文就该换一副眼睛。字体全走系统栈，不取外部字体（本库零依赖）。

数据来源，一处不新造：
    js/lines.js            站表与站名
    js/line-text-<key>.js  长文（含序与落点）
    js/events.js           年份、类别、维基与馆藏链接、本库简注
    docs/sources-<key>.json 考据分级、出处外链、引文出处、地点

**生成物，不要手改**：改哪一样都回源头改，然后重跑。

用法：python tools/mining/build_line_page.py [key]     # 缺省 shiku
"""
import io, glob, json, os, re, shutil, subprocess, sys

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_line_doc import load_line, load_long, load_events, load_dyn, load_sources, KIND, yr  # noqa: E402

SITE = 'https://no-macaroon1670.github.io/ImperialLongevity'
# 考据分级 → 配色。四类而非五类：「信史／库内既有」同色，两者都是「有依据」
TAGCLS = {'信史': 'ok', '库内既有': 'ok', '传统叙述': 'trad', '补研究': 'new',
          '推断': 'infer', '存疑': 'doubt', '重要更正': 'doubt'}
CN = '〇一二三四五六七八九十'


def cn(n):
    """1→一，11→十一。站号用汉字：这是读物，不是表格。"""
    if n <= 10:
        return CN[n]
    if n < 20:
        return '十' + (CN[n - 10] if n > 10 else '')
    return CN[n // 10] + '十' + (CN[n % 10] if n % 10 else '')


def esc(t):
    return (t or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def rich(t):
    """**粗体** 转 <strong>。文案是本库里的字面量，不是外来输入。"""
    return re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', esc(t))


CSS = """
:root{
  --bg:#0e0d0c; --bg2:#161311; --ink:#e9e3d7; --dim:#9a9187; --faint:#5d564e;
  --rule:#2a2622; --accent:#c0603f; --gold:#c9a959;
  --serif:"Songti SC","STSong","Noto Serif SC","Source Han Serif SC","SimSun",Georgia,serif;
  --sans:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--serif);
  font-size:18px;line-height:2.05;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:inherit}
.epi-verse{padding:3rem 1.2rem 0;text-align:center}
.epi-verse .vl{font-size:21px;letter-spacing:.38em;line-height:2.35;text-indent:.38em}
.epi-verse .vby{margin-top:1rem;font-family:var(--sans);font-size:11px;color:var(--faint);letter-spacing:.24em}
#bar{position:fixed;top:0;left:0;height:2px;width:0;background:var(--accent);z-index:50}
/* 导轨：宽屏才有。窄屏那点横向空间要留给正文 */
/* 左栏：导轨在上，小地图在下。两者同住一个固定列——读者眼睛一抬，
   既知道读到第几节，也知道那一节在地上哪儿 */
#side{position:fixed;left:max(1.2rem,calc(50vw - 30rem));top:50%;transform:translateY(-50%);
  z-index:40;width:11rem}
#rail{display:flex;flex-direction:column;gap:.55rem;font-family:var(--sans);font-size:11px}
/* 点与标签的间距落在 .dot 的 margin 上而不靠 flex gap：读者侧环境（插件/旧内核）重写 <a>
   的 display 时会退成 inline 排布，margin+vertical-align 在两种排布下同样成立，标签永不吃点
   （2026-08-26 库主线上截图实案，本地净环境不复现；flex 健康时此写法与 gap 像素等价） */
#rail a{display:flex;align-items:center;color:var(--faint);text-decoration:none;
  letter-spacing:.04em;transition:color .25s}
#rail .dot{display:inline-block;vertical-align:middle;width:7px;height:7px;border-radius:50%;background:currentColor;flex:none;margin-right:.5rem;transition:transform .25s}
#rail a .lbl{display:inline-block;vertical-align:middle;opacity:0;transform:translateX(-4px);transition:opacity .25s,transform .25s;white-space:nowrap}
#rail a:hover{color:var(--dim)} #rail a:hover .lbl{opacity:1;transform:none}
#rail a.on{color:var(--accent)} #rail a.on .dot{transform:scale(1.5)}
#rail a.on .lbl{opacity:1;transform:none}
@media(max-width:1180px){#side{display:none}}
.wrap{max-width:40rem;margin:0 auto;padding:0 1.5rem}
header.cover{min-height:88vh;display:flex;flex-direction:column;justify-content:center;
  padding:6rem 0 4rem;border-bottom:1px solid var(--rule)}
.kicker{font-family:var(--sans);font-size:12px;letter-spacing:.34em;color:var(--faint);margin-bottom:2.4rem}
h1{font-size:clamp(2.4rem,8vw,4rem);line-height:1.14;margin:0 0 1.6rem;font-weight:500;letter-spacing:.06em}
.lede{font-size:1.06rem;color:var(--dim);line-height:2;max-width:30rem;margin:0}
.meta{margin-top:3.4rem;font-family:var(--sans);font-size:12px;color:var(--faint);letter-spacing:.08em}
.meta a{color:var(--gold);text-decoration:none;border-bottom:1px solid transparent}
.meta a:hover{border-bottom-color:var(--gold)}
section{padding:5.5rem 0;border-bottom:1px solid var(--rule)}
section.tone{background:var(--bg2)}
.num{font-family:var(--sans);font-size:11px;letter-spacing:.3em;color:var(--faint)}
.yr{font-family:var(--sans);font-size:2.6rem;line-height:1;color:var(--rule);margin:.4rem 0 .8rem;
  font-variant-numeric:tabular-nums;font-weight:700}
h2{font-size:1.75rem;line-height:1.35;margin:0 0 .5rem;font-weight:500;letter-spacing:.04em}
.h2-ev{font-size:.95rem;font-weight:400;color:var(--faint);letter-spacing:.02em;white-space:nowrap;margin-left:.35em}
.sub{font-family:var(--sans);font-size:12px;color:var(--faint);letter-spacing:.1em;margin:0 0 2rem}
section p{margin:0 0 1.35rem}
p.beat{color:var(--gold)}
blockquote{margin:2rem 0;padding-left:1.2rem;border-left:2px solid var(--accent);color:var(--ink)}
blockquote small{display:block;margin-top:.5rem;font-family:var(--sans);font-size:11px;
  letter-spacing:.08em;color:var(--faint)}
.go{display:inline-block;margin:.4rem 0 1.6rem;font-family:var(--sans);font-size:12px;
  letter-spacing:.08em;color:var(--gold);text-decoration:none;border-bottom:1px solid var(--rule);padding-bottom:2px}
.go:hover{border-bottom-color:var(--gold)}
details.app{margin-top:2rem;font-family:var(--sans);font-size:13px;line-height:1.85;color:var(--dim)}
details.app summary{cursor:pointer;color:var(--faint);letter-spacing:.14em;font-size:11px;
  padding:.5rem 0;border-top:1px solid var(--rule)}
details.app ul{margin:.8rem 0;padding-left:1.1rem}
details.app li{margin-bottom:.7rem}
.tag{display:inline-block;font-size:10px;letter-spacing:.08em;padding:1px 6px;margin-right:.5rem;
  border-radius:3px;border:1px solid currentColor;vertical-align:.08em}
.t-ok{color:#7d9b6e} .t-trad{color:var(--gold)} .t-new{color:#6e8a9b}
.t-infer{color:#9b8a6e} .t-doubt{color:var(--accent)}
.src{margin-top:.9rem;display:flex;flex-wrap:wrap;gap:.9rem}
.src a{color:var(--faint);text-decoration:none;border-bottom:1px solid var(--rule);font-size:12px}
.src a:hover{color:var(--dim);border-bottom-color:var(--dim)}
.note{color:var(--faint);font-size:12px;font-family:var(--sans);line-height:1.9;margin-top:1rem}
/* 配图。图注里那半行是**署名**，CC-BY／CC-BY-SA 要求给出作者与许可 */
/* 文绕图。竖幅整幅摆着时两侧全空，绕排把那块空白还给文字；
   窄屏不绕——一栏劈两半两边都读不成 */
figure.pic{margin:0 0 2rem}
figure.pic img{display:block;width:100%;height:auto;border-radius:3px}
@media(min-width:820px){
  figure.pic{float:left;width:44%;margin:.4rem 1.6rem .8rem 0}
  figure.pic.pic-wide{float:none;width:100%;margin:.6rem 0 1.2rem}
  section p,section h2,details.app{clear:none}
  details.app,.go{clear:both}
}
figure.pic figcaption{margin-top:.6rem;font-family:var(--sans);font-size:11.5px;
  line-height:1.8;color:var(--faint)}
figure.pic figcaption a{color:var(--faint);text-decoration:none;border-bottom:1px solid var(--rule)}
figure.pic figcaption a:hover{color:var(--dim)}
/* 一站多图（如落点三张）：不绕排，并排摆成一排——「能看见三样东西」，
   图就该一次看见三样，不该被文字拆成三处零散的浮块 */
.pic-trio{display:flex;flex-direction:column;gap:1.4rem;margin:0 0 2rem}
.pic-trio figure.pic{margin:0}
@media(min-width:820px){
  .pic-trio{flex-direction:row}
  .pic-trio figure.pic{float:none;width:calc(33.333% - .94rem)}
}

/* ── 地图 ────────────────────────────────────────────────────────
   开篇一张大的摆出全程，左栏一张小的跟着读到哪儿走。
   底图只有海岸线、四个大湖与黄河长江淮河，没有国界（理由见 tools/mining/build_basemap.py）。
   全程的点一律画出、只是淡；当前那一站才亮——读者要能看见自己走到哪儿，
   也要能看见还剩多少。 */
#smap{padding:4rem 0 3.5rem}
svg.hmap{display:block;width:100%;height:auto}
svg.rstrip{display:block;width:100%;max-width:640px;height:auto;margin:.4rem 0 .1rem;overflow:visible}
.rs-base{stroke:var(--rule);stroke-width:1.4}
.rs-hop{stroke:var(--accent);stroke-width:2.2}
.rs-done{fill:var(--dim)}
.rs-todo{fill:none;stroke:var(--faint);stroke-width:1.2}
.rs-cur{fill:var(--accent)}
.rs-name{fill:var(--ink);font-family:var(--sans);font-size:11.5px;letter-spacing:.08em}
.rs-end{fill:var(--faint);font-family:var(--sans);font-size:9.5px;letter-spacing:.04em}
svg.hmap{margin:1.6rem 0 1rem}
svg *{vector-effect:non-scaling-stroke}
.m-dust{fill:#6a6259;opacity:.32}
.m-idx{fill:var(--dim);font-family:var(--sans);letter-spacing:0}
.m-coast{fill:none;stroke:var(--rule);stroke-width:1.1}
.m-river{fill:none;stroke:var(--accent);stroke-width:1.2;opacity:.42}
/* 大湖：一片淡水色，压在海岸之上、河之下（层序归 render_line_map.mjs 的 append 次序）。
   用河的色相而不是另起一色——湖跟河是一族，换个颜色就成了另一种东西。这一页是
   深底，故比浅色两端（.mm-lake/.pl-lake）再压一档：填充只到河那道线有效浓度的
   三成上下，读者一眼知道这是一块水面，但抢不过河、更抢不过站点。
   填充比描边实：水面不是圈出来的区域。
   要试「少画一个湖」，不必重跑构建：.m-lake[data-lake="太湖"]{display:none} */
.m-lake{fill:var(--accent);fill-opacity:.13;stroke:var(--accent);stroke-opacity:.34;stroke-width:.8}
.m-city{fill:var(--faint);opacity:.75}
.m-city-t{fill:var(--faint);opacity:.85;font-family:var(--sans)}
.m-river-t{fill:var(--accent);opacity:.65;font-family:var(--sans)}
/* 湖名：与河名同色、小一号、更轻——湖是结不是干线（2026-08-26 story 静态图补湖案） */
.m-lake-t{fill:var(--accent);opacity:.5;font-family:var(--sans)}
.m-dot{fill:var(--dim);opacity:.5}
.m-maybe{fill:none;stroke:var(--dim);stroke-width:1.2;opacity:.55;stroke-dasharray:3 2.5}
.m-held{fill:none;stroke:var(--gold);stroke-width:1.2;opacity:.5}
/* 贴在框边的方块：东西已经出了这张图的范围（伦敦） */
.m-off{stroke-dasharray:3 2.5}
.m-flow{stroke:var(--gold);stroke-width:1;opacity:.35;stroke-dasharray:4 3}
.m-stop-t{fill:var(--dim);opacity:.8;font-family:var(--sans)}
/* 现藏之处的馆名。金色，与那个空心方块、那条虚线同一族 */
.m-held-t{fill:var(--gold);opacity:.75;font-family:var(--sans)}
/* 当前这一节：亮起来 */
.m-stop.on .m-dot{fill:var(--accent);opacity:1}
.m-stop.on .m-maybe{stroke:var(--accent);opacity:1}
.m-stop.on .m-held,.m-stop.on .m-flow{stroke:var(--gold);opacity:1}
.m-stop.on .m-stop-t{fill:var(--ink);opacity:1}
#gname{margin-top:.5rem;font-family:var(--sans);font-size:10.5px;color:var(--faint);
  line-height:1.6;min-height:2.6em}

/* 点开放大。用 <dialog>：Esc 与背景遮罩都是它自带的，不必自己写一套 */
button.zoom{display:block;width:100%;padding:0;border:0;background:none;cursor:zoom-in}
button.zoom img{transition:opacity .18s}
button.zoom:hover img{opacity:.86}
dialog#lb{border:0;padding:0;background:none;max-width:96vw;max-height:96vh;color:var(--ink)}
dialog#lb::backdrop{background:rgba(8,7,6,.92)}
#lbi{display:block;max-width:min(96vw,900px);max-height:82vh;width:auto;height:auto;
  margin:0 auto;border-radius:3px}
#lbc{max-width:min(96vw,900px);margin:.8rem auto 0;font-family:var(--sans);font-size:12px;
  line-height:1.8;color:var(--dim)}
#lbc a{color:var(--gold);text-decoration:none;border-bottom:1px solid var(--rule)}
#lbx{position:fixed;top:1.1rem;right:1.4rem;width:2.2rem;height:2.2rem;border:0;border-radius:50%;
  background:rgba(255,255,255,.1);color:var(--ink);font-size:1rem;cursor:pointer}
#lbx:hover{background:rgba(255,255,255,.2)}
footer{padding:5rem 0 7rem;font-family:var(--sans);font-size:12.5px;color:var(--faint);line-height:2}
footer a{color:var(--dim);text-decoration:none;border-bottom:1px solid var(--rule)}
footer a:hover{color:var(--ink)}
footer .row{display:flex;flex-wrap:wrap;gap:1.2rem;margin-top:1.4rem}
@media(max-width:640px){
  body{font-size:17px;line-height:1.98}
  section{padding:4rem 0}
  .yr{font-size:2rem}
  h1{letter-spacing:.03em}
}
"""

JS = """
// 进度条与导轨高亮。整页只有这一段脚本，无依赖、无外链。
var bar=document.getElementById('bar'),links=[].slice.call(document.querySelectorAll('#rail a')),
    secs=links.map(function(a){return document.getElementById(a.getAttribute('href').slice(1))});
function tick(){
  var h=document.documentElement,y=h.scrollTop||document.body.scrollTop,
      m=(h.scrollHeight-h.clientHeight)||1;
  bar.style.width=(100*y/m)+'%';
  var at=0;
  for(var i=0;i<secs.length;i++){ if(secs[i]&&secs[i].getBoundingClientRect().top<h.clientHeight*0.42) at=i; }
  for(var j=0;j<links.length;j++) links[j].className=(j===at?'on':'');
}
addEventListener('scroll',tick,{passive:true});addEventListener('resize',tick);tick();

// 点开放大。图注与署名跟着进去——放大了更该说清这是谁的
var lb=document.getElementById('lb'),lbi=document.getElementById('lbi'),lbc=document.getElementById('lbc');
[].forEach.call(document.querySelectorAll('button.zoom'),function(b){
  b.addEventListener('click',function(){
    lbi.src=b.getAttribute('data-src'); lbi.alt=b.getAttribute('data-cap')||'';
    var cap=b.getAttribute('data-cap')||'', who=b.getAttribute('data-who')||'',
        full=b.getAttribute('data-full')||'';
    lbc.innerHTML='';
    var t=document.createElement('div'); t.textContent=cap+(cap&&who?'　':'')+who; lbc.appendChild(t);
    if(full){var a=document.createElement('a'); a.href=full; a.target='_blank'; a.rel='noopener';
      a.textContent='在 Commons 看原尺寸 ↗'; var d=document.createElement('div');
      d.style.marginTop='.4rem'; d.appendChild(a); lbc.appendChild(d);}
    if(lb.showModal) lb.showModal(); else lb.setAttribute('open','');
  });
});
document.getElementById('lbx').addEventListener('click',function(){lb.close?lb.close():lb.removeAttribute('open')});
lb.addEventListener('click',function(e){ if(e.target===lb) lb.close&&lb.close(); });
"""



# ── 地图 ────────────────────────────────────────────────────────────
# 长文页的地图在**生成时**画进 HTML：这一页只有一段内联脚本、不引模块，
# 而地图的几何是死的（一条线的站点不会变），没有理由留到运行时算。
#
# **但画图的代码不在这儿了。** 从 2026-08-21 起，这张图与时间轴的小地图、
# 地图页走同一台引擎：js/plate.js ＋ js/plate-line.js，在 node 里跑
# （tools/mining/render_line_map.mjs）。原先这个文件里另有一套 python 制图
# ——自己的 project、自己的取景、自己的贪心避让、自己抄的一份 ANCHORS——
# 两百来行，且那份 ANCHORS 已经漂移（漏了沈阳、长沙两座城，同一张图两版
# 画出来的城不一样多，只是以前没人对着看）。同一语义两处维护，删净。
#
# 只剩下**导轨**：route_strip 那条站界行程条不是地图，是行进条，留在这儿。


NODE = shutil.which('node')
RENDERER = os.path.join(ROOT, 'tools/mining/render_line_map.mjs')


def map_svg(key, cls='hmap', width=640):
    """一条线的大图，交给 node 画，拿回一段 SVG 字符串直接嵌进 HTML。

    **不留 python 退路**（用户 2026-08-21 拍）：留一份退路就等于把刚删掉的
    那两百行又养起来，而那两百行正是这次要还的债。没有 node 就直说，别偷偷
    画一张跟另外两个消费者不一样的图出来。

    这条线一站都没有地理档时，渲染器输出空串——调用方据此决定那一节出不出现。
    """
    if not NODE:
        raise SystemExit(
            '没找到 node。这张图归 tools/mining/render_line_map.mjs 画（与小地图、'
            '地图页同一台引擎），PATH 里得有 node（本机验的是 v24.19.0）。')
    r = subprocess.run([NODE, RENDERER, key, '--class', cls, '--width', str(width)],
                       capture_output=True, cwd=ROOT)
    err = r.stderr.decode('utf-8', 'replace').strip()
    if r.returncode != 0:
        raise SystemExit('画图失败（%s）：\n%s' % (key, err))
    if err:
        print('  · 地图：%s' % err)
    return r.stdout.decode('utf-8')


def _who(p):
    """署名行。剥 HTML 标签兜底：Commons 元数据 Artist 常整段是 <a> 链，采图侧漏网
    一次（妈祖案 2026-08-26）就会把生标签印上图注——出口一律只留纯文本。"""
    import re as _re
    t = ' · '.join([x for x in [p.get('署名') or p.get('作者'), p.get('许可')] if x])
    return _re.sub(r'\s+', ' ', _re.sub(r'<[^>]+>', '', t)).strip()


def route_strip(stops, cur):
    """站界行程条：第 cur 站（1起）的章头示意——已过实心、本站放大带名、未来空心。
    静态即正确：第 N 站的条画「前 N-1 站已过」，不需要滚动状态（用户 2026-08-21 案：
    侧栏小图不随 stop 变，遂撤职，由此条接岗）。"""
    n = len(stops)
    if n < 2:
        return ''
    W, H, pad, y = 640.0, 50, 26, 16
    xs = [pad + (W - 2 * pad) * i / (n - 1) for i in range(n)]
    o = ['<svg class="rstrip" viewBox="0 0 640 %d" aria-hidden="true">' % H]
    o.append('<line class="rs-base" x1="%.1f" y1="%d" x2="%.1f" y2="%d"/>' % (xs[0], y, xs[-1], y))
    if cur > 1:
        o.append('<line class="rs-hop" x1="%.1f" y1="%d" x2="%.1f" y2="%d"/>' % (xs[cur - 2], y, xs[cur - 1], y))
    for i, x in enumerate(xs, 1):
        if i < cur:
            o.append('<circle class="rs-done" cx="%.1f" cy="%d" r="3"/>' % (x, y))
        elif i == cur:
            o.append('<circle class="rs-cur" cx="%.1f" cy="%d" r="5.2"/>' % (x, y))
        else:
            o.append('<circle class="rs-todo" cx="%.1f" cy="%d" r="3"/>' % (x, y))
    nm = lambda st: (st.get('ev') or '')
    if cur > 2:
        o.append('<text class="rs-end" x="%.1f" y="%d" text-anchor="start">%s</text>' % (xs[0], y + 19, esc(nm(stops[0]))))
    if cur < n - 1:
        o.append('<text class="rs-end" x="%.1f" y="%d" text-anchor="end">%s</text>' % (xs[-1], y + 19, esc(nm(stops[-1]))))
    anch = 'middle' if 1 < cur < n else ('start' if cur == 1 else 'end')
    o.append('<text class="rs-name" x="%.1f" y="%d" text-anchor="%s">%s</text>'
             % (xs[cur - 1], y + 19, anch, esc(nm(stops[cur - 1]))))
    o.append('</svg>')
    return ''.join(o)


def main():
    key = sys.argv[1] if len(sys.argv) > 1 else 'shiku'
    meta, stops = load_line(key)
    ev, dyn = load_events(), load_dyn()
    pro, long_text, epi = load_long(key)
    # 题辞（可选）：LINES[key] 里有 shi 就在封面下渲染一首短诗（免正则，纯 find）。
    # 字段 2026-08-21 从 line-text-<key>.js 的 EPIGRAPH 迁到 js/lines.js——
    # 走线开场卡（tour.js 的 full 卡）现在读同一份，取水口只留这一处。
    _src = io.open(os.path.join(ROOT, 'js/lines.js'), encoding='utf-8').read()
    epigraph = None
    _lb = re.search(r"%s:\s*\{(.*?)\n  \}," % key, _src, re.S)
    if _lb:
        _blk = _lb.group(1)
        _si = _blk.find('shi: [')
        if _si >= 0:
            _vseg = _blk[_si + 6:_blk.find(']', _si)]
            _v = _vseg.split("'")[1::2]
            _j = _blk.find("shiBy: '")
            _by = _blk[_j + 8:_blk.find("'", _j + 8)] if _j >= 0 else ''
            if _v:
                epigraph = {'v': _v, 'by': _by}
    srcs = load_sources(key)
    per = srcs.get('站', {})
    hmap = map_svg(key)          # 空串＝这条线一站都没有地理档
    pics_path = os.path.join(ROOT, 'docs/pics-%s.json' % key)
    pics = (json.load(io.open(pics_path, encoding='utf-8')).get('站', {})
            if os.path.exists(pics_path) else {})

    # 站表以 lines.js 为准（图上走的就是它），长文按 ev 挂上
    O = []
    A = O.append
    A('<!doctype html>')
    A('<html lang="zh-CN">')
    A('<head>')
    A('<meta charset="utf-8">')
    A('<meta name="viewport" content="width=device-width, initial-scale=1">')
    A('<meta name="color-scheme" content="dark">')
    A('<title>%s · %s</title>' % (esc(meta.get('name')), esc(meta.get('lede'))))
    A('<meta name="description" content="%s共 %d 站。">' % (esc(meta.get('sub') + '。'), len(stops)))
    A('<link rel="canonical" href="%s/story/%s.html">' % (SITE, key))
    A('<meta property="og:type" content="article">')
    A('<meta property="og:title" content="%s">' % esc(meta.get('name')))
    A('<meta property="og:description" content="%s">' % esc(meta.get('lede')))
    A('<meta property="og:url" content="%s/story/%s.html">' % (SITE, key))
    A('<style>%s</style>' % CSS)
    A('</head>')
    A('<body>')
    A('<div id="bar"></div>')

    # 导轨：序、十一站、落点
    rail = [('s0', pro['t'] if pro else '序')]
    for i, s in enumerate(stops, 1):
        rail.append(('s%d' % i, s['t']))
    if epi:
        rail.append(('s%d' % (len(stops) + 1), epi['t']))
    # 左栏：导轨 ＋ 小地图。两者同住一个固定列，读者眼睛一抬就知道
    # 「读到第几节」与「那一节在地上哪儿」
    A('<div id="side">')
    A('<nav id="rail" aria-label="节次">')
    for sid, label in rail:
        short = label.split('：')[0].split(' · ')[-1][:6]
        A('<a href="#%s"><span class="dot"></span><span class="lbl">%s</span></a>' % (sid, esc(short)))
    A('</nav>')
    # 侧栏小地图已撤（用户 2026-08-21 裁：太 mini 且长文页气质不合——
    # 地理全貌归页首大图，行程位置归站界行程条 route_strip）
    A('</div>')

    A('<header class="cover"><div class="wrap">')
    A('<div class="kicker">%s</div>' % esc(meta.get('sub')))
    A('<h1>%s</h1>' % esc(meta.get('name')))
    A('<p class="lede">%s</p>' % esc(meta.get('lede')))
    A('<div class="meta">共 %d 站　·　<a href="../timeline.html#line=%s">在图上走一遍 →</a>'
      '　·　<a href="%s/blob/main/docs/line-%s.md">资料与出处 ↗</a></div>'
      % (len(stops), key, 'https://github.com/No-Macaroon1670/ImperialLongevity', key))
    A('</div></header>')
    if epigraph:
        A('<section class="epi-verse"><div class="wrap">')
        for _vl in epigraph['v']:
            A('<div class="vl">%s</div>' % esc(_vl))
        if epigraph['by']:
            A('<div class="vby">%s</div>' % esc(epigraph['by']))
        A('</div></section>')
    if hmap:
        A('<section id="smap"><div class="wrap">')
        A('<div class="num">这条线在地上</div>')
        A(hmap)
        A('<p class="note">只有海岸线与黄河、长江，没有国界——这不是政区图。'
          '空心圈是各源不一致、至今没有定论的地点；方块是文物现藏之处，'
          '连着的虚线就是它离开的那段路。坐标取自 Wikidata（CC0）。</p>')
        A('</div></section>')

    quoted = set()

    def one_pic(p):
        """单张配图。图注恒有一行**署名**：CC-BY／CC-BY-SA 是法律要求，CC0 与
        公有领域不要求但本库照署。自摄的图没有 Commons 文件页，只留署名不加链。

        本地图的 src 挂**内容指纹**（?v=md5前8位）：重供同名图时字节一变链接就变，
        浏览器与 Pages CDN 的旧缓存自然失效（2026-08-22 天桥重裁被缓存坑过一次后立）。"""
        p = dict(p)
        src = p.get('缩略图') or ''
        if src and not src.startswith('http'):
            fp = os.path.join(ROOT, src)
            if os.path.exists(fp):
                import hashlib
                h = hashlib.md5(open(fp, 'rb').read()).hexdigest()[:8]
                p['缩略图'] = src + '?v=' + h
        wide = False
        src0 = (p.get('缩略图') or '').split('?')[0]
        if src0 and not src0.startswith('http'):
            fp0 = os.path.join(ROOT, src0)
            if os.path.exists(fp0):
                try:
                    from PIL import Image as _Im
                    w0, h0 = _Im.open(fp0).size
                    wide = p.get('整幅') and w0 / max(h0, 1) > 2.2
                except Exception:
                    pass
        A('<figure class="pic%s">' % (' pic-wide' if wide else ''))
        # 可点开放大。**不去取 Commons 原图**——那等于把刚去掉的外部依赖请回来；
        # 仓库里这份 880px 相对页面上的 260px 已是 3.4 倍，够看了。
        # 原尺寸给外链，想要的人自己去 Commons
        A('<button class="zoom" type="button" data-src="%s" data-cap="%s" data-who="%s" '
          'data-full="%s" aria-label="放大看：%s">'
          % (esc('../' + p['缩略图']), esc(p.get('说明') or ''),
             esc(_who(p)),
             esc(p.get('说明页') or ''), esc(p.get('说明') or '图片')))
        A('<img src="%s" alt="%s" loading="lazy">' % (esc('../' + p['缩略图']), esc(p.get('说明'))))
        A('</button>')
        who = _who(p)
        link = p.get('说明页')
        tail = ('<a href="%s" target="_blank" rel="noopener">%s</a>' % (esc(link), esc(who))
                if link else esc(who))
        A('<figcaption>%s　%s</figcaption>' % (esc(p.get('说明') or ''), tail or '图片来源'))
        A('</figure>')

    def picfig(name):
        """配图，一站一张或多张。**多张**（如落点三张自摄图）不绕排，
        并排摆成一行——见上面 `.pic-trio`。单张沿用原先的文绕图。"""
        pic = pics.get(name)
        items = pic if isinstance(pic, list) else [pic] if pic else []
        items = [p for p in items if p and p.get('缩略图')]
        if not items:
            return
        multi = len(items) > 1
        if multi:
            A('<div class="pic-trio">')
        for p in items:
            one_pic(p)
        if multi:
            A('</div>')

    recheck = {}
    for r in srcs.get('复核', []):
        recheck.setdefault(r.get('stop', ''), []).append(r)

    def app_block(name):
        """考据折叠：分级条目 ＋ 出处外链 ＋ 复核提示。三样都没有就不出这一块。"""
        rec = per.get(name) or {}
        kao, lnk = rec.get('考据', []), rec.get('出处', [])
        chk = [r for r in (recheck.get(name) or []) if r.get('verdict') != '证实']
        if not (kao or lnk):
            return
        A('<details class="app"><summary>考据</summary>')
        if kao:
            A('<ul>')
            for k in kao:
                cls = TAGCLS.get(k.get('级'), 'new')
                A('<li><span class="tag t-%s">%s</span>%s</li>' % (cls, esc(k.get('级')), esc(k.get('文'))))
            A('</ul>')
        if chk:
            # 复核不逐条抄进读物——那是账本的事。这里只报个数，指路
            A('<p class="note">另有 %d 条经事后独立复核后须留意（数字打架、引文出入、'
              '出处只到二手）。逐条见 <a href="https://github.com/No-Macaroon1670/'
              'ImperialLongevity/blob/main/docs/line-%s.md" target="_blank" '
              'rel="noopener">资料与出处</a>。</p>' % (len(chk), key))
        if lnk:
            A('<div class="src">')
            for x in lnk:
                A('<a href="%s" target="_blank" rel="noopener">%s</a>' % (esc(x['url']), esc(x['题'])))
            A('</div>')
        A('</details>')

    def paras_of(name, ps):
        """段落。以「」起头的整段当引文排，并把该引文的出处补在下面。"""
        rec = per.get(name) or {}
        quotes = {q['文'].rstrip('。'): q.get('出处', '') for q in rec.get('引文', [])}
        for p in ps:
            # 库内引文段常带句末句号，出处表里的原文不带——比对前一并削掉
            bare = p.strip('「」').rstrip('。')
            if p.startswith('「') and p.rstrip('。').endswith('」') or bare in quotes:
                attr = quotes.get(bare) or quotes.get(p) or ''
                quoted.add(bare)
                A('<blockquote>%s%s</blockquote>'
                  % (rich(bare), ('<small>%s</small>' % esc(attr)) if attr else ''))
            else:
                A('<p>%s</p>' % rich(p))

    # ── 序 ────────────────────────────────────────────────────────────
    if pro:
        A('<section id="s0" class="tone"><div class="wrap">')
        A('<div class="num">序</div>')
        A('<h2>%s</h2>' % esc(pro['t'].split('·')[-1].strip()))
        picfig('序')          # 序也可配图（石窟线：门前那匹石马）
        paras_of('序', pro['p'])
        app_block('序')
        A('</div></section>')

    # ── 十一站 ────────────────────────────────────────────────────────
    for i, s in enumerate(stops, 1):
        name = s['ev'] or ''
        e = ev.get(name) or {}
        rec = per.get(name) or {}
        A('<section id="s%d" data-year="%s" data-name="%s"><div class="wrap">' % (i, e.get('y', ''), esc(name)))
        A('<div class="num">%s / %s</div>' % (cn(i), cn(len(stops))))
        A(route_strip(stops, i))
        if e.get('y'):
            A('<div class="yr">%s</div>' % yr(e['y']))
        # 节题双层（2026-08-26 库主令，与走线站点卡对称）：雅题作节题、
        # 词条名小一号淡字随后；无雅题或两名同形则单名照旧
        if s.get('t') and name and s['t'] != name:
            A('<h2>%s <span class="h2-ev">%s</span></h2>' % (esc(s['t']), esc(name)))
        else:
            A('<h2>%s</h2>' % esc(name or s.get('t', '')))
        bits = [x for x in [rec.get('地点'),
                            yr(e['y'], e.get('y2')) if e.get('y') else None,
                            dyn.get(e.get('d')) if e.get('d') else None,
                            KIND.get(e.get('k'))] if x]
        if bits:
            A('<p class="sub">%s</p>' % esc('　·　'.join(bits)))
        picfig(name)
        paras_of(name, long_text.get(name) or [s['b'] + (s.get('b2') or '')])
        A('<a class="go" href="../timeline.html#line=%s&amp;at=%d">在图上看这一站 →</a>' % (key, i))
        # 长文优先：2026-08-26 yc/yl 拆分后 yc 只剩悬浮短版，长文在 yl（knowledge.js 卡面同约）。
        # 只取 yc 会把七页的长简注整段截成短句——本行是那颗雷的排雷针，改回 yc 即复雷。
        if e.get('yl') or e.get('yc'):
            # 段首短标与段落转义是卡面格式，平铺段落里剥掉/铺平
            _note = (e.get('yl') or e['yc']).replace('**', '').replace('\\n', ' ')
            A('<p class="note">本库简注：%s</p>' % esc(_note))
        app_block(name)
        A('</div></section>')

    # ── 落点 ──────────────────────────────────────────────────────────
    if epi:
        A('<section id="s%d" class="tone"><div class="wrap">' % (len(stops) + 1))
        A('<div class="num">落点</div>')
        A('<h2>%s</h2>' % esc(epi['t'].split('·')[-1].strip()))
        picfig('落点')         # 落点也可配图（演艺线：今日天桥三张）
        paras_of('落点', epi['p'])
        app_block('落点')
        A('</div></section>')

    A('<footer><div class="wrap">')
    A('本页由 <code>tools/mining/build_line_page.py</code> 从库内数据生成，不手改。'
      '长文出自纪录片叙事稿，考据随文写就；凡各源不一致的数字，做法是一个都不给。')
    A('<div class="row">')
    A('<a href="../timeline.html#line=%s">在图上走一遍 →</a>' % key)
    A('<a href="index.html">中国帝王寿命数据库</a>')
    A('<a href="https://github.com/No-Macaroon1670/ImperialLongevity/blob/main/docs/line-%s.md" '
      'target="_blank" rel="noopener">资料与出处 ↗</a>' % key)
    A('<a href="https://github.com/No-Macaroon1670/ImperialLongevity/issues/new?labels=%%E5%%8B%%98%%E8%%AF%%AF&amp;title=%%E5%%8B%%98%%E8%%AF%%AF%%EF%%BC%%9A" '
      'target="_blank" rel="noopener">报个错 ↗</a>')
    A('</div></div></footer>')
    A('<dialog id="lb"><button id="lbx" type="button" aria-label="关闭">✕</button>'
      '<img id="lbi" alt=""><div id="lbc"></div></dialog>')
    A('<script>%s</script>' % JS)
    A('</body></html>')

    # 2026-08-26 搬目录案（库主裁：未公布故零存根成本）：story 页迁 story/ 子目录
    out = os.path.join(ROOT, 'story', '%s.html' % key)
    html = '\n'.join(O)
    io.open(out, 'w', encoding='utf-8', newline='\n').write(html)
    print('写出 %s：%d 节，%d 字节' % (out, len(rail), len(html.encode('utf-8'))))
    miss = [s['ev'] for s in stops if s['ev'] and s['ev'] not in long_text]
    if miss:
        print('  · 无长文的站（用了短文案）：', miss)
    allq = {q['文'].rstrip('。') for r in per.values() for q in r.get('引文', [])}
    if allq - quoted:
        print('  ⚠ 有出处却没在文里排成引文的：', sorted(allq - quoted))



def emit_line_pics():
    """汇出 js/line-pics.js：各线 pics-*.json 里打了「卡」标的那一张 → 导览卡主图。

    通用机制（2026-08-22 库主定）：一站多图时恰有一张 卡:true 者登导览卡；
    单图站同样须打标——「图即主语」才上卡，与石窟线 build_pics.py 旧例同义。
    缩略图挂内容指纹（?v=md5前8），与 story 页同一防缓存策略。
    """
    import hashlib
    out = {}
    for f in sorted(glob.glob(os.path.join(ROOT, 'docs', 'pics-*.json'))):
        key = os.path.basename(f)[5:-5]
        d = json.load(io.open(f, encoding='utf-8'))
        stations = {}
        for name, v in (d.get('站') or {}).items():
            items = v if isinstance(v, list) else [v]
            tagged = [x for x in items if x and x.get('卡')]
            if not tagged:
                continue
            if len(tagged) > 1:
                print('  [line-pics] %s·%s 有 %d 张打「卡」标，只取第一张' % (key, name, len(tagged)))
            p2 = dict(tagged[0])
            src = p2.get('缩略图') or ''
            if src and not src.startswith('http'):
                fp = os.path.join(ROOT, src)
                if os.path.exists(fp):
                    h = hashlib.md5(open(fp, 'rb').read()).hexdigest()[:8]
                    p2['缩略图'] = src + '?v=' + h
            stations[name] = {k2: p2[k2] for k2 in
                              ('缩略图', '说明', '作者', '署名', '许可', '说明页', '整幅') if p2.get(k2)}
        if stations:
            out[key] = stations
    NL = chr(10)
    js = NL.join([
        '// line-pics.js — 各线导览卡主图索引。**生成物，不要手改**：',
        '// 改 docs/pics-<线>.json 的「卡」标后跑 tools/mining/build_line_page.py <线>。',
        '// 挑选规则见 build_line_page.py emit_line_pics 档头。',
        'export const LINE_PICS = ' + json.dumps(out, ensure_ascii=False, indent=1) + ';',
        ''])
    io.open(os.path.join(ROOT, 'js', 'line-pics.js'), 'w', encoding='utf-8', newline='').write(js)
    print('写出 js/line-pics.js（%d 条线）' % len(out))


if __name__ == '__main__':
    main()
    emit_line_pics()
