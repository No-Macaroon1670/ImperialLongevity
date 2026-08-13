// views-river.js — 全页竖向「王朝之河」
//
// 与横向泳道的分工：泳道图把每个政权钉在一条固定的行上，读的是「谁在什么时候统治」；
// 这一张把时间竖过来、把河宽整个交给「当时并存的政权」瓜分，读的是**分裂的形状**——
// 大一统时是一条满宽的大河，分裂时河面裂成数股各自着色的分叉，重新统一时再合流。
//
// 四个设计决定：
//
//   1. **河宽恒定，只按政权数均分。** 本库没有疆域或人口数据，若让分叉宽度去编码
//      「谁更大」，那是在画我们并不掌握的东西。均分是诚实的选择，而且它让唯一的
//      视觉变量——分叉数——正好等于那一刻并存的政权数，这恰是本图要回答的问题。
//      代价是三年的割据小国与盛唐同宽；悬停与数据表给出真实规模。
//
//   2. **全局总序 ⇒ 河道永不交叉。** 任意两个政权的左右次序由一个全局排序键决定，
//      因此在它们共存的每一段里次序都相同，两条河道不可能相交。次序为
//      「正统序列 → 北方主线 → 其余」，同一法统按其源头的起始年归堆，
//      于是前蜀与后蜀、西魏与北周相邻而非四散。政权消失时右邻左移，
//      这个左移就是「合流」；新政权插入时右邻右让，这就是「分叉」。
//
//   3. **不套滚动容器，直接交给页面滚。** 竖向内容再套一层竖向滚动条是经典的滚动陷阱：
//      手指落在容器上，页面就像卡住了。去掉容器后全页只有一个滚动器，陷阱从根上不存在。
//      代价是这一节很长，故配以顶／底两条固定条充当「安全起滑区」与上下节跳转。
//
//   4. **点选而非悬停。** 触屏没有悬停。点中某位君主即高亮该段、其余压暗，
//      并在底部固定卡片里给出完整信息；再点空白处取消。
import { el, h, linear, hoverable, legend, tableView, notes, fmtYearAxis, fmt1, textWidth } from './charts.js';
import { DYN_STATS } from './data.js';
import { ERAS, SUCCESSION, ORTHODOX, SECONDARY } from './dynasties.js';
import { fmtDate } from './schema.js';
import { buildBands, dynastyColorSlots, slotVar, resolveInk, shortName } from './views-lanes.js';

const GUTTER = 34;          // 左侧年份／时代标注的留白
const TRANS = 10;           // 分叉与合流处的过渡半径（像素）
const EPS = 1e-6;

/** 沿法统链上溯到源头，用于把同一支的政权排在一起 */
function lineageRoot(key) {
  let k = key;
  const seen = new Set();
  while (SUCCESSION[k] && !seen.has(k)) { seen.add(k); k = SUCCESSION[k]; }
  return k;
}

/**
 * 全局总序。返回的比较键在整张图中固定不变，这正是「河道不交叉」的保证：
 * 两个政权只要共存，左右关系在每一段里都一样。
 */
function orderKeys(bands) {
  const orth = new Set(ORTHODOX), sec = new Set(SECONDARY);
  const rootStart = new Map();
  for (const b of bands) {
    const r = lineageRoot(b.d.key);
    const rb = bands.find((x) => x.d.key === r);
    rootStart.set(b.d.key, rb ? rb.s : b.s);
  }
  const tier = (b) => (orth.has(b.d.key) ? 0 : sec.has(b.d.key) ? 1 : 2);
  return bands.slice().sort((a, b) =>
    tier(a) - tier(b)
    || rootStart.get(a.d.key) - rootStart.get(b.d.key)
    || a.s - b.s
    || a.d.key.localeCompare(b.d.key));
}

/**
 * 把时间切成「并存政权集合不变」的一段段。切点即所有带的起讫年份。
 * 每段内每个政权占据河宽的 k/N–(k+1)/N。
 */
