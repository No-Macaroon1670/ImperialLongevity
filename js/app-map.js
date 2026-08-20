// app-map.js — 地图页（map.html）的入口。
//
// **一条目记全部地方，图上只出主点；点选那个点，链才展开；松开，链收回去。**
// 模型与判据见 docs/geo-model.md，这里只讲画法上的几个决定。
//
// 这张图的题目不是「中国历史发生在哪」，是**本库哪些条目查得到地点**。
// 两者差得很远，而差在哪里本身就是内容：讲一座窟的维基页写的是地，
// 讲一场仗的写的是事。图上留白的地方，说的是记录的形状，不是历史的形状。
//
// 四个画法上的决定，每一个都对着一个具体的两难：
//
//   **挨得近的点要散开，散开就等于说了谎**。一千单位宽的图横跨六十二度经度，
//   挪二十单位就是一百多公里。故散开之后从每个点**拉一根细线回它真正的位置**
//   ——散开是为了点得中、看得见，细线是为了别让读者忘了它本来在哪儿。
//
//   **一处超过八条就不散了**，收成一个带数字的点，**半径随条数长**——
//   点大即那地方事多，这本身是条信息。点开才展成一环。
//
//   **图外的点不画在图上**，硬贴到边上会让读者以为它就在那儿。但方向是真的：
//   链走到图外时，线**朝着那个方向画到视口边缘为止**，在边上标出去处。
//   苏武从长安去了贝加尔湖——图上看不见那个湖，但看得见他往北去了。
//
//   **去与回不能画成一条线**。同一段路来回走，一条线画两遍等于只画了一遍，
//   读者看不出他回来过。故来回两程各自向外错开一点，各带一个箭头。

import { BASEMAP, project } from './basemap.js';
import {
  el, softStroke, haloText, LabelSolver, placeCandidates, NUDGES,
  graticulePath, reader, ANCHORS, RIVER_TAGS,
} from './plate.js';
import { GEO_EVENTS } from './geo-events.js';
import { GEO_DYN } from './geo-dynasties.js';
import { EVENT_KINDS, EVENTS } from './events.js';

const W = BASEMAP.w, H = BASEMAP.h;
const $ = (id) => document.getElementById(id);
const xy = ([lat, lon]) => project(lon, lat);
const yr = (y) => (y < 0 ? `前 ${-y}` : `${y}`);

/* ── 数据 ─────────────────────────────────────────────────────────────── */

const EV_ROWS = Object.entries(GEO_EVENTS).map(([n, v]) => ({ 层: 'ev', n, ...v }));
const DYN_ROWS = Object.entries(GEO_DYN).map(([k, v]) => ({
  层: 'dyn', n: v['名'], key: k, y: v.s, k: 'dyn', r: 2, ...v,
}));
const HAS_DYN = DYN_ROWS.length > 0;
const ALL = EV_ROWS.concat(DYN_ROWS);

const KINDS = [...new Set(EV_ROWS.map((r) => r.k))]
  .sort((a, b) => EV_ROWS.filter((r) => r.k === b).length - EV_ROWS.filter((r) => r.k === a).length);

const YEARS = ALL.map((r) => r.y);
const Y_LO = Math.min(...YEARS), Y_HI = Math.max(...YEARS);

const state = {
  off: new Set(),          // 关掉的类别
  upto: Y_HI,
  layers: new Set(HAS_DYN ? ['ev', 'dyn'] : ['ev']),
  sel: null,               // 选中的条目（链展开）
  open: new Set(),         // 已展开的聚合点
  // 设置（见页面上的「设置」折叠块），都默认开
  aliveOnly: true,         // 都城只画滑块所指年份仍存续的政权
  showLow: true,           // 画低置信的点
  showAuto: true,          // 画自动取的坐标（据 'w'，没人逐条核过）
};

