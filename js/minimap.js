// minimap.js — 故事线走到哪儿了，在地上是哪儿。
//
// 只在宽屏出现，贴在讲解坞**对角**的那个角上：讲解在左下，它就去右下；
// 讲解被挤到右边（dock-right），它就换到左边。窄屏没有这个角可用，整块隐藏。
//
// 它回答的是时间轴回答不了的一个问题：石窟线那十一站在图上只是十一个年份，
// 在地上却是一条自西向东的路——拜城、敦煌、天水、大同、洛阳。文字讲「佛教东传」，
// 地图上那个点真的在往东挪。
//
// **一站不一定一个点**（见 js/geo.js）：
//   · 确定的一处 → 实心点
//   · 诸说（隆中两说、赤壁七说）→ 若干空心点 ＋ 一行「N 说」。
//     本库通例是各源不一致就一个都不给；地图上「不给」不是空白，
//     而是把候选全摆出来，让读者自己看见这地方至今没定论。
//   · 文物的现藏地 → 一条细线从出处连到现藏，末端一个空心方块。
//     《金刚经》从敦煌连到伦敦，《前赤壁赋》从黄州连到台北——
//     那条线本身就是这两条线各自的落点。
//   · 没有地点的站（《三国演义》成书）→ 整块淡出，不硬编一个点。
//
// 底图只有海岸线与黄河长江，没有国界（理由见 tools/mining/build_basemap.py）。

import { BASEMAP, project } from './basemap.js';

// 参照点。只有海岸线与两条河，读者认不出哪儿是哪儿（用户实测指出）。
// 这些是**今天的城市**，只用来定位，不参与叙事——故画得极淡，且不进
// 任何数据文件：它们不是史料，是给眼睛的坐标纸。
// 取在视野内的才画，所以全国尺度上出七八个，放大到长江中游只剩两三个。
const ANCHORS = [
  ['北京', 39.90, 116.40], ['西安', 34.27, 108.95], ['成都', 30.66, 104.07],
  ['广州', 23.13, 113.26], ['上海', 31.23, 121.47], ['乌鲁木齐', 43.83, 87.62],
  ['昆明', 25.04, 102.72], ['沈阳', 41.80, 123.43], ['兰州', 36.06, 103.83],
  ['武汉', 30.59, 114.31], ['台北', 25.03, 121.57], ['重庆', 29.56, 106.55],
  ['长沙', 28.23, 112.94], ['南京', 32.06, 118.80],
];
// 河名贴在河上：黄河与长江是中国人心里最硬的两条参照线
const RIVER_TAGS = [['黄河', 37.4, 110.5], ['长江', 30.2, 108.6]];

const NS = 'http://www.w3.org/2000/svg';
const el = (n, a = {}) => {
  const e = document.createElementNS(NS, n);
  for (const k in a) e.setAttribute(k, a[k]);
  return e;
};

/**
 * @param geoOf  (ev) => 该站的地理项（js/geo.js 的一条），可返回 null
 * @param allOf  () => 本线全部站的地理项数组，用来画淡淡的全程底稿
 */
