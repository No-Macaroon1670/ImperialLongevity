// pref-minor.js — 「小政权」开关的共用件：一个存值、一份字面、一份判据。
//
// 为什么要它：这颗开关同时长在王朝之河（timeline.html 的「设置」块，走 shell.js 的
// 控件表）与时光舆图（map.html 的「设置」块，本页不载 shell.js）上，库主 2026-09-09 令
// 「放在两个 relevant mode」并要求两处同一个存值——一处关掉，另一处下次打开就是关着的。
// 两页各抄一遍读写 localStorage 的三行是有前科的：theme.js 的头注记着舆图与地方线各抄了
// 八行日夜开关、于是按钮藏了两个月没人发现。故立成零依赖叶子（只吃 dynasties.js 这份纯数据），
// 谁要谁 import，判据（tier 3）、字面（tooltip）、键名三样都只有一份。
import { DYNASTIES } from './dynasties.js';

/** localStorage 键。与 il-theme／il.kp.v1／il.src.place 同族，值只有 'show'｜'hide'。 */
export const MINOR_KEY = 'il.minor';

/** 第三层政权的键集（判据即 dynasties.js 头注的「君主记录不入表」）。 */
export const MINOR_KEYS = new Set(DYNASTIES.filter((d) => d.tier === 3).map((d) => d.key));

/** 挂在开关上的口径：说清关的是哪 36 个、以及关掉管到哪里。两页读到同一句。
 *  2026-09-09 库主裁「可以画」之后改写：第三层按元数据起讫上了竖河（无君主淡带），
 *  河宽（当时并存的政权数）把它们算进去，故关掉是**河面真会变窄**的一件事；泳道端
 *  照旧不画（buildBands 的 meta 带被 renderLaneTimeline 滤掉）。 */
export const MINOR_TIP = `第三层：君主记录不入表的 ${MINOR_KEYS.size} 个政权`
  + '（列国十五、古蜀、卫满朝鲜、于阗、归义军、定难军、五代小藩、土司四家…）；'
  + '关掉后王朝之河不画这 36 条淡带、河宽随之变窄；横向泳道本就不画；时光舆图不画它们的都城。';

/** 读偏好：默认显示。隐私模式下 localStorage 抛错，照默认走。 */
export function readMinor() {
  try { return localStorage.getItem(MINOR_KEY) !== 'hide'; } catch { return true; }
}

/** 写偏好。存字面而非 '0'/'1'：将来若要加第三态（如「只画有疆域的」），字面读得懂。 */
export function writeMinor(show) {
  try { localStorage.setItem(MINOR_KEY, show ? 'show' : 'hide'); } catch { /* 隐私模式 */ }
}
