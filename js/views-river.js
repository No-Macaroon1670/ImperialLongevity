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
//   3. **改道是长弯，交替处不断流。** 初版在每个政权起讫点瞬间重分河宽、只留 10px
//      圆角，整张图读起来像阶梯，密集期尽是毛刺。现按 alluvial diagram 的画法重做：
//      每次改道摊开成一段 ±TRANS_PX 的过渡区，用 smoothstep 缓动；新政权自一线细流
//      张开、亡者收束成细流而不掐断成零宽的尖（d3-sankey 的 linkMinWidth 同理），
//      法统相承者在交替处共用一段变色的窄颈。河面在政权建立**之前几年**就开始让位——
//      细流是排版的预告，不是史实的提前（君主色块的起讫始终是真实日期）。
//      所有河道共用同一过渡窗做同一插值，任一瞬间的布局仍是一个不重叠的分割。
//
//   4. **河道之间留缝。** 溪流靠底色间隔分开（随河宽 5–9px），不靠描边——参照
//      alluvial 诸例中溪流间的留白；缝隙在细流与窄颈处自然收窄，正是河流交汇的样子。
//
//   5. **不套滚动容器 + 点选而非悬停。** 竖向内容再嵌一层竖向滚动是滚动陷阱，
//      本图直接交给页面滚，全页只有一个滚动器；顶／底两条固定条充当上下节跳转
//      与「安全起滑区」。触屏没有悬停，点中君主即高亮、详情进底部固定卡片。
import { el, h, linear, hoverable, legend, tableView, notes, fmtYearAxis, fmt1, textWidth } from './charts.js';
import { DYN_STATS } from './data.js';
import { ERAS, SUCCESSION, MERGED_INTO, SPRANG_FROM, ORDER_HINT, ORTHODOX, SECONDARY, DYN_MAP } from './dynasties.js';
import { fmtDate } from './schema.js';
import { buildBands, dynastyColorSlots, slotVar, resolveInk, shortName } from './views-lanes.js';

const GUTTER = 34;          // 左侧年份／时代标注的留白
const TRANS_PX = 56;        // 改道过渡区的目标半长（像素）——长 S 弯的来源
const WAVE_PX = 320;        // 蜿蜒波长（像素）：打破大一统长段的矩形感
const STEM = 1.6;           // 细流的半宽：河道张开／收束的末端不归零（d3-sankey 的
                            // linkMinWidth 同理），交替期的空档里始终有一线水流
const EPS = 1e-6;
/** 河道间的底色缝：随河宽自适应。窄屏 5px 已够分隔，宽屏同样的 5px 显得挤 */
const gapFor = (w) => Math.max(5, Math.min(9, w * 0.008));

/** 沿法统链上溯到源头，用于把同一支的政权排在一起 */
function lineageRoot(key) {
  let k = key;
  const seen = new Set();
  while (SUCCESSION[k] && !seen.has(k)) { seen.add(k); k = SUCCESSION[k]; }
  return k;
}

/**
 * 谱系家长：tier-2 政权沿「排序改判 → 法统相承 → 裂土分出」逐级上溯，
 * 直到父级是正统／北方主线（不再进堆）或无父可寻，返回最后一个 tier-2 祖先。
 * 于是冉魏归后赵、后赵归汉赵，赵家（汉赵→后赵→冉魏→前秦→后秦→胡夏）连成
 * 一个相邻块，家族内按各自起年排——初版让无 SUCCESSION 者自成一根，
 * 冉魏（350 年立）被排到最右，横插进十六国中央，整片河面为它挪位。
 */
function familyHead(key, orth, sec) {
  let k = key;
  const seen = new Set();
  while (!seen.has(k)) {
    seen.add(k);
    const p = ORDER_HINT[k] || SUCCESSION[k] || SPRANG_FROM[k];
    if (!p || !DYN_MAP.has(p) || orth.has(p) || sec.has(p)) return k;
    k = p;
  }
  return k;
}

/**
 * 全局总序。返回的比较键在整张图中固定不变，这正是「河道不交叉」的保证：
 * 两个政权只要共存，左右关系在每一段里都一样。
 * 正统与北方主线沿用法统链；其余政权按谱系家长归堆（见 familyHead）。
 */