export function mountMinimap(geoOf, allOf) {
  const wrap = document.createElement('div');
  wrap.className = 'minimap';
  wrap.setAttribute('aria-hidden', 'true');      // 纯辅助图形，读屏不必念
  // 取景**按每条线自己的范围**，不用固定的全国框。理由：石窟线从拜城铺到大足，
  // 全国框正合适；赤壁线除台北外全在长江中游，全国框里七说会挤成一个点，
  // 而「七说」正是那一站要给读者看的东西。故按本线全部点算包围盒再留边。
  const svg = el('svg', { preserveAspectRatio: 'xMidYMid meet' });
  let VB = [0, 0, BASEMAP.w, BASEMAP.h];      // 定好之后放点、算半径都用它
  svg.appendChild(el('path', { class: 'mm-coast', d: BASEMAP.coast }));
  svg.appendChild(el('path', { class: 'mm-river', d: BASEMAP.rivers }));
  const gRef = el('g', { class: 'mm-ref' });     // 参照：城市与河名
  const gAll = el('g', { class: 'mm-all' });     // 全程：淡点
  const gNow = el('g', { class: 'mm-now' });     // 本站：亮
  svg.append(gRef, gAll, gNow);
  const note = document.createElement('div');
  note.className = 'mm-note';
  wrap.append(svg, note);
  document.body.appendChild(wrap);

  const xy = ([lat, lon]) => project(lon, lat);   // geo 存的是 [纬, 经]

  // 底图只覆盖中国范围，而现藏地可能在境外（《金刚经》在伦敦）。
  // 两条路都不好：把图拉到欧亚大陆，中国这边就细得看不见；
  // 直接不画，又把整条线的落点抹掉了——那卷经**离境**这件事正是石窟线的结尾。
  // 故：境外点不参与取景，画的时候贴到图框边上，另标「图外」。
  const inFrame = ([lat, lon]) => {
    const [w, s0, e, n] = BASEMAP.bbox;
    return lon >= w && lon <= e && lat >= s0 && lat <= n;
  };

  /** 本线用到的全部**框内**点，用来定取景框。 */
  const everyPoint = () => {
    const out = [];
    for (const g of (allOf() || [])) {
      if (!g) continue;
      if (g['点'] && inFrame(g['点'])) out.push(g['点']);
      for (const s of (g['诸说'] || [])) if (s['点'] && inFrame(s['点'])) out.push(s['点']);
      if (g['现藏'] && inFrame(g['现藏'])) out.push(g['现藏']);
    }
    return out;
  };

  /** 落在取景框外的点，贴到边上。返回 [x, y, 是否图外]。 */
  const clamp = ([x, y]) => {
    const [vx, vy, vw, vh] = VB;
    const m = u(9);                            // 贴边留一点，别被裁掉一半
    const cx = Math.min(Math.max(x, vx + m), vx + vw - m);
    const cy = Math.min(Math.max(y, vy + m), vy + vh - m);
    return [cx, cy, cx !== x || cy !== y];
  };

  // 屏上想要多大就写多大，再折算回视图单位——viewBox 一缩放，
  // 写死的半径就会跟着变；点在石窟线上正好，到赤壁线上就成了一团
  const PX = 258;                              // 与 CSS 里的宽度一致
  const u = (px) => (px * VB[2]) / PX;

  const fit = () => {
    const pts = everyPoint().map(xy);
    if (!pts.length) return;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    // 最小跨度：一条线若只落在一座城，别把地图放大到街道
    const MIN = 150;
    const w0 = Math.max(x1 - x0, MIN), h0 = Math.max(y1 - y0, MIN * 0.62);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const pad = 1.35;                          // 留边：点不该贴着框
    let w = w0 * pad, h = h0 * pad;
    if (w / h < 1000 / 630) w = h * (1000 / 630); else h = w * (630 / 1000);
    VB = [cx - w / 2, cy - h / 2, w, h];
    svg.setAttribute('viewBox', VB.join(' '));
  };

  const inView = ([x, y]) => {
    const [vx, vy, vw, vh] = VB;
    const m = vw * 0.04;
    return x > vx + m && x < vx + vw - m && y > vy + m && y < vy + vh - m;
  };

  /** 参照层：视野内的城市与河名。只画一次，随取景定。 */
  const drawRef = () => {
    gRef.innerHTML = '';
    for (const [name, lat, lon] of ANCHORS) {
      const p = project(lon, lat);
      if (!inView(p)) continue;
      gRef.appendChild(el('circle', { class: 'mm-city', cx: p[0], cy: p[1], r: u(1.6) }));
      const t = el('text', { class: 'mm-city-t', x: p[0] + u(3), y: p[1] + u(2.6),
        'font-size': u(6.4) });
      t.textContent = name;
      gRef.appendChild(t);
    }
    for (const [name, lat, lon] of RIVER_TAGS) {
      const p = project(lon, lat);
      if (!inView(p)) continue;
      const t = el('text', { class: 'mm-river-t', x: p[0], y: p[1], 'font-size': u(6.8) });
      t.textContent = name;
      gRef.appendChild(t);
    }
  };

  // 全程底稿只画一次：每站取一个代表点（诸说取第一个，只为让读者看见全程的展布）
  const drawAll = () => {
    gAll.innerHTML = '';
    for (const g of (allOf() || [])) {
      if (!g) continue;
      const p = g['点'] || (g['诸说'] && g['诸说'][0] && g['诸说'][0]['点']);
      if (p) {
        const [x, y] = xy(p);
        gAll.appendChild(el('circle', { cx: x, cy: y, r: u(2.6) }));
      }
      if (g['现藏']) {
        const [x, y] = xy(g['现藏']);
        gAll.appendChild(el('circle', { cx: x, cy: y, r: u(2.6) }));
      }
    }
  };

  let drawn = false;
  const show = (ev) => {
    if (innerWidth <= 1000) { wrap.classList.remove('on'); return; }
    const g = ev ? geoOf(ev) : null;
    if (!g) { wrap.classList.remove('on'); return; }      // 没地点就不硬造一个
    if (!drawn) { fit(); drawRef(); drawAll(); drawn = true; }
    gNow.innerHTML = '';
    let msg = '';
    if (g['诸说']) {
      for (const s of g['诸说']) {
        const [x, y] = xy(s['点']);
        gNow.appendChild(el('circle', { class: 'mm-maybe', cx: x, cy: y, r: u(4.5) }));
      }
      msg = `${g['诸说'].length} 说并存`;
    }
    if (g['点']) {
      const [x, y] = xy(g['点']);
      gNow.appendChild(el('circle', { class: 'mm-here', cx: x, cy: y, r: u(4.5) }));
      // 地名直接标在点旁：底下那行小字要跨到眼睛外面去才读得到
      if (g['地名']) {
        const t = el('text', { class: 'mm-here-t', x: x + u(6), y: y + u(3),
          'font-size': u(7.6) });
        t.textContent = g['地名'];
        gNow.appendChild(t);
      }
      msg = g['地名'] || '';
    }
    if (g['现藏']) {
      const [hx, hy, off] = clamp(xy(g['现藏']));
      const from = g['点'] || (g['诸说'] && g['诸说'][0] && g['诸说'][0]['点']);
      if (from) {
        const [fx, fy] = clamp(xy(from));
        gNow.appendChild(el('line', { class: 'mm-flow', x1: fx, y1: fy, x2: hx, y2: hy }));
      }
      gNow.appendChild(el('rect', {
        class: 'mm-held' + (off ? ' mm-off' : ''),
        x: hx - u(4), y: hy - u(4), width: u(8), height: u(8),
      }));
      const where = g['藏于'] + (off ? '（图外）' : '');
      msg = msg ? `${msg} → 现藏${where}` : `现藏${where}`;
    }
    note.textContent = msg;
    wrap.classList.add('on');
  };

  const hide = () => wrap.classList.remove('on');
  const side = (right) => wrap.classList.toggle('mm-left', !right);
  return {
    show, hide, side,
    destroy() { wrap.remove(); },
  };
}
