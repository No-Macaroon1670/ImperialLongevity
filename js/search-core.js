// search-core.js — 时间轴与地图共用的检索核（用户 2026-08-20 指令合体：
// 「timeline search 支持拼音和 partial fuzzy，map search 不支持」——此前
// 地图搜索是另写的裸子串匹配，拼音表没接。匹配逻辑只此一份，不许再抄）。
//
// 三件套：norm 归一（去点隔·空格括号、转小写）；withPy 给中文键补全拼与
// 首字母两个 ascii 键（破釜沉舟 → pofuchenzhou / pfcz），多音字取常读——
// 这是搜索容错，不是注音；scoreKeys 三档打分（0 精确 / 1 前缀 / 2 子串 / 99 不中）。
import PY from './data-pinyin.js';

export const norm = (s) => (s || '').toLowerCase().replace(/[·・\s（）()]/g, '');

const pyKeys = (list) => {
  const out = [];
  for (const s of list) {
    let full = '', ini = '';
    for (const ch of s) {
      const p = PY[ch];
      if (p) { full += p; ini += p[0]; }
      else if (/[a-z0-9]/.test(ch)) { full += ch; ini += ch; }
    }
    if (full && full !== s) out.push(full);
    if (ini.length > 1 && ini !== full) out.push(ini);
  }
  return out;
};

export const withPy = (keys) => keys.concat(pyKeys(keys));

export function scoreKeys(keys, n) {
  let best = 99;
  for (const k of keys) {
    if (k === n) return 0;
    if (k.startsWith(n)) best = Math.min(best, 1);
    else if (k.includes(n)) best = Math.min(best, 2);
  }
  return best;
}