/** 年代滑块对两层的意思不一样，这是有意的：
 *
 * **事件用「截至」**——发生过就发生过了，滑到 1000 年，赤壁之战当然还在图上。
 * **政权用「当时」**——滑到哪年只画那一年还活着的政权。用「截至」的话，
 * 亡了一千年的都城会一直留在图上堆着（商周之际的图上挤满后世方块，
 * 用户实测看见的就是这个），而「此刻并存的政权」正是本站时间轴
 * 「河宽即并存政权数」的同一个读法。滑块拉满（＝不筛）时两层都全画。 */
const shown = () => ALL.filter((r) => state.layers.has(r['层'])
  && (r['层'] !== 'ev' || !state.off.has(r.k))
  && (r['层'] === 'dyn' && state.aliveOnly && state.upto < Y_HI
    ? (r.y <= state.upto && r.e >= state.upto)
    : r.y <= state.upto)
  && (state.showLow || !r['链'][r['主']]['约'])
  && (state.showAuto || r['据'] !== 'w')
  && r['主'] >= 0);

const idOf = (r) => `${r['层']}:${r.n}`;
const trueXY = (r) => xy(r['链'][r['主']]['点']);
const kindLabel = (r) => (r['层'] === 'dyn' ? '政权' : (EVENT_KINDS[r.k] || {}).label || r.k);

/* ── 骨架 ─────────────────────────────────────────────────────────────── */

const svg = el('svg', {
  viewBox: `0 0 ${W} ${H}`, class: 'plate-svg',
  preserveAspectRatio: 'xMidYMid meet', role: 'img',
  'aria-label': '本库能落到地上的条目分布图',
});
const gGrid = el('g', { class: 'pl-grid' });
gGrid.appendChild(el('path', { d: graticulePath(project, BASEMAP.bbox, 10) }));
const gCoast = el('g');
// 柔边用叠描边，**不用滤镜**：feGaussianBlur 的滤镜区域跨整张图，实测滚动时
// 浏览器重绘不过来——图上内容钉住不动、底下的灰块自己在走，上半截被撕掉一条白带
softStroke(gCoast, BASEMAP.coast, 'pl-coast-fuzz');
gCoast.appendChild(el('path', { class: 'pl-coast', d: BASEMAP.coast }));
gCoast.appendChild(el('path', { class: 'pl-river', d: BASEMAP.rivers }));
const gRef = el('g', { class: 'pl-ref' });      // 参照城市与河名
const gLead = el('g', { class: 'pl-leads' });   // 散开之后拉回真位置的细线
const gChain = el('g', { class: 'pl-chain' });  // 选中时展开的链
const gDot = el('g', { class: 'pl-dots' });
const gLab = el('g', { class: 'pl-labs' });
const gHit = el('g', { class: 'pl-hits' });     // 看不见的命中区，压在最上面
svg.append(gGrid, gCoast, gRef, gLead, gChain, gDot, gLab, gHit);
$('plate').appendChild(svg);

const IDLE = ['这张图', '一条目一个点',
  '把指针放到任一点上；点一下展开它去过的地方。留白的地方不是没发生过事，是那些条目没有地点可查。'];
const rd = reader($('plate-read'), IDLE);
const go = $('plate-go');
const goTo = (r) => {
  go.href = r['层'] === 'dyn'
    ? `timeline.html#d=${encodeURIComponent(r.key)}`
    : `timeline.html#ev=${encodeURIComponent(r.n)}`;
  go.hidden = false;
};
const goOff = () => { go.hidden = true; };

/* ── 散开与聚合 ────────────────────────────────────────────────────────
   按**视口上的距离**分组，不按经纬度：北京与十三陵不是同一处，但在全国
   尺度的图上贴在一起，就该散开画。阈值取视图单位，viewBox 固定故等价于屏距。 */

const NEAR = 11;        // 视图单位。约合桌面上 12px、窄屏上 8px
const CAP = 8;          // 一处超过这么多条就收成一个聚合点