function orderKeys(bands) {
  const orth = new Set(ORTHODOX), sec = new Set(SECONDARY);
  const bandOf = new Map(bands.map((b) => [b.d.key, b]));
  const groupKey = new Map();
  const groupStart = new Map();
  for (const b of bands) {
    const t = orth.has(b.d.key) ? 0 : sec.has(b.d.key) ? 1 : 2;
    const g = t === 2 ? familyHead(b.d.key, orth, sec) : lineageRoot(b.d.key);
    groupKey.set(b.d.key, g);
    const gb = bandOf.get(g);
    groupStart.set(b.d.key, gb ? gb.s : (DYN_MAP.get(g) ? DYN_MAP.get(g).s : b.s));
  }
  const tier = (b) => (orth.has(b.d.key) ? 0 : sec.has(b.d.key) ? 1 : 2);
  return bands.slice().sort((a, b) =>
    tier(a) - tier(b)
    || groupStart.get(a.d.key) - groupStart.get(b.d.key)
    || groupKey.get(a.d.key).localeCompare(groupKey.get(b.d.key))
    || a.s - b.s
    || a.d.key.localeCompare(b.d.key));
}

/**
 * 把时间切成「并存政权集合不变」的一段段，再把河宽切成 C 条**固定车道**。
 *
 * C ＝ 全图并存峰值（用户原案：「我们可以实际运用 7 个 Lane」）。任一时刻的 n 条
 * 河道各分得整数条车道：一统独占 C/C；两雄并立分 ⌈C/2⌉/⌊C/2⌋（七车道即 4/3）；
 * 三分则 3/2/2，依次类推，多出的车道自左先分（左侧是正统主线）。
 * 要点在于**车道边界是全图固定的网格**：政权生灭只转让整数条车道，
 * 未被转让的边界纹丝不动——这就是河流「更直」的来源，也一并消掉了
 * 此前按比例摊缝时远端河道跟着呼吸的毛病。缝隙从相邻河道交界各让 g0/2 刻出。
 */
function layoutChannels(bands, x0, x1) {
  const ordered = orderKeys(bands);
  const rank = new Map(ordered.map((b, i) => [b.d.key, i]));
  const cuts = [...new Set(bands.flatMap((b) => [b.s, b.e]))].sort((p, q) => p - q);
  const raw = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], z = cuts[i + 1];
    if (z - a < EPS) continue;
    const mid = (a + z) / 2;
    const live = bands.filter((b) => b.s <= mid && mid <= b.e)
      .sort((p, q) => rank.get(p.d.key) - rank.get(q.d.key));
    raw.push({ a, z, live, n: live.length });
  }
  const C = Math.max(1, ...raw.map((r) => r.n));
  const laneW = (x1 - x0) / C;
  const g0 = gapFor(x1 - x0);
  const slices = [];
  for (const r of raw) {
    if (!r.n) { slices.push({ a: r.a, z: r.z, live: [], n: 0, at: new Map() }); continue; }
    const base = Math.floor(C / r.n), rem = C % r.n;
    const at = new Map();
    let lane = 0;
    r.live.forEach((b, i) => {
      const size = base + (i < rem ? 1 : 0);
      const xa = x0 + lane * laneW + (i > 0 ? g0 / 2 : 0);
      const xb = x0 + (lane + size) * laneW - (i < r.n - 1 ? g0 / 2 : 0);
      at.set(b.d.key, [xa, xb]);
      lane += size;
    });
    slices.push({ a: r.a, z: r.z, live: r.live, n: r.n, at });
  }
  return { slices, ordered, rank, C };
}

/**
 * 某政权不在此段时的「退化盒」：一条 STEM 半宽的细流，放在按全局次序它本应
 * 插入的缝隙中点。新生河道自细流张开，消亡河道收束成细流——不掐断成零宽的尖
 * （初版收到零，法统交替处出现「X 形掐断」，河面像消失了一瞬）。
 * 分与合都收在正确的缝里，不会横穿别的河道。
 */
