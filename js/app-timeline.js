// app-timeline.js — 王朝全景页(timeline.html)的入口
//
// 与统计页共用 shell.js 的状态、筛选、渲染循环与后台自愈；本页只装全景章节，
// 不要页首统计条(那属于寿命数据库)。
import { mountApp, mountSib } from './shell.js';
import { SECTIONS } from './sections-panorama.js';
import { mountSearch } from './search.js';
import { buildLineCatalog, lineFromHash, lineHash } from './line-catalog.js';
import { buildPlaceCatalog } from './place-catalog.js';
import { mountTour } from './tour.js';
import { lineOf, LINES } from './lines.js';

mountApp({ sections: SECTIONS, hero: false });
// 页首互链一行（2026-09-08 去 clutter 案 §一.1）：登记表与渲染都在零依赖叶子
// js/sib-nav.js，shell 只转手一份。越早挂越好——JS 到货前 .mh-row 已在 HTML 里，
// 挂上去不跳版
mountSib();

const panorama = document.getElementById('panorama');
const chartHost = () => document.querySelector('#panorama .chart-host');

// 工具簇：节题独占一行、五颗入口另起一行（库主 2026-09-08 追加 §六.2 的「路 B」）。
// 从前题与 ⚙🧭📖📍🎲＋搜索框挤在同一条 flex 行上——宽屏像标题拖了条小尾巴，
// 窄屏则题折两行、钮再折第三行，宽窄两副样子。收进一个显式容器之后：
//   ① 版式恒定两行，宽窄同构（.sec-tools 是 flex-basis:100% 的整行）；
//   ② 钉住态由**容器一个人** position:fixed，簇内各钮回到流内排布——
//      从前是六颗钮各自 fixed、各写一条 right: calc(…+40px+80px+120px) 的偏移，
//      加一颗钮就得把后面几条常数全改一遍，且实测已撞过（📍 与黑条左钮差 2px）。
// tour.js／search.js 各自的 append 点改成先找 .sec-tools，找不到才退回 .head，
// 于是不载本容器的页（统计页、故事线深链页）行为一字不变。
const tools = document.createElement('div');
tools.className = 'sec-tools';
(panorama.querySelector('.head') || panorama).appendChild(tools);

// 导览先挂:两者都往 .head 里塞按钮,而搜索框靠 margin-left:auto 顶到最右,
// 先挂的导览按钮才会留在标题这一侧
mountTour(panorama, chartHost);