function group(rows) {
  const gs = [];
  // 分量大的先占位，小的往它身边靠——聚合点落在哪儿由重要的那几条决定
  for (const r of rows.slice().sort((a, b) => a.r - b.r)) {
    const [x, y] = trueXY(r);
    let hit = null;
    for (const g of gs) {
      if ((g.cx - x) ** 2 + (g.cy - y) ** 2 <= NEAR * NEAR) { hit = g; break; }
    }
    if (hit) {
      hit.rows.push({ r, x, y });
      hit.cx = hit.rows.reduce((s, m) => s + m.x, 0) / hit.rows.length;
      hit.cy = hit.rows.reduce((s, m) => s + m.y, 0) / hit.rows.length;
    } else {
      gs.push({ cx: x, cy: y, rows: [{ r, x, y }] });
    }
  }
  return gs;
}

/** 一组 n 个点摆在哪儿。一个不动；少数摆一圈；多了一圈套一圈。
 *
 * 半径收着给：初版 n=2 也推到十一单位开外，两个点隔着中心遥遥相对，
 * 两根引线连成一条直线，看上去像「这两条有关系」——而它们只是碰巧挨着。
 *
 * **多了就套环**，不要摊成一个大圈：聚合点展开时常有二三十条，
 * 一圈塞二十二个，圈会大到跨过半个华北，而里头的点仍然挨着。
 * 每环最多十个，一环装满再往外开一环。
 */
function spread(g) {
  const n = g.rows.length;
  if (n === 1) { g.rows[0].px = g.rows[0].x; g.rows[0].py = g.rows[0].y; return; }
  const rest = g.rows.slice();
  if (n > 6) { const c = rest.shift(); c.px = g.cx; c.py = g.cy; }
  let ring = 0, i = 0;
  while (i < rest.length) {
    const cap = Math.min(rest.length - i, 6 + ring * 4);
    const rad = 4.6 + 1.45 * Math.min(cap, 6) + ring * 11;
    for (let j = 0; j < cap; j += 1) {
      const th = (-Math.PI / 2) + (2 * Math.PI * j) / cap + (ring % 2 ? Math.PI / cap : 0);
      rest[i + j].px = g.cx + rad * Math.cos(th);
      rest[i + j].py = g.cy + rad * Math.sin(th);
    }
    i += cap;
    ring += 1;
  }
}

/* ── 链 ───────────────────────────────────────────────────────────────── */

/** 线段截到视口矩形内（Liang–Barsky）。**两端都要截**。
 *
 * 初版只截终点，因为想的是「从图内走到图外」。可苏武是去了又回来的：
 * 回程那一段的**起点**在图外，于是那条线从 y = −68 起笔，画在画布外面，
 * 屏上看只剩半截凭空出现的线。返回 [x1,y1,x2,y2,起点被截,终点被截]，
 * 整段都在框外则返回 null。 */
function clipSeg(px, py, qx, qy) {
  const M = 7;                       // 留一点边，箭头不至于被裁掉
  const dx = qx - px, dy = qy - py;
  let t0 = 0, t1 = 1;
  const test = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else {
      if (r < t0) return false; if (r < t1) t1 = r;
    }
    return true;
  };
  if (!test(-dx, px - M) || !test(dx, (W - M) - px)
      || !test(-dy, py - M) || !test(dy, (H - M) - py)) return null;
  return [px + dx * t0, py + dy * t0, px + dx * t1, py + dy * t1, t0 > 0, t1 < 1];
}

/** 从 A 到 B 的**真实初始方位角**（大圆），0 = 正北，顺时针。
 *
 * 图外那一程不能照投影里的方向画。这张图是等距圆柱：费城在经度 −75°，
 * 投影下落在图框左边很远处，于是「西安 → 宾大博物馆」的线指向**正西**
 * ——而从西安去费城，真实的初始方位是东北偏北，从北边过去。
 * 投影里的方向是投影的假象，大圆方位角才是真的。
 * 近处（贝加尔湖在正北）两者一致，远处差得离谱，故一律用后者。
 */
function bearing([lat1, lon1], [lat2, lon2]) {
  const R = Math.PI / 180;
  const f1 = lat1 * R, f2 = lat2 * R, dl = (lon2 - lon1) * R;
  return Math.atan2(Math.sin(dl) * Math.cos(f2),
    Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl));
}

