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
import { el, h, linear, ticks, hoverable, legend, tableView, notes, showTip, hideTip, fmtYearAxis, fmt1, scrollHint, glide } from './charts.js';
import { mountKnowledgeCorner, eventSpec, evSpec } from './knowledge.js';
import { stampHash } from './search.js';
import { DYNASTIES, DYN_STATS } from './data.js';
import { ERAS, SUCCESSION, MERGED_INTO, SPRANG_FROM, TRANSITIONS, ORTHODOX, SECONDARY } from './dynasties.js';
import { EVENTS, EVENT_KINDS, LEFT_BANK, evAnchor } from './events.js';
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
        segs.push({ e, s: s.t, x: Math.max(en.t, s.t + 0.08),
          p0: s.precision === 'year', p1: en.precision === 'year' });
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
    // 年精度缝合：先秦纪年只到年，且循踰年改元——旧君卒于末年、新君**翌年**
    // 才是元年，图上每处交接便凭空空出一年（14px/年 时肉眼可见，用户实测）。
    // 王位其实没有空过，空的是记账口径。两侧边界都只精确到年、缝隙不超过
    // 1.6 年时贴合绘制；真空档（共和 14 年、太康失国、夏商丧期 ≥2 年）与
    // 月日精度的帝制时代一概不碰——月日数据撑得起真缝，年数据撑不起。
    for (let i = 0; i + 1 < segs.length; i++) {
      const a = segs[i], c = segs[i + 1];
      const gap = c.s - a.x;
      if (a.p1 && c.p0 && gap > 0 && gap <= 1.6) c.s = a.x;
    }
    for (const g of segs) { g.ds = g.s; g.dx = g.x; }   // ds/dx＝绘图坐标，s/x 始终保留真实日期
    const s = Math.min(...segs.map((g) => g.s), ...preRule.map((g) => g.s));
    const e2 = Math.max(...segs.map((g) => g.x));
    bands.push({ d, s, e: e2, segs, preRule, n: emps.length });
  }
  bands.sort((a, b) => a.s - b.s || a.e - b.e);
  return bands;
}

/**
 * 事件标记的**形状**。十类各一色本已到色板的极限（红与橙、深绿与青绿、粉与玫
 * 两两难分），而竖河把事件搬进河道之后更糟：河道**本身**就是用同一套色板着色的，
 * 蓝点落在蓝河上就等于没画（用户实测:「这个蓝色圆球是被 clip 了吗」——
 * 没有被裁，是与河同色）。故加一条正交通道:形状。
 *
 * 颜色仍在（远看的分组感靠它），但认类不再只靠颜色——这正是配色规范里
 * 「颜色不承担唯一识别职责」那条。形状按语义取:战事尖头向上、灾疫尖头向下、
 * 民变是十字、外交是菱形、制度是方块、著述是圆点、遗址是屋形、文物是六边。
 * 起讫类（存续期／遗址／文物）另有共同点:都不是尖的，与时点类一眼分得开。
 *
 * 描边取页色:标记压在饱和的君主色块上，一圈页色的细边就是图与地的分界，
 * 与朝代名、事件名的描边衬底同一手法。
 */
const EV_SHAPE = {
  war: 'up', dis: 'down', rev: 'plus', out: 'diamond', gov: 'square',
  cul: 'circle', inst: 'bar', era: 'bar', her: 'house', art: 'hex',
  // 名人轶事用星:九种形状里星是唯一没被占的,而它恰好也是「名人」的现成隐喻。
  // 色相到这一类已经排到第十一个,颜色本身分辨力所剩无几,形状是这一类的主通道
  fig: 'star',
};
export function evMark(kind, cx, cy, r, extra = {}) {
  const a = { fill: `var(--ev-${kind})`, ...extra };
  const P = (list) => ({ points: list.map(([x, y]) => `${(cx + x * r).toFixed(2)},${(cy + y * r).toFixed(2)}`).join(' '), ...a });
  switch (EV_SHAPE[kind] || 'circle') {
    case 'up':      return el('polygon', P([[0, -1.2], [1.05, 0.76], [-1.05, 0.76]]));
    case 'down':    return el('polygon', P([[0, 1.2], [1.05, -0.76], [-1.05, -0.76]]));
    case 'diamond': return el('polygon', P([[0, -1.3], [1.3, 0], [0, 1.3], [-1.3, 0]]));
    case 'hex':     return el('polygon', P([[0, -1.2], [1.04, -0.6], [1.04, 0.6], [0, 1.2], [-1.04, 0.6], [-1.04, -0.6]]));
    case 'house':   return el('polygon', P([[0, -1.3], [1.05, -0.3], [1.05, 1], [-1.05, 1], [-1.05, -0.3]]));
    case 'plus':    return el('polygon', P([[-0.42, -1.2], [0.42, -1.2], [0.42, -0.42], [1.2, -0.42], [1.2, 0.42],
      [0.42, 0.42], [0.42, 1.2], [-0.42, 1.2], [-0.42, 0.42], [-1.2, 0.42], [-1.2, -0.42], [-0.42, -0.42]]));
    // 五角星:外顶点 1.35r、内顶点 0.55r。外径放大是因为星形的**视觉面积**
    // 比同外接圆的三角、方块小得多,取同一个 r 画出来会显著偏小
    case 'star':    return el('polygon', P(Array.from({ length: 10 }, (_, i) => {
      const t = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? 0.55 : 1.35;
      return [Math.cos(t) * rr, Math.sin(t) * rr];
    })));
    case 'square':  return el('rect', { x: cx - r * 0.92, y: cy - r * 0.92, width: r * 1.84, height: r * 1.84, rx: r * 0.24, ...a });
    case 'bar':     return el('rect', { x: cx - r * 1.2, y: cy - r * 0.7, width: r * 2.4, height: r * 1.4, rx: r * 0.32, ...a });
    default:        return el('circle', { cx, cy, r, ...a });
  }
}