// ── 策展故事线：#line=<key> 拉起一条线 ────────────────────────────────
// 与导览同一套引擎（约定见 docs/idea-storylines.md「四之五」），只是换一套站表：
// 导览教你怎么读这张图，故事线用这张图讲一件事。目录 UI 留待第二条线，
// 眼下先把深链打通——一条线本来就该是「发得出去的一个链接」。
let lineTour = null;
function openLine(key, at) {
  const line = lineOf(key);
  if (!line) return false;
  // **拆掉，不是藏起来**：从目录里换线时旧的那套还挂在 DOM 上——
  // 两个坞、两张小地图、两套键盘监听同时抢方向键。实测每换一次线漏一整套
  if (lineTour) { lineTour.destroy(); lineTour = null; }
  // 故事线一开就转深色，结束再放回去（用户定的通例：叙事默认深色）。
  // 存的是**读者原来的那个值**而不是「浅色」——他若本来就在深色，
  // 结束时不该被推到浅色去；他若从没选过（属性缺席），就把属性摘掉，
  // 交还给系统的 prefers-color-scheme
  const root = document.documentElement;
  const themeWas = root.getAttribute('data-theme');
  root.setAttribute('data-theme', 'dark');
  syncThemeLabel();
  lineTour = mountTour(panorama, chartHost, {
    stops: line.stops, tag: line.name, key: `il.line.${line.key}`, launch: false, geo: line.geo,
    shi: line.shi, shiBy: line.shiBy,
    onStop: () => {
      if (themeWas) root.setAttribute('data-theme', themeWas);
      else root.removeAttribute('data-theme');
      syncThemeLabel();
    },
  });
  // at 是**长文页里的节号**（一起算，序＝0），故直接当下标用。
  // 长文那边每节挂着「在图上看这一站 →」，落到哪一站得说得准
  const n = Number.isFinite(at) ? Math.max(0, Math.min(line.stops.length - 1, at)) : 0;
  lineTour.start(n);
  return true;
}
// 主题按钮的字要跟着走，否则读者看到「🌙 深色」而页面已经是深色的了
function syncThemeLabel() {
  const tt = document.getElementById('theme-toggle');
  if (!tt) return;
  const cur = document.documentElement.getAttribute('data-theme');
  const dark = cur === 'dark' || (!cur && matchMedia('(prefers-color-scheme: dark)').matches);
  tt.textContent = dark ? '☀ 浅色' : '🌙 深色';
}
// ── 故事目录 ────────────────────────────────────────────────────────
// 书的按钮开的是**目录**而不是某一条线：线会越来越多，而「有哪些线可走」
// 本身就是读者要先看见的东西（用户指出）。目录只列名字、一句话与站数，
// 点一条才进去——选择在读者手里，不在按钮上。
const { el: catalog, open: openCatalog } = buildLineCatalog({
  lines: Object.values(LINES),
  onPick: (line) => { history.replaceState(null, '', lineHash(line.key)); openLine(line.key); },
});
{
  const head = tools;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip tour-launch line-launch';
  // 两段结构与骰子一致：钉进顶栏时只留图标，展开时带名字
  const face = document.createElement('span');
  face.className = 'line-face';
  face.textContent = '📖';
  const label = document.createElement('span');
  label.textContent = '故事线';
  btn.append(face, label);
  btn.title = '故事线目录：穿过这张图的几种读法';
  btn.setAttribute('aria-label', '故事线目录');
  btn.addEventListener('click', openCatalog);
  head.appendChild(btn);

  // 地方线目录（库主 2026-09-07 令）：与骰子、故事线同一簇、同一元件规格——
  // 三颗钮问的是三个不同的「从哪儿进去」：🎲 随手一条、📖 挑一条读法、📍 挑一座城。
  // 钉住态由 .sec-tools.pinned 整簇接管（逐钮的 .place-launch.pinned 一族已随
  // 2026-09-08 的工具簇改造整段删掉）：簇内各钮按 flex 排队，无需手算右偏移
  const { open: openPlaces } = buildPlaceCatalog();
  const pbtn = document.createElement('button');
  pbtn.type = 'button';
  pbtn.className = 'chip tour-launch place-launch';
  const pface = document.createElement('span');
  pface.className = 'place-face';
  pface.textContent = '📍';
  const plabel = document.createElement('span');
  plabel.textContent = '地方线';
  pbtn.append(pface, plabel);
  pbtn.title = '地方线目录：站在一座城里看四千年';
  pbtn.setAttribute('aria-label', '地方线目录');
  pbtn.addEventListener('click', openPlaces);
  head.appendChild(pbtn);
}

addEventListener('hashchange', () => { const k = lineFromHash(); if (k) openLine(k.key, k.at); });
// 首屏：等图渲染完再拉线，否则第一站落位时还没有可量的图
{
  const k = lineFromHash();
  if (k) setTimeout(() => openLine(k.key, k.at), 400);
}

// 搜索与深链:两千年的长卷,得能搜得到、也发得出(见 js/search.js)
mountSearch(panorama, chartHost);

// 从前这里还有一句 syncCounts({emp,dyn,ev,geo})：它回填的是页首那段「同一份数据的
// 另外几种读法」里的 data-il-count（去 clutter 案 §一.1 整段撤掉，换成 nav.sib）。
// counts.js 是一次性 querySelectorAll、不带 MutationObserver，全页零个 data-il-count
// 之后那一句只是空跑一次循环，还顺带把 EMPERORS/EVENTS/GEO_STATS 三份数据拖进本模块
// 的依赖图。本页要数字的地方（泳道图例、数据表把手）各自现算，不经 counts。
// 别处仍在用：map.html 三处、about.html 四处（app-map.js／app-about.js 各自调）。
