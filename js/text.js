// text.js — 文本显示原语（零 import，零 DOM 副作用）
//
// 与 year.js 同一辈分的叶子模块：谁要都能拿，拿了不会连带拖进一整套框架。
// 立此模块是因为 `**粗体**` 那一串正则原先有四份逐字副本（知识卡的简注、
// 导览长文、cta、cta2），改一处必漏三处。
//
// 收进来的口径：先转义 &/<，再拆星号。顺序不能倒——先拆星号会把 <strong>
// 自己转义掉。数据是本库里的字面量（简注 yc、故事线文案），非外来输入，
// 但走 innerHTML 前照例转义，无成本、免后患。

/** HTML 转义（& 与 <，走 innerHTML 前的最小一份）。mdBold 的第一步。
 *  暂无第二个消费端，故不导出——库内不留零调用点的导出（见 year.js 同律）。*/
const escHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** `**粗体**` 转 `<strong>`——库内简注（`yc`）与故事线文案的唯一标记语法。
 *  给需要按 innerHTML 落地的文本用（fillCard 的无维基分支、地图悬停小卡、
 *  导览长文栏与两条 cta）。 */
export function mdBold(s) {
  return escHtml(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
