// place-catalog.js — 地方线目录浮层：全景页与舆图页顶栏那颗 📍 开的东西
// （2026-09-07 库主令「顶栏加地方线钮，与 🎲📖 同一簇同一元件规格」）。
//
// 与 `line-catalog.js` 是**同款不同池**：那边列「穿过这张图的几种读法」，
// 这边列「站在哪一座城里可以看四千年」。壳与样式一概沿用 `.line-catalog` 那一族
// （styles.css 里同一段），本件只出行内容——两个浮层长得一样是故意的：
// 读者在顶栏按下的两颗钮属于同一类动作（挑一条线走），开出来的东西不该两个样。
//
// **这是挑城的唯一入口**：place.html 不带城名时也弹它（app-place.js 的 renderFallback），
// 单城页「换一座城」也开它；索引页 2026-09-08 撤了（库主：地方线同故事线，从页内进，
// 不在页首互链里）。行内容的算法＝ membersOf → countByKind → kindsByCount 取前四。
//
// 为什么 geo-events.js 是**动态** import：地方线的成员数要靠坐标半径才算得准
// （见 places.js 的归地注），而那份数据 457KB，全景页今天一个字节都没有加载过。
// 为一颗还没按下的按钮先付 457KB 不划算，故推迟到**首次开目录**那一刻——
// 舆图页本来就静态引着它，那边这一句是从模块缓存里原地取回，不产生第二次网络往返。

import { PLACES, membersOf, PLACE_MIN } from './places.js';
import { EVENTS, kindLabel, countByKind, kindsByCount } from './events.js';
import { fmtYearAxis } from './year.js';

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * 造一个地方线目录浮层，挂进 body，返回 `{ el, open, close }`。
 * 行是**链接**不是按钮（与故事线目录相反）：那边选一条线是在本页拉起一段导览，
 * 这边选一座城是换一张页面——该让读者能中键新开、能复制链接。
 */
export function buildPlaceCatalog() {
  const box = h('div', 'line-catalog place-catalog');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', '地方线目录');
  const close = () => box.classList.remove('on');
  const sheet = h('div', 'lc-sheet');
  const head = h('div', 'lc-head');
  const ttl = document.createElement('h3');
  ttl.textContent = '地方线';
  const x = h('button', 'kp-close', '✕');
  x.type = 'button';
  x.setAttribute('aria-label', '关闭');
  x.addEventListener('click', close);
  head.append(ttl, x);
  // 压成一句（去 clutter 案 D-C4 定案）：「轴按政权换手分段」在 place.html 的 lede
  // 与互链一行「地方线」那条 title 里各说过一遍，浮层这里第三遍念它是白念；
  // 「条目按分量挂在两侧」下一屏的卡阵自证。门槛数仍由 PLACE_MIN 现填，不写死
  const intro = h('p', 'lc-intro',
    `站在一座城里看四千年。成员 ${PLACE_MIN} 条以上的城，按条数排。`);
  const body = h('div', 'pc-body');
  const wait = h('p', 'lc-intro', '正在按坐标归地…');
  body.appendChild(wait);
  sheet.append(head, intro, body);
  box.appendChild(sheet);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.body.appendChild(box);

  // 两面旗，不是一面（复核员 2026-09-07 指出）：filled 记「算成了」，filling 记
  // 「正在算」。原先只有 filled 且立在 await 之前，await 之后那一段（membersOf、
  // 组 DOM）又不在 try 里——那儿一抛错，浮层就永远停在「正在按坐标归地…」，
  // 不报错、不重试、重开也无用。分成两面之后：连点两下仍只算一遍（filling 挡着），
  // 而算砸了会放开 filling，读者重开一次即重试
  let filled = false;
  let filling = false;
  async function fill() {
    if (filled || filling) return;
    filling = true;
    try {
      await fillBody();
      filled = true;
    } catch (err) {
      console.error('[place-catalog] 归地算不出来：', err);
      body.replaceChildren(h('p', 'lc-intro',
        '这份目录没能算出来（按坐标归地那一步出错了）。刷新页面再试一次。'));
    } finally {
      filling = false;
    }
  }
  async function fillBody() {
    let GEO_EVENTS = {};
    try { ({ GEO_EVENTS } = await import('./geo-events.js')); } catch { GEO_EVENTS = {}; }
    const rows = Object.values(PLACES).map((p) => {
      const ms = membersOf(p, EVENTS, GEO_EVENTS);
      return { p, ms, kinds: countByKind(ms) };
    }).filter((r) => r.ms.length >= PLACE_MIN).sort((a, b) => b.ms.length - a.ms.length);

    body.replaceChildren(...(rows.length ? rows.map(({ p, ms, kinds }) => {
      const a = h('a', 'lc-row pc-row');
      a.href = `place.html?key=${encodeURIComponent(p.key)}`;
      const nm = h('div', 'lc-name', p.name);
      nm.appendChild(h('span', 'lc-count', `${ms.length} 条`));
      if (p.sub) nm.appendChild(h('span', 'pc-sub', p.sub));   // 区域线的副题（边界话）
      const sub = h('div', 'lc-sub');
      sub.appendChild(h('span', 'pc-span', `${fmtYearAxis(ms[0].y)} – ${fmtYearAxis(ms[ms.length - 1].y)}`));
      for (const k of kindsByCount(kinds).slice(0, 4)) {
        const kk = h('span', `pc-kk k-${k}`);
        kk.appendChild(h('i', 'pl-swatch'));
        kk.appendChild(h('span', null, `${kindLabel(k)} ${kinds[k]}`));
        sub.appendChild(kk);
      }
      a.append(nm, sub);
      return a;
    }) : [h('p', 'lc-intro', '暂无够格开线的地方。')]));
  }

  const open = () => {
    box.classList.add('on');
    fill().then(() => { const f = box.querySelector('.pc-row'); if (f) f.focus(); });
  };
  return { el: box, open, close };
}
