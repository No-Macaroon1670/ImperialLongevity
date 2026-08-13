// views-river.js — 全页竖向「王朝之河」
//
// 与横向泳道的分工：泳道图把每个政权钉在一条固定的行上，读的是「谁在什么时候统治」；
// 这一张把时间竖过来、把河宽整个交给「当时并存的政权」瓜分，读的是**分裂的形状**——
// 大一统时是一条满宽的大河，分裂时河面裂成数股各自着色的分叉，重新统一时再合流。
//
// 五个设计决定：
//
//   1. **河宽恒定，只按政权数均分。** 本库没有疆域或人口数据，若让分叉宽度去编码
//      「谁更大」，那是在画我们并不掌握的东西。均分是诚实的选择，而且它让唯一的
//      视觉变量——分叉数——正好等于那一刻并存的政权数，这恰是本图要回答的问题。
//      代价是三年的割据小国与盛唐同宽；点按详情与数据表给出真实规模。
//
//   2. **全局总序 ⇒ 河道永不交叉。** 任意两个政权的左右次序由一个全局排序键决定，
//      因此在它们共存的每一段里次序都相同，两条河道不可能相交。次序为
//      「正统序列 → 北方主线 → 其余」，同一法统按其源头的起始年归堆，
//      于是前蜀与后蜀、西魏与北周相邻而非四散。
//
//   3. **改道是长弯，不是台阶。** 初版在每个政权起讫点瞬间重分河宽、只留 10px 圆角，
//      整张图读起来像阶梯，密集期尽是毛刺。现按 alluvial diagram 的画法重做：
//      每次改道摊开成一段 ±42px 的过渡区，用 smoothstep 缓动；新政权自楔尖张开、
//      亡者收拢成尖，因此河面在政权建立**之前几年**就开始让位——分叉是预告出来的，
//      这是排版的提前量，不是史实的提前（君主色块的起讫始终是真实日期）。
//      所有河道共用同一过渡窗做同一插值，任一瞬间的布局仍是一个不重叠的分割。
//
//   4. **河道之间留缝。** 溪流靠底色间隔分开（5px），不靠描边——参照 alluvial
//      诸例中溪流间的留白；缝隙在楔尖与合拢处自然收窄，正是河流交汇的样子。
//
//   5. **不套滚动容器 + 点选而非悬停。** 竖向内容再嵌一层竖向滚动是滚动陷阱，
//      本图直接交给页面滚，全页只有一个滚动器；顶／底两条固定条充当上下节跳转
//      与「安全起滑区」。触屏没有悬停，点中君主即高亮、详情进底部固定卡片。
import { el, h, linear, hoverable, legend, tableView, notes, fmtYearAxis, fmt1, textWidth } from './charts.js';
import { DYN_STATS } from './data.js';
import { ERAS, SUCCESSION, ORTHODOX, SECONDARY } from './dynasties.js';
import { fmtDate } from './schema.js';
import { buildBands, dynastyColorSlots, slotVar, resolveInk, shortName } from './views-lanes.js';

const GUTTER = 34;          // 左侧年份／时代标注的留白
const GAP = 5;              // 河道之间的底色缝
const TRANS_PX = 42;        // 改道过渡区的目标半长（像素）——长 S 弯的来源
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
 * 段内每个政权分得 (河宽 − 缝隙) / N，政权间留 GAP 底色缝。
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
    const n = live.length;
    const w = ((x1 - x0) - (n - 1) * GAP) / n;
    const at = new Map(live.map((b, k) => [b.d.key, [x0 + k * (w + GAP), x0 + k * (w + GAP) + w]]));
    slices.push({ a, z, live, n, at });
  }
  return { slices, ordered, rank };
}

/**
 * 某政权不在此段时的「退化盒」：宽度为零的点，放在按全局次序它本应插入的缝隙中点。
 * 新生河道自这里张开成楔，消亡河道向这里收拢成尖——分与合都收在正确的缝里，
 * 不会横穿别的河道。
 */
function degenerate(slice, rank, key, x0, x1) {
  const r = rank.get(key);
  let below = null, above = null;
  for (const b of slice.live) {
    const rb = rank.get(b.d.key);
    if (rb < r) below = b;
    else { above = b; break; }
  }
  const lo = below ? slice.at.get(below.d.key)[1] : null;
  const hi = above ? slice.at.get(above.d.key)[0] : null;
  const x = lo !== null && hi !== null ? (lo + hi) / 2
    : lo !== null ? Math.min(lo + GAP / 2, x1)
    : hi !== null ? Math.max(hi - GAP / 2, x0)
    : (x0 + x1) / 2;
  return [x, x];
}

/**
 * 相邻两段之间的过渡：窗 [c − ha, c + hb]，半长取「目标半长」与「邻段一半」的较小者，
 * 因此过渡窗彼此不相交。窗内所有河道用同一 smoothstep 在旧新两个分割之间插值——
 * 两个不重叠分割的凸组合仍是不重叠分割，故过渡中也不会有河道相互侵入。
 */
