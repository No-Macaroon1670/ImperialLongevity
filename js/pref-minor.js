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
 *  河宽那句不写：河与泳道的带只从在位君主长出来，第三层「君主记录不入表」因而本就无带（复核员 2026-09-09 实测
 *  开关翻两遍河宽不变）——要它们上河是另一件事（按元数据年份画淡带），候库主。 */
export const MINOR_TIP = `第三层：君主记录不入表的 ${MINOR_KEYS.size} 个政权`
  + '（列国十五、古蜀、卫满朝鲜、于阗、归义军、定难军、五代小藩、土司四家…）；'
  + '关掉后舆图政权层不画它们的都城；王朝之河上第三层本就无带，不受影响。';

/** 读偏好：默认显示。隐私模式下 localStorage 抛错，照默认走。 */
export function readMinor() {
  try { return localStorage.getItem(MINOR_KEY) !== 'hide'; } catch { return true; }
}

/** 写偏好。存字面而非 '0'/'1'：将来若要加第三态（如「只画有疆域的」），字面读得懂。 */
export function writeMinor(show) {
  try { localStorage.setItem(MINOR_KEY, show ? 'show' : 'hide'); } catch { /* 隐私模式 */ }
}