/** 一个箭头，画在 (x,y)，指向角 a。 */
function arrow(g, x, y, a, cls) {
  const L = 9, Wd = 4.4;
  const p = [[x, y],
    [x - L * Math.cos(a) + Wd * Math.sin(a), y - L * Math.sin(a) - Wd * Math.cos(a)],
    [x - L * Math.cos(a) - Wd * Math.sin(a), y - L * Math.sin(a) + Wd * Math.cos(a)]];
  g.appendChild(el('polygon', { class: cls, points: p.map((q) => q.join(',')).join(' ') }));
}

function drawChain(row, ax, ay) {
  gChain.innerHTML = '';
  const jobs = [];
  const chain = row['链'];
  const cls = row['层'] === 'dyn' ? 'k-dyn' : `k-${row.k}`;
  // 主点已被散开挪过位子，链要从它**现在画在哪儿**接出去，否则线会脱开那个点
  const at = (i) => (i === row['主'] ? [ax, ay] : xy(chain[i]['点']));

  if (row['式'] === '诸说') {
    // 诸说不连线——它们不是先后的行迹，是并存的主张。全摆出来，让读者看见
    // 这地方至今没定论；主说实心，其余空心
    chain.forEach((c, i) => {
      if (c['外']) return;
      const [x, y] = at(i);
      if (i !== row['主']) {
        gChain.appendChild(el('circle', { class: `pl-claim ${cls}`, cx: x, cy: y, r: 5 }));
      }
      const h = haloText(gChain, c['名'], { size: 10.5, halo: 'var(--surface-2)', haloWidth: 3.2 });
      h.over.setAttribute('class', 'pl-chain-t');
      jobs.push({ h, p: [x, y], pri: 300 - i, cands: placeCandidates('e') });
    });
    return jobs;
  }

  // 链：逐段画，段末一个箭头。**同一段路来回走的，两程各自向外错开**，
  // 否则第二程盖在第一程上，读者看不出他回来过
  const legs = [];
  for (let i = 0; i + 1 < chain.length; i += 1) legs.push([i, i + 1]);
  const seen = new Map();
  const keyOf = (a, b) => [chain[a]['名'], chain[b]['名']].sort().join(' ');
  legs.forEach(([a, b]) => seen.set(keyOf(a, b), (seen.get(keyOf(a, b)) || 0) + 1));
  const used = new Map();

  legs.forEach(([a, b]) => {
    const key = keyOf(a, b);
    const idx = used.get(key) || 0;
    used.set(key, idx + 1);
    const total = seen.get(key);
    const [px, py] = at(a);
    let [rx, ry] = at(b);
    if (chain[b]['外']) {
      // 图外：按**真实大圆方位角**指出去，不照投影里的方向。屏上北是 −y，
      // 故方位角 θ 对应的方向向量是 (sinθ, −cosθ)。长度取够穿出图框即可
      const th = bearing(chain[a]['点'], chain[b]['点']);
      const far = (W + H) * 2;
      rx = px + far * Math.sin(th);
      ry = py - far * Math.cos(th);
    }
    const ang = Math.atan2(ry - py, rx - px);
    const off = total > 1 ? (idx - (total - 1) / 2) * 7 : 0;   // 只有一程时不挪
    const ox = -Math.sin(ang) * off, oy = Math.cos(ang) * off;
    // 图外：朝真方向画到视口边为止。位置不敢说，方向是真的
    const seg = clipSeg(px + ox, py + oy, rx + ox, ry + oy);
    if (!seg) return;                       // 两端都在框外，这一程画不出来
    const [x1, y1, x2, y2, cutStart, cutEnd] = seg;
    gChain.appendChild(el('line', {
      class: `pl-leg ${cls}${(cutStart || cutEnd) ? ' pl-leg-out' : ''}`, x1, y1, x2, y2,
    }));
    arrow(gChain, x2, y2, Math.atan2(y2 - y1, x2 - x1), `pl-arrow ${cls}`);
    if (cutEnd) {
      // 只在**走出去**那一程的边上标去处；走回来那一程的起点是同一个地方，
      // 再标一遍就是重复
      const h = haloText(gChain, `${chain[b]['名']}（图外）`, {
        size: 10, halo: 'var(--surface-2)', haloWidth: 3.2,
      });
      h.over.setAttribute('class', 'pl-chain-t pl-out-t');
      jobs.push({ h, p: [x2, y2], pri: 290, cands: placeCandidates('w') });
    }
  });

  chain.forEach((c, i) => {
    if (c['外']) return;
    const [x, y] = at(i);
    if (i !== row['主']) {
      gChain.appendChild(el('circle', {
        class: `pl-step ${cls}${c['约'] ? ' pl-low' : ''}`, cx: x, cy: y, r: 4.6,
      }));
    }
    const h = haloText(gChain, `${c['名']}·${c['角']}`, {
      size: 10.5, halo: 'var(--surface-2)', haloWidth: 3.2,
    });
    h.over.setAttribute('class', 'pl-chain-t');
    jobs.push({ h, p: [x, y], pri: 300 - i, cands: placeCandidates('e') });
  });
  return jobs;
}

