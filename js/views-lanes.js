// views-lanes.js — 横向泳道时间轴
//
// 与纵向双层时间轴的分工：那一张一行一位皇帝、纵向铺 325 行，看的是「个体」；
// 这一张把**朝代**做成横向长带、皇帝做成带内分段，看的是「同一时刻有几个政权在运转」。
//
// 三个设计决定：
//   1. 泳道可回收（用户所谓 no loyalty）。一条泳道不归属任何朝代：某朝终结后，
//      该泳道即可被后来开始的政权接管。于是任一时刻被占用的泳道数 ＝ 当时并存的政权数，
//      九条泳道足以容纳中国史上最挤的时刻（937 年，十一个政权并存）。
//   2. 以朝代而非皇帝为泳道单元。若一行一位皇帝，每个名字要占约 80px 固定宽度，
//      实测即使放大到 20px/年仍需 12 条以上泳道（密集期短祚之君扎堆）；
//      改为朝代长带后只需 9 条，且长带本身有足够宽度容纳名称。
//   3. 朝代名在带首，并在横向滚动时吸附于视口左缘（不越出本带范围），
//      因此任何时刻都能读出正在看的是哪一朝。
import { el, h, linear, ticks, hoverable, legend, tableView, notes, showTip, hideTip, fmtYearAxis, fmt1, scrollHint } from './charts.js';
import { mountKnowledgeCorner, eventSpec } from './knowledge.js';
import { DYNASTIES, DYN_STATS } from './data.js';
import { ERAS, SUCCESSION, MERGED_INTO, SPRANG_FROM, TRANSITIONS, ORTHODOX, SECONDARY } from './dynasties.js';
import { EVENTS, EVENT_KINDS } from './events.js';
import { fmtDate } from './schema.js';

const SLOT_VARS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];
const OTHER_VAR = '--lane-other';

// ── 朝代取色：区间图着色 ──────────────────────────────────────────────────
// 时间上重叠的两个政权必须异色；不重叠的可以安全复用同一槽位（唐与明同为槽 1 无妨）。
// 结果只依赖 DYNASTIES 常量，与过滤器无关 —— 筛选不会让幸存者改色。
let COLOR_CACHE = null;
export function dynastyColorSlots() {
  if (COLOR_CACHE) return COLOR_CACHE;
  const ds = DYNASTIES;
  const prominence = (d) => {
    const st = DYN_STATS.get(d.key);
    return (d.e - d.s + 1) * Math.log(2 + (st ? st.n : 0));
  };
  // 正统序列优先取色相，边缘割据政权在色相用尽时折入中性灰
  const order = ds.slice().sort((a, b) => (a.tier - b.tier) || (prominence(b) - prominence(a)));
  const slot = new Map();
  for (const d of order) {
    const taken = new Set();
    for (const o of ds) {
      const c = slot.get(o.key);
      if (o === d || c === undefined || c < 0) continue;
      if (o.s <= d.e && d.s <= o.e) taken.add(c);
    }
    let c = 0;
    while (c < SLOT_VARS.length && taken.has(c)) c++;
    slot.set(d.key, c < SLOT_VARS.length ? c : -1);
  }
  COLOR_CACHE = slot;
  return slot;
}
export const slotVar = (s) => (s < 0 ? OTHER_VAR : SLOT_VARS[s]);

