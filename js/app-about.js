// app-about.js — 说明页（about.html）的挂载。这页没有图、没有数据，
// 只做三件小事：页首互链、深色开关、把 data-il-count 的数字回填。
//
// 为什么单开一个 app-*：说明页不该 import shell.js（那会连整个 data.js 一起拉进来，
// 几兆字节只为一行 nav 与一颗深色钮）。sib-nav／theme／geo-stats 都是叶子。
import { mountSib } from './sib-nav.js';
import { mountThemeToggle } from './theme.js';
import { GEO_STATS } from './geo-stats.js';
import { EVENTS } from './events.js';
import { DYNASTIES } from './dynasties.js';
import { syncCounts } from './counts.js';

// 深色钮要**给个家**，否则一辈子看不见：styles.css 那条 `.lede .theme-toggle{display:none}`
// 管的是「还睡在段末、shell 尚未收编」的状态；本页不走 shell（说明页没有筛选条、没有
// 「设置」块），不搬就等于没有开关（2026-09-07 地方线页同一处坑，见 app-place.js 的记）。
// 家安在标题行 `.mh-row` 末，**排在 mountSib 之前**——互链一行靠 margin-left:auto 顶到最右、
// 窄屏又整行独占，按钮排它后面会被挤成第三行。
mountThemeToggle(document.querySelector('.mh-row'));
mountSib();
// 说明页里若引用「多少条大事记查得到地点」这类数字，写 data-il-count 即可，
// 别写死——写死的每次增补都会再错一次（counts.js 头注）。
// 键与地方线页取齐：ev＝大事记总数、geo＝其中查得到地点的、dyn＝政权数
syncCounts({ ev: EVENTS.length, dyn: DYNASTIES.length, geo: GEO_STATS.ev });