function degenerate(slice, rank, key, x0, x1) {
  const r = rank.get(key);
  let below = null, above = null;
  for (const b of slice.live) {
    const rb = rank.get(b.d.key);
    if (rb < r) below = b;
    else { above = b; break; }
  }
  const gap = gapFor(x1 - x0);
  const lo = below ? slice.at.get(below.d.key)[1] : null;
  const hi = above ? slice.at.get(above.d.key)[0] : null;
  const x = lo !== null && hi !== null ? (lo + hi) / 2
    : lo !== null ? Math.min(lo + gap / 2, x1)
    : hi !== null ? Math.max(hi - gap / 2, x0)
    : (x0 + x1) / 2;
  return [Math.max(x0, x - STEM), Math.min(x1, x + STEM)];
}

/**
 * 目标河道近岸上的细流盒。用于「支流汇入干流／干流分出支流」：
 * 亡者的收束点（或新生者的涌出点）骑在吞并者（或母体）的河岸上，
 * 尾迹经由过渡窗弯向河岸、没入其君主色块之下——亡国是汇流，不是蒸发。
 *
 * 相邻性门槛：先找该河道按全局次序本应落座的缝隙，目标必须正好是缝隙的
 * 左邻或右邻。中间隔着第三条河道时弯过去必然横穿别人（河道永不交叉是本图
 * 的硬约束），返回 null 退回缝隙细流——数据记的是史实，几何画得出才画。
 */
function bankStem(slice, rank, key, tgt) {
  const r = rank.get(key);
  let j = 0;
  for (const b of slice.live) { if (rank.get(b.d.key) < r) j++; else break; }
  const L = slice.live[j - 1], R = slice.live[j];
  if (L && L.d.key === tgt) { const box = slice.at.get(tgt); return [box[1] - STEM, box[1] + STEM]; }
  if (R && R.d.key === tgt) { const box = slice.at.get(tgt); return [box[0] - STEM, box[0] + STEM]; }
  return null;
}

/**
 * 相邻两段之间的过渡：窗 [c − ha, c + hb]，半长取「目标半长」与「邻段一半」的较小者，
 * 因此过渡窗彼此不相交。窗内所有河道用同一 smoothstep 在旧新两个分割之间插值——
 * 两个不重叠分割的凸组合仍是不重叠分割，故过渡中也不会有河道相互侵入。
 */
function buildTransitions(slices, rank, pxYear, x0, x1) {
  const tau = TRANS_PX / pxYear;
  const trans = [];
  const flows = [];
  for (let i = 1; i < slices.length; i++) {
    const A = slices[i - 1], B = slices[i];
    const c = B.a;
    const from = new Map(A.at), to = new Map(B.at);
    const local = [];
    for (const k of B.at.keys()) if (!from.has(k)) from.set(k, degenerate(A, rank, k, x0, x1));
    for (const k of A.at.keys()) if (!to.has(k)) to.set(k, degenerate(B, rank, k, x0, x1));
    // 亡入／分出：吞并者（母体）相邻时，细流直接放到对方河岸上——支流汇入
    // 干流、干流分出支流。中间隔着第三条河道时不能弯（河道永不交叉是硬约束），
    // 改记一条「穿流带」：半透明的细带穿过去，压在途经河道的君主色块之下、
    // 只在河床与缝隙间隐约可见，点选该政权时点亮——sankey 图的半透明 ribbon 同理
    for (const k of A.at.keys()) {
      if (B.at.has(k)) continue;
      const tgt = MERGED_INTO[k];
      if (!tgt) continue;
      const st = B.at.has(tgt) ? bankStem(B, rank, k, tgt) : null;
      if (st) to.set(k, st);
      // 目标不相邻、或已先亡／尚未生（北魏亡后半年西魏方立）：转穿流带，
      // 绘制端用 edge() 在带长范围内找目标，找不到才作罢
      else local.push({ key: k, tgt, dir: 'merge' });
    }
    for (const k of B.at.keys()) {
      if (A.at.has(k)) continue;
      const src = SPRANG_FROM[k];
      if (!src) continue;
      const st = A.at.has(src) ? bankStem(A, rank, k, src) : null;
      if (st) from.set(k, st);
      else local.push({ key: k, tgt: src, dir: 'spring' });
    }
    // 法统相承且在同一切点交棒者（汉→新、唐→后梁…），前后两河共用一个「颈缩」盒：
    // 前朝收进它、新朝从它张开，于是交替处是一段变色的窄颈，而不是两个背对背的尖——
    // ggalluvial 把承续画成一条连续 ribbon，同理
    const dying = [...A.at.keys()].filter((k) => !B.at.has(k));
    for (const yk of B.at.keys()) {
      if (A.at.has(yk)) continue;
      const xk = SUCCESSION[yk];
      if (!xk || !dying.includes(xk)) continue;
      const XA = A.at.get(xk), YB = B.at.get(yk);
      const cx = ((XA[0] + XA[1]) / 2 + (YB[0] + YB[1]) / 2) / 2;
      // 颈宽取六成而非两成：同切点的禅让（汉→新、宋→齐、五代五朝…）本是同一
      // 政权换了家姓，深掐成细颈会把「延续」错画成「崩解」。真正的崩解式收束
      // 属于有空窗的更迭（秦亡至汉兴隔着楚汉之争），那由细流＋空档自然呈现
      const w = Math.max(2 * STEM, Math.min(XA[1] - XA[0], YB[1] - YB[0]) * 0.6);
      const waist = [cx - w / 2, cx + w / 2];
      to.set(xk, waist);
      from.set(yk, waist);
    }
    // 近直角压平：过渡窗的长度随本次改道的最大位移伸长（至多三倍标准窗、
    // 不超过邻段一半）。位移大而窗短，边就近乎横切——统一与大分裂这类
    // 整幅重排，弯道必须给得更长
    let dx = 0;
    for (const [k, fb] of from) {
      const tb2 = to.get(k);
      if (tb2) dx = Math.max(dx, Math.abs(fb[0] - tb2[0]), Math.abs(fb[1] - tb2[1]));
    }
    const need = Math.max(tau, Math.min(3 * tau, (dx * 0.7) / pxYear));
    const ha = Math.min(need, (A.z - A.a) / 2);
    const hb = Math.min(need, (B.z - B.a) / 2);
    for (const f of local) {
      f.c = c;
      f.h = f.dir === 'merge' ? hb : ha;
      f.stem = (f.dir === 'merge' ? to : from).get(f.key);
      flows.push(f);
    }
    trans.push({ c, ha, hb, from, to });
  }
  return { trans, flows };
}