function layoutChannels(bands, x0, x1) {
  const ordered = orderKeys(bands);
  const rank = new Map(ordered.map((b, i) => [b.d.key, i]));
  const cuts = [...new Set(bands.flatMap((b) => [b.s, b.e]))].sort((p, q) => p - q);
  const slices = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], z = cuts[i + 1];
    if (z - a < EPS) continue;
    const mid = (a + z) / 2;
    const live = bands.filter((b) => b.s <= mid && mid <= b.e)
      .sort((p, q) => rank.get(p.d.key) - rank.get(q.d.key));
    if (!live.length) { slices.push({ a, z, live: [], n: 0, at: new Map() }); continue; }
    const w = (x1 - x0) / live.length;
    const at = new Map(live.map((b, k) => [b.d.key, [x0 + k * w, x0 + (k + 1) * w]]));
    slices.push({ a, z, live, n: live.length, at });
  }
  return { slices, ordered };
}

/**
 * 河道边界点：`{t, x0, x1}` 表示**自 t 起**该河道的左右边界为 x0/x1，直到下一个点。
 * 末尾补一个终止点（t = 带的结束年），其边界沿用前一段——河道到此为止，不再变宽。
 * 宽度没变的相邻切点直接合并，免得在同一处画出零长度的过渡。
 */
function edgePoints(band, slices) {
  const pts = [];
  for (const s of slices) {
    const box = s.at.get(band.d.key);
    if (!box) continue;
    const prev = pts[pts.length - 1];
    if (prev && Math.abs(prev.x0 - box[0]) < 0.4 && Math.abs(prev.x1 - box[1]) < 0.4) continue;
    pts.push({ t: Math.max(s.a, band.s), x0: box[0], x1: box[1] });
  }
  if (!pts.length) return [];
  const tail = pts[pts.length - 1];
  pts.push({ t: band.e, x0: tail.x0, x1: tail.x1 });
  return pts;
}

/** 把边界点裁到 [ta, tb]，两端各补一个点，使裁出的一段仍是完整的阶梯 */
function clipPoints(pts, ta, tb) {
  const out = [];
  for (const p of pts) {
    if (p.t <= ta + EPS) { out.length = 0; out.push({ ...p, t: ta }); continue; }
    if (p.t >= tb - EPS) break;
    out.push(p);
  }
  if (!out.length) return [];
  out.push({ ...out[out.length - 1], t: tb });
  return out;
}

/**
 * 一条河道在 [ta, tb] 区间内的多边形路径。
 *
 * 每个切点处河道要么变窄（有政权出现＝分叉）要么变宽（有政权消失＝合流）。
 * 硬折角会让整张图看起来像阶梯而非河流，故在切点上下各取 tr 像素做三次贝塞尔过渡；
 * tr 按相邻两段长度的一半封顶，避免过渡区互相穿透。
 */
function channelPath(pts, y, ta, tb, inset = 0) {
  const cl = clipPoints(pts, ta, tb);
  if (cl.length < 2) return '';
  const n = cl.length;
  const ys = cl.map((p) => y(p.t));
  const L = cl.map((p) => p.x0 + inset);
  const R = cl.map((p) => p.x1 - inset);
  if (L.some((v, i) => R[i] - v < 0.6)) return '';        // 内缩后已无宽度可画
  const tr = (j) => Math.max(0, Math.min(TRANS, (ys[j] - ys[j - 1]) / 2,
    (j + 1 < n ? ys[j + 1] - ys[j] : TRANS * 2) / 2));
  const same = (a, b) => Math.abs(a - b) < 0.4;

  let d = `M${L[0]},${ys[0]}`;
  for (let j = 1; j < n; j++) {                            // 顺流而下，走左岸
    if (same(L[j], L[j - 1])) { d += `L${L[j - 1]},${ys[j]}`; continue; }
    const t = tr(j);
    d += `L${L[j - 1]},${ys[j] - t}C${L[j - 1]},${ys[j]} ${L[j]},${ys[j]} ${L[j]},${ys[j] + t}`;
  }
  d += `L${R[n - 1]},${ys[n - 1]}`;                        // 横过河口
  for (let j = n - 1; j >= 1; j--) {                       // 逆流而上，走右岸
    if (same(R[j], R[j - 1])) { d += `L${R[j - 1]},${ys[j - 1]}`; continue; }
    const t = tr(j);
    d += `L${R[j]},${ys[j] + t}C${R[j]},${ys[j]} ${R[j - 1]},${ys[j]} ${R[j - 1]},${ys[j] - t}`;
    d += `L${R[j - 1]},${ys[j - 1]}`;
  }
  return `${d}Z`;
}

