// plate.js — 制图用的共享零件：滤镜、halo 标签、贪心排版器、经纬网。
//
// 手法取自一份 Claude Design 的 plate（「Monsoon Asia」，Classical 设计系统），
// **但一行 d3 也没抄**。那份稿子用 d3 只做四件事：topojson 转 path、geoMercator、
// geoGraticule、geoContains。本项目的底图路径是预烘焙好的字符串，`project()` 早就有了，
// 经纬网与点在框内都是几十行——为这四样引两个 CDN 依赖，会打掉这个项目
// 「零依赖、无构建、手写 SVG」的立身之本。故只搬手法，不搬库。
//
// 搬过来的四样，每一样都对着本项目一个具体的老毛病：
//
//   **羽化色块 + 不画国界**。原稿用 feMorphology 先把多边形胀开，再 feGaussianBlur
//   羽化，于是色块在内部实、到邻界虚，两块相遇处自然融掉，**一根界线都不画**。
//   本项目底图的抬头写着「国界画法有争议，一张小图没必要卷进去」——这正是那句话的画法。
//
//   **模糊海岸**。海岸不画线，画一道虚开的宽描边。硬线在小图上会跟标签打架。
//
//   **halo 标签**。同一段文字画两遍：底下那遍描一圈纸色粗边（stroke-linejoin: round），
//   上面那遍是正文。压在海岸线上也读得出，且不必给标签垫底板。
//
//   **贪心排版器**。每个标签登记一个 job（节点、优先级、候选偏移、可选的合法性判据），
//   最后一次性按优先级放置：逐个试候选位置，**撞上已占区域就换下一个，全撞就隐藏**。
//   eco-web 那次的结论是「declutter 胜过力导向」——这是那个结论的成品实现：
//   宁可少画一个地名，也不要两个地名叠在一起。

const NS = 'http://www.w3.org/2000/svg';

/* ── 参照层 ──────────────────────────────────────────────────────────────
   只有海岸线与两条河，读者认不出哪儿是哪儿（用户实测指出）。这些是**今天的
   城市**，只用来定位，不参与叙事——故画得极淡，且不进任何数据文件：
   它们不是史料，是给眼睛的坐标纸。两张图共用一份，免得各写各的走样。      */

export const ANCHORS = [
  ['北京', 39.90, 116.40], ['西安', 34.27, 108.95], ['成都', 30.66, 104.07],
  ['广州', 23.13, 113.26], ['上海', 31.23, 121.47], ['乌鲁木齐', 43.83, 87.62],
  ['昆明', 25.04, 102.72], ['沈阳', 41.80, 123.43], ['兰州', 36.06, 103.83],
  ['武汉', 30.59, 114.31], ['台北', 25.03, 121.57], ['重庆', 29.56, 106.55],
  ['长沙', 28.23, 112.94], ['南京', 32.06, 118.80],
];

/** 河名贴在河上：黄河与长江是中国人心里最硬的两条参照线。 */
export const RIVER_TAGS = [['黄河', 37.4, 110.5], ['长江', 30.2, 108.6]];

export const el = (n, a = {}) => {
  const e = document.createElementNS(NS, n);
  for (const k in a) if (a[k] != null) e.setAttribute(k, a[k]);
  return e;
};

/* ── 滤镜 ────────────────────────────────────────────────────────────────
   一次性挂进 <defs>。id 带前缀，同页多张图不会互相抢。                     */

export function plateFilters(defs, prefix = 'pl') {
  const ids = {
    coast: `${prefix}-fuzz-coast`,
    feather: `${prefix}-feather`,
  };

  // 海岸：一道虚开的宽描边。stdDeviation 2 是原稿的值，在 1000px 宽的图上正好
  const fc = el('filter', {
    id: ids.coast, x: '-30%', y: '-30%', width: '160%', height: '160%',
  });
  fc.appendChild(el('feGaussianBlur', { stdDeviation: 2 }));
  defs.appendChild(fc);

  // 政区色块：**先胀后糊**。只糊不胀会把色块吃瘦一圈，接缝处露出底纸；
  // 先 dilate 2.2 再 blur 4，色块守得住内部，只在边缘虚掉
  const ft = el('filter', {
    id: ids.feather, x: '-40%', y: '-40%', width: '180%', height: '180%',
  });
  ft.appendChild(el('feMorphology', { operator: 'dilate', radius: 2.2 }));
  ft.appendChild(el('feGaussianBlur', { stdDeviation: 4 }));
  defs.appendChild(ft);

  return ids;
}

