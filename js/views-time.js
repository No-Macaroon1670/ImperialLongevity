// views-time.js — 时间轴类视图：双层寿命/统治时间轴、历史总散点、寿命热力图
import { el, h, linear, ticks, Frame, hoverable, legend, tableView, notes, fmt1, fmtYearAxis, scrollHint } from './charts.js';
import { ERAS } from './dynasties.js';
import { fmtDate } from './schema.js';
import { renderLaneTimeline } from './views-lanes.js';

const C = (v) => `var(${v})`;
const UNI = C('--c-unified'), SPL = C('--c-split');

const yearOf = (dt) => (dt ? dt.t : null);
const label = (e) => `${e.temple}（${e.name}）`;

function emperorTip(e) {
  const rows = [
    { label: '朝代', value: e.dynasty },
    { label: '生卒', value: `${fmtDate(e.birth, { yearOnly: true })} – ${e.death ? fmtDate(e.death, { yearOnly: true }) : '失踪/不详'}` },
    { label: '享年', value: e.lifespan === null ? '不详' : `${Math.floor(e.lifespan)} 岁` },
    { label: '登基年龄', value: e.accAge === null ? '不详' : `${Math.floor(e.accAge)} 岁` },
    { label: '在位', value: e.reignYears === null ? '不详' : `${e.reignYears.toFixed(1)} 年` },
    { label: '死因', value: e.causeLabel },
    { label: '时期', value: e.unified ? '大一统王朝' : '分裂时期' },
  ].map((r) => ({ label: r.label, value: r.value }));
  if (e.note) rows.push(e.note);
  return rows;
}