/* ── 读数 ─────────────────────────────────────────────────────────────── */

function say(row, pin) {
  const chain = row['链'];
  const here = chain[row['主']];
  const bits = [];
  if (row['式'] === '诸说') {
    const others = chain.filter((_, i) => i !== row['主']).map((c) => c['名']);
    bits.push(`${chain.length} 说并存，主说 ${here['名']}`);
    if (others.length) bits.push(`另有：${others.join('、')}`);
  } else if (chain.length > 1) {
    bits.push(chain.map((c) => `${c['名']}·${c['角']}${c['外'] ? '（图外）' : ''}`).join(' → '));
  } else {
    bits.push(`${here['名']}·${here['角']}`);
  }
  if (row['外主'] >= 0) bits.push(`主点其实在${chain[row['外主']]['名']}，出了这张图的范围`);
  if (here['约']) bits.push('今地属推定，故画成半透明');
  if (row['据'] === 'w') bits.push('坐标取自该条目的维基页，没有人核过它是不是这件事发生的地方');
  const kick = row['层'] === 'dyn'
    ? `${yr(row.y)} – ${yr(row.e)}　政权`
    : `${yr(row.y)}　${kindLabel(row)}`;
  if (pin) rd.pin(kick, row.n, bits.join('　·　')); else rd.hover(kick, row.n, bits.join('　·　'));
  goTo(row);
}

/* ── 画 ───────────────────────────────────────────────────────────────── */

let centred = false;

