// line-badge.js — 故事线角标「◯◯线第①站 →」的规格（2026-09-04 归一，SSOT 卷 D26）。
//
// 知识卡（`knowledge.js` 的 `.kp-line`）与地方页条卡（`app-place.js` 的
// `.plc-line-badge`）各挂各的 class、各带各的事件（地方页多一个
// stopPropagation——角标是去别处的门，别把它读成「点开这张卡」），
// **共有的只是这三串字**，故本模块只出规格、不出节点。
//
// 站序与 `story/<key>.html` 的 section id 同源（`tools/mining/build_line_page.py`
// 生成 `js/line-stops.js`）。**不可把这几行放进 `line-stops.js`**：那是生成物，
// 头两行写着「不要手改」，下次任一条线重新生成即被抹掉。

const CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

/** 前缀：故事页自身嵌卡时同级相链，其余页面要带 `story/`。
 *  地方页此前写死 `'story/'`——今天同值，但 place.html 哪天挪进 /story/ 下就断链。 */
export const storyBase = () => (/\/story\//.test(location.pathname) ? '' : 'story/');

/**
 * 一条角标的三串字。
 * @param l 一条 LINE_STOPS 记录 `{ key, name, i }`
 * @param base 链接前缀，默认按 pathname 算
 */
export function lineBadgeSpec(l, { base = storyBase() } = {}) {
  return {
    href: `${base}${l.key}.html#s${l.i}`,
    text: `${l.name}第${CIRC[l.i - 1] || l.i}站 →`,
    title: `这件事是${l.name}的第 ${l.i} 站，点开读故事线`,
  };
}
