// app.js — 统计核心页(index.html)的入口
//
// 页面一分为二的缘由：王朝全景(河流／泳道／知识卡／承继细丝)已长成一件独立的
// 作品——它回答「谁在何时统治、天下有多分裂、谁承谁」，而本页回答「帝王的寿命
// 由什么决定」。两者共用同一份数据与同一套外壳(shell.js)，但各有各的读者、
// 各有各的入口与标题。全景页见 timeline.html。
import { mountApp, mountSib } from './shell.js';
import { SECTIONS } from './sections-stats.js';

// 页首互链一行（去 clutter 案 §一.1）。先挂 nav 再挂正文：mountApp 会跑一整轮
// render()，先把页首定住，读者就不会看见标题行事后跳一格。
// 件在 js/sib-nav.js，shell.js 只转手——五页拿的是同一份字面
mountSib();

mountApp({ sections: SECTIONS, hero: true });

// 「数据来源与口径」折叠块搬到第一张图之下（决策 D58 案 C）。原先它夹在目录与
// 正文之间，手机 375×812 上把 #timeline 的 .chart-host 顶推到 y=823——差 11px
// 掉出首屏。折叠块不丢一个字，只换落点：读者先看见图，要核口径再往下一行。
// 搬位只能在 JS 做——章节卡是 mountApp 现生成的，index.html 里没有它的锚点。
// mountApp 只建一次卡（render() 此后只重填 ctrl/chart），故这一次移动是稳的。
const srcNotes = document.getElementById('sources');
const firstCard = document.getElementById('timeline');
if (srcNotes && firstCard) firstCard.after(srcNotes);

// 从前这里还有一句 syncCounts({ geo: GEO_STATS.ev })：唯一的消费端是页首那段
// 「另外几种读法」里的 data-il-count="geo"。那段散文整段撤了（释义进 nav 的
// title、不带数字），故连 geo-stats 的 import 一并撤——本页不再有回填点