function draw() {
  [gRef, gLead, gChain, gDot, gLab, gHit].forEach((g) => { g.innerHTML = ''; });
  const rows = shown();
  const jobs = [];
  const solver = new LabelSolver();

  // 参照层：极淡的今日城市与两条河名。**坐标纸先落座**——初版把它排在条目名
  // 之后，八十多个条目名一拥而上，北京、成都、上海连同黄河、长江全被挤掉，
  // 读者面对一堆彩点认不出哪儿是哪儿，而这正是当初加参照层要解决的事
  for (const [name, lat, lon] of ANCHORS) {
    const [x, y] = project(lon, lat);
    const c = el('circle', { class: 'pl-city', cx: x, cy: y, r: 2 });
    gRef.appendChild(c);
    solver.obstacle(c);
    const h = haloText(gRef, name, { size: 10.5, halo: 'var(--surface-2)', haloWidth: 3 });
    h.over.setAttribute('class', 'pl-city-t');
    jobs.push({ h, p: [x, y], pri: 150, cands: placeCandidates('e') });
  }
  for (const [name, lat, lon] of RIVER_TAGS) {
    const [x, y] = project(lon, lat);
    const h = haloText(gRef, name, { size: 12, halo: 'var(--surface-2)', haloWidth: 3.4 });
    h.over.setAttribute('class', 'pl-river-t');
    jobs.push({ h, p: [x, y], pri: 200, cands: NUDGES.tight.map(([a, b]) => [a, b, 'middle']) });
  }

  const gs = group(rows);
  let packed = 0, folded = 0, selAt = null;

  for (const g of gs) {
    const gid = `${Math.round(g.cx)},${Math.round(g.cy)}`;
    if (g.rows.length > CAP && !state.open.has(gid)) {
      // 收成一个点，标上条数。**半径随条数长**——点大即那地方事多，
      // 这本身是条信息，不只是「这儿挤」。点开才展成一环
      folded += g.rows.length;
      const R = Math.min(26, 9 + Math.sqrt(g.rows.length) * 2.4);
      const c = el('circle', { class: 'pl-cluster', cx: g.cx, cy: g.cy, r: R });
      gDot.appendChild(c);
      solver.obstacle(c);
      const t = el('text', {
        class: 'pl-cluster-n', x: g.cx, y: g.cy + R * 0.34, 'text-anchor': 'middle',
        'font-size': Math.max(10, R * 0.82),
      });
      t.textContent = String(g.rows.length);
      gDot.appendChild(t);
      const hit = el('circle', {
        class: 'pl-hit', cx: g.cx, cy: g.cy, r: R + 3, tabindex: '0', role: 'button',
        'aria-label': `此处 ${g.rows.length} 条，展开`,
      });
      gHit.appendChild(hit);
      const open = () => { state.open.add(gid); draw(); };
      hit.addEventListener('click', (e) => { e.stopPropagation(); open(); });
      hit.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
      hit.addEventListener('mouseenter', () => rd.hover(
        '此处密集', `${g.rows.length} 条挤在一处`,
        `${g.rows.slice(0, 6).map((m) => m.r.n).join('、')}${g.rows.length > 6 ? ' 等' : ''}　·　点一下摊开`,
      ));
      hit.addEventListener('mouseleave', () => { if (!state.sel) rd.leave(); });
      continue;
    }

    spread(g);
    if (g.rows.length > 1) packed += g.rows.length;

    for (const m of g.rows) {
      const { r } = m;
      const id = idOf(r);
      const cls = r['层'] === 'dyn' ? 'k-dyn' : `k-${r.k}`;
      const low = r['链'][r['主']]['约'];
      // 散开之后拉一根细线回真位置：散开是为了点得中，细线是为了别让读者
      // 忘了它本来在哪儿。挪二十单位在这张图上就是一百多公里
      // 只在挪得够远时才拉引线：挪不到一个点的直径，引线给不出信息，
      // 只添乱——两个点之间的短线会被读成「这两条有关系」
      const moved = Math.hypot(m.px - m.x, m.py - m.y);
      if (moved > 9) {
        gLead.appendChild(el('line', { x1: m.x, y1: m.y, x2: m.px, y2: m.py }));
      }
      const rad = (r.r === 1 ? 5.4 : r.r === 2 ? 4.2 : 3.4) + (r['层'] === 'dyn' ? 0.6 : 0);
      const kls = `pl-dot ${cls}${low ? ' pl-low' : ''}`
        + `${r['层'] === 'dyn' ? ' pl-dyn' : ''}${state.sel === id ? ' on' : ''}`;
      /* **政权都城画成方块。** 都城是一座城、一个座位，方的一眼读得出是另一层；
         再说圆的深灰点跟聚合点撞脸——那也是个深灰的圈 */
      const dot = r['层'] === 'dyn'
        ? el('rect', { class: kls, x: m.px - rad, y: m.py - rad, width: rad * 2, height: rad * 2 })
        : el('circle', { class: kls, cx: m.px, cy: m.py, r: rad });
      gDot.appendChild(dot);
      solver.obstacle(dot);

      const hit = el('circle', {
        class: 'pl-hit', cx: m.px, cy: m.py, r: Math.max(rad * 2.4, 11),
        tabindex: '0', role: 'button', 'aria-label': `${r.n}，${yr(r.y)}`,
      });
      gHit.appendChild(hit);
      const enter = () => { if (!state.sel) { dot.classList.add('hot'); say(r, false); } };
      const leave = () => { dot.classList.remove('hot'); if (!state.sel) { rd.leave(); goOff(); } };
      hit.addEventListener('mouseenter', enter);
      hit.addEventListener('focus', enter);
      hit.addEventListener('mouseleave', leave);
      hit.addEventListener('blur', leave);
      const toggle = () => { state.sel = state.sel === id ? null : id; draw(); };
      hit.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
      hit.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });

      if (state.sel === id) selAt = { r, x: m.px, y: m.py };
      // 只给一等的条目标名字：八十多个名字同时铺开等于一个都读不进去，
      // 其余靠悬停。链展开时全部让位——那时读者要看的是这一条去过哪儿
      /* 只标一等的条目。**但若读者把大事记关了、只留政权这一层**，就给都城全标上
         ——那时它们正是要读的东西，九十三个名字也铺得开 */
      const dynOnly = state.layers.size === 1 && state.layers.has('dyn');
      if (!state.sel && (r.r === 1 || (r['层'] === 'dyn' && dynOnly))) {
        const h = haloText(gLab, r.n, {
          size: r['层'] === 'dyn' ? 11.5 : 12.5, halo: 'var(--surface-2)',
          haloWidth: 3.6, weight: 600,
        });
        h.over.setAttribute('class', `pl-lab ${cls}`);
        jobs.push({ h, p: [m.px, m.py + 1], pri: 90, cands: placeCandidates('e') });
      }
    }
  }

  if (selAt) {
    jobs.push(...drawChain(selAt.r, selAt.x, selAt.y));
    say(selAt.r, true);
  } else if (state.sel) {
    state.sel = null;               // 选中的那条被筛掉了：松开，别留个指着空处的链
    rd.unpin(); goOff();
  }

  for (const j of jobs) {
    solver.job({
      nodes: j.h.nodes, priority: j.pri, candidates: j.cands,
      apply: ([dx, dy, anchor]) => j.h.at(j.p[0] + dx, j.p[1] + dy, anchor || 'middle'),
    });
  }
  const { hidden } = solver.solve();
  tally(rows, gs, packed, folded, hidden);
  centreOnce(rows);
}

