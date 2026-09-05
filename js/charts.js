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

/** 文本像素宽的粗估：CJK 与全角标点按 1 em，其余按 0.56 em */
export const textWidth = (s, fs = 11) =>
  [...String(s)].reduce((a, c) => a + (/[一-鿿＀-￯（）]/.test(c) ? 1 : 0.56), 0) * fs;

// 绘图区（去掉左右边距后的净宽）的下限。低于此值，坐标轴刻度会挤成一团、
// 曲线被压成一条竖线——那已经不是「小一点」，而是读不出来。
const MIN_PLOT_W = 180;

export class Frame {
  // 注意：Frame 只往宿主里追加，绝不清空宿主——清空会吞掉调用方刚放进去的分面标题。
  // 各 render 函数在开头自行 host.innerHTML = '' 完成整块重绘。
  //
  // 宽度是**响应式**的：画布按宿主的实际可用宽度铺，上限为设计宽度。
  // 从前的做法是画布恒为 1080、靠 `.chart-svg{width:100%}` 等比压缩，
  // 在 375px 手机上实测缩到 0.27×——11px 的刻度只剩 3px，等于没有。
  // 现在改为重新布局：字号是绝对像素，不随画布缩放，窄屏只是画得窄一些。
  //
  // 下限由边距自动推出而非逐图手调：净绘图区不足 MIN_PLOT_W 时不再收窄，
  // 由 .chart-host 横向滚动接管。因此 Cox 森林图（左边距 250px 放变量名）
  // 在手机上会横向滚动，而 KM 曲线（左边距 56px）能完整铺进 375px。
  // scaleHeight=false 用于高度由行数决定的图（森林图、点图），它们不能按比例压扁。
  constructor(host, { width = 760, height = 340, m = { t: 16, r: 20, b: 44, l: 56 },
                      minWidth = 0, scaleHeight = true } = {}) {
    const avail = Math.floor(host.getBoundingClientRect().width) || width;
    const floor = Math.max(minWidth, m.l + m.r + MIN_PLOT_W);
    const W = Math.round(Math.max(floor, Math.min(width, avail)));
    // 画布变窄时高度同步收一些，否则手机上会得到一张又瘦又高的图；
    // 但绘图区最多只收到设计值的 55%，再低纵向分辨率就不够了。
    const plotH = height - m.t - m.b;
    const k = Math.max(0.55, Math.min(1, W / width));
    const H = scaleHeight && k < 1 ? Math.round(m.t + m.b + plotH * k) : height;

    this.m = m;
    this.W = W; this.H = H;
    this.pw = W - m.l - m.r;
    this.ph = H - m.t - m.b;
    this.narrow = W < width;                 // 供调用方决定是否隐藏次要元素
    this.svg = el('svg', {
      viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart-svg',
      preserveAspectRatio: 'xMinYMin meet', role: 'img',
    });
    this.g = el('g', { transform: `translate(${m.l},${m.t})` });
    this.svg.appendChild(this.g);
    host.appendChild(this.svg);
    this.host = host;
  }
  add(node) { this.g.appendChild(node); return node; }

  /**
   * 刻度标签抽稀：网格线全留（它们不会互相压字），只按标签实际宽度等距抽掉一部分文字。
   * 窄画布下这一步是必需的——否则「前221 前121 前21 79 179…」会糊成一片黑。
   */
  thinTicks(vals, fmt, project, fs = 11) {
    if (vals.length < 2) return vals;
    const gap = Math.abs(project(vals[1]) - project(vals[0]));
    if (!gap) return vals;
    const need = Math.max(...vals.map((t) => textWidth(fmt(t), fs))) + 8;
    const k = Math.max(1, Math.ceil(need / gap));
    return k === 1 ? vals : vals.filter((_, i) => i % k === 0);
  }

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
    // 旋转过的标签不占横向空间，无须抽稀
    for (const t of (xTickRotate ? xTicks : this.thinTicks(xTicks, xFmt, x))) {
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
export function moveTip(evt, above = false) {
  const t = tip();
  const pad = 14;
  const w = t.offsetWidth, hh = t.offsetHeight;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  // 触摸时手指本身压在触点上，提示必须挪到上方，否则被指头挡住
  if (above) { x = evt.clientX - w / 2; y = evt.clientY - hh - 18; }
  if (x + w > window.innerWidth - 8) x = above ? window.innerWidth - w - 8 : evt.clientX - w - pad;
  if (y + hh > window.innerHeight - 8) y = evt.clientY - hh - pad;
  t.style.left = `${Math.max(4, x)}px`;
  t.style.top = `${Math.max(4, y)}px`;
}
export function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

// 触摸设备上「点开的提示」由一个全局监听关闭：再点别处即收起。
// 只装一次，且用捕获阶段，免得被 SVG 节点自己的处理程序吃掉。
let touchDismissArmed = false;
function armTouchDismiss() {
  if (touchDismissArmed) return;
  touchDismissArmed = true;
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && !(e.target instanceof Element && e.target.closest('.mark'))) hideTip();
  }, true);
}