const smoothstep = (u) => u * u * (3 - 2 * u);

/**
 * 确定性蜿蜒：河道整体做 ±amp 的横向摆动，打破大一统长段的矩形感。
 * 相位取政权名的散列——不用随机数，同一筛选下重绘逐像素稳定；
 * 两个不同频的正弦叠出「河」而非「正弦墙纸」的观感。
 * 振幅不超过缝宽的三成，相邻河道即便反相摆动也吃不掉缝隙。
 */
function waveOf(key, t, pxYear, amp) {
  let hsh = 0;
  for (let i = 0; i < key.length; i++) hsh = (hsh * 31 + key.charCodeAt(i)) % 997;
  const ph = (hsh / 997) * Math.PI * 2;
  const u = (t * pxYear) / WAVE_PX * Math.PI * 2;
  return amp * (Math.sin(u + ph) + 0.4 * Math.sin(2.3 * u + 1.7 * ph));
}

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
 * 在 [ta, tb] 内采样河道边界。过渡窗内按 smoothstep 补 12 个采样点；
 * 常态段每 ~44px 也补一点——蜿蜒要靠这些点显形。折线过点即视觉平滑，
 * 不必维护贝塞尔的簿记。边界一律经 edgeFn（含蜿蜒偏移）取得。
 */