/** 这行字要随筛选走：写死「八十多个」的话，年代滑到只剩四条时它还在这么说。 */
function tally(rows, gs, packed, folded, hidden) {
  const bits = [`图上 ${rows.length} 条落点，落在 ${gs.length} 处`];
  if (packed) bits.push(`其中 ${packed} 条挨得太近、已散开画（细线指回它真正的位置）`);
  if (folded) bits.push(`${folded} 条收在聚合点里，点开摊平`);
  if (state.sel) {
    bits.push('已展开一条的行迹；再点一下那个点，或按 Esc，收回去');
  } else {
    const one = rows.filter((r) => r.r === 1).length;
    bits.push(`标了名字的是一等的 ${one} 条${hidden ? `（${hidden} 条撞位未标）` : ''}，其余把指针放上去就读得到`);
  }
  $('plate-tally').textContent = `${bits.join('；')}。`;
}

// 窄屏上图比框宽，进来时默认停在最左边——而最左边是新疆以西的空海。
// 故第一次画完把视口挪到点最密处。**只做一次**：之后读者拖到哪儿是他的事
function centreOnce(rows) {
  if (centred || !rows.length) return;
  const box = $('plate');
  if (box.scrollWidth <= box.clientWidth + 1) { centred = true; return; }
  const xs = rows.map((r) => trueXY(r)[0]).sort((a, b) => a - b);
  box.scrollLeft = Math.max(0, (xs[Math.floor(xs.length / 2)] / W) * box.scrollWidth
    - box.clientWidth / 2);
  centred = true;
}

/* ── 控件 ─────────────────────────────────────────────────────────────── */

