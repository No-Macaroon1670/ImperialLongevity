// charts.js — SVG 图表基元：坐标轴、刻度、图例、悬停提示、表格视图
const NS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, children = []) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
}
export function h(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
}

// ── 比例尺 ───────────────────────────────────────────────────────────────
export function linear([d0, d1], [r0, r1]) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = (v) => r0 + (v - d0) * k;
  f.invert = (v) => (k === 0 ? d0 : d0 + (v - r0) / k);
  f.domain = [d0, d1]; f.range = [r0, r1];
  return f;
}
export function band(keys, [r0, r1], pad = 0.25) {
  const step = (r1 - r0) / Math.max(1, keys.length);
  const bw = step * (1 - pad);
  const idx = new Map(keys.map((k, i) => [k, i]));
  const f = (k) => r0 + idx.get(k) * step + (step - bw) / 2;
  f.bandwidth = bw; f.step = step; f.keys = keys;
  f.center = (k) => f(k) + bw / 2;
  return f;
}
export function ticks(d0, d1, count = 6) {
  if (d0 === d1) return [d0];
  const span = d1 - d0;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(raw))));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const out = [];
  for (let t = Math.ceil(d0 / step) * step; t <= d1 + 1e-9; t += step) out.push(Math.round(t / step) * step);
  return out;
}

// ── 图表框架 ─────────────────────────────────────────────────────────────
export class Frame {
  // 注意：Frame 只往宿主里追加，绝不清空宿主——清空会吞掉调用方刚放进去的分面标题。
  // 各 render 函数在开头自行 host.innerHTML = '' 完成整块重绘。
  constructor(host, { width = 760, height = 340, m = { t: 16, r: 20, b: 44, l: 56 } } = {}) {
    this.m = m;
    this.W = width; this.H = height;
    this.pw = width - m.l - m.r;
    this.ph = height - m.t - m.b;
    this.svg = el('svg', {
      viewBox: `0 0 ${width} ${height}`, class: 'chart-svg',
      preserveAspectRatio: 'xMinYMin meet', role: 'img',
    });
    this.g = el('g', { transform: `translate(${m.l},${m.t})` });
    this.svg.appendChild(this.g);
    host.appendChild(this.svg);
    this.host = host;
  }
  add(node) { this.g.appendChild(node); return node; }
  axes({ x, y, xTicks, yTicks, xFmt = String, yFmt = String, xLabel, yLabel, grid = 'y', xTickRotate = 0 }) {
    const { pw, ph } = this;
    if (grid === 'y' || grid === 'xy') {
      for (const t of yTicks) {
        this.add(el('line', { x1: 0, x2: pw, y1: y(t), y2: y(t), class: 'grid' }));
      }
    }
    if (grid === 'x' || grid === 'xy') {
      for (const t of xTicks) this.add(el('line', { y1: 0, y2: ph, x1: x(t), x2: x(t), class: 'grid' }));
    }
    this.add(el('line', { x1: 0, x2: pw, y1: ph, y2: ph, class: 'axis-line' }));
    for (const t of xTicks) {
      const tx = x(t);
      const lab = el('text', {
        x: tx, y: ph + 18, class: 'tick', 'text-anchor': xTickRotate ? 'end' : 'middle',
        transform: xTickRotate ? `rotate(${xTickRotate} ${tx} ${ph + 18})` : null,
      }, xFmt(t));
      this.add(lab);
    }
    for (const t of yTicks) {
      this.add(el('text', { x: -10, y: y(t) + 4, class: 'tick', 'text-anchor': 'end' }, yFmt(t)));
    }
    if (xLabel) this.add(el('text', { x: pw / 2, y: ph + 40, class: 'axis-label', 'text-anchor': 'middle' }, xLabel));
    if (yLabel) this.add(el('text', { x: -this.m.l + 14, y: -11, class: 'axis-label', 'text-anchor': 'start' }, yLabel));
    return this;
  }
}