function buildTransitions(slices, rank, pxYear, x0, x1) {
  const tau = TRANS_PX / pxYear;
  const trans = [];
  for (let i = 1; i < slices.length; i++) {
    const A = slices[i - 1], B = slices[i];
    const c = B.a;
    const ha = Math.min(tau, (A.z - A.a) / 2);
    const hb = Math.min(tau, (B.z - B.a) / 2);
    const from = new Map(A.at), to = new Map(B.at);
    for (const k of B.at.keys()) if (!from.has(k)) from.set(k, degenerate(A, rank, k, x0, x1));
    for (const k of A.at.keys()) if (!to.has(k)) to.set(k, degenerate(B, rank, k, x0, x1));
    trans.push({ c, ha, hb, from, to });
  }
  return trans;
}

const smoothstep = (u) => u * u * (3 - 2 * u);

/** 河道 key 在时刻 t 的左右边界；不存在（生前窗外／死后窗外）时返回 null */
function edgeAt(key, t, slices, trans) {
  for (const T of trans) {
    if (t < T.c - T.ha - EPS || t > T.c + T.hb + EPS) continue;
    const A = T.from.get(key), B = T.to.get(key);
    if (A && B) {
      const s = smoothstep(Math.min(1, Math.max(0, (t - (T.c - T.ha)) / (T.ha + T.hb))));
      return [A[0] + (B[0] - A[0]) * s, A[1] + (B[1] - A[1]) * s];
    }
    break;                                     // 窗内但该河道两侧都无盒 → 交给段常态
  }
  const S = slices.find((s) => t >= s.a - EPS && t <= s.z + EPS);
  return (S && S.at.get(key)) || null;
}

/**
 * 在 [ta, tb] 内采样河道边界。常态段只需两端点，过渡窗内按 smoothstep 补 10 个采样点，
 * 折线过这些点即视觉平滑，不必维护贝塞尔的簿记。
 */
function sampleEdges(key, ta, tb, slices, trans) {
  const ts = new Set([ta, tb]);
  for (const T of trans) {
    const w0 = T.c - T.ha, w1 = T.c + T.hb;
    if (w1 < ta || w0 > tb) continue;
    for (let i = 0; i <= 10; i++) {
      const t = w0 + (w1 - w0) * i / 10;
      if (t > ta && t < tb) ts.add(t);
    }
  }
  const out = [];
  for (const t of [...ts].sort((a, b) => a - b)) {
    const e = edgeAt(key, t, slices, trans);
    if (e) out.push({ t, x0: e[0], x1: e[1] });
  }
  return out;
}