function mountKinds() {
  const bar = $('plate-kinds');
  for (const k of KINDS) {
    const n = EV_ROWS.filter((r) => r.k === k).length;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip pl-chip k-${k} on`;
    b.innerHTML = `<span class="pl-swatch"></span>${(EVENT_KINDS[k] || {}).label || k} ${n}`;
    b.addEventListener('click', () => {
      if (state.off.has(k)) state.off.delete(k); else state.off.add(k);
      b.classList.toggle('on', !state.off.has(k));
      draw();
    });
    bar.appendChild(b);
  }
  if (!HAS_DYN) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip pl-chip k-dyn on';
  b.innerHTML = `<span class="pl-swatch"></span>政权都城 ${DYN_ROWS.length}`;
  b.addEventListener('click', () => {
    if (state.layers.has('dyn')) state.layers.delete('dyn'); else state.layers.add('dyn');
    b.classList.toggle('on', state.layers.has('dyn'));
    draw();
  });
  bar.appendChild(b);
}

function mountYear() {
  const sl = $('plate-year'), out = $('plate-year-out');
  sl.min = String(Y_LO); sl.max = String(Y_HI); sl.value = String(Y_HI);
  const sync = () => {
    state.upto = Number(sl.value);
    out.textContent = state.upto >= Y_HI ? '全部'
      : `${yr(state.upto)} 年（事件截至此年，政权取当时并存的）`;
    draw();
  };
  sl.addEventListener('input', sync);
  sync();
}

// 点空处 / 按 Esc = **全收回**：链收回去，展开过的聚合点也收回去。
// 「松开之后图没变回原样」是用户实测指出的——展开的那一环一直留着，
// 读者以为自己没退出来
const collapse = () => {
  if (!state.sel && !state.open.size) return;
  state.sel = null; state.open.clear(); draw();
};
svg.addEventListener('click', collapse);
addEventListener('keydown', (e) => { if (e.key === 'Escape') collapse(); });

/** 各类落得下多少，现算现填。
 *
 * 这一节原本是手写的一串数字，补了一批数据之后**整段全错**——
 * 「文物 159 条落得下 5 条」变成了落得下 7 条，而页上还写着 5。
 * 凡是会随数据变的数字都不该手写，这是本库的通例。 */
function fillCoverage() {
  const host = $('plate-cover');
  if (!host) return;
  const total = {}, got = {};
  for (const e of EVENTS) {
    if (e.k === 'era' && !EVENT_KINDS[e.k]) continue;
    total[e.k] = (total[e.k] || 0) + 1;
  }
  for (const r of EV_ROWS) got[r.k] = (got[r.k] || 0) + 1;
  const rows = Object.keys(total)
    .map((k) => ({ k, t: total[k], g: got[k] || 0 }))
    .sort((a2, b2) => (b2.g / b2.t) - (a2.g / a2.t) || b2.t - a2.t);
  const none = rows.filter((x) => !x.g);
  host.innerHTML = '';
  for (const x of rows.filter((y) => y.g)) {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${(EVENT_KINDS[x.k] || {}).label || x.k}</strong>　`
      + `${x.t} 条落得下 ${x.g} 条（${Math.round((100 * x.g) / x.t)}%）`;
    host.appendChild(li);
  }
  if (none.length) {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${none.map((x) => `${(EVENT_KINDS[x.k] || {}).label || x.k} ${x.t} 条`).join('、')}</strong>`
      + '　一条都落不下';
    host.appendChild(li);
  }
}

/** 文里那些数字由脚本按实际数覆盖——手工写死的每次增补都会再错一次。 */
for (const node of document.querySelectorAll('[data-il-count=ev]')) {
  node.textContent = String(EVENTS.length);
}
for (const node of document.querySelectorAll('[data-il-count=geo]')) {
  node.textContent = String(EV_ROWS.length);
}
for (const node of document.querySelectorAll('[data-il-count=dyn]')) {
  node.textContent = String(DYN_ROWS.length);
}

// 主题按钮。本页不走 shell.js（没有筛选、章节、渲染循环要它管），故这几行是自己的
const tt = $('theme-toggle');
tt.addEventListener('click', () => {
  const root = document.documentElement;
  const cur = root.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark'
    : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
  root.setAttribute('data-theme', next);
  tt.textContent = next === 'dark' ? '☀ 浅色' : '🌙 深色';
});

function mountSettings() {
  const wire = (id, key) => {
    const box = $(id);
    if (!box) return;
    box.addEventListener('change', () => { state[key] = box.checked; draw(); });
  };
  wire('pl-set-alive', 'aliveOnly');
  wire('pl-set-low', 'showLow');
  wire('pl-set-auto', 'showAuto');
}

fillCoverage();
mountKinds();
mountYear();
mountSettings();
