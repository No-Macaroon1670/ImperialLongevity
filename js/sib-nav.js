// sib-nav.js — 页首互链一行 `nav.sib`：五页共用的**叶子件**（2026-09-08 去 clutter 案 §一.1）。
//
// 为什么单开一个模块而不是写进 shell.js：舆图页与地方线页**不载 shell**
// （app-map.js／app-place.js 各自挂载，shell.js 又 import 整个 data.js——
// 一条 nav 换来几兆字节的君主数据，划不来）。故按本库既有惯例（year.js／
// text.js／dom.js／line-badge.js 那一批）单开零依赖叶子，shell.js 再 re-export
// 一次给统计页与全景页——两边拿到的是同一份字面，改一处四页同变。
//
// 为什么四页字面写死在这里而不是各页各写：从前四页各写一段 63–166 字散文，
// 措辞、顺序、数字全不一样，且每页都在替别的页写 lede（「河宽即并存政权数」
// 出现在寿命页页首）。名字本身就够 self-explanatory（库主 2026-09-07），
// 释义进 title，不带数字——数字各页 hero／chip 自己有，不用第二套机制。

/**
 * 登记表（四项）。地方线与故事线**不在这一行**：它们不是并列的一种读法，从王朝之河、
 * 时光舆图页内的 📍／📖 钮进（库主 2026-09-08：「地方线其实没有必要在这里单独开个页面……
 * 故事线都没开页面」）；地方线页本身仍挂这一行，当前页没有对应项，四项全链。顺序即读者在四页之间来回时看到的固定顺序，不随当前页变。
 * label 是短称（拍板⑤：四项等长好扫），全称与那一句释义进 title。
 */
export const SIB_PAGES = [
  { page: 'timeline', href: 'timeline.html', label: '王朝之河',
    title: '王朝之河：按时间铺开，河宽＝当时并存的政权数' },
  { page: 'index', href: 'index.html', label: '帝王寿命',
    title: '中国帝王寿命数据库：按人算命数——君主的生卒、在位与死因，用生存分析问「帝王的寿命由什么决定」' },
  { page: 'map', href: 'map.html', label: '时光舆图',
    title: '时光舆图：按地方铺开，查得到地点的大事记在图上各有落点' },
  { page: 'about', href: 'about.html', label: '说明',
    title: '读法与做法：这些图怎么读、数据怎么来、能回答什么' },
];

/**
 * 渲染并挂上那一行。
 *
 * @param {Object} [opts]
 * @param {string} [opts.page]  当前页键；缺省读 `document.body.dataset.page`
 * @param {Element} [opts.host] 挂载容器；缺省找 `.mh-row`，找不到就**就地把 h1 裹进一个**
 *                              （四页页首结构不完全一样，裹一层比要求四页先改 HTML 稳）
 * @returns {HTMLElement|null} 那条 nav，页上无 h1 且无 .mh-row 时返回 null
 */
export function mountSib(opts = {}) {
  const doc = opts.doc || document;
  const page = opts.page || doc.body?.dataset?.page || '';
  let host = opts.host || doc.querySelector('.mh-row');
  if (!host) {
    const h1 = doc.querySelector('header.masthead h1') || doc.querySelector('h1');
    if (!h1 || !h1.parentNode) return null;
    host = doc.createElement('div');
    host.className = 'mh-row';
    h1.parentNode.insertBefore(host, h1);
    host.appendChild(h1);
  }
  // 幂等：重复调用（热重载、页面自己二次挂载）不该叠出两行
  const old = host.querySelector('nav.sib');
  if (old) old.remove();

  const nav = doc.createElement('nav');
  nav.className = 'sib';
  nav.setAttribute('aria-label', '同一份数据的其他读法');
  SIB_PAGES.forEach((p, i) => {
    if (i) {
      // 分隔点只是版式，不该被读屏念成「中间点」
      const sep = doc.createElement('span');
      sep.className = 'sib-sep';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = '·';
      nav.appendChild(sep);
    }
    if (p.page === page) {
      // 当前页不链：链到自己是一次「什么也没发生」的点击，读者会以为坏了
      const cur = doc.createElement('span');
      cur.setAttribute('aria-current', 'page');
      cur.textContent = p.label;
      cur.title = p.title;
      nav.appendChild(cur);
    } else {
      const a = doc.createElement('a');
      a.href = p.href;
      a.textContent = p.label;
      a.title = p.title;
      nav.appendChild(a);
    }
  });
  host.appendChild(nav);
  return nav;
}
