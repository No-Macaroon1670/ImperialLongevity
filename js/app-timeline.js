// app-timeline.js — 王朝全景页(timeline.html)的入口
//
// 与统计页共用 shell.js 的状态、筛选、渲染循环与后台自愈；本页只装全景章节，
// 不要页首统计条(那属于寿命数据库)。
import { mountApp } from './shell.js';
import { SECTIONS } from './sections-panorama.js';
import { mountSearch } from './search.js';
import { mountTour } from './tour.js';
import { lineOf } from './lines.js';
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