// ── 主渲染 ───────────────────────────────────────────────────────────────
export function renderRiver(host, list, opts) {
  host.innerHTML = '';
  const bands = buildBands(list);
  if (!bands.length) { host.appendChild(h('p', { class: 'muted', text: '当前筛选无数据。' })); return; }

  const pxYear = opts.riverPx || 7;
  const byDynasty = opts.laneColor !== 'unified';
  const markViolent = opts.laneViolent !== false;
  const slots = dynastyColorSlots();
  const ink = resolveInk(host);

  const W = Math.max(300, Math.floor(host.getBoundingClientRect().width) || 360);
  const t0 = Math.min(...bands.map((b) => b.s)) - 4;
  const t1 = Math.max(...bands.map((b) => b.e)) + 4;
  const H = Math.round((t1 - t0) * pxYear);
  const y = linear([t0, t1], [0, H]);
  const RX0 = GUTTER, RX1 = W - 6;

  const { slices, ordered } = layoutChannels(bands, RX0, RX1);

  const edgesOf = new Map();
  for (const b of bands) edgesOf.set(b.d.key, edgePoints(b, slices));

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'river-svg', role: 'img' });

  // ── 时代分带：整幅横向淡底，交替填充，名称贴在左栏 ──────────────────────
  ERAS.forEach((era, i) => {
    const ya = Math.max(0, y(era.s)), yb = Math.min(H, y(era.e));
    if (yb - ya < 3) return;
    if (i % 2 === 0) svg.appendChild(el('rect', { x: 0, y: ya, width: W, height: yb - ya, class: 'era-band', opacity: .55 }));
    svg.appendChild(el('line', { x1: 0, x2: W, y1: yb, y2: yb, class: 'ref-line', opacity: .5 }));
  });

  // ── 年份刻度：竖向下每 100 年一道，贴左栏 ───────────────────────────────
  const step = pxYear >= 12 ? 50 : 100;
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
    svg.appendChild(el('line', { x1: GUTTER - 4, x2: W, y1: y(t), y2: y(t), class: 'grid', opacity: .5 }));
    svg.appendChild(el('text', { x: GUTTER - 7, y: y(t) + 3.5, class: 'tick', 'text-anchor': 'end', 'font-size': 9.5 },
      fmtYearAxis(t)));
  }

  // ── 河道 ────────────────────────────────────────────────────────────────
  const empNodes = [];
  const labelNodes = [];
  for (const b of ordered) {
    const edges = edgesOf.get(b.d.key);
    if (!edges || edges.length < 2) continue;
    const cvar = byDynasty ? slotVar(slots.get(b.d.key)) : (b.d.u ? '--c-unified' : '--c-split');
    const col = `var(${cvar})`;
    const st = DYN_STATS.get(b.d.key);

    // 河床：整条存续期的淡色底，君主之间的空档由它透出——那正是「无在位君主」的年份
    const bed = el('path', {
      d: channelPath(edges, y, b.s, b.e, 1), fill: col, opacity: .16, class: 'mark',
    });
    hoverable(bed, () => [
      { color: col, value: `${fmtYearAxis(b.d.s)}–${fmtYearAxis(b.d.e)}`, label: '国祚' },
      { label: '历时', value: `${st.span} 年` },
      { label: '皇帝', value: `${st.n} 位（当前筛选 ${b.n} 位）` },
      { label: 'DSI', value: st.dsi === null ? '—' : `${fmt1(st.dsi)} 年/帝` },
      ...(b.d.note ? [b.d.note] : []),
    ], () => b.d.name);
    svg.appendChild(bed);

    // 称帝前掌权期：贴河道左缘的窄条。不是正式在位期，视觉上必须与君主段可区分
    for (const g of b.preRule) {
      const w = Math.min(7, (edges[0].x1 - edges[0].x0) / 3);
      const narrow = edges.map((p) => ({ t: p.t, x0: p.x0, x1: p.x0 + w }));
      const d = channelPath(narrow, y, g.s, g.x, 1);
      if (!d) continue;
      const node = el('path', { d, fill: col, opacity: .5, class: 'mark' });
      hoverable(node, () => [
        { color: col, value: `${fmtDate(g.e.accRule, { yearOnly: true })}–${fmtDate(g.e.acc, { yearOnly: true })}`, label: '掌权（未称帝）' },
        { label: '称帝', value: fmtDate(g.e.acc) },
        '此段为该君主实际掌握政权最高权力、但尚未即皇帝位的时期，不计入「在位年数」。',
      ], () => `${b.d.name}·${g.e.temple}`);
      svg.appendChild(node);
    }

    // 君主分段：满河宽的实色块，段间留 1.5px 缝
    for (const g of b.segs) {
      const gap = Math.min(0.8, (g.x - g.s) * 0.18);
      const d = channelPath(edges, y, g.s + gap, g.x - gap, 1.5);
      if (!d) continue;
      const node = el('path', { d, fill: col, class: 'mark river-emp' });
      node.dataset.emp = g.e.id;
      const tip = () => [
        { color: col, value: `${fmtDate(g.e.acc, { yearOnly: true })}–${g.e.reignEnd ? fmtDate(g.e.reignEnd, { yearOnly: true }) : '？'}`, label: '在位' },
        { label: '在位年数', value: g.e.reignYears === null ? '—' : `${g.e.reignYears.toFixed(1)} 年` },
        { label: '享年', value: g.e.lifespan === null ? '不详' : `${Math.floor(g.e.lifespan)} 岁` },
        { label: '登基年龄', value: g.e.accAge === null ? '不详' : `${Math.floor(g.e.accAge)} 岁` },
        { label: '死因', value: g.e.causeLabel },
        ...(g.e.note ? [g.e.note] : []),
      ];
      hoverable(node, tip, () => `${b.d.name}·${g.e.temple}`);
      svg.appendChild(node);
      empNodes.push({ node, e: g.e, band: b, col, tip });

      // 非正常死亡：段末横贯河道的红杠（竖向下三角容易被误认为箭头）
      if (markViolent && g.e.violent === 1 && g.e.reignEnd && Math.abs(g.x - g.e.reignEnd.t) < 0.01) {
        const seg = edges.filter((p) => p.t <= g.x + EPS).pop();
        if (seg) {
          svg.appendChild(el('line', {
            x1: seg.x0 + 2, x2: seg.x1 - 2, y1: y(g.x) - 1, y2: y(g.x) - 1,
            stroke: 'var(--critical)', 'stroke-width': 2.5, 'stroke-linecap': 'round',
          }));
        }
      }

      // 君主简称：河道竖向流动，名字竖排最省地方，也是汉字的本来排法
      const nm = shortName(g.e);
      const seg0 = edges.find((p) => p.t >= g.s - EPS);
      const chW = seg0 ? seg0.x1 - seg0.x0 : 0;
      const runH = y(g.x) - y(g.s);
      if (seg0 && chW >= 15 && runH >= nm.length * 10 + 6) {
        const tx = (seg0.x0 + seg0.x1) / 2;
        const ty = y(g.s) + (runH - nm.length * 10) / 2 + 9;
        const t = el('text', {
          x: tx, y: ty, 'font-size': 10, 'text-anchor': 'middle',
          fill: ink[cvar] === 'dark' ? 'var(--text-1)' : 'var(--surface-1)',
          'pointer-events': 'none',
        });
        [...nm].forEach((c, i) => t.appendChild(el('tspan', { x: tx, dy: i ? 10 : 0 }, c)));
        svg.appendChild(t);
      }
    }

    // 朝代名：写在河道起点上方；滚动时吸附于视口上缘，但不越出自身区间
    const e0 = edges[0];
    const lw = textWidth(b.d.name, 11.5);
    const cx = (e0.x0 + e0.x1) / 2;
    const dot = el('circle', { cx: e0.x0 + 5, cy: y(b.s) + 6, r: 3, fill: col });
    const label = el('text', {
      x: Math.max(GUTTER + 2, Math.min(W - lw - 2, cx - lw / 2)), y: y(b.s) + 10,
      'font-size': 11.5, 'font-weight': 640, fill: 'var(--text-1)', 'pointer-events': 'none',
      stroke: 'var(--page)', 'stroke-width': 3, 'paint-order': 'stroke',
    }, b.d.name);
    svg.appendChild(dot); svg.appendChild(label);
    labelNodes.push({ dot, label, y0: y(b.s), y1: y(b.e), lw, cx });
  }

  const wrap = h('div', { class: 'river-wrap' }, [svg]);
  host.appendChild(wrap);

  // ── 点选高亮 ────────────────────────────────────────────────────────────
  // 触屏没有悬停，故以点选替代：选中者留亮，同屏其余压暗，详情进底部固定卡片。
  const card = h('div', { class: 'river-card' });
  document.body.appendChild(card);
  let selected = null;
  const clearSel = () => {
    selected = null;
    card.classList.remove('on');
    for (const n of empNodes) n.node.classList.remove('dim', 'sel');
  };
  const select = (item) => {
    selected = item;
    for (const n of empNodes) {
      n.node.classList.toggle('dim', n !== item);
      n.node.classList.toggle('sel', n === item);
    }
    card.innerHTML = '';
    card.appendChild(h('div', { class: 'rc-title' }, [
      h('span', { class: 'rc-dot' }), h('span', { text: `${item.band.d.name}·${item.e.temple}` }),
    ]));
    card.querySelector('.rc-dot').style.background = item.col;
    const rows = item.tip().filter((r) => typeof r !== 'string');
    card.appendChild(h('div', { class: 'rc-rows' }, rows.map((r) =>
      h('span', { class: 'rc-row' }, [
        h('b', { text: r.value }), h('span', { class: 'muted', text: r.label }),
      ]))));
    const noteTxt = item.tip().find((r) => typeof r === 'string');
    if (noteTxt) card.appendChild(h('p', { class: 'rc-note muted small', text: noteTxt }));
    card.appendChild(h('button', { class: 'rc-close', type: 'button', text: '✕', onclick: clearSel }));
    card.classList.add('on');
  };
  for (const n of empNodes) {
    n.node.addEventListener('click', (ev) => { ev.stopPropagation(); select(n); });
  }
  svg.addEventListener('click', () => { if (selected) clearSel(); });

  // ── 滚动时的标签吸附 ────────────────────────────────────────────────────
  // 页面自身在滚，故监听 window 而非容器；仅当区间跨过视口上缘时才吸附，
  // 否则同屏的两个朝代会双双挤到顶上互相压字。
  let raf = null;
  const sync = () => {
    raf = null;
    const box = wrap.getBoundingClientRect();
    const top = -box.top + (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0) + 44;
    const bottom = top + window.innerHeight;
    for (const n of labelNodes) {
      const vis = n.y1 > top - 40 && n.y0 < bottom;
      n.dot.setAttribute('opacity', vis ? 1 : 0);
      n.label.setAttribute('opacity', vis ? 1 : 0);
      if (!vis) continue;
      const stick = (n.y0 <= top && top < n.y1) ? Math.min(top + 12, Math.max(n.y0 + 10, n.y1 - 6)) : n.y0 + 10;
      n.label.setAttribute('y', stick);
      n.dot.setAttribute('cy', stick - 4);
    }
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(sync); };
  addEventListener('scroll', onScroll, { passive: true });
  requestAnimationFrame(sync);

  // 视图挂在 window 与 body 上的东西（滚动监听、固定卡片）在重绘或切走时必须撤：
  // scroll 监听不撤会随每次筛选累积一个引用死 DOM 的监听器，
  // 卡片不撤会留在泳道视图上。app.js 的 panorama render 包装器每次渲染前调用此钩子。
  host.__riverCleanup = () => { card.remove(); removeEventListener('scroll', onScroll); };

  // ── 图例与说明 ──────────────────────────────────────────────────────────
  const peak = slices.reduce((m, s) => Math.max(m, s.n), 0);
  const peakSlice = slices.find((s) => s.n === peak);
  host.appendChild(h('p', { class: 'muted small', style: 'margin:10px 0 0', text:
    `河宽恒定，按当时并存的政权数均分：一股＝天下一统，数股＝分裂割据。`
    + `最宽处为 ${fmtYearAxis(peakSlice.a)} 年的 ${peak} 股。`
    + (markViolent ? ' 横贯河道的红杠＝该帝非正常死亡。' : '')
    + ' 点按任一段可锁定该君主。' }));
  if (byDynasty) {
    host.appendChild(legend(ordered.map((b) => ({ color: `var(${slotVar(slots.get(b.d.key))})`, label: b.d.name }))));
  } else {
    host.appendChild(legend([
      { color: 'var(--c-unified)', label: '大一统王朝' },
      { color: 'var(--c-split)', label: '分裂时期政权' },
    ]));
  }

  host.appendChild(notes([
    `河宽**不编码疆域或人口**——本库没有这两项数据，若让分叉的宽窄去表示「谁更大」，`
    + `那是在画我们并不掌握的东西。故河宽恒定、按政权数均分，唯一的视觉变量「分叉数」`
    + `正好等于那一刻并存的政权数。代价是三年的割据小国与盛唐同宽，真实规模见悬停与数据表。`,
    `河道之间**永不交叉**：左右次序由一个全局排序键决定（正统序列 → 北方主线 → 其余，`
    + `同一法统按其源头的起始年归堆），因此任意两个政权只要共存，次序在每一段里都相同。`
    + `政权消失时右邻左移即为「合流」，新政权插入时右邻右让即为「分叉」——`
    + `图上所有的分与合都只是这一条规则的结果，没有额外的美化。`,
    `**不套滚动容器**：竖向内容再嵌一层竖向滚动是经典的滚动陷阱，手指落在容器上页面就像卡住了。`
    + `本图直接交给页面滚动，全页只有一个滚动器。代价是这一节很长（${Math.round(H)}px），`
    + `故顶／底两条固定条既是上下节跳转，也是保证能起滑的安全区。`,
    `君主之间的空缺由淡色河床透出，那正是「该段年份没有在位君主的记录」——`
    + `成因与逐条核对见「空档审计」一节。`,
  ], { label: '这张图为什么这样画' }));

  host.appendChild(tableView(
    ['次序', '朝代', '起讫', '历时(年)', '皇帝数', 'DSI', '大一统'],
    ordered.map((b, i) => {
      const st = DYN_STATS.get(b.d.key);
      return [i + 1, b.d.name, `${fmtYearAxis(b.d.s)}–${fmtYearAxis(b.d.e)}`, st.span, b.n,
        st.dsi === null ? null : st.dsi.toFixed(1), b.d.u ? '是' : '否'];
    }),
    { caption: '河道次序（左→右）与朝代一览' },
  ));
}
