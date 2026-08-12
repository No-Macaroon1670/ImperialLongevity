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
import { el, h, linear, ticks, hoverable, legend, tableView, showTip, hideTip, fmtYearAxis, fmt1 } from './charts.js';
import { DYNASTIES, DYN_STATS } from './data.js';
import { ERAS } from './dynasties.js';
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
const slotVar = (s) => (s < 0 ? OTHER_VAR : SLOT_VARS[s]);

// 读出当前主题下解析后的真实色值，用于判断段内文字该用白还是墨色
function resolveInk(host) {
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
function shortName(e) {
  const t = e.temple.replace(/（[^）]*）$/, '');
  const tail = e.dynasty.slice(-1);
  const stripped = t.startsWith(e.dynasty) ? t.slice(e.dynasty.length)
    : (t.length > 2 && t.startsWith(tail)) ? t.slice(1) : t;
  return stripped || t;
}

// ── 主渲染 ───────────────────────────────────────────────────────────────
export function renderLaneTimeline(host, list, opts) {
  host.innerHTML = '';
  const pxYear = opts.lanePx || 10;
  const byDynasty = opts.laneColor !== 'unified';
  const markViolent = opts.laneViolent !== false;
  const slots = dynastyColorSlots();
  const ink = resolveInk(host);

  const LANE_H = 48, LABEL_H = 15, TRACK_Y = 18, TRACK_H = 24, HEAD_H = 54;
  const LABEL_FS = 12.5, SEG_FS = 10;

  // 1) 组装朝代带
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
      // 看上去像缺数据。以半高虚段区别于正式在位期。
      const first = e.reigns[0].s;
      if (e.accRule && first && first.t - e.accRule.t > 0.9) {
        preRule.push({ e, s: e.accRule.t, x: first.t });
      }
    }
    if (!segs.length) continue;
    segs.sort((a, b) => a.s - b.s);
    for (const g of segs) { g.ds = g.s; g.dx = g.x; }   // ds/dx＝绘图坐标，s/x 始终保留真实日期
    // 带的跨度取「朝代元数据」与「实际在位区间」的并集
    const s = Math.min(d.s, ...segs.map((g) => g.s), ...preRule.map((g) => g.s));
    const e2 = Math.max(d.e, ...segs.map((g) => g.x));
    bands.push({ d, s, e: e2, segs, preRule, n: emps.length });
  }
  if (!bands.length) { host.appendChild(h('p', { class: 'muted', text: '当前筛选无数据。' })); return; }
  bands.sort((a, b) => a.s - b.s || a.e - b.e);

  // 2) 泳道装箱：首次适配。带的横向足迹取「带宽」与「名称宽度」的较大者，
  //    因此带首的名称永远不会压到上一条政权的尾部。
  const laneEnd = [];
  for (const b of bands) {
    const need = Math.max(b.e * pxYear, b.s * pxYear + textW(b.d.name, LABEL_FS) + 14);
    let k = 0;
    while (k < laneEnd.length && laneEnd[k] > b.s * pxYear - 10) k++;
    if (k === laneEnd.length) laneEnd.push(-Infinity);
    laneEnd[k] = need;
    b.lane = k;
  }
  const nLanes = laneEnd.length;

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
  head.appendChild(el('line', { x1: 0, x2: W, y1: HEAD_H - 1, y2: HEAD_H - 1, class: 'axis-line' }));

  // ── 主体 ────────────────────────────────────────────────────────────────
  const body = el('svg', { viewBox: `0 0 ${W} ${BODY_H}`, width: W, height: BODY_H });
  for (const t of yTicks) {
    body.appendChild(el('line', { x1: x(t), x2: x(t), y1: 0, y2: BODY_H, class: 'grid' }));
  }
  for (const era of ERAS) {
    const bx = x(era.e);
    if (bx > PAD_L && bx < W - PAD_L) body.appendChild(el('line', { x1: bx, x2: bx, y1: 0, y2: BODY_H, class: 'ref-line' }));
  }

  const labelNodes = [];
  for (const b of bands) {
    const y0 = b.lane * LANE_H + 4;
    const cvar = byDynasty ? slotVar(slots.get(b.d.key)) : (b.d.u ? '--c-unified' : '--c-split');
    const col = `var(${cvar})`;
    const bx0 = x(b.s), bx1 = x(b.e);

    // 底带：朝代存续期的浅色轨道
    const track = el('rect', {
      x: bx0, y: y0 + TRACK_Y, width: Math.max(2, bx1 - bx0), height: TRACK_H, rx: 4,
      fill: col, opacity: 0.14, class: 'mark',
    });
    const st = DYN_STATS.get(b.d.key);
    hoverable(track, () => [
      { color: col, value: `${b.d.s <= 0 ? `前${-b.d.s + 1}` : b.d.s}–${b.d.e}`, label: '国祚' },
      { label: '历时', value: `${st.span} 年` },
      { label: '皇帝', value: `${st.n} 位（当前筛选 ${b.n} 位）` },
      { label: 'DSI', value: st.dsi === null ? '—' : `${fmt1(st.dsi)} 年/帝` },
      ...(b.d.note ? [b.d.note] : []),
    ], () => b.d.name);
    body.appendChild(track);

    // 称帝前的掌权期：半高、低透明度，贴在正式在位段之下
    for (const g of b.preRule) {
      const px0 = x(g.s), px1 = x(g.x);
      const pw = Math.max(2, px1 - px0 - 2);
      const node = el('rect', {
        x: px0 + 1, y: y0 + TRACK_Y + TRACK_H - 8, width: pw, height: 7, rx: 2,
        fill: col, opacity: 0.5, class: 'mark',
      });
      hoverable(node, () => [
        { color: col, value: `${fmtDate(g.e.accRule, { yearOnly: true })}–${fmtDate(g.e.acc, { yearOnly: true })}`, label: '掌权（未称帝）' },
        { label: '称帝', value: fmtDate(g.e.acc) },
        '此段为该君主实际掌握政权最高权力、但尚未即皇帝位的时期，不计入「在位年数」。',
      ], () => `${b.d.name}·${g.e.temple}`);
      body.appendChild(node);
    }

    // 皇帝分段
    const segH = (TRACK_H - (b.subs - 1) * 2) / b.subs;
    for (const g of b.segs) {
      const sy = y0 + TRACK_Y + g.sub * (segH + 2);
      const sx0 = x(g.ds), sx1 = x(g.dx);
      const wSeg = Math.max(1.5, sx1 - sx0 - 2);   // −2 ＝ 段间以底色留缝，而不是描边分隔
      const rect = el('rect', {
        x: sx0 + 1, y: sy, width: wSeg, height: segH, rx: Math.min(3, segH / 2), fill: col, class: 'mark',
      });
      body.appendChild(rect);

      // 非正常死亡：段末的小三角（状态色 + 图例说明，不单靠颜色表意）
      if (markViolent && g.e.violent === 1 && g.e.reignEnd && Math.abs(g.x - g.e.reignEnd.t) < 0.01) {
        const tipX = sx0 + 1 + wSeg;
        body.appendChild(el('path', {
          d: `M${tipX - 3.5},${sy - 1.5}L${tipX + 3.5},${sy - 1.5}L${tipX},${sy + 4}Z`,
          fill: 'var(--critical)',
        }));
      }
      // 段内简称：放得下才写，放不下留给悬停与数据表
      const nm = shortName(g.e);
      if (segH >= 9 && wSeg > textW(nm, SEG_FS) + 8) {
        body.appendChild(el('text', {
          x: sx0 + 5, y: sy + segH / 2 + SEG_FS * 0.36, 'font-size': SEG_FS,
          fill: ink[cvar] === 'dark' ? 'var(--text-1)' : 'var(--surface-1)',
        }, nm));
      }
      const hit = el('rect', { x: sx0, y: sy - 2, width: Math.max(10, sx1 - sx0), height: segH + 4, fill: 'transparent', class: 'mark' });
      hoverable(hit, () => [
        { color: col, value: `${fmtDate(g.e.acc, { yearOnly: true })}–${g.e.reignEnd ? fmtDate(g.e.reignEnd, { yearOnly: true }) : '？'}`, label: '在位' },
        { label: '在位年数', value: g.e.reignYears === null ? '—' : `${g.e.reignYears.toFixed(1)} 年` },
        { label: '享年', value: g.e.lifespan === null ? '不详' : `${Math.floor(g.e.lifespan)} 岁` },
        { label: '登基年龄', value: g.e.accAge === null ? '不详' : `${Math.floor(g.e.accAge)} 岁` },
        { label: '死因', value: g.e.causeLabel },
        ...(g.e.note ? [g.e.note] : []),
      ], () => `${b.d.name}·${g.e.temple}`);
      body.appendChild(hit);
    }

    // 朝代名（带首；滚动时吸附于视口左缘，但不越出本带）
    const lw = textW(b.d.name, LABEL_FS);
    const dot = el('circle', { cx: bx0 + 4, cy: y0 + 8, r: 3.5, fill: col });
    const label = el('text', { x: bx0 + 12, y: y0 + 12, 'font-size': LABEL_FS, 'font-weight': 600, fill: 'var(--text-1)' }, b.d.name);
    body.appendChild(dot); body.appendChild(label);
    labelNodes.push({ dot, label, x0: bx0, x1: bx1, lw });
  }

  // ── 组装：表头与主体同处一个滚动容器，横向同步、纵向吸顶 ────────────────
  const headWrap = h('div', { class: 'tl-head-wrap' }, [head]);
  const inner = h('div', { class: 'tl-inner' }, [headWrap, body]);
  const scroller = h('div', { class: 'lane-scroll' }, [inner]);
  // 泳道数在 10 以内时不设高度上限并关掉纵向滚动：横向滚动条本身要占十几像素，
  // 若照旧设 max-height，就会为了这十几像素逼出一条纵向滚动条，纯属噪音。
  if (nLanes <= 10) scroller.style.overflowY = 'hidden';
  else scroller.style.maxHeight = `${10 * LANE_H + HEAD_H + 24}px`;
  host.appendChild(scroller);

  // 图例：只列出当前视口内可见的朝代。色值本身固定不变，
  // 变的只是「这一屏有哪些朝代」——这是图例该做的事，不是重新配色。
  const legendHost = h('div');
  host.appendChild(legendHost);
  const staticLegend = h('div');
  host.appendChild(staticLegend);
  if (markViolent) {
    staticLegend.appendChild(legend([{ color: 'var(--critical)', label: '▲ 段末三角＝该帝非正常死亡（被杀/战死/自杀）' }]));
  }

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

  // 说明 + 数据表
  const greyN = [...slots.values()].filter((v) => v < 0).length;
  const stacked = bands.filter((b) => b.subs > 1);
  host.appendChild(h('p', { class: 'muted small', text:
    `同朝代内前帝崩与后帝即位常落在同一个月，史料精确到月即产生名义上的重叠——这类不足半年的重叠一律`
    + `就地挤压（交界取中点、两段各退一半），仍并排在同一行；只有真正并立称帝者才分层错开，`
    + `当前有 ${stacked.length} 例${stacked.length ? `（${stacked.map((b) => b.d.name).join('、')}）` : ''}。`
    + `分段的绘图宽度因此可能比真实在位期短几个月，悬停与数据表给出的始终是真实日期。` }));
  host.appendChild(h('p', { class: 'muted small', text:
    `共 ${bands.length} 个政权装入 ${nLanes} 条泳道。泳道不归属任何朝代：某朝终结后该行即被后来的政权接管，`
    + `因此同一时刻占用的行数就是当时并存的政权数（最挤的 937 年有十一个政权）。`
    + (byDynasty
      ? `配色按具体朝代，时间上重叠者必为异色，不重叠者复用槽位（唐与明同色不会造成混淆）；`
        + `并存政权最多达 11 个而分类色板仅 8 槽，故有 ${greyN} 个边缘割据政权折入中性灰——每条带都直接标注朝代名，颜色只是辅助。`
      : '配色沿用全局语义：蓝＝大一统，橙＝分裂。') }));

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
