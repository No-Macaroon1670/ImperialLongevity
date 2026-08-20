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
//
// 图上的字全部走 js/plate.js：**衬底**（同一段字画两遍，底下那遍描一圈纸色粗边）
// 与**排版器**（按优先级逐个试位置，撞上就换，全撞就不画）。
// 之前这两样都没有：城市名压在海岸线上糊成一片，站名又跟城市名叠在一起。
// 排版顺序即优先级——站名 > 河名 > 城市名。城市名是坐标纸，让位是它的本分。

import { BASEMAP, project } from './basemap.js';
import { el, plateFilters, haloText, LabelSolver, placeCandidates, NUDGES } from './plate.js';

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
  // 海岸画两道：底下一道糊开的宽描边，上面一根细线。只留细线的话，
  // 硬边会跟字打架；只留糊边又认不出海岸在哪。stdDeviation 随取景现调（见 fit）
  const defs = el('defs');
  const FLT = plateFilters(defs, 'mm');
  svg.appendChild(defs);
  svg.appendChild(el('path', {
    class: 'mm-coast-fuzz', d: BASEMAP.coast, filter: `url(#${FLT.coast})`,
  }));
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
    // 糊的程度写在用户单位里，viewBox 一缩放就会跟着变。描边有
    // non-scaling-stroke 顶着，滤镜没有，故这里现折算回去
    const b = defs.querySelector('feGaussianBlur');
    if (b) b.setAttribute('stdDeviation', u(0.85).toFixed(2));
  };

  const inView = ([x, y]) => {
    const [vx, vy, vw, vh] = VB;
    const m = vw * 0.04;
    return x > vx + m && x < vx + vw - m && y > vy + m && y < vy + vh - m;
  };

  // 待排的字。每条记：把手、锚点、优先级、可选位置。
  // 位置由 solve() 一次性定——各画各的必然叠，这是 eco-web 那次的教训
  const refJobs = [], nowJobs = [];
  const tag = (g2, name, cls, size, pri, cands) => {
    const h = haloText(g2, name, {
      size, halo: 'var(--surface-1)', haloWidth: u(2.6),
    });
    h.over.setAttribute('class', cls);        // 颜色交给样式表，class 压得过属性
    return { h, pri, cands };
  };

  /** 参照层：视野内的城市与河名。节点只造一次，摆哪儿每次重排。 */
  const drawRef = () => {
    gRef.innerHTML = ''; refJobs.length = 0;
    for (const [name, lat, lon] of ANCHORS) {
      const p = project(lon, lat);
      if (!inView(p)) continue;
      gRef.appendChild(el('circle', { class: 'mm-city', cx: p[0], cy: p[1], r: u(1.6) }));
      refJobs.push({ ...tag(gRef, name, 'mm-city-t', u(6.4), 10,
        placeCandidates('e', u(1))), p });
    }
    // 河名贴在河上，**不能跑远**——跑远了就指着别的地方了，故只微挪
    for (const [name, lat, lon] of RIVER_TAGS) {
      const p = project(lon, lat);
      if (!inView(p)) continue;
      const nudge = NUDGES.tight.map(([dx, dy]) => [u(dx * 0.6), u(dy * 0.6), 'middle']);
      refJobs.push({ ...tag(gRef, name, 'mm-river-t', u(6.8), 50, nudge), p });
    }
  };

  /** 一次把图上所有的字摆好。站名最先落座，城市名最后，撞满了就不画。 */
  const layout = () => {
    const sv = new LabelSolver();
    gNow.querySelectorAll('circle, rect').forEach((n) => sv.obstacle(n));
    gRef.querySelectorAll('circle').forEach((n) => sv.obstacle(n));
    for (const j of refJobs.concat(nowJobs)) {
      j.h.nodes.forEach((n) => n.removeAttribute('display'));   // 上一站藏起来的，这一站重新给机会
      sv.job({
        nodes: j.h.nodes,
        priority: j.pri,
        candidates: j.cands,
        apply: ([dx, dy, anchor]) => j.h.at(j.p[0] + dx, j.p[1] + dy, anchor || 'middle'),
      });
    }
    sv.solve();
  };

  // 全程底稿只画一次：每站取一个代表点（诸说取第一个，只为让读者看见全程的展布）
  const drawAll = () => {
    gAll.innerHTML = '';
    for (const g of (allOf() || [])) {
      if (!g) continue;
      const p = g['点'] || (g['诸说'] && g['诸说'][0] && g['诸说'][0]['点']);
      if (p) {
        const [x, y] = xy(p);
        gAll.appendChild(el('circle', { cx: x, cy: y, r: u(3.2) }));
      }
      if (g['现藏']) {
        const [x, y] = xy(g['现藏']);
        gAll.appendChild(el('circle', { cx: x, cy: y, r: u(3.2) }));
      }
    }
  };

  let drawn = false;
  const show = (ev) => {
    if (innerWidth <= 1000) { wrap.classList.remove('on'); return; }
    const g = ev ? geoOf(ev) : null;
    if (!g) { wrap.classList.remove('on'); return; }      // 没地点就不硬造一个
    if (!drawn) { fit(); drawRef(); drawAll(); drawn = true; }
    gNow.innerHTML = ''; nowJobs.length = 0;
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
      // 地名直接标在点旁：底下那行小字要跨到眼睛外面去才读得到。
      // 优先级给到最高——这一站的名字是**必须**画出来的那个
      if (g['地名']) {
        nowJobs.push({ ...tag(gNow, g['地名'], 'mm-here-t', u(7.6), 100,
          placeCandidates('e', u(1))), p: [x, y] });
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
      // 现藏地也标名字。**图外的不标**：名字钉在框边上，读者会以为东西就在那儿；
      // 虚线方块只说「往那个方向」，那行小字里的「（图外）」才说清楚
      if (!off && g['藏于']) {
        nowJobs.push({ ...tag(gNow, g['藏于'], 'mm-held-t', u(6.8), 80,
          placeCandidates('e', u(1))), p: [hx, hy] });
      }
      const where = g['藏于'] + (off ? '（图外）' : '');
      msg = msg ? `${msg} → 现藏${where}` : `现藏${where}`;
    }
    note.textContent = msg;
    wrap.classList.add('on');      // **必须先显示再排版**：display:none 的字量出来是 0×0
    layout();
  };

  const hide = () => wrap.classList.remove('on');
  const side = (right) => wrap.classList.toggle('mm-left', !right);
  return {
    show, hide, side,
    destroy() { wrap.remove(); },
  };
}
