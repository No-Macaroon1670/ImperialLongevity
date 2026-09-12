// pref-long.js — 「卡片正文给哪一份」的共用件：一个存值、一份字面、一个变更信号。
//
// 库主令 2026-09-12：「要不要做个 default 长文选项。如果选了的话词条就会显示库内 YL
// where available」「因为现在我们大部分长文都被维基盖了」。此前 knowledge.js 的 fillCard
// 只在**无维基条目**或**摘要拉取失败**两支才把库内长注（yl）顶上摘要区；只要维基有条目，
// 卡片正文永远是那段百科导言，库里九百多条自撰长注一个字都露不出来。故立此开关，
// **默认 yl**（库主原话「default 长文」）——有长注就给长注，没有才退维基摘要。
//
// 体例照 js/pref-minor.js：零依赖叶子，键名、字面、读写四样各只有一份。开关同时长在
// 王朝之河（timeline.html 的「设置」块，走 shell.js 的控件表）与时光舆图（map.html 的
// 「设置」块，本页不载 shell.js）上，两处共用这一个存值；地方线页（place.html）不摆开关，
// 但它的嵌入卡走同一个 knowledge.js，故读到的也是这一份。

/** localStorage 键。与 il.minor／il-theme／il.kp.v1 同族，值只有 'yl'｜'wiki'。 */
export const LONG_KEY = 'il.long';

/** 变更信号：写偏好即在 window 上发一记。knowledge.js 听见就把**已经开着的卡**重填一遍
 *  （不然读者得先关掉卡再点开才看得到换的那一份）。跨页不实时——另一页下次打开时读存值，
 *  与「小政权」同规矩。 */
export const LONG_EVENT = 'il:longpref';

/** 两档的字面。分段器要 [值, 字面] 对，两页同取这一份。 */
export const LONG_OPTIONS = [['yl', '库内长注（有则用）'], ['wiki', '维基摘要']];

/** 控件组名。 */
export const LONG_LABEL = '卡片正文';

/** 挂在开关上的口径：说清两份东西各是什么、谁压谁。两页读到同一句。 */
export const LONG_TIP = '本库长注是自撰考据（带出处、分层次，常比百科导言长几倍），'
  + '维基摘要是百科导言；两者都有时默认给长注。'
  + '缩略图与「维基百科全文 ↗」链接两档都照旧从维基摘要来，换档只换正文那一段。';

/** 读偏好：默认 'yl'（库主 2026-09-12 定的 default 长文）。隐私模式下 localStorage
 *  抛错，照默认走。返回字面而非布尔——将来若要加第三态（如「两段都给」），读得懂。 */
export function readLong() {
  try { return localStorage.getItem(LONG_KEY) === 'wiki' ? 'wiki' : 'yl'; } catch { return 'yl'; }
}

/** 写偏好并当场通知本页（见 LONG_EVENT）。非法值一律按默认 'yl' 落。 */
export function writeLong(mode) {
  const v = mode === 'wiki' ? 'wiki' : 'yl';
  try { localStorage.setItem(LONG_KEY, v); } catch { /* 隐私模式 */ }
  try { window.dispatchEvent(new CustomEvent(LONG_EVENT, { detail: v })); } catch { /* 老浏览器 */ }
}