function sampleEdges(edgeFn, ta, tb, trans, pxYear) {
  const ts = new Set([ta, tb]);
  for (const T of trans) {
    const w0 = T.c - T.ha, w1 = T.c + T.hb;
    if (w1 < ta || w0 > tb) continue;
    for (let i = 0; i <= 12; i++) {
      const t = w0 + (w1 - w0) * i / 12;
      if (t > ta && t < tb) ts.add(t);
    }
  }
  const step = 44 / pxYear;
  for (let t = ta + step; t < tb; t += step) ts.add(t);
  const out = [];
  for (const t of [...ts].sort((a, b) => a - b)) {
    const e = edgeFn(t);
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
  // 槽位只从首位君主**实际在位**起算。buildBands 的带首含称帝前掌权期（泳道的
  // 半高段需要它），照搬到河流会让孙权自 200 年就占满一个槽——东汉最后二十年被
  // 挤出满宽、曹魏蜀汉的分叉凭空悬置。掌权期本就不计入任何统计，也不该占河面。
  const bands = buildBands(list).map((b) => {
    const s2 = Math.min(...b.segs.map((g) => g.s));
    return s2 > b.s ? { ...b, s: s2 } : b;
  });
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

  const { slices, ordered, rank, C } = layoutChannels(bands, RX0, RX1);
  const { trans, flows } = buildTransitions(slices, rank, pxYear, RX0, RX1);
  window.__RIVER__ = { slices, trans, flows, rank, C };   // 调试钩子：布局自检用
  const flowsBy = new Map();
  for (const f of flows) { if (!flowsBy.has(f.key)) flowsBy.set(f.key, []); flowsBy.get(f.key).push(f); }
  const amp = Math.min(1.6, gapFor(RX1 - RX0) * 0.3);
  const edge = (key, t) => {
    const b0 = edgeAt(key, t, slices, trans);
    if (!b0) return null;
    let w = waveOf(key, t, pxYear, amp);
    w = Math.max(RX0 - b0[0], Math.min(RX1 - b0[1], w));
    return [b0[0] + w, b0[1] + w];
  };
  const sample = (key, ta, tb) => sampleEdges((t) => edge(key, t), ta, tb, trans, pxYear);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'river-svg', role: 'img' });
  // 四个绘制层，DOM 顺序即遮挡顺序：所有河床垫底，君主段全体压在其上——
  // 因此新朝的预告细流（先于建国张开的淡色）只会显现在缝隙与河床里，
  // 绝不会浮在邻河的君主色块之上
  const gBeds = el('g'), gStrips = el('g'), gEmps = el('g'), gLabels = el('g');

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
  svg.appendChild(gBeds); svg.appendChild(gStrips); svg.appendChild(gEmps); svg.appendChild(gLabels);

  // ── 河道 ────────────────────────────────────────────────────────────────
  const empNodes = [];
  const labelNodes = [];
  for (const b of ordered) {
    const cvar = byDynasty ? slotVar(slots.get(b.d.key)) : (b.d.u ? '--c-unified' : '--c-split');
    const col = `var(${cvar})`;
    const st = DYN_STATS.get(b.d.key);

    // 河床：淡色底。首尾各向外多要 tau——楔尖与合拢尾就长在这段延伸里，
    // 生前死后窗外的采样返回 null 自动裁掉，无须另算窗的实际半长
    const bedSamples = sample(b.d.key, b.s - 3 * tau, b.e + 3 * tau);
    const bedPath = polyPath(bedSamples, y, 1);
    if (!bedPath) continue;
    const bed = el('path', { d: bedPath, fill: col, opacity: .16, class: 'mark', 'data-dyn': b.d.key });
    hoverable(bed, () => [
      { color: col, value: `${fmtYearAxis(b.d.s)}–${fmtYearAxis(b.d.e)}`, label: '国祚' },
      { label: '历时', value: `${st.span} 年` },
      { label: '皇帝', value: `${st.n} 位（当前筛选 ${b.n} 位）` },
      { label: 'DSI', value: st.dsi === null ? '—' : `${fmt1(st.dsi)} 年/帝` },
      ...(b.d.note ? [b.d.note] : []),
    ], () => b.d.name);
    gBeds.appendChild(bed);

    // 穿流带：亡入（或分出）对象不相邻时的半透明细带。画在河床层，
    // 于是途经河道的君主色块天然盖在它上面——主河在上，穿流只在底色间可见
    for (const f of (flowsBy.get(b.d.key) || [])) {
      const RIB = 84 / pxYear;                       // 带长（年）
      const sx = (f.stem[0] + f.stem[1]) / 2;
      const tv = f.dir === 'merge' ? f.c + f.h + RIB : f.c - f.h - RIB;
      const tb = edge(f.tgt, tv) || edge(f.tgt, f.c + (f.dir === 'merge' ? f.h : -f.h)) || edge(f.tgt, f.c);
      if (!tb) continue;
      const bx = sx < (tb[0] + tb[1]) / 2 ? tb[0] + STEM : tb[1] - STEM;
      const [ya, yb2] = f.dir === 'merge'
        ? [y(f.c + f.h), y(Math.min(tv, t1))]
        : [y(Math.max(tv, t0)), y(f.c - f.h)];
      const [xa, xb2] = f.dir === 'merge' ? [sx, bx] : [bx, sx];
      const my = (ya + yb2) / 2;
      const d = `M${(xa - STEM).toFixed(1)},${ya.toFixed(1)}`
        + `C${(xa - STEM).toFixed(1)},${my.toFixed(1)} ${(xb2 - STEM).toFixed(1)},${my.toFixed(1)} ${(xb2 - STEM).toFixed(1)},${yb2.toFixed(1)}`
        + `L${(xb2 + STEM).toFixed(1)},${yb2.toFixed(1)}`
        + `C${(xb2 + STEM).toFixed(1)},${my.toFixed(1)} ${(xa + STEM).toFixed(1)},${my.toFixed(1)} ${(xa + STEM).toFixed(1)},${ya.toFixed(1)}Z`;
      const rib = el('path', { d, fill: col, opacity: .22, class: 'mark river-flow', 'data-dyn': b.d.key });
      hoverable(rib, () => [
        f.dir === 'merge'
          ? `${b.d.name}亡入${(bands.find((x) => x.d.key === f.tgt) || { d: { name: f.tgt } }).d.name}（${fmtYearAxis(f.c)}）——中间隔着别的河道，故以穿流带示意，点选可点亮。`
          : `${b.d.name}裂出自${(bands.find((x) => x.d.key === f.tgt) || { d: { name: f.tgt } }).d.name}（${fmtYearAxis(f.c)}）——中间隔着别的河道，故以穿流带示意，点选可点亮。`,
      ], () => (f.dir === 'merge' ? '亡入' : '分出'));
      gBeds.appendChild(rib);
    }

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
      gStrips.appendChild(node);
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
      gEmps.appendChild(node);
      empNodes.push({ node, e: g.e, band: b, col, tip });

      // 非正常死亡：段末右缘的红色刻痕。初版横贯全河道，在五代十国这类
      // 短祚扎堆的年代叠成一片红白横纹——刻痕保留信号、去掉噪音
      if (markViolent && g.e.violent === 1 && g.e.reignEnd && Math.abs(g.x - g.e.reignEnd.t) < 0.01) {
        const box = edge(b.d.key, Math.max(g.s, g.x - gapY));
        if (box) {
          const wN = Math.max(9, Math.min((box[1] - box[0]) * 0.4, 46));
          gEmps.appendChild(el('line', {
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
        gEmps.appendChild(t);
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
    gLabels.appendChild(dot); gLabels.appendChild(label);
    labelNodes.push({ dot, label, y0: y(b.s), y1: y(b.e), lw, key: b.d.key });
  }

  const wrap = h('div', { class: 'river-wrap' }, [svg]);
  host.appendChild(wrap);

  // ── 点选高亮 ────────────────────────────────────────────────────────────
  // 触屏没有悬停，故以点选替代：选中者留亮，同屏其余压暗，详情进底部固定卡片。
  const card = h('div', { class: 'river-card' });
  document.body.appendChild(card);
  let selected = null;
  let litEls = [];
  const clearSel = () => {
    selected = null;
    card.classList.remove('on');
    for (const n of empNodes) n.node.classList.remove('dim', 'sel');
    for (const e2 of litEls) e2.setAttribute('opacity', e2.dataset.o0);
    litEls = [];
  };
  const select = (item) => {
    selected = item;
    for (const n of empNodes) {
      n.node.classList.toggle('dim', n !== item);
      n.node.classList.toggle('sel', n === item);
    }
    // 点亮该政权的河床与穿流带：被压在君主色块下的汇流去向由此显形
    for (const e2 of litEls) e2.setAttribute('opacity', e2.dataset.o0);
    litEls = [...svg.querySelectorAll(`path[data-dyn="${item.band.d.key}"]`)];
    for (const e2 of litEls) {
      e2.dataset.o0 = e2.getAttribute('opacity');
      e2.setAttribute('opacity', e2.classList.contains('river-flow') ? '0.55' : '0.34');
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
      // 横向也要跟随：河道随世事左右迁移，圆点若钉在建国时的 x，
      // 吸附滚动后就会浮在别家的河床上（北魏分裂处的西魏圆点即此症）
      const tAt = y.invert(stick);
      const boxNow = edge(n.key, Math.min(Math.max(tAt, t0), t1));
      if (boxNow) {
        const cxNow = (boxNow[0] + boxNow[1]) / 2;
        n.label.setAttribute('x', Math.max(GUTTER + 2, Math.min(W - n.lw - 2, cxNow - n.lw / 2)));
        n.dot.setAttribute('cx', boxNow[0] + 5);
      }
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
    `河宽切成 ${C} 条固定车道，按当时并存的政权数整数分配：一股独占全部车道＝天下一统，`
    + `两股分 ${Math.ceil(C / 2)}/${Math.floor(C / 2)}，依次类推。最挤处为 ${fmtYearAxis(peakSlice.a)} 年的 ${peak} 股。`
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
    `**左右次序按谱系归堆**：正统序列与北方主线各按法统连线，其余政权沿`
    + `「排序改判 → 法统相承 → 裂土分出」上溯到谱系家长归堆——赵家`
    + `（汉赵→后赵→冉魏→前秦→后秦→胡夏）、燕家、凉家各自连成相邻块，`
    + `家族内按起年排。个别政权疆土与血统不一致（西燕裂自前秦而血统属燕），`
    + `由 dynasties.js 的 ORDER_HINT 手工改判。`
    + `称帝前掌权期不占槽位：孙权 200 年已掌江东，但吴的河道自其首位皇帝在位起才张开。`,
    `河道之间**永不交叉**：左右次序由一个全局排序键决定（正统序列 → 北方主线 → 其余，`
    + `同一法统按其源头的起始年归堆），因此任意两个政权只要共存，次序在每一段里都相同。`
    + `政权消失时右邻左移即为「合流」，新政权插入时右邻右让即为「分叉」——`
    + `图上所有的分与合都只是这一条规则的结果，没有额外的美化。`,
    `**河宽切成 ${C} 条固定车道，按整数分配**：C＝全图并存峰值。任一时刻的 n 条河道`
    + `各分得整数条车道——一统独占、两雄 ${Math.ceil(C / 2)}/${Math.floor(C / 2)}、三分 3/2/2…`
    + `多出的车道自左先分（左侧是正统主线）。车道边界是全图固定的网格，政权生灭只转让`
    + `整数条车道，**未被转让的边界纹丝不动**——这是河流「更直」的来源，也消掉了此前`
    + `按比例摊缝时远端河道跟着呼吸的毛病。位移大的改道（统一、大分裂）会把过渡窗自动`
    + `拉长至多三倍，不出现近乎直角的急弯；河道另有 ±2px 的确定性蜿蜒`
    + `（相位取政权名散列，重绘稳定），免得大一统的长段读成矩形。`
    + `理想的调节量是真实疆域面积（河宽即国力、自带总量上限），但本库没有逐年疆域数据，`
    + `且元、清这类跨界政权难以归一——整数车道是「不画我们不掌握的东西」前提下的诚实近似。`,
    `**亡国是汇流，不是蒸发**：政权终结时其疆土并入谁家、建立时从谁家裂出，`
    + `都是已知的史实（见 dynasties.js 的 MERGED_INTO / SPRANG_FROM 及逐条依据）。`
    + `河道收束时弯向吞并者的河岸并没入其下（陈并于隋、北齐亡于北周、南宋亡于元…），`
    + `新河道的细流自母体的河岸涌出（清起于叛明的后金、金起于叛辽的完颜部…）。`
    + `吞并者与亡者之间隔着第三条河道时不弯——河道永不交叉是硬约束，此时改画一条`
    + `半透明的**穿流带**：压在途经河道的君主色块之下、只在底色间隐约可见，`
    + `点选该政权即点亮（sankey 图的半透明 ribbon 同理）。`
    + `禅让式的法统相承另有画法（变色微腰），两者都成立时微腰优先。`,
    `**改道摊开成长弯，交替处不断流**：每次政权更替的河宽重分摊在一段约 ±${TRANS_PX}px 的`
    + `过渡区里（不超过邻段一半，以免过渡区互相穿透），用 smoothstep 缓动。新河道自一线细流张开、`
    + `亡者收束成细流而**不掐断成零宽的尖**（d3-sankey 的 linkMinWidth 同理）；`
    + `法统相承者（汉→新、唐→后梁…）在交替处共用一段变色的窄颈，河面不断流。`
    + `河面在政权建立前数年即开始让位——**细流是排版的预告，不是史实的提前**：`
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