// ── 1–4. 双层时间轴（寿命 / 统治 / 双层） ────────────────────────────────
export function renderTimeline(host, list, opts) {
  const mode = opts.timelineMode || 'dual';       // 'life' | 'reign' | 'dual' | 'lanes'
  const sortKey = opts.timelineSort || 'birth';
  if (mode === 'lanes') return renderLaneTimeline(host, list, opts);
  host.innerHTML = '';

  const items = list.filter((e) => (mode === 'reign' ? e.reigns[0].s : e.birth || e.reigns[0].s));
  const sorted = items.slice().sort((a, b) => {
    if (sortKey === 'life') return (b.lifespan ?? -1) - (a.lifespan ?? -1);
    if (sortKey === 'reign') return (b.reignYears ?? -1) - (a.reignYears ?? -1);
    const av = yearOf(a.birth) ?? yearOf(a.reigns[0].s) ?? 0;
    const bv = yearOf(b.birth) ?? yearOf(b.reigns[0].s) ?? 0;
    return av - bv;
  });
  if (!sorted.length) { host.appendChild(h('p', { class: 'muted', text: '当前筛选无数据。' })); return; }

  const W = 1080, ML = 132, MR = 24, rowH = 13;
  const lo = Math.min(...sorted.map((e) => Math.min(yearOf(e.birth) ?? Infinity, yearOf(e.reigns[0].s) ?? Infinity)));
  const hi = Math.max(...sorted.map((e) => Math.max(yearOf(e.death) ?? -Infinity, yearOf(e.censor) ?? -Infinity, yearOf(e.reignEnd) ?? -Infinity)));
  const x = linear([lo - 12, hi + 12], [ML, W - MR]);
  const xt = ticks(lo, hi, 10);

  // 固定表头（时间轴 + 时代分带），使纵向滚动时刻度常驻
  const head = el('svg', { viewBox: `0 0 ${W} 46`, width: W, height: 46 });
  for (const era of ERAS) {
    const x0 = Math.max(ML, x(era.s)), x1 = Math.min(W - MR, x(era.e));
    if (x1 <= x0) continue;
    head.appendChild(el('text', { x: (x0 + x1) / 2, y: 13, class: 'era-label', 'text-anchor': 'middle' }, era.name));
    head.appendChild(el('line', { x1: x0, x2: x1, y1: 19, y2: 19, class: 'ref-line' }));
  }
  for (const t of xt) {
    head.appendChild(el('text', { x: x(t), y: 40, class: 'tick', 'text-anchor': 'middle' }, fmtYearAxis(t)));
  }
  head.appendChild(el('line', { x1: ML, x2: W - MR, y1: 44, y2: 44, class: 'axis-line' }));

  const H = sorted.length * rowH + 10;
  const body = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
  // 纵向网格：每个百年一条
  for (const t of xt) body.appendChild(el('line', { x1: x(t), x2: x(t), y1: 0, y2: H, class: 'grid' }));

  sorted.forEach((e, i) => {
    const y = i * rowH + 6;
    const col = e.unified ? UNI : SPL;
    const g = el('g', { class: 'mark' });

    if (mode !== 'reign' && e.birth && (e.death || e.censor)) {
      const x0 = x(e.birth.t), x1 = x((e.death || e.censor).t);
      g.appendChild(el('line', {
        x1: x0, x2: x1, y1: y, y2: y, stroke: col, 'stroke-width': mode === 'dual' ? 2 : 4,
        'stroke-linecap': 'round', opacity: mode === 'dual' ? 0.42 : 1,
      }));
      if (!e.death) g.appendChild(el('circle', { cx: x1, cy: y, r: 2.6, fill: 'none', stroke: col, 'stroke-width': 1.4 }));
    }
    if (mode !== 'life') {
      for (const rg of e.reigns) {
        const s = rg.s, en = rg.e || e.death || e.censor;
        if (!s || !en) continue;
        const x0 = x(s.t), x1 = Math.max(x(en.t), x0 + 1.4);
        g.appendChild(el('rect', {
          x: x0, y: y - 3, width: x1 - x0, height: 6, rx: 2, fill: col,
          opacity: mode === 'dual' ? 1 : 0.92,
        }));
      }
    }
    // 行首直接标注庙号：行高 13px 足以容纳 9.5px 字，不会相互压叠
    const nm = e.temple.length > 11 ? `${e.temple.slice(0, 10)}…` : e.temple;
    g.appendChild(el('text', { x: ML - 8, y: y + 3.5, class: 'tick', 'text-anchor': 'end', 'font-size': 9.5 }, nm));
    hoverable(g, () => emperorTip(e), () => label(e));
    body.appendChild(g);
  });

  // 表头与主体共处同一滚动容器：纵向滚动时刻度粘顶，横向滚动时两者同步
  const headWrap = h('div', { class: 'tl-head-wrap' });
  headWrap.appendChild(head);
  const inner = h('div', { class: 'tl-inner' }, [headWrap, body]);
  const scroller = h('div', { class: 'timeline-scroll' }, [inner]);
  host.appendChild(scroller);
  scrollHint(scroller, '左右滑动查看完整时间轴');

  host.appendChild(legend([
    { color: UNI, label: '大一统王朝' },
    { color: SPL, label: '分裂时期' },
    ...(mode === 'dual' ? [{ color: 'var(--muted)', label: '细线＝在世（寿命） · 粗块＝在位' }] : []),
  ]));
  host.appendChild(tableView(
    ['庙号', '姓名', '朝代', '生年', '卒年', '享年', '登基年龄', '在位(年)', '死因', '时期'],
    sorted.map((e) => [e.temple, e.name, e.dynasty, fmtDate(e.birth, { yearOnly: true }),
      e.death ? fmtDate(e.death, { yearOnly: true }) : '失踪', e.lifespan === null ? null : Math.floor(e.lifespan),
      e.accAge === null ? null : Math.floor(e.accAge), e.reignYears === null ? null : e.reignYears.toFixed(1),
      e.causeLabel, e.unified ? '大一统' : '分裂']),
    { caption: '时间轴数据表', max: 400 },
  ));
}