// ── 悬停提示 ─────────────────────────────────────────────────────────────
let tipEl = null;
function tip() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tooltip';
    tipEl.setAttribute('role', 'status');
    document.body.appendChild(tipEl);
  }
  return tipEl;
}
export function showTip(evt, rows, title) {
  const t = tip();
  t.innerHTML = '';
  if (title) t.appendChild(h('div', { class: 'tip-title', text: title }));
  for (const r of [].concat(rows)) {
    if (typeof r === 'string') { t.appendChild(h('div', { class: 'tip-note', text: r })); continue; }
    const row = h('div', { class: 'tip-row' });
    if (r.color) row.appendChild(h('span', { class: 'tip-key', style: `background:${r.color}` }));
    row.appendChild(h('span', { class: 'tip-val', text: r.value }));
    row.appendChild(h('span', { class: 'tip-lab', text: r.label }));
    t.appendChild(row);
  }
  t.style.display = 'block';
  moveTip(evt);
}
export function moveTip(evt) {
  const t = tip();
  const pad = 14;
  const w = t.offsetWidth, hh = t.offsetHeight;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
  if (y + hh > window.innerHeight - 8) y = evt.clientY - hh - pad;
  t.style.left = `${Math.max(4, x)}px`;
  t.style.top = `${Math.max(4, y)}px`;
}
export function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

/** 给任意 SVG 节点挂上悬停 + 键盘焦点的等价提示 */
export function hoverable(node, getRows, getTitle) {
  const show = (e) => showTip(e, getRows(), getTitle ? getTitle() : undefined);
  node.addEventListener('pointerenter', show);
  node.addEventListener('pointermove', moveTip);
  node.addEventListener('pointerleave', hideTip);
  node.setAttribute('tabindex', '0');
  node.addEventListener('focus', (e) => {
    const r = node.getBoundingClientRect();
    showTip({ clientX: r.left + r.width / 2, clientY: r.top }, getRows(), getTitle ? getTitle() : undefined);
  });
  node.addEventListener('blur', hideTip);
  return node;
}

// ── 图例 ─────────────────────────────────────────────────────────────────
export function legend(items, { shape = 'rect' } = {}) {
  const wrap = h('div', { class: 'legend' });
  for (const it of items) {
    const sw = h('span', { class: `legend-swatch ${it.shape || shape}` });
    sw.style.background = it.color;
    if (it.hollow) { sw.style.background = 'transparent'; sw.style.boxShadow = `inset 0 0 0 2px ${it.color}`; }
    wrap.appendChild(h('span', { class: 'legend-item' }, [sw, h('span', { text: it.label })]));
  }
  return wrap;
}

/**
 * 折叠的方法说明。
 *
 * 图下方原本堆着四五段口径与偏倚的长文，读者要越过一堵字墙才看得到下一张图。
 * 但这些内容不能删——它们正是「这张图能说什么、不能说什么」的边界。
 * 故一律收进折叠块：图旁只留读图必需的图例与结论数字，长论证一键可展开，
 * 完整版本则见 README。summary 写明内容性质（而非笼统的「更多」），
 * 使读者能判断是否需要展开。
 */
export function notes(items, { label = '口径与已知偏倚' } = {}) {
  const list = [].concat(items).filter(Boolean);
  if (!list.length) return null;
  const det = h('details', { class: 'notes' });
  det.appendChild(h('summary', { text: label }));
  for (const it of list) {
    det.appendChild(typeof it === 'string' ? h('p', { class: 'muted small', text: it }) : it);
  }
  return det;
}

// ── 表格视图（每张图的无障碍孪生） ────────────────────────────────────────
export function tableView(headers, rows, { caption = '数据表', max = 0 } = {}) {
  const det = h('details', { class: 'table-view' });
  det.appendChild(h('summary', { text: `数据表（${rows.length} 行）` }));
  const tbl = h('table');
  tbl.appendChild(h('caption', { text: caption }));
  const thead = h('thead');
  thead.appendChild(h('tr', {}, headers.map((x) => h('th', { text: String(x) }))));
  tbl.appendChild(thead);
  const tb = h('tbody');
  const shown = max ? rows.slice(0, max) : rows;
  for (const r of shown) tb.appendChild(h('tr', {}, r.map((c) => h('td', { text: c === null || c === undefined ? '—' : String(c) }))));
  tbl.appendChild(tb);
  const scroller = h('div', { class: 'table-scroll' }, [tbl]);
  det.appendChild(scroller);
  if (max && rows.length > max) det.appendChild(h('p', { class: 'muted small', text: `仅显示前 ${max} 行` }));
  return det;
}

export const fmtYear = (y) => (y <= 0 ? `前${-y + 1}` : String(Math.round(y)));
export const fmtYearAxis = (y) => (y <= 0 ? `前${-Math.round(y) + 1}` : String(Math.round(y)));
export const fmt1 = (v) => (v === null || v === undefined || !isFinite(v) ? '—' : v.toFixed(1));
export const fmt2 = (v) => (v === null || v === undefined || !isFinite(v) ? '—' : v.toFixed(2));