/**
 * 事件类别图例＝筛选钮。颜色没有图例就等于没编码;而关掉一类会降灰划线,
 * 一眼看得出是「我关掉了」而非「本来就没有」。分类本身也是一种读法:
 * 只留战事看的是王朝的武运,只留制度看的是治理术的演进。
 *
 * 两个视图共用一份:河流此前只在宽屏有两岸事件轨、且图例只画在泳道图下,
 * 于是手机上既筛不了类,也不知道那些彩点各是什么——而事件层恰恰是手机上
 * 最主要的一层。返回两个节点(小标题与色标行),由调用方决定挂在哪儿。
 *
 * `skip` 去掉本视图根本不画的类:治世·中兴在泳道里是皇帝格子外的虚线外套,
 * 河流没有这一层,那个色标点了也不会有任何变化——按不动的开关比没有开关更糟。
 */
export function eventLegend(opts, { skip = [] } = {}) {
  const off = new Set(opts.evOff || []);
  const row = h('div', { class: 'ev-legend' });
  const counts = {};
  for (const ev of EVENTS) counts[ev.k] = (counts[ev.k] || 0) + 1;
  for (const [k, meta] of Object.entries(EVENT_KINDS)) {
    if (!counts[k] || skip.includes(k)) continue;
    const chip = h('button', {
      type: 'button', class: 'chip ev-chip' + (off.has(k) ? ' off' : ''),
      'aria-pressed': String(!off.has(k)),
      title: off.has(k) ? '点按显示这一类' : '点按隐藏这一类',
      onclick: () => {
        const next = new Set(off);
        if (next.has(k)) next.delete(k); else next.add(k);
        opts.setOpt('evOff', [...next]);
      },
    });
    // 图例画的就是图上那个形状:色标只说得出颜色,而颜色已不是唯一的识别通道
    const glyph = el('svg', { width: 14, height: 14, viewBox: '0 0 14 14', class: 'ev-glyph' });
    glyph.appendChild(evMark(k, 7, 7, 5));
    chip.appendChild(glyph);
    chip.appendChild(h('span', { text: `${meta.label} ${counts[k]}` }));
    row.appendChild(chip);
  }
  return [h('p', { class: 'muted small', style: 'margin:10px 0 2px', text: '大事记（点色标可按类筛选）' }), row];
}

