// app-timeline.js — 王朝全景页(timeline.html)的入口
//
// 与统计页共用 shell.js 的状态、筛选、渲染循环与后台自愈；本页只装全景章节，
// 不要页首统计条(那属于寿命数据库)。
import { mountApp } from './shell.js';
import { SECTIONS } from './sections-panorama.js';
import { mountSearch } from './search.js';
import { buildLineCatalog } from './line-catalog.js';
import { mountTour } from './tour.js';
import { lineOf, LINES } from './lines.js';
import { EMPERORS, DYNASTIES } from './data.js';
import { EVENTS } from './events.js';
import { GEO_STATS } from './geo-stats.js';
import { syncCounts as fillCounts } from './counts.js';

mountApp({ sections: SECTIONS, hero: false });

const panorama = document.getElementById('panorama');
const chartHost = () => document.querySelector('#panorama .chart-host');

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
  onPick: (line) => { history.replaceState(null, '', `#line=${line.key}`); openLine(line.key); },
});
{
  const head = panorama.querySelector('.head') || panorama;
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
}

const lineFromHash = () => {
  const m = /(?:^|[#&])line=([a-z0-9_-]+)/i.exec(location.hash || '');
  if (!m) return null;
  const a = /(?:^|[#&])at=(\d+)/i.exec(location.hash || '');
  return { key: m[1].toLowerCase(), at: a ? Number(a[1]) : undefined };
};
addEventListener('hashchange', () => { const k = lineFromHash(); if (k) openLine(k.key, k.at); });
// 首屏：等图渲染完再拉线，否则第一站落位时还没有可量的图
{
  const k = lineFromHash();
  if (k) setTimeout(() => openLine(k.key, k.at), 400);
}

// 搜索与深链:两千年的长卷,得能搜得到、也发得出(见 js/search.js)
mountSearch(panorama, chartHost);

/**
 * 正文里的「N 位君主 / N 个政权」由数据现算，不写死。
 *
 * 起因：补进南越（一政权、五君主）之后，四个文件里的「382 位」「65 个政权」
 * 全成了错的，得手工逐处改——而这类数字**每次增补都会再错一次**。
 * HTML 里仍留着一个值作兜底（脚本没跑起来时不至于空着），运行时按实际覆盖。
 */
fillCounts({ emp: EMPERORS.length, dyn: DYNASTIES.length, ev: EVENTS.length, geo: GEO_STATS.ev });