/** 采样点连成的封闭多边形：左岸顺流而下，右岸逆流而上 */
function polyPath(samples, y, inset = 0) {
  if (samples.length < 2) return '';
  if (Math.max(...samples.map((p) => p.x1 - p.x0)) < inset * 2 + 1.2) return '';
  const pt = samples.map((p) => {
    const half = Math.min(inset, (p.x1 - p.x0) / 2);
    return { yy: y(p.t), l: p.x0 + half, r: p.x1 - half };
  });
  let d = `M${pt[0].l.toFixed(1)},${pt[0].yy.toFixed(1)}`;
  for (let i = 1; i < pt.length; i++) d += `L${pt[i].l.toFixed(1)},${pt[i].yy.toFixed(1)}`;
  for (let i = pt.length - 1; i >= 0; i--) d += `L${pt[i].r.toFixed(1)},${pt[i].yy.toFixed(1)}`;
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
  const tau = TRANS_PX / pxYear;

  const { slices, ordered, rank } = layoutChannels(bands, RX0, RX1);
  const trans = buildTransitions(slices, rank, pxYear, RX0, RX1);
  const edge = (key, t) => edgeAt(key, t, slices, trans);
  const sample = (key, ta, tb) => sampleEdges(key, ta, tb, slices, trans);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'river-svg', role: 'img' });

  // ── 时代分带：整幅横向淡底，交替填充 ────────────────────────────────────
  ERAS.forEach((era, i) => {
    const ya = Math.max(0, y(era.s)), yb = Math.min(H, y(era.e));
    if (yb - ya < 3) return;
    if (i % 2 === 0) svg.appendChild(el('rect', { x: 0, y: ya, width: W, height: yb - ya, class: 'era-band', opacity: .55 }));
    svg.appendChild(el('line', { x1: 0, x2: W, y1: yb, y2: yb, class: 'ref-line', opacity: .5 }));
  });

  // ── 年份刻度：每 100 年一道，贴左栏 ─────────────────────────────────────
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
    const cvar = byDynasty ? slotVar(slots.get(b.d.key)) : (b.d.u ? '--c-unified' : '--c-split');
    const col = `var(${cvar})`;
    const st = DYN_STATS.get(b.d.key);

    // 河床：淡色底。首尾各向外多要 tau——楔尖与合拢尾就长在这段延伸里，
    // 生前死后窗外的采样返回 null 自动裁掉，无须另算窗的实际半长
    const bedSamples = sample(b.d.key, b.s - tau, b.e + tau);
    const bedPath = polyPath(bedSamples, y, 1);
    if (!bedPath) continue;
    const bed = el('path', { d: bedPath, fill: col, opacity: .16, class: 'mark' });
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
      const s0 = sample(b.d.key, g.s, g.x);
      const w = s0.length ? Math.min(7, (s0[0].x1 - s0[0].x0) / 3) : 0;
      if (!w) continue;
      const d = polyPath(s0.map((p) => ({ t: p.t, x0: p.x0, x1: p.x0 + w })), y, 0.5);
      if (!d) continue;
      const node = el('path', { d, fill: col, opacity: .5, class: 'mark' });
      hoverable(node, () => [
        { color: col, value: `${fmtDate(g.e.accRule, { yearOnly: true })}–${fmtDate(g.e.acc, { yearOnly: true })}`, label: '掌权（未称帝）' },
        { label: '称帝', value: fmtDate(g.e.acc) },
        '此段为该君主实际掌握政权最高权力、但尚未即皇帝位的时期，不计入「在位年数」。',
      ], () => `${b.d.name}·${g.e.temple}`);
      svg.appendChild(node);
    }

    // 君主分段：实色块。段间缝按像素给（1.1px），不按年——按年给会在密集期
    // 放大成一屏横纹；起讫日期本身始终是真实值，缝只是绘图退让
    for (const g of b.segs) {
      const gapY = Math.min(1.1 / pxYear, (g.x - g.s) * 0.22);
      const segSamples = sample(b.d.key, g.s + gapY, g.x - gapY);
      const d = polyPath(segSamples, y, 1);
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

      // 非正常死亡：段末右缘的红色刻痕。初版横贯全河道，在五代十国这类
      // 短祚扎堆的年代叠成一片红白横纹——刻痕保留信号、去掉噪音
      if (markViolent && g.e.violent === 1 && g.e.reignEnd && Math.abs(g.x - g.e.reignEnd.t) < 0.01) {
        const box = edge(b.d.key, Math.max(g.s, g.x - gapY));
        if (box) {
          const wN = Math.max(9, Math.min((box[1] - box[0]) * 0.4, 46));
          svg.appendChild(el('line', {
            x1: box[1] - 1.5 - wN, x2: box[1] - 1.5, y1: y(g.x) - 1.4, y2: y(g.x) - 1.4,
            stroke: 'var(--critical)', 'stroke-width': 2.5, 'stroke-linecap': 'round',
          }));
        }
      }

      // 君主简称：竖排（汉字的本来排法）。取段中点处的河宽判断放不放得下
      const nm = shortName(g.e);
      const midBox = edge(b.d.key, (g.s + g.x) / 2);
      const chW = midBox ? midBox[1] - midBox[0] : 0;
      const runH = y(g.x) - y(g.s);
      if (midBox && chW >= 15 && runH >= nm.length * 10 + 6) {
        const tx = (midBox[0] + midBox[1]) / 2;
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
    const box0 = edge(b.d.key, Math.min(b.e, b.s + Math.min(tau, (b.e - b.s) / 2))) || edge(b.d.key, b.s);
    if (!box0) continue;
    const lw = textWidth(b.d.name, 11.5);
    const cx = (box0[0] + box0[1]) / 2;
    const dot = el('circle', { cx: box0[0] + 5, cy: y(b.s) + 6, r: 3, fill: col });
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
    + (markViolent ? ' 河道右缘的红色刻痕＝该帝非正常死亡。' : '')
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
    + `正好等于那一刻并存的政权数。代价是三年的割据小国与盛唐同宽，真实规模见点按详情与数据表。`,
    `河道之间**永不交叉**：左右次序由一个全局排序键决定（正统序列 → 北方主线 → 其余，`
    + `同一法统按其源头的起始年归堆），因此任意两个政权只要共存，次序在每一段里都相同。`
    + `政权消失时右邻左移即为「合流」，新政权插入时右邻右让即为「分叉」——`
    + `图上所有的分与合都只是这一条规则的结果，没有额外的美化。`,
    `**改道摊开成长弯**：每次政权更替的河宽重分摊在一段约 ±${TRANS_PX}px 的过渡区里`
    + `（不超过邻段一半，以免过渡区互相穿透），用 smoothstep 缓动。新河道自楔尖张开、`
    + `亡者收拢成尖，故河面在政权建立前数年即开始让位——**楔尖是排版的预告，不是史实的提前**：`
    + `淡色河床可早于建国数年张开，但君主色块的起讫始终是真实日期。`
    + `所有河道在同一过渡窗内做同一插值，任一瞬间的布局仍是不重叠的分割，这是长弯不打架的保证。`,
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
