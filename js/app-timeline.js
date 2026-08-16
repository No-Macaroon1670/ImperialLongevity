// app-timeline.js — 王朝全景页(timeline.html)的入口
//
// 与统计页共用 shell.js 的状态、筛选、渲染循环与后台自愈；本页只装全景章节，
// 不要页首统计条(那属于寿命数据库)。
import { mountApp } from './shell.js';
import { SECTIONS } from './sections-panorama.js';
import { mountSearch } from './search.js';

mountApp({ sections: SECTIONS, hero: false });

// 搜索与深链:两千年的长卷,得能搜得到、也发得出(见 js/search.js)
mountSearch(document.getElementById('panorama'),
  () => document.querySelector('#panorama .chart-host'));