// ── 主渲染 ───────────────────────────────────────────────────────────────
export function renderLaneTimeline(host, list, opts) {
  // 重绘前先记下读者正看着哪一年（闭包由上一轮渲染在文件尾留下）——滑杆、
  // 配色、视图切换都走整段重绘，不记的话每次都被扔回图的最左端，
  // 而先秦扩张后那里是夏初的荒原
  if (host.__yearOfScroll) host.__anchorYear = host.__yearOfScroll();
  for (const n of document.querySelectorAll('.lane-peek')) n.remove();   // 上一轮的预览小窗
  if (host.__peekCleanup) { host.__peekCleanup(); host.__peekCleanup = null; }
  host.innerHTML = '';
  let pxYear = opts.lanePx || 10;
  const byDynasty = opts.laneColor !== 'unified';
  const markViolent = opts.laneViolent !== false;
  const slots = dynastyColorSlots();
  const ink = resolveInk(host);

  const showEvents = opts.laneEvents !== false;
  // 事件名分居分隔线上下两侧,各留五字之高。此前全挤在线下:实测 547 条里
  // 72 条(13%)根本排不下名字,另有 144 条被挤得偏离本位——近三成的名字
  // 站错了地方。分成上下两条独立的争位赛道,两头都松快。
  const EV_UP = showEvents ? 66 : 0;    // 线上:文教
  const EV_DN = showEvents ? 81 : 0;    // 线下:政事 + 年份
  const LANE_H = 48, LABEL_H = 15, TRACK_Y = 18, TRACK_H = 24;
  const HEAD_H = 24 + EV_UP + EV_DN + (showEvents ? 6 : 25);
  const LABEL_FS = 12.5, SEG_FS = 10;

  // 1) 组装朝代带
  const bands = buildBands(list);
  if (!bands.length) { host.appendChild(h('p', { class: 'muted', text: '当前筛选无数据。' })); return; }
  // 轴跨钳制：泳道画到夏初时 30px/年 × 约四千年 ≈ 12万px，逼近部分渲染引擎
  // 2^17=131072px 的图层上限（表头 SVG 同宽、绘制面积翻倍）。滑杆照旧，
  // 生效值按实际跨度封顶——宁可最松档少几像素，不可整幅泳道画不出来。
  {
    const span = Math.max(...bands.map((b) => b.e)) - Math.min(...bands.map((b) => b.s)) + 20;
    pxYear = Math.min(pxYear, Math.max(6, Math.floor(110000 / span)));
  }

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
    // 微型政权（画宽装不下自己的名字，如桓楚二年）在紧缩放下不为标签占位：
    // 名字改由色点＋悬停承载，占位缩到点宽——否则一年的政权要为 45px 的
    // 字幅独占一整行（用户实测：后凉—桓楚—胡夏本可共檐，桓楚被标签挤走）
    const lw = textW(b.d.name, LABEL_FS) + 14;
    b.micro = (b.e - b.s) * pxYear < lw;
    return { a, z: Math.max(b.e * pxYear, a + (b.micro ? 18 : lw)) };
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
  const AXIS_Y = showEvents ? 24 + EV_UP : 49;
  // **年份挪到表头最下缘**,紧贴泳道。年份是拿来读泳道的,原先却排在表头顶上,
  // 中间隔着整条事件轨——要对照哪一年是哪一朝,眼睛得跨过五十像素的名字。
  const TICK_Y = showEvents ? HEAD_H - 4 : 42;
  for (const t of yTicks) {
    // 年份上方原有一小截竖线。年份还在表头顶上时它有用——指明这个数对着哪条竖线;
    // 如今年份已贴着泳道,而泳道里本就有一条**通高的**网格线站在同一个 x 上
    //(见下方 body 的 class: 'grid'),这一小截不过是那条线被表头截断的残段。
    // 无事件轨时年份仍在上方,那时才需要它。
    if (!showEvents) {
      head.appendChild(el('line', { x1: x(t), x2: x(t), y1: 24, y2: 30, class: 'axis-line' }));
    }
    head.appendChild(el('text', { x: x(t), y: TICK_Y, class: 'tick', 'text-anchor': 'middle' }, fmtYearAxis(t)));
  }
  // 分隔线:有事件轨时下移,把标记行让到线**上**——标记与竖排名字之间隔着一条线,
  // 眼睛便不必在同一片留白里分辨「哪个球配哪串字」(标记压在名字头上时挤得难读)
  head.appendChild(el('line', { x1: 0, x2: W, y1: AXIS_Y, y2: AXIS_Y, class: 'axis-line' }));

  // ── 事件轨：大事记 ──────────────────────────────────────────────────────
  // 时间轴此前只画「谁在统治」,事件层补上「那两千年里发生了什么」——
  // 教育类时间轴的主体内容正是这一层。标记按类别取形与色(EVENT_KINDS),
  // 跨年事件(安史之乱 755–763)画成一段横条,点标记即在知识卡里读词条。
  // 放在表头内而非泳道里:它随表头吸顶,滚到哪一段都看得见,且不占泳道行数。
  if (showEvents) {
    // 标记**钉在分隔线上**:名字分居上下两侧,标记居中才不偏袒哪一边
    const evTop = AXIS_Y;
    // 留空要按**字身**算,不能按基线算:基线以上还有约九像素的字身,
    // 而标记如今骑在线上、半径最大 4.3px。先前按基线留 12px,实测 434 处
    // 名字压到了标记上(纵向压进一到两像素,用户一眼看出来)。
    const LAB_DN = AXIS_Y + 19;              // 线下名字的起笔(政事)
    const LAB_UP_BOT = AXIS_Y - 15;          // 线上名字的**末字**基线(文教,自下往上排)
    const LAB_FS = 10.5, LAB_DY = 11.4;      // 字比初版大一号:9px 竖排在密集处认不出
    const COL_MAX = 5, MAX_COLS = 2;         // 一列五字,超出折第二列(最多两列十字)
    const slots = { up: [], dn: [] };   // 上下各争各的位子,互不相扰
    const evOff = new Set(opts.evOff || []);
    // **分量决定先后**:此前是按年份顺序抢位子,于是一条无名小事只要年份靠前,
    // 就能把「安史之乱」的名字挤掉——图上留下的是编排的偶然,不是历史的轻重。
    // 现在一等先挑位子,二等次之,三等垫底(r 见 js/events.js:按维基三项指标定)。
    // 画的次序反过来:三等先落笔,一等最后压顶,免得小点盖住大点。
    const rk = (ev) => ev.r || 2;
    // **同年错开**。此前同一年的几条事件坐标完全相同,命中区整块重叠,
    // 于是每年只有最后画上去的那条点得开——用户点「开凿大运河」,
    // 弹出来的是同年的「赵州桥建成」。实测 129 条事件挤在 59 个年份上
    // (1900 年有四条),即四分之一的事件层点不开,且看见的名字与点开的常非一物。
    // 按年分组横向摊开,标准档 7px 合半年,肉眼几乎看不出,但各自可点、也各自可留名。
    const sameYear = new Map();
    for (const e2 of EVENTS) {
      if (evOff.has(e2.k) || e2.k === 'era') continue;
      if (!sameYear.has(e2.y)) sameYear.set(e2.y, []);
      sameYear.get(e2.y).push(e2);
    }
    // 组内按 o(年内次序)排:此前是合并脚本按**名字**排的,于是 1449 年
    // 「北京保卫战」排到了「土木堡之变」左边——八月的事跑到十月的事后头。
    // 无月序可考的留 o 空缺,彼此相对位置不表意。
    for (const g of sameYear.values()) g.sort((a2, b2) => (a2.o || 99) - (b2.o || 99));
    const fanOf = (e2) => {
      const g = sameYear.get(e2.y);
      return g && g.length > 1 ? (g.indexOf(e2) - (g.length - 1) / 2) * 7 : 0;
    };
    const gEvLead = el('g', { class: 'ev-lead' });
    head.appendChild(gEvLead);
    const gEv = [3, 2, 1].map((r) => { const g = el('g', { class: `ev-tier ev-r${r}` }); head.appendChild(g); return [r, g]; });
    const layer = Object.fromEntries(gEv);
    // **不按分量卡死留名**。分量只决定**抢位子的先后**,不决定谁有资格留名:
    // 空位还剩着却不写名字,是白白浪费。1457–1490 那一段原先一个名字都没有
    //(夺门之变、曹石之变、荆襄流民起义…全是三等,被门槛一刀切掉),
    // 而那里明明空着一大片(用户实测)。
    // 密不密由碰撞检测管,它本来就保证不重叠;门槛只在**没人争**的地方伤人。
    const R = { 1: 4.3, 2: 3.2, 3: 2.4 };
    for (const ev of [...EVENTS].sort((a, b) => rk(a) - rk(b))) {
      // era 已改画成皇帝格子的外套,不占事件轨
      // 不再按 TRANSITIONS 滤:凡**收进 events.js 的**就是我们判定该画的。
      // 那条规则本是为「别把改朝换代画两遍」,但它连淝水之战、隋灭陈之战、
      // 陈桥兵变、靖康之变都一并挡掉了——正是先前特意补回来的那十一条,
      // 补进数据却仍被这里拦在轨外,等于白补。承继细丝的刻痕在河身、
      // 事件点在表头,两处register不同,并存不算重复。
      if (evOff.has(ev.k) || ev.k === 'era') continue;
      const ex = x(evAnchor(ev)) + fanOf(ev);
      if (ex < PAD_L - 40 || ex > W - PAD_L + 40) continue;
      const kind = EVENT_KINDS[ev.k] || EVENT_KINDS.gov;
      const isSpan = !!kind.span;
      // **百年以上的制度只标起点**:租庸调行用一百五十余年、遣唐使往还二百六十年,
      // 画成长条必然与邻近的条与点互撞(用户实测),而一根横贯的长杠也说不清
      // 「这一百五十年里发生了什么」。跨度交给悬停与卡片去讲——
      // 图上不硬画我们本就画不好的东西。起点用方块、时点用圆点,以示区别
      const g = layer[rk(ev)];
      const rad = R[rk(ev)];
      // 标记也挂 data-evi：导览打光照「墨」，标记与标签的字都是墨
      const dot = evMark(ev.k, ex, evTop, rad, { class: 'mark ev-dot', 'data-evi': String(EVENTS.indexOf(ev)) });
      dot.dataset.evN = ev.n;
      g.appendChild(dot);
      // 名字竖写:汉字本来的排法,横向只占一个字宽,于是几乎不再互相挤——
      // 横排时六个字要六十余像素,密集处只能靠悬停读名
      // 一列放不下就折第二列,而不是截成省略号——名字读全了才有用。
      // 两列居中对齐锚点,于是标签仍以事件年份为中心
      // **雅名**:凡有现成典故可指这件事的,图上写典故(破釜沉舟、四面楚歌),
      // 本名与出处留在悬停与卡片里。史书式的平实叙述(「董贤拜大司马」)认不出、
      // 也记不住;而典故本就是汉语替这些事留下的名字,读者早就认得。
      // 折行处按**词**断,不按字数中分。「赤眉·绿林起义」原先按 7÷2 断成
      // 「赤眉·绿」「林起义」——把「绿林」劈成两半;名字里的「·」本就是天然的
      // 断处,依它断即得「赤眉」「绿林起义」(用户指出)。
      const raw = ev.ya || ev.n;
      const sep = Math.max(raw.indexOf('·'), raw.indexOf('、'));
      let segs = null;
      if (sep > 0 && sep < raw.length - 1
          && sep <= COL_MAX && raw.length - sep - 1 <= COL_MAX) {
        segs = [[...raw.slice(0, sep)], [...raw.slice(sep + 1)]];
      }
      const nmAll = [...raw];
      const nm = nmAll.length > COL_MAX * MAX_COLS
        ? nmAll.slice(0, COL_MAX * MAX_COLS - 1).concat('…') : nmAll;
      const cols = segs ? 2 : Math.min(MAX_COLS, Math.ceil(nm.length / COL_MAX));
      const colW = LAB_FS + 2;
      const halfW = (cols * colW) / 2;
      // **挤不下就往旁边挪,而不是不写**。此前一撞就整条不留名——可两侧往往
      // 就有空位,而每个标记自带年份,挪开一两年读者照样对得上。
      // 依次试 0、±4、±8… 直到两年的宽度为止;真挪开了就补一根细引线回到圆点。
      // **上下分家,与竖河的左右岸同一套分法**:政事(战、乱、灾、交、制)在线下,
      // 紧挨着年份与泳道;文教(著述、科技、遗址、文物)在线上。两侧各争各的位子,
      // 于是同一段年份能容下的名字翻了一倍。两个视图从此共用一套语法。
      const up = !LEFT_BANK.has(ev.k);
      const lane = up ? slots.up : slots.dn;
      const maxShift = Math.max(10, pxYear * 2);
      let cx0 = null;
      {
        for (let d = 0; d <= maxShift && cx0 === null; d += 4) {
          for (const cand of (d === 0 ? [ex] : [ex + d, ex - d])) {
            if (!lane.some(([sx, sw]) => Math.abs(sx - cand) < sw + halfW)) { cx0 = cand; break; }
          }
        }
      }
      if (cx0 !== null) {
        // 线上的名字自下往上排(末字贴着线),线下的自上往下——两侧都从线起笔,
        // 名字长短不一时也不会离自己的标记忽远忽近
        const nRows = Math.ceil(nm.length / cols);
        const y0 = up ? LAB_UP_BOT - (nRows - 1) * LAB_DY : LAB_DN;
        if (Math.abs(cx0 - ex) > 1) {
          gEvLead.appendChild(el('line', {
            x1: ex, y1: evTop + (up ? -rad - 1 : rad + 1), x2: cx0,
            y2: up ? LAB_UP_BOT + 3 : LAB_DN - 9,
            stroke: `var(--ev-${ev.k})`, 'stroke-width': 0.8, opacity: .45 }));
        }
        const per = Math.ceil(nm.length / cols);
        for (let c = 0; c < cols; c++) {
          const seg = segs ? segs[c] : nm.slice(c * per, (c + 1) * per);
          if (!seg.length) continue;
          // 竖排多列依汉字传统自右向左:首列在右
          const cx2 = cx0 + halfW - colW * (c + 0.5);
          // 字也挂 data-evi：导览打光要照的是**画出来的墨**，不是为了好点而
          // 做得很高的命中区（用户实测：光框比字高出一大截）
          const t2 = el('text', { x: cx2, y: y0, 'font-size': LAB_FS, 'text-anchor': 'middle',
            fill: 'var(--text-2)', 'pointer-events': 'none', 'data-evi': String(EVENTS.indexOf(ev)) });
          seg.forEach((ch, i) => t2.appendChild(el('tspan', { x: cx2, dy: i ? LAB_DY : 0 }, ch)));
          g.appendChild(t2);
        }
        lane.push([cx0, halfW]);
        // 标签下方再补一块命中区:此前命中区只盖着圆点,而标签可能被避让
        // 挪开两年之远,于是点名字点不着自己、反而点到邻居(用户实测)
        const lh = el('rect', {
          x: cx0 - halfW - 2, y: up ? y0 - 12 : LAB_DN - 11, width: halfW * 2 + 4,
          height: up ? LAB_UP_BOT - y0 + 16 : HEAD_H - LAB_DN - 6,
          fill: 'transparent', 'pointer-events': 'all', class: 'kp-hit ev-hit' });
        lh.dataset.evi = String(EVENTS.indexOf(ev));
        hoverable(lh, tipOf, () => ev.ya || ev.n);
        g.appendChild(lh);
      }
      const hit = el('rect', { x: ex - 7, y: evTop - 9, width: 14, height: 18,
        fill: 'transparent', 'pointer-events': 'all', class: 'kp-hit ev-hit' });
      hit.dataset.evi = String(EVENTS.indexOf(ev));
      hoverable(hit, tipOf, () => ev.ya || ev.n);
      g.appendChild(hit);
      function tipOf() { return [
        { color: `var(--ev-${ev.k})`, value: ev.y2 ? `${fmtYearAxis(ev.y)}–${fmtYearAxis(ev.y2)}` : fmtYearAxis(ev.y), label: kind.label },
        { label: '事件', value: ev.n },
        ...(ev.yc ? [ev.yc] : []),
        ...(isSpan ? ['图上只标起点：这类制度或交流延续百年以上，画成长条会与邻近事件互撞，跨度见上方年份。'] : []),
        '点它可在右侧卡片读这条大事记的词条。',
      ]; }
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

  // 年代拟测（F 旗 Y）的斜纹：夏与商前期的君主格是传统系年等比铺入的坐标，
  // 不是史源确年，画法上必须与实证段一眼可辨（斜纹＋半透明）。
  // 与 contest-hatch 分立：一个说「并立」，一个说「虚年」，语义不同不共用。
  const defsY = el('defs');
  defsY.appendChild(el('pattern', {
    id: 'vy-hatch-l', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)',
  }, [el('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: 'var(--surface-1)', 'stroke-width': 2.2, opacity: 0.55 })]));
  body.appendChild(defsY);

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
      ...(b.d.bio ? [b.d.bio] : []),
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
        fill: col, opacity: 0.14, class: 'mark', 'data-dyn': b.d.key,
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
        ...(g.e.yearsSurmised ? ['斜纹段＝低置信年份：推算所得（传统系年铺入，或诸家体系并存取其一），非史源确年；依据见本条备注。'] : []),
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
        const segAttrs = { x: sx0 + 1, y: sy, width: wSeg, height: segH, rx: Math.min(3, segH / 2) };
        gTop.appendChild(el('rect', {
          ...segAttrs, fill: col, class: 'mark', ...(g.e.yearsSurmised ? { opacity: 0.55 } : {}),
        }));
        if (g.e.yearsSurmised) {
          gTop.appendChild(el('rect', {
            ...segAttrs, fill: 'url(#vy-hatch-l)', class: 'mark', 'pointer-events': 'none',
          }));
        }
        const hit = el('rect', { x: sx0, y: sy - 2, width: Math.max(10, sx1 - sx0), height: segH + 4, fill: 'transparent', class: 'mark' });
        hoverable(hit, segTip, () => `${b.d.name}·${g.e.temple}`);
        gTop.appendChild(hit);
        empRefs.push({ node: hit, e: g.e, band: b, cx: (sx0 + sx1) / 2 });
        hit.addEventListener('click', () => stampHash('e', g.e.name || g.e.temple));
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
          // 名字不吃指针:否则点在「太宗」二字上既选不中太宗,又被委派监听
          // 当成点了空白(丝散、卡不开)
          'pointer-events': 'none',
        }, nm));
      }
    }

    // 朝代名（带首；滚动时吸附于视口左缘，但不越出本带）。
    // 微型政权（见 spanOf）只画色点不写名——名字在底带与君主段的悬停里
    const lw = textW(b.d.name, LABEL_FS);
    const dot = el('circle', { cx: bx0 + 4, cy: y0 + 8, r: 3.5, fill: col });
    gTop.appendChild(dot);
    if (!b.micro) {
      const label = el('text', { x: bx0 + 12, y: y0 + 12, 'font-size': LABEL_FS, 'font-weight': 600, fill: 'var(--text-1)' }, b.d.name);
      gTop.appendChild(label);
      labelNodes.push({ dot, label, x0: bx0, x1: bx1, lw });
    }
  }

  // ── 治世外套：套在对应皇帝格子外的一圈 ──────────────────────────────────
  //
  // 治世与中兴不是「某年发生了什么」,而是**某几位皇帝的在位期被后世追认**——
  // 贞观之治就是唐太宗那二十三年,康乾盛世横跨康雍乾三朝。挂在事件轨上等于
  // 把它与时点事件混为一谈;套在那几格皇帝外面,它才落回自己的所指。
  // 画成虚线外框而非填色:填色会盖住君主段本身的颜色与非正常死亡刻痕,
  // 而外套的语义正是「这一段的评价」,不该遮挡这一段的事实。
  if (showEvents && !(opts.evOff || []).includes('era')) {
    const gEra = el('g', { class: 'tl-eras' });
    for (const ev of EVENTS) {
      if (ev.k !== 'era' || !ev.y2) continue;
      // 归属**由数据显式指定**(events.js 的 `d`)。此前按重叠面积猜,而辽宋、
      // 金宋、大理宋同时在场时谁都「完全覆盖」那段年份,于是咸平之治套到了辽国、
      // 乾淳之治套到了大理——并存时代里,面积根本不是归属的证据
      let best = ev.d ? bands.find((b) => b.d.key === ev.d) : null;
      if (!best) {
        let bestOv = 0;
        for (const b of bands) {
          const ov = Math.min(b.e, ev.y2) - Math.max(b.s, ev.y);
          if (ov > bestOv) { bestOv = ov; best = b; }
        }
        if (!best || bestOv <= 0) continue;
      }
      if (Math.min(best.e, ev.y2) - Math.max(best.s, ev.y) <= 0) continue;
      const ex0 = x(Math.max(ev.y, best.s)), ex1 = x(Math.min(ev.y2, best.e));
      if (ex1 - ex0 < 6) continue;
      const y0 = best.lane * LANE_H + 4;
      const coat = el('rect', {
        x: ex0 - 2, y: y0 + TRACK_Y - 4, width: ex1 - ex0 + 4, height: TRACK_H + 8, rx: 5,
        fill: 'none', stroke: 'var(--ev-era)', 'stroke-width': 1.4, 'stroke-dasharray': '4 2.5',
        opacity: .85, class: 'mark era-coat',
      });
      gEra.appendChild(coat);
      // 命中环:fill:none 的框只有 1.4px 描边可点(用户实测「框对但点不着」)。
      // 沿框再画一圈**向外扩**的透明粗描边,环几乎全在框外——既好点,
      // 又不抢走框内君主格子自己的点选
      const coatHit = el('rect', {
        x: ex0 - 8, y: y0 + TRACK_Y - 10, width: ex1 - ex0 + 16, height: TRACK_H + 20, rx: 9,
        fill: 'none', stroke: 'transparent', 'stroke-width': 14, 'pointer-events': 'stroke',
        class: 'kp-hit era-coat',
      });
      coatHit.dataset.evi = String(EVENTS.indexOf(ev));
      hoverable(coatHit, () => [
        { color: 'var(--ev-era)', value: `${fmtYearAxis(ev.y)}–${fmtYearAxis(ev.y2)}`, label: '治世·中兴' },
        { label: '史称', value: ev.n },
        { label: '所属', value: best.d.name },
        '后世史书对这一段的追认，非当时建制；外框圈出的正是被追认的那几位君主。点它可读词条。',
      ], () => ev.n);
      gEra.appendChild(coatHit);
      // 名字压在外框上缘,自带底色晕圈以免与君主名打架;名字本身也可点
      const lw = textW(ev.n, 9.5);
      if (ex1 - ex0 > lw + 10) {
        const lab = el('text', {
          x: (ex0 + ex1) / 2 - lw / 2, y: y0 + TRACK_Y - 6, 'font-size': 9.5,
          fill: 'var(--ev-era)', stroke: 'var(--page)', 'stroke-width': 3, 'paint-order': 'stroke',
          class: 'kp-hit era-coat',
        }, ev.n);
        lab.dataset.evi = String(EVENTS.indexOf(ev));
        gEra.appendChild(lab);
      }
    }
    gTop.appendChild(gEra);
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
    // 点治世外套:卡片改讲这一段治世
    const evi = ev.target && ev.target.dataset && ev.target.dataset.evi;
    if (evi !== undefined && kp && kp.showEvent) {
      const e3 = EVENTS[+evi];
      if (e3) {
        kp.showEvent({ id: `evt:${e3.w}`, head: `${fmtYearAxis(e3.y)}–${fmtYearAxis(e3.y2)} · 治世·中兴（史书追认）`,
          title: e3.w, baidu: e3.b || e3.n, q: `${e3.n} 历史`, yt: true, display: e3.n });
        return;
      }
    }
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
  /**
   * 跨度只在点中它时才现形。
   *
   * 有起讫的条目此前在图上**只标起点**（见上方 isSpan 那段注释：画成通长的长条
   * 必与邻近事件互撞）。代价是跨度完全看不见——四羊方尊画在前1300 一个点上，
   * 谁也看不出那是个两百五十年的断代窗口，得悬停才知道。
   *
   * 按需现形两头都占：默认一个点、零杂乱；点中了才横着拉出一条线。
   * 全图同时只有一条，撞不着谁。
   *
   * 线分两种，因为 y2 本身就有两种意思：
   *   **真的持续了这么久**（inst 存续期、her 遗址、era 治世）——莫高窟确实
   *     从 366 存在到 1368。画实线。
   *   **不知道是哪一年**（art 文物）——四羊方尊铸成于某一刻，前1300–前1046
   *     是断代窗口不是寿命。画**半透明**的线，且两端加竖挡：这是误差棒，
   *     不是时间段。同一根实线画上去等于断言一件假事。
   */
  const spanLayer = el('g', { class: 'ev-span-layer' });
  head.appendChild(spanLayer);
  const showSpan = (e3) => {
    spanLayer.innerHTML = '';
    if (!e3) return;
    // 两种线读的是两组不同的字段,不再靠类别去猜:
    //   u1/u2 断代窗口(锚点可能落在哪儿)  → 半透明虚线 + 两端竖挡,是误差棒
    //   y/y2  真实存续(那些年它确实在)    → 实线
    // 二者可以并存(有起讫、边界又不确定的东西,如夏商),此时窗口优先画出来
    const window_ = e3.u1 !== undefined && e3.u2 !== undefined;
    const lo = window_ ? e3.u1 : e3.y;
    const hi = window_ ? e3.u2 : e3.y2;
    if (hi === undefined || hi <= lo) return;
    const x0 = x(lo), x1 = x(hi);
    spanLayer.appendChild(el('line', {
      x1: x0, x2: x1, y1: AXIS_Y, y2: AXIS_Y,
      stroke: `var(--ev-${e3.k})`, 'stroke-width': window_ ? 2.5 : 3.5,
      'stroke-linecap': 'round', opacity: window_ ? 0.38 : 0.75,
      ...(window_ ? { 'stroke-dasharray': '5 4' } : {}),
    }));
    if (window_) {                            // 误差棒的两根竖挡
      for (const xx of [x0, x1]) {
        spanLayer.appendChild(el('line', { x1: xx, x2: xx, y1: AXIS_Y - 4, y2: AXIS_Y + 4,
          stroke: `var(--ev-${e3.k})`, 'stroke-width': 2, opacity: 0.5 }));
      }
    }
  };

  head.addEventListener('click', (ev2) => {
    const i = ev2.target && ev2.target.dataset && ev2.target.dataset.evi;
    if (i === undefined || !kp || !kp.showEvent) return;
    const e3 = EVENTS[+i];
    showSpan(e3);
    kp.showEvent(evSpec(e3));
  });
  host.__showSpan = showSpan;      // 搜索/深链/骰子落到事件时同样拉出跨度

  const headWrap = h('div', { class: 'tl-head-wrap' }, [head]);
  const inner = h('div', { class: 'tl-inner' }, [headWrap, body]);
  const scroller = h('div', { class: 'lane-scroll' }, [inner]);
  // 泳道数在 10 以内时不设高度上限并关掉纵向滚动：横向滚动条本身要占十几像素，
  // 若照旧设 max-height，就会为了这十几像素逼出一条纵向滚动条，纯属噪音。
  // 纵向不再滚动（用户定的版式）：介绍出框省下的高度足以铺开全部泳道行，
  // fitHeight 会按视口占用收放，密集时代整幅展开、荒原时代收成两行
  scroller.style.overflowY = 'hidden';
  host.appendChild(scroller);
  scrollHint(scroller, '左右滑动即为时间流逝');

  // 说明段右侧的空当放知识卡:中间朝代、右侧皇帝,横滚自动跟随、点选钉卡。
  // 挂在 __riverCleanup 上——app 的全景包装器在每次重绘前统一调用,
  // 切去河流视图或改筛选重绘时,角卡与滚动监听一并撤走
  kp = mountKnowledgeCorner(empRefs, bandRefs, scroller, host.closest('section.card'));
  host.__riverCleanup = kp;

  // 定位接口:搜索跳转与深链共用同一套入口(见 js/search.js)。
  // 两个视图各自实现,调用方只管说「去 755 年」「去李世民」,不必知道
  // 这一张是横滚的还是竖滚的
  // 横滚到某个画布 x,居中。`o.smooth` 走缓动并把 Promise 挂在 __locate.pending 上——
  // 导览要等到位了再打光,而搜索跳转只想立刻到,两者共用这一个入口
  const goX = (px, o = {}) => {
    // 跳转即松钉:钉住是为了「点了谁就别跟着滚动乱换」,但那只该在原地生效。
    // 跨年代跳过去之后,旧位置钉住的卡就是陈货(骰子掷到 589,右卡还钉着 1161 的
    // 完颜亮)。松开不等于清空——未钉住的卡由 update() 按新视口重新跟随,
    // 跟不上就自己收起来;紧接着的 showEvent/click 会把该钉的重新钉上
    if (kp && kp.releasePins) kp.releasePins();
    const lim = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const to = Math.max(0, Math.min(lim, px - scroller.clientWidth / 2));
    host.closest('section.card').scrollIntoView({ block: 'start', behavior: 'instant' });
    const p = o.smooth
      ? glide(() => scroller.scrollLeft, (v) => { scroller.scrollLeft = v; }, to)
      : (scroller.scrollLeft = to, Promise.resolve());
    host.__locate.pending = p;
    return p;
  };

  host.__locate = {
    view: 'lanes',
    pending: Promise.resolve(),
    year(yr, o) { return goX(x(yr), o); },
    /** 某段年份在视口中的矩形——导览的「熄灯打光」按它挖洞,随滚动逐帧重算 */
    rect(a, b) {
      const sr = scroller.getBoundingClientRect();
      const x0 = sr.left + x(a) - scroller.scrollLeft;
      const x1 = sr.left + x(b) - scroller.scrollLeft;
      return { x: x0, y: sr.top, w: Math.max(x1 - x0, 10), h: sr.height };
    },
    /**
     * 同上，但**只算泳道那一片**：顶上 HEAD_H 那条是事件轴（大事记的标记与
     * 竖排标签），讲「这一段年份里有几家并立」时不该把它也照进去
     *（用户实测：五代十国那站，光把事件轴连同泳道一起罩住了）。
     */
    rectBody(a, b) {
      const r = this.rect(a, b);
      return { ...r, y: r.y + HEAD_H, h: Math.max(10, r.h - HEAD_H) };
    },
    emperor(id, o) {
      const r = empRefs.find((q) => q.e.id === id);
      if (!r) return false;
      goX(r.cx, o);
      // 卡片立刻开:摘要要向维基取,趁着滚动这一路把请求发出去,到站时正好读得上。
      // 窄屏角卡摆不下、点击处理器直接早退,骰子/搜索跳到君主就什么也不开
      // ——改走贴底词条单卡,与跳到事件一致(河流侧同款修法)
      if (kp && kp.soloMode && kp.soloMode() && kp.showEmperor) {
        kp.showEmperor(r);
      } else {
        r.node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      return r.node;
    },
    dynasty(key, o) {
      const b = bandRefs.find((q) => q.band.d.key === key);
      if (!b) return false;
      goX((b.x0 + b.x1) / 2, o);
      b.node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return b.node;
    },
    event(i, o) {
      const ev = EVENTS[i];
      if (!ev) return false;
      this.year(ev.y2 ? (ev.y + ev.y2) / 2 : ev.y, o);
      if (host.__showSpan) host.__showSpan(ev);      // 跳过去的也把跨度拉出来
      if (kp && kp.showEvent) {
        kp.showEvent(evSpec(ev));
      }
      return true;
    },
  };

  // 落点：重绘回到读者离开的那一年；首绘（无记录）落在秦始皇——开卷即四千年，
  // 读者应站在帝制的门口（向左是更早的世界），而不是传说时代的荒原。
  // 深链随后由 search.js 的双 rAF 落位覆盖。只动横滚，不动页面纵滚。
  {
    const yr = host.__anchorYear ?? -220;
    const lim = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    scroller.scrollLeft = Math.max(0, Math.min(lim, x(yr) - scroller.clientWidth / 2));
    host.__yearOfScroll = () => x.invert(scroller.scrollLeft + scroller.clientWidth / 2);
  }

  // 图例：只列出当前视口内可见的朝代。色值本身固定不变，
  // 变的只是「这一屏有哪些朝代」——这是图例该做的事，不是重新配色。
  const legendHost = h('div');
  host.appendChild(legendHost);
  const staticLegend = h('div');
  host.appendChild(staticLegend);
  // 读图必需的视觉语法留在图旁，一行说完；来龙去脉收进折叠块
  // 速查行只留一词一义、按在场要素显隐；长解释在下方折叠块（用户定的分工）。
  // 注意斜纹一词二义：底轨斜纹（并立）与君主格斜纹（低置信年份）是两种语法
  const hasVY = bands.some((b) => b.segs.some((g) => g.e.yearsSurmised));
  const hasMicro = bands.some((b) => b.micro);
  const key = [];
  if (useTop) key.push('淡底首行＝正统序列');
  if (useSecond) key.push('次行＝北方主线');
  if (contests.length) key.push('底轨斜纹＝新旧并立');
  if (hasVY) key.push('君主格斜纹＝低置信年份');
  key.push('浅色半高＝称帝前掌权');
  if (markViolent) key.push('▲＝非正常死亡');
  if (hasMicro) key.push('极短政权仅存色点');
  key.push('点选可显承继丝（详见下方说明）');
  staticLegend.appendChild(h('p', { class: 'muted small', style: 'margin:8px 0 0', text: key.join(' · ') }));

  if (showEvents) for (const n of eventLegend(opts)) staticLegend.appendChild(n);

  let raf = null;
  let fitInit = false;    // 首次高度落定后才开过渡，免得开页先看一段收缩动画
  // 视口自适应高度（用户点子）：泳道行数是全局分配的——先秦段里往往只有
  // 一两行有货，其余十几行是给五代十国备着的空行。按视口内实际占用的
  // 最深一行收放容器高度，空行裁掉，图注与大事记随之上来。
  // **只在滚动停稳后动**（280ms 无滚动）：横滚条贴着容器底缘，拖动中途
  // 改高度会让它在指针底下上蹿下跳（用户实测）；代价是拖进密集时代的
  // 一瞬间下缘行迟 280ms 才展开，远轻于抓不住滚动条。
  const fitHeight = () => {
    const left = scroller.scrollLeft, right = left + scroller.clientWidth;
    const y0 = x.invert(left), y1 = x.invert(right);
    let deep = 0;
    for (const b of bands) if (b.e > y0 && b.s < y1 && b.lane > deep) deep = b.lane;
    const sbH = scroller.offsetHeight - scroller.clientHeight;      // 横滚条自身的高
    const contentH = scroller.scrollHeight;
    const want = contentH - (nLanes - deep - 1) * LANE_H + sbH;
    if (scroller.__fitH === want) return;
    scroller.__fitH = want;
    scroller.style.maxHeight = 'none';
    scroller.style.height = `${want}px`;
    scroller.scrollTop = 0;      // 恒 hidden 下的保险：被裁的只能是底部空行
    if (!fitInit) { fitInit = true; requestAnimationFrame(() => { scroller.style.transition = 'height .25s ease'; }); }
  };
  let settleT = null;
  // 拖动预览（用户点子）：拖着横滚条飞越四千年时主画布高度冻结（见下），
  // 给指针边上一枚小窗勾出目标时段的泳道轮廓——像视频进度条的缩略图。
  // 「在拖条」不猜步幅、不掐时间（首版按单次滚动跨半屏判，慢拖判不出来；
  // 停稳定时器又会在拖动中途的停顿里提前开火——皆用户实测）：
  // mousedown 落在滚动条区（target 是容器自身且坐标越过 clientHeight/Width）
  // 即入拖动态，期间小窗常显、高度绝不动；mouseup/pointerup/失焦即释放，
  // 高度一次调齐。原生拖条不派发 mousemove，小窗位置按滚动比例推算。
  const peek = document.createElement('div');
  peek.className = 'lane-peek';
  peek.style.display = 'none';
  document.body.appendChild(peek);
  let dragging = false, peekLast = 0;
  const renderPeek = () => {
    const left = scroller.scrollLeft, cw = scroller.clientWidth;
    const y0 = x.invert(left), y1 = x.invert(left + cw), yc = (y0 + y1) / 2;
    const vis2 = bands.filter((b) => b.e > y0 && b.s < y1);
    const era = ERAS.find((er) => yc >= er.s && yc <= er.e);
    const PW = 188, rows = Math.max(1, vis2.reduce((m, b) => Math.max(m, b.lane), 0) + 1);
    const PH = Math.min(rows, 12) * 7 + 4;
    const sx = (t) => Math.max(0, Math.min(PW, (t - y0) / (y1 - y0) * PW));
    let bars = '';
    for (const b of vis2) {
      const bx0 = sx(b.s), bx1 = sx(b.e);
      const cvar = byDynasty ? slotVar(slots.get(b.d.key)) : (b.d.u ? '--c-unified' : '--c-split');
      bars += `<rect x="${bx0.toFixed(1)}" y="${b.lane * 7 + 2}" width="${Math.max(2, bx1 - bx0).toFixed(1)}" height="5" rx="2" fill="var(${cvar})" opacity=".85"></rect>`;
    }
    peek.innerHTML = `<div class="lp-cap">${fmtYearAxis(yc)} 年${era ? ' · ' + era.name : ''} · ${vis2.length} 政权</div>`
      + `<svg width="${PW}" height="${PH}" viewBox="0 0 ${PW} ${PH}">${bars}</svg>`;
    const rect = scroller.getBoundingClientRect();
    const frac = left / Math.max(1, scroller.scrollWidth - cw);
    const px = Math.max(rect.left + 8, Math.min(rect.right - PW - 24, rect.left + frac * rect.width - PW / 2));
    peek.style.left = `${px}px`;
    peek.style.top = `${rect.bottom - PH - 58}px`;
    peek.style.display = '';
  };
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
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    peek.style.display = 'none';
    clearTimeout(settleT);
    fitHeight();                        // 松手即一次调齐——用户要的「on release」
  };
  scroller.addEventListener('mousedown', (e2) => {
    if (e2.target !== scroller) return;                     // 点在内容上的不算
    if (e2.offsetY >= scroller.clientHeight || e2.offsetX >= scroller.clientWidth) {
      dragging = true; peekLast = scroller.scrollLeft;      // 落在横/纵滚动条区
    }
  });
  const onUp = () => endDrag();
  addEventListener('mouseup', onUp, true);
  addEventListener('pointerup', onUp, true);
  addEventListener('blur', onUp);
  host.__peekCleanup = () => {
    removeEventListener('mouseup', onUp, true);
    removeEventListener('pointerup', onUp, true);
    removeEventListener('blur', onUp);
    peek.remove();
  };
  scroller.addEventListener('scroll', () => {
    if (!raf) raf = requestAnimationFrame(sync);
    if (dragging) {
      if (scroller.scrollLeft !== peekLast) { peekLast = scroller.scrollLeft; renderPeek(); }
      clearTimeout(settleT);
      settleT = setTimeout(endDrag, 1600);   // mouseup 偶被浏览器吞掉时的保险丝
    } else {
      clearTimeout(settleT);
      settleT = setTimeout(fitHeight, 280);  // 滚轮/触板：光标不在条上，照旧沉降
    }
  });
  requestAnimationFrame(sync);
  fitHeight();                          // 首绘立即定高（锚点已落好）

  const greyN = [...slots.values()].filter((v) => v < 0).length;
  const stacked = bands.filter((b) => b.subs > 1);
  host.appendChild(notes([
    '图例详解——斜纹有两处语义，不可混读：**底轨**上的斜纹标「新旧并立」的交替期（上半轨前朝、下半轨后朝，正统行与北方主线共用此画法）；**君主格**上的斜纹＋半透明标「低置信年份」——推算所得（传统系年铺入，或诸家体系并存取其一），依据见各条悬停备注。点选朝代或皇帝会点亮承继丝：粗实线＝法统相承、细实线＝亡入、虚线＝裂自；「全部承继关系」开关可整图齐显。画宽装不下自己名字的极短政权（桓楚、中华帝国）只画色点，名字在悬停里。',
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