// ── 5. 中国历史总时间轴（散点 + 移动平均趋势） ────────────────────────────
export function renderHistoryScatter(host, list, opts) {
  host.innerHTML = '';
  const xKey = opts.scatterX || 'birth';
  const pts = list.filter((e) => e.lifespan !== null && (xKey === 'birth' ? e.birth : e.reigns[0].s));
  if (pts.length < 3) { host.appendChild(h('p', { class: 'muted', text: '当前筛选数据不足。' })); return; }

  const f = new Frame(host, { width: 1080, height: 460, m: { t: 26, r: 22, b: 52, l: 52 } });
  const xs = pts.map((e) => (xKey === 'birth' ? e.birth.t : e.reigns[0].s.t));
  const x = linear([Math.min(...xs) - 20, Math.max(...xs) + 20], [0, f.pw]);
  const y = linear([0, Math.max(90, Math.max(...pts.map((e) => e.lifespan)) + 5)], [f.ph, 0]);
  const xt = ticks(Math.min(...xs), Math.max(...xs), 10);
  const yt = ticks(0, y.domain[1], 6);

  // 时代分带（图表 chrome，不是数据系列）
  for (const era of ERAS) {
    const x0 = Math.max(0, x(era.s)), x1 = Math.min(f.pw, x(era.e));
    if (x1 - x0 < 2) continue;
    const idx = ERAS.indexOf(era);
    if (idx % 2 === 0) f.add(el('rect', { x: x0, y: 0, width: x1 - x0, height: f.ph, class: 'era-band', opacity: 0.55 }));
    f.add(el('text', { x: (x0 + x1) / 2, y: -8, class: 'era-label', 'text-anchor': 'middle' }, era.name));
  }
  f.axes({ x, y, xTicks: xt, yTicks: yt, xFmt: fmtYearAxis, yFmt: (v) => `${v}`, xLabel: xKey === 'birth' ? '出生年' : '登基年', yLabel: '享年（岁）' });

  const colorOf = (e) => (e.violent === 1 ? SPL : e.violent === 0 ? UNI : 'var(--muted)');
  for (const e of pts) {
    const cx = x(xKey === 'birth' ? e.birth.t : e.reigns[0].s.t), cy = y(e.lifespan);
    const hollow = e.violent === null;
    const node = el('circle', {
      cx, cy, r: 4, class: 'mark',
      fill: hollow ? 'none' : colorOf(e), stroke: hollow ? colorOf(e) : 'var(--surface-1)',
      'stroke-width': hollow ? 1.5 : 1.6, opacity: 0.9,
    });
    // 命中区大于标记本身
    const hit = el('circle', { cx, cy, r: 11, fill: 'transparent', class: 'mark' });
    hoverable(hit, () => emperorTip(e), () => label(e));
    f.add(node); f.add(hit);
  }

  // 50 年窗口移动平均（按 x 键排序），分「大一统 / 分裂」两条
  const series = [
    { key: 1, color: UNI, label: '大一统王朝（±50年移动平均）' },
    { key: 0, color: SPL, label: '分裂时期（±50年移动平均）' },
  ];
  for (const s of series) {
    const sub = pts.filter((e) => (opts.looseUnified ? e.unifiedLoose : e.unified) === s.key)
      .map((e) => ({ t: xKey === 'birth' ? e.birth.t : e.reigns[0].s.t, v: e.lifespan }))
      .sort((a, b) => a.t - b.t);
    if (sub.length < 6) continue;
    // ±50 年窗口、每 5 年取一点：窗口太窄会把两三个人的偶然差异画成「趋势」
    const path = [];
    for (let t = x.domain[0]; t <= x.domain[1]; t += 5) {
      const win = sub.filter((p) => Math.abs(p.t - t) <= 50);
      if (win.length < 5) { if (path.length && path[path.length - 1] !== null) path.push(null); continue; }
      path.push([t, win.reduce((a, p) => a + p.v, 0) / win.length]);
    }
    let d = '', pen = false;
    for (const p of path) {
      if (!p) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`; pen = true;
    }
    if (d) f.add(el('path', { d, class: 'serie-line', stroke: s.color, opacity: 0.95 }));
  }

  host.appendChild(legend([
    { color: UNI, label: '正常死亡（自然/疾病/意外）', shape: 'dot' },
    { color: SPL, label: '非正常死亡（被杀/战死/自杀）', shape: 'dot' },
    { color: 'var(--muted)', label: '死因不明', shape: 'dot', hollow: true },
    { color: UNI, label: '大一统 ±50 年移动平均', shape: 'line' },
    { color: SPL, label: '分裂 ±50 年移动平均', shape: 'line' },
  ]));
  host.appendChild(notes(['点的大小固定：纵轴已编码寿命，再以半径重复编码同一变量属于双重编码，会掩盖真实差异。']));
  host.appendChild(tableView(
    ['庙号', '朝代', xKey === 'birth' ? '出生年' : '登基年', '享年', '死因', '是否非正常'],
    pts.slice().sort((a, b) => (xKey === 'birth' ? a.birth.t - b.birth.t : a.reigns[0].s.t - b.reigns[0].s.t))
      .map((e) => [e.temple, e.dynasty, fmtYearAxis(xKey === 'birth' ? e.birth.t : e.reigns[0].s.t),
        Math.floor(e.lifespan), e.causeLabel, e.violent === null ? '不明' : e.violent ? '是' : '否']),
    { caption: '历史总时间轴数据表', max: 400 },
  ));
}

// ── 9. 热力图：年代 × 寿命区间 × 人数密度 ─────────────────────────────────
export function renderHeatmap(host, list, opts) {
  host.innerHTML = '';
  const facet = opts.heatFacet !== false;
  const binYears = 100;
  const bins = [[0, 15], [15, 25], [25, 35], [35, 45], [45, 55], [55, 65], [65, 100]];
  const binLabel = (b, i) => (i === 0 ? '＜15' : i === bins.length - 1 ? '65＋' : `${b[0]}–${b[1] - 1}`);

  const pts = list.filter((e) => e.lifespan !== null && e.birth);
  if (!pts.length) { host.appendChild(h('p', { class: 'muted', text: '当前筛选无数据。' })); return; }
  const cLo = Math.floor(Math.min(...pts.map((e) => e.birth.t)) / binYears) * binYears;
  const cHi = Math.ceil(Math.max(...pts.map((e) => e.birth.t)) / binYears) * binYears;
  const cols = [];
  for (let c = cLo; c < cHi; c += binYears) cols.push(c);

  const BLUE = ['--heat-1', '--heat-2', '--heat-3', '--heat-4', '--heat-5'];
  const ORANGE = ['--heat2-1', '--heat2-2', '--heat2-3', '--heat2-4', '--heat2-5'];
  const groups = facet
    ? [{ key: 1, name: '大一统王朝', ramp: BLUE },
       { key: 0, name: '分裂时期',   ramp: ORANGE }]
    : [{ key: null, name: '全部', ramp: BLUE }];

  const counts = groups.map((g) => cols.map((c) => bins.map(() => 0)));
  for (const e of pts) {
    const gi = facet ? groups.findIndex((g) => g.key === (opts.looseUnified ? e.unifiedLoose : e.unified)) : 0;
    if (gi < 0) continue;
    const ci = Math.floor((e.birth.t - cLo) / binYears);
    const bi = bins.findIndex(([a, b]) => e.lifespan >= a && e.lifespan < b);
    if (ci >= 0 && ci < cols.length && bi >= 0) counts[gi][ci][bi]++;
  }
  const maxCount = Math.max(1, ...counts.flat(2));

  // 同上：先入 DOM，Frame 才量得到真实可用宽度
  const wrap = h('div', { class: facet ? 'grid2' : '' });
  host.appendChild(wrap);
  groups.forEach((g, gi) => {
    const box = h('div');
    wrap.appendChild(box);
    box.appendChild(h('h4', { text: g.name, class: 'small', style: 'margin:2px 0 6px;color:var(--text-2)' }));
    const cellW = Math.max(14, Math.min(38, (facet ? 470 : 980) / cols.length));
    const W = cellW * cols.length + 70, H = bins.length * 30 + 54;
    const plot = h('div');                       // Frame 会清空宿主，故另开一层承载
    box.appendChild(plot);
    // 热力图是密度网格，格子太窄就看不出深浅差别，故按列数定下限——
    // 取 14px，与上面 cellW 自己的下限一致，避免在桌面分面里多出一条滚动条
    const f = new Frame(plot, { width: W, height: H, m: { t: 8, r: 10, b: 42, l: 58 },
      minWidth: cols.length * 14 + 68, scaleHeight: false });
    const cw = f.pw / cols.length, ch = f.ph / bins.length;
    cols.forEach((c, ci) => bins.forEach((b, bi) => {
      const n = counts[gi][ci][bi];
      const si = n === 0 ? -1 : Math.min(g.ramp.length - 1, Math.floor((n / maxCount) * (g.ramp.length - 0.001)));
      const rect = el('rect', {
        x: ci * cw + 1, y: (bins.length - 1 - bi) * ch + 1, width: cw - 2, height: ch - 2, rx: 2,
        fill: si < 0 ? 'var(--surface-2)' : `var(${g.ramp[si]})`, class: 'mark',
      });
      hoverable(rect, () => [
        { label: '人数', value: `${n} 位` },
        { label: '出生年代', value: `${fmtYearAxis(c)}–${fmtYearAxis(c + binYears - 1)}` },
        { label: '享年区间', value: `${binLabel(b, bi)} 岁` },
      ], () => g.name);
      f.add(rect);
      if (n > 0 && cw > 17) {
        // 单元格内的数字按填充亮度择色，浅深两套主题下都保证对比度
        f.add(el('text', {
          x: ci * cw + cw / 2, y: (bins.length - 1 - bi) * ch + ch / 2 + 4, 'text-anchor': 'middle',
          'font-size': 10, fill: si >= 2 ? 'var(--surface-1)' : 'var(--text-1)',
        }, String(n)));
      }
    }));
    bins.forEach((b, bi) => f.add(el('text', {
      x: -8, y: (bins.length - 1 - bi) * ch + ch / 2 + 4, class: 'tick', 'text-anchor': 'end',
    }, binLabel(b, bi))));
    cols.forEach((c, ci) => {
      if (cols.length > 14 && ci % 2) return;
      f.add(el('text', { x: ci * cw + cw / 2, y: f.ph + 16, class: 'tick', 'text-anchor': 'end', transform: `rotate(-45 ${ci * cw + cw / 2} ${f.ph + 16})` }, fmtYearAxis(c)));
    });
    f.add(el('text', { x: f.pw / 2, y: f.ph + 38, class: 'axis-label', 'text-anchor': 'middle' }, '出生年代（百年）'));
  });

  // 色阶图例：连续量必须给出刻度，不能只靠悬停
  const scaleRow = h('div', { class: 'legend' });
  for (const g of groups) {
    const item = h('span', { class: 'legend-item' });
    item.appendChild(h('span', { text: `${g.name}　少`, class: 'muted' }));
    for (let i = 0; i < g.ramp.length; i++) {
      const sw = h('span', { class: 'legend-swatch' });
      sw.style.background = `var(${g.ramp[i]})`;
      sw.style.borderRadius = '2px';
      const lo = Math.max(1, Math.ceil((i / g.ramp.length) * maxCount + 0.0001));
      const hi = Math.max(lo, Math.floor(((i + 1) / g.ramp.length) * maxCount));
      sw.title = lo === hi ? `${lo} 人` : `${lo}–${hi} 人`;
      item.appendChild(sw);
    }
    item.appendChild(h('span', { text: `多（最深＝${maxCount} 人）`, class: 'muted' }));
    scaleRow.appendChild(item);
  }
  host.appendChild(scaleRow);
  host.appendChild(h('p', { class: 'muted small', text: `颜色＝人数密度（单一色相，由浅至深五级），两个分面共用同一比例尺；格内数字即为人数，灰底空格表示该年代该寿命区间无人。` }));
  const rows = [];
  groups.forEach((g, gi) => cols.forEach((c, ci) => bins.forEach((b, bi) => {
    if (counts[gi][ci][bi]) rows.push([g.name, `${fmtYearAxis(c)}–${fmtYearAxis(c + binYears - 1)}`, binLabel(b, bi), counts[gi][ci][bi]]);
  })));
  host.appendChild(tableView(['分组', '出生年代', '享年区间', '人数'], rows, { caption: '热力图数据表', max: 300 }));
}

export { fmt1 };