/**
 * 给任意 SVG 节点挂上悬停 + 键盘焦点的等价提示。
 *
 * 触摸设备要单独处理：pointerenter/pointerleave 在触屏上分别对应「手指按下 / 抬起」，
 * 沿用鼠标那套的话，提示只在手指压着的那一瞬存在，而那一瞬它正好被手指遮住——
 * 实测等于手机上完全读不到提示。故触摸时按下即显示、抬起不收，改由点击别处收起。
 */
export function hoverable(node, getRows, getTitle) {
  // 触屏不走 pointerenter：那是手指一落地就来的事件，滚长卷时指尖擦过
  // 任何可点段，提示卡就「自动」弹出（用户 iPad/手机实测）。触屏改为
  // 记下触意、等真正的轻点（click——滚动手势不会触发它）再弹；鼠标照旧悬停。
  let touchArmed = false;
  const show = (e) => {
    if (e.pointerType === 'touch') { touchArmed = true; return; }
    showTip(e, getRows(), getTitle ? getTitle() : undefined);
  };
  node.addEventListener('click', (e) => {
    if (!touchArmed) return;
    touchArmed = false;
    showTip(e, getRows(), getTitle ? getTitle() : undefined);
    moveTip(e, true);
    armTouchDismiss();
  });
  node.addEventListener('pointerenter', show);
  node.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') moveTip(e); });
  node.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') hideTip(); });
  node.setAttribute('tabindex', '0');
  node.addEventListener('focus', () => {
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
    // 形状类加 sw- 前缀:裸的 .dot / .line 太常见,浏览器扩展注入的同名规则
    // 会直接命中我们的元素(用户实测:某返利扩展的 `.dot{position:absolute}`
    // 把图例色点拽出了流,压到文字上)。加前缀即与外界脱钩。
    const sw = h('span', { class: `legend-swatch sw-${it.shape || shape}` });
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

/**
 * 横向滚动提示。
 *
 * 桌面上有滚动条与鼠标滚轮，横向可滚是看得出来的；手机上两者都没有——
 * 一张两万像素宽的时间轴只露出 320px，不说就真的没人会去划。
 * 故仅在「内容确实溢出」且「窄屏」时插入一行提示，其余情况一个字都不多占。
 * 用户一旦划过就把它撤掉：提示的使命到此为止，留着只是噪音。
 */
export function scrollHint(scroller, text = '左右滑动查看完整时间轴') {
  requestAnimationFrame(() => {
    if (window.innerWidth > 720 || scroller.scrollWidth <= scroller.clientWidth + 4) return;
    const hint = h('p', { class: 'muted small scroll-hint', text: `← ${text} →` });
    scroller.parentNode.insertBefore(hint, scroller);
    scroller.addEventListener('scroll', () => hint.remove(), { once: true });
  });
}

/**
 * 带缓动的滚动，时长随距离增长；返回 Promise，到位后 resolve。
 *
 * 全景图是两千年铺开的长卷,从五代跳到南宋是两千余像素的路。瞬移到位省时间,
 * 却把「这中间隔着三百年」一并省掉了——走这段路花掉的时间本身就是尺度感,
 * 而尺度正是这张图要讲的事。故时长按距离加,但封顶,免得跨越全图时读者干等。
 *
 * read/write 由调用方给,于是横滚(scrollLeft)与竖滚(window.scrollY)共用一套。
 * 系统设了「减少动态效果」就直接落位:眩晕比尺度感要紧。
 */
export function glide(read, write, to, { min = 380, max = 1400, perPx = 0.5 } = {}) {
  const from = read();
  const dist = Math.abs(to - from);
  if (dist < 3 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    write(to);
    return Promise.resolve();
  }
  const dur = Math.min(max, min + dist * perPx);
  return new Promise((done) => {
    let t0 = null;
    const step = (ts) => {
      if (t0 === null) t0 = ts;
      const p = Math.min(1, (ts - t0) / dur);
      // easeInOutCubic:起步与到站都慢、中途快——像镜头推移,不像瞬移
      const k = p < 0.5 ? 4 * p * p * p : 1 - ((-2 * p + 2) ** 3) / 2;
      write(from + (to - from) * k);
      if (p < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
}

// 正本迁至 js/year.js（零依赖），此处原样 re-export：十余处 `import { fmtYearAxis } from './charts.js'` 一行不动
export { fmtYearAxis } from './year.js';
export const fmt1 = (v) => (v === null || v === undefined || !isFinite(v) ? '—' : v.toFixed(1));
export const fmt2 = (v) => (v === null || v === undefined || !isFinite(v) ? '—' : v.toFixed(2));