/** 不用滤镜的柔边：同一条路径叠几道由宽到窄、由淡到浓的描边。
 *
 * **大图上不要用 feGaussianBlur。** 那个滤镜的区域跨了整张图，实测滚动时
 * 浏览器重绘不过来：图上的内容钉在原地不动，底下那块灰底自己在走，
 * 上半截被撕掉一条白带。小地图（258px）没事，一千单位宽的整页图必出。
 * 叠描边是纯几何，没有滤镜区域，效果差不多而哪儿都不会翻车。
 *
 * `layers` 从宽到窄，每层 [宽度, 不透明度]。
 */
export function softStroke(g, d, cls, layers = [[7, 0.13], [4.4, 0.17], [2.6, 0.22]]) {
  for (const [w, o] of layers) {
    g.appendChild(el('path', {
      class: cls, d, fill: 'none', 'stroke-width': w, 'stroke-opacity': o,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
  }
}

/* ── 湖面 ────────────────────────────────────────────────────────────────
   （2026-08-26 底图水系扩建案）四个风格化大湖，只画面、不画名。

   **层序必须是：海岸之上、河之下。** 湖在这张图上是水系的「结」——长江串起
   洞庭与鄱阳，淮河进洪泽——河压在湖上，读者才看得出那个「过」字；反过来让湖
   盖住河，长江就像是流到洞庭为止。调用方按 appendChild 的先后自己排，
   这个函数不管层序，只负责造那一层。

   不画湖名：地名一多就得进排版器抢位置，而山名河名已经在抢了，湖名不是这张图
   要讲的事。形心 `c` 照样烘进了数据里，日后要标名不必重跑构建。

   每条路径带 data-lake=中文名，好让「留哪几个湖」这种取舍能在 CSS 里试，
   不必为了看一眼少一个湖的样子去重跑一次构建。                              */

export function lakeLayer(parent, lakes, cls) {
  const g = el('g', { class: `${cls}s` });
  for (const lk of (lakes || [])) {
    g.appendChild(el('path', { class: cls, d: lk.d, 'data-lake': lk.n }));
  }
  parent.appendChild(g);
  return g;
}

/* ── halo 标签 ───────────────────────────────────────────────────────────
   返回一个把两遍文字当一个东西挪的把手。                                   */

export function haloText(g, text, opts = {}) {
  const {
    size = 11, fill = 'currentColor', italic = false, weight = null,
    family = null, tracking = null, halo = 'var(--paper, #fff)', haloWidth = 3,
    opacity = null,
  } = opts;
  const mk = (isHalo) => {
    const t = el('text', {
      'font-size': size,
      'font-family': family,
      'font-style': italic ? 'italic' : null,
      'font-weight': weight,
      'letter-spacing': tracking,
      fill: isHalo ? halo : fill,
      opacity: isHalo ? 0.85 : opacity,
      stroke: isHalo ? halo : null,
      'stroke-width': isHalo ? haloWidth : null,
      'stroke-linejoin': isHalo ? 'round' : null,
      'paint-order': isHalo ? 'stroke' : null,
    });
    t.textContent = text;
    g.appendChild(t);
    return t;
  };
  const under = mk(true);
  const over = mk(false);
  return {
    over, nodes: [under, over],
    at(x, y, anchor = 'middle') {
      [under, over].forEach((t) => {
        t.setAttribute('x', x); t.setAttribute('y', y);
        t.setAttribute('text-anchor', anchor);
      });
      return this;
    },
    transform(tr) {
      [under, over].forEach((t) => t.setAttribute('transform', tr));
      return this;
    },
    paint(c) { over.setAttribute('fill', c); return this; },
    remove() { [under, over].forEach((t) => t.remove()); },
  };
}

/* ── 候选位置 ────────────────────────────────────────────────────────────
   八个方位 × 两档距离。preferred 排在最前，其余依次退让。                   */

export const SIDES = {
  e: [7, 4, 'start'], w: [-7, 4, 'end'], n: [0, -9, 'middle'], s: [0, 15, 'middle'],
  ne: [6, -6, 'start'], nw: [-6, -6, 'end'], se: [6, 14, 'start'], sw: [-6, 14, 'end'],
};
const SIDE_ORDER = ['e', 'w', 'n', 's', 'ne', 'nw', 'se', 'sw'];

export function placeCandidates(preferred = 'e', scale = 1) {
  const order = [preferred, ...SIDE_ORDER.filter((s) => s !== preferred)];
  const out = [];
  for (const k of [1, 1.9]) {
    for (const s of order) {
      const [dx, dy, anchor] = SIDES[s];
      out.push([
        Math.round(dx * k * scale),
        Math.round(dy * (k > 1 ? 1.5 : 1) * scale),
        anchor,
      ]);
    }
  }
  return out;
}

/** 面状名（山脉、海域）不该跑远——跑远了就是事实错误。故偏移量小且按距离排序。 */
export function drift(xs, ys) {
  const out = [];
  for (const dx of xs) for (const dy of ys) out.push([dx, dy]);
  return out.sort(
    (a, b) => (Math.abs(a[0]) * 0.7 + Math.abs(a[1])) - (Math.abs(b[0]) * 0.7 + Math.abs(b[1])),
  );
}
export const NUDGES = {
  tight: drift([0, -9, 9, -18, 18], [0, -9, 9]),
  open: drift([0, -14, 14, -28, 28], [0, -12, 12, -24, 24]),
};

/* ── 贪心排版器 ──────────────────────────────────────────────────────────
   用法：
       const s = new LabelSolver();
       s.obstacle(markNode);                       // 点、符号：永远占位
       s.job({ nodes, priority, candidates, apply, validate, must });
       s.solve();                                  // 必须在元素已入 DOM 之后

   `apply(cand)` 负责把标签摆到那个候选位；排版器只管量框、判撞、决定用哪个。
   全部候选都撞 → 隐藏。**宁可少画一个地名，也不要两个叠在一起。**

   `must: true` 是**保底档**，给「掉了就是错、不是丑」的那种字：地图上的序号
   掉一个，读者就跟长文左栏的行程条对不上号了。撞满时它不藏，退回第一个
   合法候选位硬摆上去（叠一点也认），并照样入账，免得后面的字再叠上来。
   solve() 的回执里 `forced` 报的就是这种。缺省 false，老调用方一行不必改。 */

export class LabelSolver {
  constructor() { this.jobs = []; this.obstacles = []; }

  obstacle(node) { if (node) this.obstacles.push(node); return this; }
  job(j) { this.jobs.push(j); return this; }

  static rectOf(nodes) {
    let r = null;
    for (const n of nodes) {
      if (!n || !n.getBoundingClientRect) continue;
      const b = n.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      r = r
        ? { l: Math.min(r.l, b.left), t: Math.min(r.t, b.top),
            x: Math.max(r.x, b.right), y: Math.max(r.y, b.bottom) }
        : { l: b.left, t: b.top, x: b.right, y: b.bottom };
    }
    return r;
  }

  static hits(a, b) {
    return !!a && !!b && a.l < b.x - 1 && b.l < a.x - 1 && a.t < b.y - 1 && b.t < a.y - 1;
  }

  /** 压掉多少面积。只有保底档用得着：撞满时得比较「哪个候选位压得最少」。 */
  static overlap(a, b) {
    if (!a || !b) return 0;
    const w = Math.min(a.x, b.x) - Math.max(a.l, b.l);
    const h = Math.min(a.y, b.y) - Math.max(a.t, b.t);
    return w > 0 && h > 0 ? w * h : 0;
  }

  solve() {
    const taken = this.obstacles.map((n) => LabelSolver.rectOf([n])).filter(Boolean);
    // 高优先级先落座；同优先级按登记顺序
    const jobs = this.jobs.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
    let hidden = 0;
    let forced = 0;
    for (const job of jobs) {
      let seated = false;
      for (const cand of job.candidates) {
        if (job.validate && !job.validate(cand)) continue;
        job.apply(cand);
        const r = LabelSolver.rectOf(job.nodes);
        if (!r) { seated = true; break; }        // 量不出框（未渲染）就放过
        if (!taken.some((t) => LabelSolver.hits(r, t))) { taken.push(r); seated = true; break; }
      }
      // 保底档：撞满也得画。取**压得最少**的那个合法候选位——不是死取第一个：
      // 两站同址时（碑帖线的开封禁中两帖、书归线的北京两库）死取第一个会让两个
      // 序号一模一样地叠在同一处，那比掉号还难认。validate 仍然算数：硬摆是允许
      // 叠字，不是允许出框；出了框会被 viewBox 裁掉半个字，那不叫保底
      if (!seated && job.must) {
        let best = null, least = Infinity;
        for (const cand of job.candidates) {
          if (job.validate && !job.validate(cand)) continue;
          job.apply(cand);
          const r = LabelSolver.rectOf(job.nodes);
          const area = r ? taken.reduce((s, t) => s + LabelSolver.overlap(r, t), 0) : 0;
          if (area < least) { least = area; best = cand; if (!area) break; }
        }
        best = best || job.candidates[0];
        if (best) {
          job.apply(best);
          const r = LabelSolver.rectOf(job.nodes);
          if (r) taken.push(r);
          seated = true;
          forced += 1;
        }
      }
      if (!seated) {
        job.nodes.forEach((n) => n && n.setAttribute('display', 'none'));
        hidden += 1;
      }
    }
    return { placed: jobs.length - hidden, hidden, forced };
  }
}

/* ── 经纬网 ──────────────────────────────────────────────────────────────
   自己生成，不用 d3.geoGraticule。等距圆柱投影下经线纬线都是直线，
   但仍按 step/4 打点，好让将来换投影时不必重写。                            */

export function graticulePath(project, bbox, step = 10, dense = 4) {
  const [w, s, e, n] = bbox;
  const d = [];
  const line = (pts) => {
    d.push('M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L'));
  };
  const start = (v) => Math.ceil(v / step) * step;
  for (let lon = start(w); lon <= e; lon += step) {
    const pts = [];
    for (let lat = s; lat <= n + 1e-9; lat += step / dense) pts.push(project(lon, Math.min(lat, n)));
    line(pts);
  }
  for (let lat = start(s); lat <= n; lat += step) {
    const pts = [];
    for (let lon = w; lon <= e + 1e-9; lon += step / dense) pts.push(project(Math.min(lon, e), lat));
    line(pts);
  }
  return d.join('');
}

/** 一条纬线，用来画北回归线一类的特殊线。 */
export function parallelPath(project, bbox, lat, dense = 40) {
  const [w, , e] = bbox;
  const pts = [];
  for (let i = 0; i <= dense; i += 1) pts.push(project(w + ((e - w) * i) / dense, lat));
  return 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L');
}

/* ── 读数面板 ────────────────────────────────────────────────────────────
   悬停读、点击钉住。原稿的交互，值得照搬：地图上放不下的话，都归这块。      */

export function reader(root, idle) {
  const kicker = root.querySelector('[data-read=kicker]');
  const title = root.querySelector('[data-read=title]');
  const note = root.querySelector('[data-read=note]');
  let pinned = false;
  const set = (k, t, n, muted) => {
    if (kicker) kicker.textContent = k;
    if (title) title.textContent = t;
    if (note) { note.textContent = n; note.classList.toggle('idle', !!muted); }
  };
  const rest = () => set(idle[0], idle[1], idle[2], true);
  rest();
  return {
    hover(k, t, n) { if (!pinned) set(k, t, n, false); },
    leave() { if (!pinned) rest(); },
    pin(k, t, n) { pinned = true; set(k, t, n, false); },
    unpin() { pinned = false; rest(); },
    get pinned() { return pinned; },
  };
}