// 读出当前主题下解析后的真实色值，用于判断段内文字该用白还是墨色
export function resolveInk(host) {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  host.appendChild(probe);
  const ink = {};
  for (const v of [...SLOT_VARS, OTHER_VAR]) {
    probe.style.color = `var(${v})`;
    const m = getComputedStyle(probe).color.match(/\d+/g);
    if (!m) { ink[v] = 'light'; continue; }
    const [r, g, b] = m.map(Number).map((x) => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    ink[v] = (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.35 ? 'dark' : 'light';
  }
  probe.remove();
  return ink;
}

const textW = (s, fs) => [...s].reduce((a, c) => a + (/[一-鿿＀-￯（）]/.test(c) ? 1 : 0.55), 0) * fs;

/**
 * 段内显示的简称：带首已写明朝代，段内不必重复。
 * 先去掉括注（「元太祖（成吉思汗）」→「元太祖」），再剥掉与朝代重复的前缀；
 * 朝代全名对不上时退一步剥其末字，使「东汉·汉光武帝」在带内只写「光武帝」。
 */
export function shortName(e) {
  const t = e.temple.replace(/（[^）]*）$/, '');
  const tail = e.dynasty.slice(-1);
  const stripped = t.startsWith(e.dynasty) ? t.slice(e.dynasty.length)
    : (t.length > 2 && t.startsWith(tail)) ? t.slice(1) : t;
  return stripped || t;
}

/**
 * 把筛选后的皇帝名单组装成「朝代带」——横向泳道与竖向河流两个视图共用同一套口径。
 *
 * 带的跨度由「实际有君主在位（含称帝前掌权期）」决定，不回退到朝代元数据的年份：
 * 元数据只精确到年，曹魏记作「220」即 220 年 1 月，而汉献帝实际禅位在 220 年 11 月；
 * 若以元数据取值，两朝会凭空重叠十一个月，接续关系便无法落在同一条泳道／河道上。
 * 头尾若真有一年以上无主，由「空档审计」一节单独列出，不靠底带掩盖。
 */
export function buildBands(list) {
  const bands = [];
  for (const d of DYNASTIES) {
    const emps = list.filter((e) => e.dynKey === d.key);
    if (!emps.length) continue;
    const segs = [];
    const preRule = [];
    for (const e of emps) {
      for (const rg of e.reigns) {
        const s = rg.s, en = rg.e || e.death || e.censor;
        if (!s || !en) continue;
        segs.push({ e, s: s.t, x: Math.max(en.t, s.t + 0.08) });
      }
      // 称帝前已实际掌握该政权最高权力的一段（石勒 319 称赵王、330 才称帝；
      // 忽必烈 1260 即汗位、1271 才建国号元）。不画出来，带首就会凭空空一大截，
      // 看上去像缺数据。以半高／半宽浅段区别于正式在位期。
      const first = e.reigns[0].s;
      if (e.accRule && first && first.t - e.accRule.t > 0.9) {
        preRule.push({ e, s: e.accRule.t, x: first.t });
      }
    }
    if (!segs.length) continue;
    segs.sort((a, b) => a.s - b.s);
    for (const g of segs) { g.ds = g.s; g.dx = g.x; }   // ds/dx＝绘图坐标，s/x 始终保留真实日期
    const s = Math.min(...segs.map((g) => g.s), ...preRule.map((g) => g.s));
    const e2 = Math.max(...segs.map((g) => g.x));
    bands.push({ d, s, e: e2, segs, preRule, n: emps.length });
  }
  bands.sort((a, b) => a.s - b.s || a.e - b.e);
  return bands;
}

// ── 主渲染 ───────────────────────────────────────────────────────────────
export function renderLaneTimeline(host, list, opts) {
  host.innerHTML = '';
  const pxYear = opts.lanePx || 10;
  const byDynasty = opts.laneColor !== 'unified';
  const markViolent = opts.laneViolent !== false;
  const slots = dynastyColorSlots();
  const ink = resolveInk(host);

  const showEvents = opts.laneEvents !== false;
  const EV_H = showEvents ? 26 : 0;      // 事件轨:贴在表头之下、泳道之上
  const LANE_H = 48, LABEL_H = 15, TRACK_Y = 18, TRACK_H = 24, HEAD_H = 54 + EV_H;
  const LABEL_FS = 12.5, SEG_FS = 10;

  // 1) 组装朝代带
  const bands = buildBands(list);
  if (!bands.length) { host.appendChild(h('p', { class: 'muted', text: '当前筛选无数据。' })); return; }

  // 2) 泳道装箱。带的横向足迹取「带宽」与「名称宽度」的较大者，
  //    因此带首的名称永远不会压到上一条政权的尾部。
  //    在首次适配之上加一层偏好：后继政权优先落在前身那一行（见 SUCCESSION），
  //    使前蜀→后蜀、西魏→北周、五代中原正统线等继承关系横向连成一条。
  //    相邻政权多半首尾紧接（后梁止于 923、后唐即立于 923），故同泳道只留 4px 间隙；
  //    已声明的接续关系允许完全紧邻（间隙 0），两带之间靠 2px 底色缝分隔。
  //    最上一行为正统序列专用（见 ORTHODOX）：不参与回收，任何割据政权都不会挤进来，
  //    于是第一行自成一条贯通两千年的主线，其余政权一律平等地排在下方。
  //    第二行优先安排北朝线（见 SECONDARY），与正统行并行；该行并不独占，
  //    北朝线只覆盖 386–581 年，其余时段照常参与回收。
  //    因此泳道占用记为「区间表」而非单一末端值：正统行与北朝线要先于其余政权落座，
  //    落座顺序不再与时间顺序一致，只有区间表才能让后来者准确填进它们之间的空当。
  const orthSet = new Set(ORTHODOX);
  const secSet = new Set(SECONDARY);
  const orth = bands.filter((b) => orthSet.has(b.d.key));
  const sec = bands.filter((b) => secSet.has(b.d.key) && !orthSet.has(b.d.key));
  const useTop = orth.length > 0;
  const useSecond = sec.length > 0;
  const ROW_SEC = useTop ? 1 : 0;
  const GAP = 4;
  const lanes = [];                            // lanes[k] = [{a, z, key}]，均为像素区间
  const laneOf = new Map();
  const successorOf = new Map();
  for (const b of bands) { const p = SUCCESSION[b.d.key]; if (p) successorOf.set(p, b); }

  const spanOf = (b) => {
    const a = b.s * pxYear;
    return { a, z: Math.max(b.e * pxYear, a + textW(b.d.name, LABEL_FS) + 14) };
  };
  const ensure = (k) => { while (lanes.length <= k) lanes.push([]); return lanes[k]; };
  const place = (b, k) => {
    const s = spanOf(b);
    ensure(k).push({ ...s, key: b.d.key });
    b.lane = k; laneOf.set(b.d.key, k);
  };
  const freeIn = (k, b, gap) => {
    if (k < 0 || k >= lanes.length) return true;
    const { a, z } = spanOf(b);
    return !lanes[k].some((iv) => iv.a < z + gap && a - gap < iv.z);
  };
  /** 该行中紧邻 b 之前的那个政权——用于判断会不会挤掉它的后继 */
  const prevOwner = (k, b) => {
    const { a } = spanOf(b);
    let best = null;
    for (const iv of (lanes[k] || [])) if (iv.z <= a && (!best || iv.z > best.z)) best = iv;
    return best ? best.key : null;
  };

  // 先让两条主线落座
  if (useTop) { ensure(0); for (const b of orth) place(b, 0); }
  if (useSecond) { ensure(ROW_SEC); for (const b of sec) place(b, ROW_SEC); }

  const firstFree = useTop ? 1 : 0;             // 第一行独占；第二行只是优先，不独占
  for (const b of bands) {
    if (laneOf.has(b.d.key)) continue;          // 两条主线已就位
    // 占了这一行会不会挡住该行前一位的后继？只有「尚未落座」的后继才需要留位——
    // 北周的后继是隋，而隋早已入座正统行，再为它把某一行空着纯属浪费。
    const blocks = (k) => {
      const s = successorOf.get(prevOwner(k, b));
      return !!s && s !== b && !laneOf.has(s.d.key) && s.s < b.e;
    };
    let k = -1;
    const pl = laneOf.get(SUCCESSION[b.d.key]);
    if (pl !== undefined && pl >= firstFree && freeIn(pl, b, 0)) k = pl;   // 紧随前身
    if (k < 0) { k = firstFree; while (k < lanes.length && (!freeIn(k, b, GAP) || blocks(k))) k++; }
    if (k >= lanes.length) {                    // 无「既空闲又不挡后继」之行，退而求其次
      let j = firstFree; while (j < lanes.length && !freeIn(j, b, GAP)) j++;
      k = j;
    }
    place(b, k);
  }
  const nLanes = lanes.length;

  // 2b) 主线交替期：线内相邻两朝若并存（实测峰值恰为 2），上一朝居上半轨、下一朝居下半轨，
  //     其余时段仍占满整条轨道。正统行与北方线共用这一套画法，全图只有一种视觉语法。
  //     切分点即并存区间的首尾，底带、掌权期与皇帝分段一并按段绘制。
  const contests = [];
  const layoutLine = (members) => {
    const line = members.slice().sort((a, b) => a.s - b.s);
    const local = [];
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], c = line[i + 1];
      const from = Math.max(a.s, c.s), to = Math.min(a.e, c.e);
      if (to - from > 0.02) local.push({ from, to, top: a, bottom: c, lane: a.lane });
    }
    for (const b of members) {
      const cuts = new Set([b.s, b.e]);
      for (const c of local) {
        if (c.from > b.s && c.from < b.e) cuts.add(c.from);
        if (c.to > b.s && c.to < b.e) cuts.add(c.to);
      }
      const xs = [...cuts].sort((p, q) => p - q);
      b.pieces = [];
      for (let i = 0; i + 1 < xs.length; i++) {
        const mid = (xs[i] + xs[i + 1]) / 2;
        const c = local.find((k) => k.from <= mid && mid <= k.to && (k.top === b || k.bottom === b));
        b.pieces.push({ x0: xs[i], x1: xs[i + 1], slot: c ? (c.top === b ? 0 : 1) : null });
      }
    }
    contests.push(...local);
  };
  if (useTop) layoutLine(orth);
  if (useSecond) layoutLine(sec);
  /** 把 [from,to] 按该带的分段切开，回调拿到每一小段的横向范围与纵向几何 */
  const spanParts = (b, from, to) => {
    const pieces = b.pieces || [{ x0: b.s, x1: b.e, slot: null }];
    const out = [];
    for (const p of pieces) {
      const a = Math.max(from, p.x0), c = Math.min(to, p.x1);
      if (c > a) out.push({ x0: a, x1: c, slot: p.slot });
    }
    return out.length ? out : [{ x0: from, x1: to, slot: null }];
  };
  const slotGeom = (slot) => (slot === null
    ? { y: TRACK_Y, h: TRACK_H }
    : { y: TRACK_Y + slot * (TRACK_H / 2 + 1), h: TRACK_H / 2 - 1 });

  // 3) 带内排布。
  //    实测 100 处「同朝代内在位重叠」中有 95 处不足 0.25 年（康熙/雍正 0.01 年、
  //    晋武帝/晋惠帝 0.00 年），全是史料只精确到月、前帝崩与后帝即位落在同一个月所致，
  //    并非真的两人同时在位。若一有重叠就另起一层，整条带会被这些假重叠劈成两行。
  //    因此：容差 TOL 以内的重叠直接挤压——把交界推到重叠区中点，两段各让一半，
  //    仍并排在同一行，靠 2px 底色缝分隔；只有超过容差的真并立（闽景宗与天德帝
  //    在福州、建州各自称帝；南齐东昏侯与和帝分据建康、江陵）才分层错开。
  const TOL = 0.5;
  for (const b of bands) {
    const subEnd = [];
    for (const g of b.segs) {
      let k = 0;
      while (k < subEnd.length && subEnd[k] - g.s > TOL) k++;
      if (k === subEnd.length) subEnd.push(-Infinity);
      subEnd[k] = Math.max(subEnd[k], g.x);
      g.sub = k;
    }
    b.subs = subEnd.length;
    // 同层内残余的细微重叠：交界取中点，两段各退一半
    for (let s = 0; s < b.subs; s++) {
      const row = b.segs.filter((g) => g.sub === s);
      for (let i = 0; i + 1 < row.length; i++) {
        const a = row[i], c = row[i + 1];
        if (a.dx > c.ds) {
          const m = (a.dx + c.ds) / 2;
          a.dx = Math.max(a.ds + 0.02, m);
          c.ds = Math.min(c.dx - 0.02, m);
        }
      }
    }
  }

  // 4) 画布尺寸
  const t0 = Math.min(...bands.map((b) => b.s)) - 8;
  const t1 = Math.max(...bands.map((b) => b.e)) + 8;
  const PAD_L = 4;
  const W = Math.round((t1 - t0) * pxYear) + PAD_L * 2;
  const BODY_H = nLanes * LANE_H + 8;
  const x = linear([t0, t1], [PAD_L, W - PAD_L]);
  const tickStep = pxYear >= 14 ? 25 : pxYear >= 10 ? 50 : 100;
  const yTicks = [];
  for (let t = Math.ceil(t0 / tickStep) * tickStep; t <= t1; t += tickStep) yTicks.push(t);

  // ── 表头（时代分带 + 年份刻度），随内容横向滚动、纵向吸顶 ──────────────
  const head = el('svg', { viewBox: `0 0 ${W} ${HEAD_H}`, width: W, height: HEAD_H });
  const eraLabels = [];
  ERAS.forEach((era, i) => {
    const x0 = Math.max(PAD_L, x(era.s)), x1 = Math.min(W - PAD_L, x(era.e));
    if (x1 - x0 < 4) return;
    if (i % 2 === 0) head.appendChild(el('rect', { x: x0, y: 0, width: x1 - x0, height: 20, class: 'era-band' }));
    // 时代名同样吸附于视口左缘：滚到哪一段，就一直能读出身处哪个时代
    const t = el('text', { x: x0 + 8, y: 14, class: 'era-label' }, era.name);
    head.appendChild(t);
    eraLabels.push({ node: t, x0, x1, lw: textW(era.name, 10.5) });
  });
  for (const t of yTicks) {
    head.appendChild(el('line', { x1: x(t), x2: x(t), y1: 24, y2: 30, class: 'axis-line' }));
    head.appendChild(el('text', { x: x(t), y: 44, class: 'tick', 'text-anchor': 'middle' }, fmtYearAxis(t)));
  }
  head.appendChild(el('line', { x1: 0, x2: W, y1: 53, y2: 53, class: 'axis-line' }));

  // ── 事件轨：大事记 ──────────────────────────────────────────────────────
  // 时间轴此前只画「谁在统治」,事件层补上「那两千年里发生了什么」——
  // 教育类时间轴的主体内容正是这一层。标记按类别取形与色(EVENT_KINDS),
  // 跨年事件(安史之乱 755–763)画成一段横条,点标记即在知识卡里读词条。
  // 放在表头内而非泳道里:它随表头吸顶,滚到哪一段都看得见,且不占泳道行数。
  if (showEvents) {
    const evY = 53 + EV_H / 2 + 1;
    const placed = [];                       // 已占用的横向区间,用于避让重叠
    // 运行时护栏:与承继细丝同条目的事件不画——那件事细丝的刻痕已经能点开,
    // 画两遍只会让同一件事在图上出现两次(用户实测:太平天国既是政权又是事件)
    const trW = new Set(Object.values(TRANSITIONS).map((t) => t.w));
    for (const ev of EVENTS) {
      if (trW.has(ev.w)) continue;
      const ex = x(ev.y);
      if (ex < PAD_L - 40 || ex > W - PAD_L + 40) continue;
      const kind = EVENT_KINDS[ev.k] || EVENT_KINDS.gov;
      const label = ev.n;
      const lw = textW(label, 9.5);
      // 标记恒画;标签只在不与前一个相撞时才写(密集期宁可只留标记,靠悬停读名)
      let ty = evY - 8;
      const room = !placed.some((iv) => ex - 4 < iv.z && iv.a < ex + lw + 8);
      if (ev.y2 && x(ev.y2) - ex > 3) {
        head.appendChild(el('rect', { x: ex, y: evY - 3.5, width: x(ev.y2) - ex, height: 3,
          rx: 1.5, fill: `var(--ev-${ev.k})`, opacity: .5 }));
      }
      const dot = el('circle', { cx: ex, cy: evY - 2, r: 3.2, fill: `var(--ev-${ev.k})`,
        class: 'mark ev-dot', 'data-ev-n': label });
      const hit = el('rect', { x: ex - 7, y: 53, width: 14, height: EV_H, fill: 'transparent',
        'pointer-events': 'all', class: 'kp-hit ev-hit' });
      hit.dataset.evi = String(EVENTS.indexOf(ev));
      hoverable(hit, () => [
        { color: `var(--ev-${ev.k})`, value: ev.y2 ? `${fmtYearAxis(ev.y)}–${fmtYearAxis(ev.y2)}` : fmtYearAxis(ev.y), label: kind.label },
        { label: '事件', value: label },
        '点它可在右侧卡片读这条大事记的词条。',
      ], () => label);
      head.appendChild(dot);
      if (room) {
        head.appendChild(el('text', { x: ex + 5, y: ty + 1, 'font-size': 9.5,
          fill: 'var(--text-2)', 'pointer-events': 'none' }, label));
        placed.push({ a: ex, z: ex + lw + 8 });
      }
      head.appendChild(hit);
    }
  }

  // ── 主体 ────────────────────────────────────────────────────────────────
  const body = el('svg', { viewBox: `0 0 ${W} ${BODY_H}`, width: W, height: BODY_H });
  for (const t of yTicks) {
    body.appendChild(el('line', { x1: x(t), x2: x(t), y1: 0, y2: BODY_H, class: 'grid' }));
  }
  for (const era of ERAS) {
    const bx = x(era.e);
    if (bx > PAD_L && bx < W - PAD_L) body.appendChild(el('line', { x1: bx, x2: bx, y1: 0, y2: BODY_H, class: 'ref-line' }));
  }

  // 第一行整行淡底，标出「这一行与其余行性质不同」。第二行不加底色——
  // 北方线只覆盖其中约 500 年，整行涂色会误示为该行全归北方线所有。
  if (useTop) body.appendChild(el('rect', { x: 0, y: 0, width: W, height: LANE_H, fill: 'var(--text-1)', opacity: 0.035 }));

  // 三个绘制层,DOM 顺序即遮挡顺序:浅底带垫底 → 承继细丝 → 君主段与标签压顶。
  // 细丝夹在中间,于是它在留白与浅底带上现身、遇到实心的君主段便潜行而过——
  // 与竖向河流的分层教义同一条(穿流带压在君主色块之下,只在河床与缝隙间可见)
  const gBase = el('g'), gStrand = el('g', { class: 'tl-strands' }), gTop = el('g');
  body.appendChild(gBase); body.appendChild(gStrand); body.appendChild(gTop);

  if (contests.length) {
    // 交替并立期：45° 斜纹底衬。此处纹理承载的是「并立」这一状态，非装饰
    const defs = el('defs');
    defs.appendChild(el('pattern', {
      id: 'contest-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)',
    }, [el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: 'var(--text-2)', 'stroke-width': 1.1, opacity: 0.34 })]));
    body.appendChild(defs);
    for (const c of contests) {
      // 上下半轨的切分照做（否则两带会真的重叠），但不足半年的交接不再加斜纹：
      // 那只是月度精度造成的数日重叠，画出来是一道看不见的窄条，徒增噪音
      if (c.to - c.from < 0.5) continue;
      const cx0 = x(c.from), cx1 = x(c.to);
      const orthodox = c.lane === 0;
      const rect = el('rect', {
        x: cx0, y: c.lane * LANE_H + 2, width: Math.max(2, cx1 - cx0), height: LANE_H - 6,
        fill: 'url(#contest-hatch)', class: 'mark',
      });
      hoverable(rect, () => [
        { value: `${fmtYearAxis(c.from)}–${fmtYearAxis(c.to)}`, label: orthodox ? '正统未定' : '南北并立' },
        { label: '历时', value: `${(c.to - c.from).toFixed(1)} 年` },
        { label: '并立', value: `${c.top.d.name} · ${c.bottom.d.name}` },
        orthodox
          ? '两朝同时自居正朔：上半轨为前朝，下半轨为后朝。后世追认的正统归属要到此段结束才定下来。'
          : '北方主线的新旧交替：上半轨为前朝，下半轨为后朝，两者在此段内并存。',
      ], () => (orthodox ? '正统交替期' : '主线交替期'));
      gBase.appendChild(rect);
    }
  }

  const labelNodes = [];
  const empRefs = [];   // 知识角卡的素材:每段一个 {点击靶, 皇帝, 朝代, 横心}
  const bandRefs = [];  // 同上,朝代级:{朝代, 起讫像素, 底带节点} —— 朝代卡的取材
  const geo = new Map();  // 朝代 → 几何(起讫像素、各分段上下缘),承继细丝的锚点
  for (const b of bands) {
    const y0 = b.lane * LANE_H + 4;
    const cvar = byDynasty ? slotVar(slots.get(b.d.key)) : (b.d.u ? '--c-unified' : '--c-split');
    const col = `var(${cvar})`;
    const bx0 = x(b.s), bx1 = x(b.e);

    // 底带：朝代存续期的浅色轨道。正统交替期按上/下半分段绘制，其余时段占满整轨。
    // 左右各内缩 1px：紧邻的两朝之间因此留出 2px 底色缝，靠留白分隔而非描边
    const st = DYN_STATS.get(b.d.key);
    const trackTip = () => [
      { color: col, value: `${b.d.s <= 0 ? `前${-b.d.s + 1}` : b.d.s}–${b.d.e}`, label: '国祚' },
      { label: '历时', value: `${st.span} 年` },
      { label: '皇帝', value: `${st.n} 位（当前筛选 ${b.n} 位）` },
      { label: 'DSI', value: st.dsi === null ? '—' : `${fmt1(st.dsi)} 年/帝` },
      ...(b.lane === 0 ? ['位于正统序列行；与前后朝并存的那一段以上下半轨表示正统未定。'] : []),
      ...(b.d.note ? [b.d.note] : []),
    ];
    const gparts = [];
    for (const p of spanParts(b, b.s, b.e)) {
      const g = slotGeom(p.slot);
      const px0 = x(p.x0), px1 = x(p.x1);
      gparts.push({ x0: px0, x1: px1, top: y0 + g.y, bot: y0 + g.y + g.h });
      const track = el('rect', {
        x: px0 + 1, y: y0 + g.y, width: Math.max(2, px1 - px0 - 2), height: g.h, rx: 4,
        fill: col, opacity: 0.14, class: 'mark',
      });
      hoverable(track, trackTip, () => b.d.name);
      gBase.appendChild(track);
      bandRefs.push({ band: b, x0: px0, x1: px1, node: track });
    }
    // 细丝的锚点按**分段**记:交替期的带被切成上下半轨,只记整轨中线会让
    // 线端消失在色块中央,进出看不出来(用户实测「二行并一处一眼看不清」)
    geo.set(b.d.key, { b, col, x0: bx0, x1: bx1, parts: gparts.length ? gparts
      : [{ x0: bx0, x1: bx1, top: y0 + TRACK_Y, bot: y0 + TRACK_Y + TRACK_H }] });

    // 称帝前的掌权期：贴在所在轨道底部的半高浅段
    for (const g of b.preRule) {
      for (const p of spanParts(b, g.s, g.x)) {
        const gm = slotGeom(p.slot);
        const px0 = x(p.x0), px1 = x(p.x1);
        const hh = Math.min(7, gm.h - 2);
        const node = el('rect', {
          x: px0 + 1, y: y0 + gm.y + gm.h - hh, width: Math.max(2, px1 - px0 - 2), height: hh, rx: 2,
          fill: col, opacity: 0.5, class: 'mark',
        });
        hoverable(node, () => [
          { color: col, value: `${fmtDate(g.e.accRule, { yearOnly: true })}–${fmtDate(g.e.acc, { yearOnly: true })}`, label: '掌权（未称帝）' },
          { label: '称帝', value: fmtDate(g.e.acc) },
          '此段为该君主实际掌握政权最高权力、但尚未即皇帝位的时期，不计入「在位年数」。',
        ], () => `${b.d.name}·${g.e.temple}`);
        gTop.appendChild(node);
      }
    }

    // 皇帝分段
    for (const g of b.segs) {
      const segTip = () => [
        { color: col, value: `${fmtDate(g.e.acc, { yearOnly: true })}–${g.e.reignEnd ? fmtDate(g.e.reignEnd, { yearOnly: true }) : '？'}`, label: '在位' },
        { label: '在位年数', value: g.e.reignYears === null ? '—' : `${g.e.reignYears.toFixed(1)} 年` },
        { label: '享年', value: g.e.lifespan === null ? '不详' : `${Math.floor(g.e.lifespan)} 岁` },
        { label: '登基年龄', value: g.e.accAge === null ? '不详' : `${Math.floor(g.e.accAge)} 岁` },
        { label: '死因', value: g.e.causeLabel },
        ...(g.e.note ? [g.e.note] : []),
      ];
      const parts = spanParts(b, g.ds, g.dx);
      let widest = null;
      for (const p of parts) {
        const gm = slotGeom(p.slot);
        const segH = (gm.h - (b.subs - 1) * 2) / b.subs;
        const sy = y0 + gm.y + g.sub * (segH + 2);
        const sx0 = x(p.x0), sx1 = x(p.x1);
        const wSeg = Math.max(1.5, sx1 - sx0 - 2);   // −2 ＝ 段间以底色留缝，而不是描边分隔
        gTop.appendChild(el('rect', {
          x: sx0 + 1, y: sy, width: wSeg, height: segH, rx: Math.min(3, segH / 2), fill: col, class: 'mark',
        }));
        const hit = el('rect', { x: sx0, y: sy - 2, width: Math.max(10, sx1 - sx0), height: segH + 4, fill: 'transparent', class: 'mark' });
        hoverable(hit, segTip, () => `${b.d.name}·${g.e.temple}`);
        gTop.appendChild(hit);
        empRefs.push({ node: hit, e: g.e, band: b, cx: (sx0 + sx1) / 2 });
        if (!widest || wSeg > widest.w) widest = { w: wSeg, x: sx0, y: sy, h: segH };
        // 非正常死亡：段末的小三角（状态色 + 图例说明，不单靠颜色表意）
        if (markViolent && g.e.violent === 1 && g.e.reignEnd
            && Math.abs(g.x - g.e.reignEnd.t) < 0.01 && Math.abs(p.x1 - g.dx) < 1e-9) {
          const tipX = sx0 + 1 + wSeg;
          gTop.appendChild(el('path', {
            d: `M${tipX - 3.5},${sy - 1.5}L${tipX + 3.5},${sy - 1.5}L${tipX},${sy + 4}Z`,
            fill: 'var(--critical)',
          }));
        }
      }
      // 段内简称：写在最宽的那一小段上，放不下就留给悬停与数据表
      const nm = shortName(g.e);
      if (widest && widest.h >= 9 && widest.w > textW(nm, SEG_FS) + 8) {
        gTop.appendChild(el('text', {
          x: widest.x + 5, y: widest.y + widest.h / 2 + SEG_FS * 0.36, 'font-size': SEG_FS,
          fill: ink[cvar] === 'dark' ? 'var(--text-1)' : 'var(--surface-1)',
        }, nm));
      }
    }

    // 朝代名（带首；滚动时吸附于视口左缘，但不越出本带）
    const lw = textW(b.d.name, LABEL_FS);
    const dot = el('circle', { cx: bx0 + 4, cy: y0 + 8, r: 3.5, fill: col });
    const label = el('text', { x: bx0 + 12, y: y0 + 12, 'font-size': LABEL_FS, 'font-weight': 600, fill: 'var(--text-1)' }, b.d.name);
    gTop.appendChild(dot); gTop.appendChild(label);
    labelNodes.push({ dot, label, x0: bx0, x1: bx1, lw });
  }

  // ── 承继细丝：点选才现,事件年份处的短接 ────────────────────────────────
  //
  // 泳道的车道分配是装箱算法定的(正统专用首行、北方主线次行、其余回收),
  // 谱系关系跨行连线若常驻,65 条带上百条关系必成面条。两条约束换来一个干净解：
  //   1) **不动任何车道**——线只是覆在图上的临时层,布局分毫不改;
  //   2) **锚在事件年份**——亡入锚在亡年、分出锚在立国年、禅让锚在交接点,
  //      于是每条线都是一段近乎竖直的短接,不横跨长距离,也就不会互相缠绕。
  // 只画选中朝代的一跳邻域(前身/后继/亡入/亡入我者/分出/分自我者),
  // 点空白即散。同车道相邻的承继不画——那正是装箱时「后继优先落在前身那一行」
  // 的结果,相邻本身已经是那句话,再描一条线是重复。
  // 三张表的键值方向并不一致,连线前必须先摆正:
  //   SUCCESSION[后继] = 前身   → 边是 前身 → 后继(rev)
  //   SPRANG_FROM[子]  = 母体   → 边是 母体 → 子  (rev)
  //   MERGED_INTO[亡者] = 吞并者 → 边是 亡者 → 吞并者
  // 照同一方向连会画出跨百年的横线与斜线(实测宋→后周画成 1127→960 的倒行)
  const REL = [
    ['succ', SUCCESSION, '法统相承', true],
    ['merge', MERGED_INTO, '亡入', false],
    ['spring', SPRANG_FROM, '裂自', true],
  ];
  const strandPath = (xa, ya, xb, yb) => {
    const my = (ya + yb) / 2;
    return `M${xa.toFixed(1)},${ya.toFixed(1)}C${xa.toFixed(1)},${my.toFixed(1)} ${xb.toFixed(1)},${my.toFixed(1)} ${xb.toFixed(1)},${yb.toFixed(1)}`;
  };
  const arrow = (xb, yb, dir) => {
    const s = dir >= 0 ? 1 : -1;
    return `M${xb.toFixed(1)},${yb.toFixed(1)}L${(xb - 3.6).toFixed(1)},${(yb - s * 6).toFixed(1)}L${(xb + 3.6).toFixed(1)},${(yb - s * 6).toFixed(1)}Z`;
  };
  let kp = null;                       // 知识角卡的把手,点丝时用来推事件卡
  const HIT_W = 13;                    // 命中带宽度:丝两侧各 ±6.5px 的容差
  const clearStrands = () => { gStrand.innerHTML = ''; };
  /** 该带在某个横坐标处的那一段(交替期分上下半轨);落在带外时取最近的一段 */
  const partAt = (G, px) => G.parts.find((q) => px >= q.x0 - 0.5 && px <= q.x1 + 0.5)
    || G.parts.reduce((best, q) => (Math.min(Math.abs(px - q.x0), Math.abs(px - q.x1))
      < Math.min(Math.abs(px - best.x0), Math.abs(px - best.x1)) ? q : best), G.parts[0]);
  const linksOf = (key) => {
    const out = [];
    for (const [kind, MAP, label, rev] of REL) {
      const tgt = MAP[key];
      if (tgt && geo.has(tgt)) out.push({ kind, label, from: rev ? tgt : key, to: rev ? key : tgt });
      for (const [k2, v2] of Object.entries(MAP)) {
        if (v2 === key && geo.has(k2)) out.push({ kind, label, from: rev ? key : k2, to: rev ? k2 : key });
      }
    }
    return out;
  };
  const allLinks = () => {
    const seen = new Set(), out = [];
    for (const [kind, MAP, label, rev] of REL) {
      for (const [k2, v2] of Object.entries(MAP)) {
        if (!geo.has(k2) || !geo.has(v2)) continue;
        const L = { kind, label, from: rev ? v2 : k2, to: rev ? k2 : v2 };
        const sig = `${kind}|${L.from}|${L.to}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push(L);
      }
    }
    return out;
  };
  const nameOfKey = (k) => (geo.get(k) ? geo.get(k).b.d.name : k);
  const drawStrands = (key, dim = false) => {
    clearStrands();
    const links = key === null ? allLinks() : (geo.has(key) ? linksOf(key) : []);
    for (const L of links) {
      const A = geo.get(L.from), B = geo.get(L.to);
      // 事件年份:承统与亡入锚在前者的终点,分出锚在后者的起点
      const evX = L.kind === 'spring' ? B.x0 : A.x1;
      let xa = Math.min(Math.max(evX, A.x0), A.x1);
      let xb = Math.min(Math.max(evX, B.x0), B.x1);
      const pa = partAt(A, xa), pb = partAt(B, xb);
      const ca = (pa.top + pa.bot) / 2, cb = (pb.top + pb.bot) / 2;
      let ya, yb;
      const trans0 = TRANSITIONS[`${L.from}>${L.to}`];
      if (Math.abs(ca - cb) < 1) {
        if (Math.abs(xa - xb) < 4) {
          // 同轨紧邻:承继关系由「相邻」本身说明,不必再描一条线。但若这场交替
          // 有名有姓(陈桥兵变、靖康之变),就在交界处刻一道可点的短竖痕——
          // 与非正常死亡的红刻痕同一语法:刻痕标事件,不占版面也不牵线
          if (!trans0) continue;
          const mid = (xa + xb) / 2;
          gStrand.appendChild(el('line', { x1: mid, x2: mid, y1: pa.top - 2, y2: pa.bot + 2,
            stroke: 'var(--page)', 'stroke-width': 4.5, opacity: .8 }));
          const tick = el('line', { x1: mid, x2: mid, y1: pa.top - 2, y2: pa.bot + 2,
            stroke: B.col, 'stroke-width': 2.2, opacity: dim ? .7 : .95, class: 'mark',
            'data-rel': `${nameOfKey(L.from)}→${nameOfKey(L.to)}·${L.label}`,
          });
          gStrand.appendChild(tick);
          // 命中带:与刻痕同形而透明加宽,专吃点击与悬停。刻痕只有 2.2px,
          // 视觉上够醒目、指头却按不准(用户实测「箭头有点难点」)
          const tHit = el('line', { x1: mid, x2: mid, y1: pa.top - 7, y2: pa.bot + 7,
            stroke: 'transparent', 'stroke-width': HIT_W, 'pointer-events': 'stroke', class: 'kp-hit' });
          tHit.dataset.ev = `${L.from}>${L.to}`;
          hoverable(tHit, () => [
            { color: B.col, value: `${nameOfKey(L.from)} → ${nameOfKey(L.to)}`, label: L.label },
            { label: '史称', value: trans0.n },
            { label: '时点', value: fmtYearAxis(t0 + (mid - PAD_L) / (W - 2 * PAD_L) * (t1 - t0)) },
            '同一泳道内首尾相接即为法统相承；此刻痕标出这场交替的名目，点它可读词条。',
          ], () => trans0.n);
          gStrand.appendChild(tHit);
          continue;
        }
        ya = yb = ca;                             // 同轨隔着空窗:走中线的水平短接
        xa = A.x1; xb = B.x0;
      } else {
        // **边到边**:自源带背向目标的那一侧穿出、落在目标带朝向源的那一缘。
        // 于是线在色块边界上现身与消失,半轨交替处也一眼看得出进出
        const down = cb > ca;
        ya = down ? pa.bot : pa.top;
        yb = down ? pb.top : pb.bot;
      }
      const col = L.kind === 'merge' ? A.col : B.col;
      const d = strandPath(xa, ya, xb, yb);
      // 全显模式把丝压细压淡:百来条同时在场,单看每条不重要,重要的是疏密的分布
      gStrand.appendChild(el('path', {
        d, fill: 'none', stroke: 'var(--page)', 'stroke-width': dim ? 3.4 : 5,
        'stroke-linecap': 'round', opacity: dim ? .7 : .85,
      }));
      const line = el('path', {
        d, fill: 'none', stroke: col,
        'stroke-width': (L.kind === 'succ' ? 2.4 : 1.8) * (dim ? 0.72 : 1),
        'stroke-linecap': 'round', 'stroke-dasharray': L.kind === 'spring' ? '5 3' : null,
        opacity: dim ? .6 : .95, class: 'mark', 'data-rel': `${nameOfKey(L.from)}→${nameOfKey(L.to)}·${L.label}`,
      });
      gStrand.appendChild(line);
      const tr = TRANSITIONS[`${L.from}>${L.to}`];
      // 同上:透明加宽的命中带覆在丝上,±6px 的容差换来可点性;
      // 它仍在细丝层内,故君主色块照旧压在其上,不会抢走色块自身的点选
      const hit = el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': HIT_W,
        'stroke-linecap': 'round', 'pointer-events': 'stroke', class: 'kp-hit' });
      if (tr) hit.dataset.ev = `${L.from}>${L.to}`;
      hoverable(hit, () => [
        { color: col, value: `${nameOfKey(L.from)} → ${nameOfKey(L.to)}`, label: L.label },
        ...(tr ? [{ label: '史称', value: tr.n }] : []),
        { label: '时点', value: fmtYearAxis(t0 + (evX - PAD_L) / (W - 2 * PAD_L) * (t1 - t0)) },
        L.kind === 'succ' ? '禅让或称帝改元式的法统相承：前朝的正朔由后朝接过。'
          : L.kind === 'merge' ? '武力吞并或纳土归降：疆土与朝廷并入对方。'
            : '裂土自立：从母体的疆土上分出。',
        ...(tr ? ['点这条丝可在右侧卡片读这场改朝换代的词条。'] : []),
      ], () => (tr ? tr.n : L.label));
      gStrand.appendChild(hit);
      if (Math.abs(yb - ya) > 1) {
        gStrand.appendChild(el('path', { d: arrow(xb, yb, yb - ya), fill: col, opacity: dim ? .6 : .95 }));
      }
    }
  };
  // 委派一个监听:点朝代底带或皇帝分段都按其朝代显丝,点空白即散
  const ownerOf = new Map();
  for (const r of bandRefs) ownerOf.set(r.node, r.band.d.key);
  for (const r of empRefs) ownerOf.set(r.node, r.band.d.key);
  const allOn = opts.laneStrands === true;
  body.addEventListener('click', (ev) => {
    // 点丝:朝代卡改讲那一场改朝换代;丝本身不改选中态,免得一点就散
    const evKey = ev.target && ev.target.dataset && ev.target.dataset.ev;
    if (evKey && kp && kp.showEvent) {
      const tr = TRANSITIONS[evKey];
      const [f, t] = evKey.split('>');
      const nm = (k) => (geo.get(k) ? geo.get(k).b.d.name : k);
      if (tr && kp.showEvent(eventSpec(tr, nm(f), nm(t)))) return;
    }
    const key = ownerOf.get(ev.target);
    // 全显模式下点某朝即「聚焦」——只留它的一跳邻域;点空白回到全显
    if (key) drawStrands(key);
    else if (allOn) drawStrands(null, true);
    else clearStrands();
  });
  if (allOn) drawStrands(null, true);

  // ── 组装：表头与主体同处一个滚动容器，横向同步、纵向吸顶 ────────────────
  head.addEventListener('click', (ev2) => {
    const i = ev2.target && ev2.target.dataset && ev2.target.dataset.evi;
    if (i === undefined || !kp || !kp.showEvent) return;
    const e3 = EVENTS[+i];
    kp.showEvent({ id: `evt:${e3.w}`, head: `${e3.y2 ? `${fmtYearAxis(e3.y)}–${fmtYearAxis(e3.y2)}` : fmtYearAxis(e3.y)} · ${(EVENT_KINDS[e3.k] || {}).label || '大事'}`,
      title: e3.w, baidu: e3.b || e3.n, q: `${e3.n} 历史`, yt: true, display: e3.n });
  });

  const headWrap = h('div', { class: 'tl-head-wrap' }, [head]);
  const inner = h('div', { class: 'tl-inner' }, [headWrap, body]);
  const scroller = h('div', { class: 'lane-scroll' }, [inner]);
  // 泳道数在 10 以内时不设高度上限并关掉纵向滚动：横向滚动条本身要占十几像素，
  // 若照旧设 max-height，就会为了这十几像素逼出一条纵向滚动条，纯属噪音。
  if (nLanes <= 10) scroller.style.overflowY = 'hidden';
  else scroller.style.maxHeight = `${10 * LANE_H + HEAD_H + 24}px`;
  host.appendChild(scroller);
  scrollHint(scroller, '左右滑动即为时间流逝');

  // 说明段右侧的空当放知识卡:中间朝代、右侧皇帝,横滚自动跟随、点选钉卡。
  // 挂在 __riverCleanup 上——app 的全景包装器在每次重绘前统一调用,
  // 切去河流视图或改筛选重绘时,角卡与滚动监听一并撤走
  kp = mountKnowledgeCorner(empRefs, bandRefs, scroller, host.closest('section.card'));
  host.__riverCleanup = kp;

  // 图例：只列出当前视口内可见的朝代。色值本身固定不变，
  // 变的只是「这一屏有哪些朝代」——这是图例该做的事，不是重新配色。
  const legendHost = h('div');
  host.appendChild(legendHost);
  const staticLegend = h('div');
  host.appendChild(staticLegend);
  // 读图必需的视觉语法留在图旁，一行说完；来龙去脉收进折叠块
  const key = [];
  if (useTop) key.push('淡底首行＝正统序列');
  if (useSecond) key.push('次行＝北方政权主线');
  if (contests.length) key.push('斜纹＝新旧并立（上半轨前朝、下半轨后朝）');
  key.push('浅色半高段＝称帝前掌权期');
  if (markViolent) key.push('▲＝该帝非正常死亡');
  key.push('点选朝代或皇帝可显丝：粗实线＝法统相承 · 细实线＝亡入 · 虚线＝裂自');
  staticLegend.appendChild(h('p', { class: 'muted small', style: 'margin:8px 0 0', text: key.join(' · ') }));

  let raf = null;
  const sync = () => {
    raf = null;
    const left = scroller.scrollLeft, right = left + scroller.clientWidth;
    // 标签吸附规则：仅当该区间「跨过视口左缘」时才贴边，否则留在自己的起点。
    // 这样同屏的两个时代（如唐末与五代十国重叠的那几年）不会双双挤到左缘互相压字。
    const stickX = (x0, x1, lw, pad) => {
      const natural = x0 + pad;
      const rightLimit = Math.max(natural, x1 - lw - pad);
      return (x0 <= left && left < x1) ? Math.min(left + pad, rightLimit) : natural;
    };
    for (const n of eraLabels) {
      const vis = n.x1 > left && n.x0 < right;
      n.node.setAttribute('opacity', vis ? 1 : 0);
      if (vis) n.node.setAttribute('x', stickX(n.x0, n.x1, n.lw, 8));
    }
    for (const n of labelNodes) {
      const vis = n.x1 > left && n.x0 < right;
      n.dot.setAttribute('opacity', vis ? 1 : 0);
      n.label.setAttribute('opacity', vis ? 1 : 0);
      if (!vis) continue;
      const c = stickX(n.x0, n.x1, n.lw + 12, 6);
      n.dot.setAttribute('cx', c + 4);
      n.label.setAttribute('x', c + 12);
    }
    const y0 = x.invert(left), y1 = x.invert(right);
    const vis = bands.filter((b) => b.e > y0 && b.s < y1).sort((a, b) => a.lane - b.lane);
    legendHost.innerHTML = '';
    // 「视口内可见」≠「同时并存」：视口横跨一段年份，其中的政权可能前后相继。
    // 真正的并存数是任一竖直切面上被占用的泳道数。
    let peak = 0;
    for (let t = y0; t <= y1; t += 1) {
      let c = 0;
      for (const b of vis) if (b.s <= t && t <= b.e) c++;
      if (c > peak) peak = c;
    }
    legendHost.appendChild(h('div', { class: 'muted small', style: 'margin-top:8px',
      text: `视口 ${fmtYearAxis(y0)} – ${fmtYearAxis(y1)} 年：可见 ${vis.length} 个政权，最多同时并存 ${peak} 个。` }));
    if (byDynasty) {
      legendHost.appendChild(legend(vis.map((b) => ({ color: `var(${slotVar(slots.get(b.d.key))})`, label: b.d.name }))));
    } else {
      // 此模式下只有两种颜色，逐一政权列色块纯属重复；改为两项图例 + 政权名单
      const has = (u) => vis.some((b) => b.d.u === u);
      legendHost.appendChild(legend([
        ...(has(1) ? [{ color: 'var(--c-unified)', label: '大一统王朝' }] : []),
        ...(has(0) ? [{ color: 'var(--c-split)', label: '分裂时期政权' }] : []),
      ]));
      legendHost.appendChild(h('div', { class: 'muted small', text: vis.map((b) => b.d.name).join('、') }));
    }
  };
  scroller.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(sync); });
  requestAnimationFrame(sync);

  const greyN = [...slots.values()].filter((v) => v < 0).length;
  const stacked = bands.filter((b) => b.subs > 1);
  host.appendChild(notes([
    useTop && `第一行为正统序列专用（${orth.length} 朝），不参与泳道回收，任何割据政权都不会挤进来，`
      + `于是它自成一条贯通两千年的主线；其余政权一律平等地排在下方，不含褒贬。`
      + `斜纹段为正统交替期——陈与隋并立八年、南宋与元并立七十三年、明与清并立二十八年，`
      + `正统归属要到那一段结束才由后世定下来。采用《资治通鉴》以降的传统正统观`
      + `（三国承曹魏、南北朝承南朝、五代承中原五朝），这是史观选择而非史实：`
      + `北魏、辽、金、西夏在各自时代同样自居正统。`,
    useSecond && `第二行优先安排「北方政权主线」：386–581 年的北魏→西魏→北周，与 916–1234 年的辽→金。`
      + `中国史上这两段都是南北法统长期并行，而正统行都取南方为正朔，北方政权便会被挤到下方各行，`
      + `对峙关系反倒读不出来。两次都以「并入第一行」收束——581 年北周禅隋、元既已入正统行——`
      + `恰好呈现北方政权最终统合天下的节奏。线内交替（辽金并立十年）沿用与正统行相同的上下半轨画法。`
      + `该行并不独占：两段线合计约 500 年，其余时段照常参与回收。`
      + `西夏与辽、金三方并立，不入此线，平等排在下方。`,
    `共 ${bands.length} 个政权装入 ${nLanes} 条泳道。泳道不归属任何朝代：某朝终结后该行即被后来的政权接管，`
      + `因此同一时刻占用的行数就是当时并存的政权数（最挤的 937 年有十一个政权）。`,
    `同朝代内前帝崩与后帝即位常落在同一个月，史料精确到月即产生名义上的重叠——这类不足半年的重叠一律`
      + `就地挤压（交界取中点、两段各退一半），仍并排在同一行；只有真正并立称帝者才分层错开，`
      + `当前有 ${stacked.length} 例${stacked.length ? `（${stacked.map((b) => b.d.name).join('、')}）` : ''}。`
      + `分段的绘图宽度因此可能比真实在位期短几个月，悬停与数据表给出的始终是真实日期。`,
    byDynasty
      ? `配色按具体朝代，时间上重叠者必为异色，不重叠者复用槽位（唐与明同色不会造成混淆）；`
        + `并存政权最多达 11 个而分类色板仅 8 槽，故有 ${greyN} 个边缘割据政权折入中性灰——`
        + `每条带都直接标注朝代名，颜色只是辅助。`
      : '配色沿用全局语义：蓝＝大一统，橙＝分裂。',
  ], { label: '排布规则与史观说明' }));

  host.appendChild(tableView(
    ['泳道', '朝代', '起讫', '历时(年)', '皇帝数', 'DSI', '大一统'],
    bands.slice().sort((a, b) => a.s - b.s).map((b) => {
      const st = DYN_STATS.get(b.d.key);
      return [b.lane + 1, b.d.name, `${fmtYearAxis(b.d.s)}–${fmtYearAxis(b.d.e)}`, st.span, b.n,
        st.dsi === null ? null : st.dsi.toFixed(1), b.d.u ? '是' : '否'];
    }),
    { caption: '泳道分配与朝代一览' },
  ));
}
