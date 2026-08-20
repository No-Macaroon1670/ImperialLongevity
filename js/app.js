// app.js — 统计核心页(index.html)的入口
//
// 页面一分为二的缘由：王朝全景(河流／泳道／知识卡／承继细丝)已长成一件独立的
// 作品——它回答「谁在何时统治、天下有多分裂、谁承谁」，而本页回答「帝王的寿命
// 由什么决定」。两者共用同一份数据与同一套外壳(shell.js)，但各有各的读者、
// 各有各的入口与标题。全景页见 timeline.html。
import { mountApp } from './shell.js';
import { SECTIONS } from './sections-stats.js';
import { GEO_STATS } from './geo-stats.js';
import { syncCounts } from './counts.js';

mountApp({ sections: SECTIONS, hero: true });

syncCounts({ geo: GEO_STATS.ev });
