// app-timeline.js — 王朝全景页(timeline.html)的入口
//
// 与统计页共用 shell.js 的状态、筛选、渲染循环与后台自愈；本页只装全景章节，
// 不要页首统计条(那属于寿命数据库)。
import { mountApp } from './shell.js';
import { SECTIONS } from './sections-panorama.js';
import { mountSearch } from './search.js';
import { mountTour } from './tour.js';
import { lineOf, LINES } from './lines.js';
import { EMPERORS, DYNASTIES } from './data.js';
import { EVENTS } from './events.js';

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
function openLine(key) {
  const line = lineOf(key);
  if (!line) return false;
  if (lineTour) lineTour.stop(false);
  lineTour = mountTour(panorama, chartHost, {
    stops: line.stops, tag: line.name, key: `il.line.${line.key}`, launch: false,
  });
  lineTour.start(0);
  return true;
}
// ── 故事目录 ────────────────────────────────────────────────────────
// 书的按钮开的是**目录**而不是某一条线：线会越来越多，而「有哪些线可走」
// 本身就是读者要先看见的东西（用户指出）。目录只列名字、一句话与站数，
// 点一条才进去——选择在读者手里，不在按钮上。
const catalog = document.createElement('div');
catalog.className = 'line-catalog';
catalog.setAttribute('role', 'dialog');
catalog.setAttribute('aria-label', '故事线目录');
const closeCatalog = () => { catalog.classList.remove('on'); document.body.classList.remove('line-catalog-on'); };
{
  const sheet = document.createElement('div');
  sheet.className = 'lc-sheet';
  const head = document.createElement('div');
  head.className = 'lc-head';
  const h = document.createElement('h3');
  h.textContent = '故事线';
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'kp-close'; x.textContent = '✕';
  x.setAttribute('aria-label', '关闭');
  x.addEventListener('click', closeCatalog);
  head.append(h, x);
  const intro = document.createElement('p');
  intro.className = 'lc-intro';
  intro.textContent = '一条线是穿过这张图的一种读法：跨越时代的一串站点，逐站打光、逐站讲。';
  sheet.append(head, intro);
  for (const line of Object.values(LINES)) {
    const row = document.createElement('button');
    row.type = 'button'; row.className = 'lc-row';
    const nm = document.createElement('div');
    nm.className = 'lc-name';
    nm.textContent = line.name;
    const cnt = document.createElement('span');
    cnt.className = 'lc-count';
    cnt.textContent = `${line.stops.length} 站`;
    nm.appendChild(cnt);
    const sub = document.createElement('div');
    sub.className = 'lc-sub';
    sub.textContent = line.lede;
    row.append(nm, sub);
    row.addEventListener('click', () => {
      closeCatalog();
      history.replaceState(null, '', `#line=${line.key}`);
      openLine(line.key);
    });
    sheet.appendChild(row);
  }
  catalog.appendChild(sheet);
  catalog.addEventListener('click', (e) => { if (e.target === catalog) closeCatalog(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCatalog(); });
  document.body.appendChild(catalog);
}
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
  btn.addEventListener('click', () => {
    catalog.classList.add('on');
    document.body.classList.add('line-catalog-on');
    const first = catalog.querySelector('.lc-row');
    if (first) first.focus();
  });
  head.appendChild(btn);
}

const lineFromHash = () => {
  const m = /(?:^|[#&])line=([a-z0-9_-]+)/i.exec(location.hash || '');
  return m ? m[1].toLowerCase() : null;
};
addEventListener('hashchange', () => { const k = lineFromHash(); if (k) openLine(k); });
// 首屏：等图渲染完再拉线，否则第一站落位时还没有可量的图
{
  const k = lineFromHash();
  if (k) setTimeout(() => openLine(k), 400);
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
function syncCounts() {
  const n = { emp: EMPERORS.length, dyn: DYNASTIES.length, ev: EVENTS.length };
  for (const el of document.querySelectorAll('[data-il-count]')) {
    const v = n[el.dataset.ilCount];
    if (v !== undefined) el.textContent = String(v);
  }
}
syncCounts();
