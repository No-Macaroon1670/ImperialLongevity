// dom.js — SVG 元素工厂（2026-09-04 归一，SSOT 卷 D07）。
//
// **零 DOM 副作用的叶子模块**：模块体里一行 document 都没有，只有函数被调用
// 时才造节点。这一条是硬约束——`tools/mining/render_line_map.mjs` 在 node 里
// import plate 系（本模块随之进来），那边的 document 垫片是**在 import 之后**
// 才装上的，模块体一碰 document 就当场炸。
//
// 归一前两份：`charts.js`（带 children）与 `plate.js`（无 children，`for…in` ＋
// `!= null`）。两份的属性落地口径本就等价（`v === null || v === undefined`
// ⇄ `a[k] != null`；调用点全是对象字面量，`for…in` 取不到别的东西），差的只是
// 第三参——实测两系合计 91 处 `el(` 调用**无一传第三参**，故合并零行为差。

export const NS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, children = []) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
}
