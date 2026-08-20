// app-map.js — 地图页（map.html）的入口：把库里落得到地上的条目画成一张图。
//
// **这张图的题目不是「中国历史发生在哪」，是「本库哪些条目查得到一个地点」。**
// 两者差得很远，而差在哪里本身就是内容：全库 874 条，能落到地上的只有 82 条。
// 遗址·建筑 69 条里落得下 56 条（81%），文物 159 条只落得下 5 条，
// 战事 103 条、民变 65 条、名人轶事 132 条一条都落不下。
//
// 这不是「战争没有地点」——赤壁、淝水、土木堡当然都有地方。是**维基条目页
// 带不带主坐标**：讲一场仗的页面写的是事，讲一座窟的页面写的是地。
// 所以图上稀疏的那些格子，说的是记录的形状，不是历史的形状。页脚把这句写死了。
//
// 手法全部走 js/plate.js（取自一份 Claude Design 的 plate，未引 d3）：
// 糊开的海岸、羽化、halo 衬底、贪心排版器、经纬网、读数面板。
// 排版器在这里才真正吃劲：八十多个点挤一张图，能标的名字远少于点数，
// 撞满了就不画——**宁可少画一个地名，也不要两个叠在一起**。

import { BASEMAP, project } from './basemap.js';
import {
  el, plateFilters, haloText, LabelSolver, placeCandidates, NUDGES,
  graticulePath, reader, ANCHORS, RIVER_TAGS,
} from './plate.js';
import { GEO_EVENTS } from './geo-events.js';
import { EVENT_KINDS, EVENTS } from './events.js';

const W = BASEMAP.w, H = BASEMAP.h;
const $ = (id) => document.getElementById(id);
const xy = ([lat, lon]) => project(lon, lat);

// 年份写法与全站一致：负数写「前 N」，不写「-N」
const yr = (y) => (y < 0 ? `前 ${-y}` : `${y}`);

const ROWS = Object.entries(GEO_EVENTS)
  .map(([n, v]) => ({ n, ...v }))
  .sort((a, b) => a.y - b.y);

const KINDS = [...new Set(ROWS.map((r) => r.k))]
  .sort((a, b) => ROWS.filter((r) => r.k === b).length - ROWS.filter((r) => r.k === a).length);

const state = {
  off: new Set(),                  // 关掉的类别
  upto: Math.max(...ROWS.map((r) => r.y)),
  pinned: null,
};

const shown = () => ROWS.filter((r) => !state.off.has(r.k) && r.y <= state.upto);

/* ── 画 ────────────────────────────────────────────────────────────────── */

const svg = el('svg', {
  viewBox: `0 0 ${W} ${H}`, class: 'plate-svg',
  preserveAspectRatio: 'xMidYMid meet', role: 'img',
  'aria-label': '本库能落到地上的条目分布图',
});
const defs = el('defs');
const FLT = plateFilters(defs, 'pl');
svg.appendChild(defs);

// 底：经纬网最先，海岸压在它上面
const gGrid = el('g', { class: 'pl-grid' });
gGrid.appendChild(el('path', { d: graticulePath(project, BASEMAP.bbox, 10) }));
const gCoast = el('g');
gCoast.appendChild(el('path', {
  class: 'pl-coast-fuzz', d: BASEMAP.coast, filter: `url(#${FLT.coast})`,
}));
gCoast.appendChild(el('path', { class: 'pl-coast', d: BASEMAP.coast }));
gCoast.appendChild(el('path', { class: 'pl-river', d: BASEMAP.rivers }));
const gRef = el('g', { class: 'pl-ref' });      // 参照城市与河名
const gLink = el('g', { class: 'pl-link' });    // 一条目两点时的连线
const gDot = el('g', { class: 'pl-dots' });
const gLab = el('g', { class: 'pl-labs' });
// 命中区单独一层，压在最上面。三等的点半径 3.4，鼠标都难点中，手指更不必说；
// 故每个点另配一圈看不见的大圆专管点选。字那一层设了 pointer-events: none，
// 不会挡在命中区前面——它是画出来给人看的，不是拿来点的
const gHit = el('g', { class: 'pl-hits' });
svg.append(gGrid, gCoast, gRef, gLink, gDot, gLab, gHit);

const host = $('plate');
host.appendChild(svg);

// 「到时间轴上看这一条」得是**真链接**，不是一句承诺。初版把这句写在说明文字里，
// 而那儿并没有链接可点——图上答不了「这件事前后还有什么」，那本来就是时间轴的活，
// 送过去即可（时间轴认 #ev=<条目名>，见 js/search.js 的 applyHash）
const go = $('plate-go');
const goTo = (name) => {
  go.href = `timeline.html#ev=${encodeURIComponent(name)}`;
  go.hidden = false;
};
const goOff = () => { go.hidden = true; };

const rd = reader($('plate-read'), [
  '这张图',
  '八十二条落点',
  '把指针放到任一点上；点一下钉住。留白的地方不是没发生过事，是那些条目没有地点可查。',
]);

/** 半径：一等的点大，三等的小。**分量决定大小，也决定谁先抢到名字的位置。** */
const rad = (r) => (r === 1 ? 5.4 : r === 2 ? 4.2 : 3.4);

function draw() {
  [gRef, gLink, gDot, gLab, gHit].forEach((g) => { g.innerHTML = ''; });
  const rows = shown();
  // 钉住的那条可能刚被筛掉或被年代滑块挡在外面——松开，别让链接指着一个图上没有的点
  if (state.pinned && !rows.some((r) => r.n === state.pinned)) {
    state.pinned = null; rd.unpin(); goOff();
  }
  const jobs = [];
  const solver = new LabelSolver();

  // ── 参照层：极淡的今日城市与两条河名 ──────────────────────────────
  for (const [name, lat, lon] of ANCHORS) {
    const [x, y] = project(lon, lat);
    const c = el('circle', { class: 'pl-city', cx: x, cy: y, r: 2 });
    gRef.appendChild(c);
    solver.obstacle(c);
    const h = haloText(gRef, name, { size: 10.5, halo: 'var(--surface-2)', haloWidth: 3 });
    h.over.setAttribute('class', 'pl-city-t');
    // **坐标纸先落座**。初版把城市名排在条目名之后，结果八十多个条目名一拥而上，
    // 北京、成都、上海连同黄河、长江全被挤掉——读者面对一堆彩点和一段海岸线，
    // 认不出哪儿是哪儿，而这正是当初加参照层要解决的事
    jobs.push({ h, p: [x, y], pri: 150, cands: placeCandidates('e') });
  }
  for (const [name, lat, lon] of RIVER_TAGS) {
    const [x, y] = project(lon, lat);
    const h = haloText(gRef, name, { size: 12, halo: 'var(--surface-2)', haloWidth: 3.4 });
    h.over.setAttribute('class', 'pl-river-t');
    // 河名不许跑远——跑远了就指着别的河了
    jobs.push({ h, p: [x, y], pri: 200, cands: NUDGES.tight.map(([a, b]) => [a, b, 'middle']) });
  }

  // ── 落点 ────────────────────────────────────────────────────────────
  // 画的次序按分量反过来（三等先落笔、一等压顶），抢名字的次序才是正的
  const byRank = rows.slice().sort((a, b) => b.r - a.r);
  for (const row of byRank) {
    const pts = row['点'];
    if (pts.length > 1) {
      // 一条目两个点（熹平石经：立于洛阳太学，残石在西安碑林等处）。
      // 那条线本身就是这条目要说的事，故画出来
      const a = xy(pts[0]['点']), b = xy(pts[1]['点']);
      gLink.appendChild(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }));
    }
    pts.forEach((q, idx) => {
      const [x, y] = xy(q['点']);
      const dot = el('circle', {
        class: `pl-dot k-${row.k}${q['据'] === 'w' ? ' pl-auto' : ''}${idx ? ' pl-second' : ''}`,
        cx: x, cy: y, r: rad(row.r),
      });
      gDot.appendChild(dot);
      solver.obstacle(dot);          // 挡字的是看得见的那个点，不是命中区
      const hit = el('circle', {
        class: 'pl-hit', cx: x, cy: y, r: Math.max(rad(row.r) * 2.4, 11),
        tabindex: idx ? null : '0', role: idx ? null : 'button',
        'aria-label': `${row.n}，${yr(row.y)}`,
      });
      gHit.appendChild(hit);
      const say = () => rd.hover(
        `${yr(row.y)}　${(EVENT_KINDS[row.k] || {}).label || row.k}`,
        row.n,
        `${q['名']}　·　${q['据'] === 'p' ? '地点经人核定，坐标取自维基' : '坐标取自该条目的维基页'}`
          + (pts.length > 1 ? `　·　本条另有一处：${pts[1 - idx]['名']}` : ''),
      );
      const enter = () => { dot.classList.add('on'); say(); goTo(row.n); };
      const leave = () => { dot.classList.remove('on'); rd.leave(); if (!state.pinned) goOff(); };
      hit.addEventListener('mouseenter', enter);
      hit.addEventListener('focus', enter);
      hit.addEventListener('mouseleave', leave);
      hit.addEventListener('blur', leave);
      if (!idx) {
        const toggle = () => {
          if (state.pinned === row.n) { state.pinned = null; rd.unpin(); goOff(); return; }
          state.pinned = row.n;
          rd.unpin();
          rd.pin(
            `${yr(row.y)}　${(EVENT_KINDS[row.k] || {}).label || row.k}`, row.n,
            `${q['名']}　·　已钉住，再点一下松开`,
          );
          goTo(row.n);
        };
        hit.addEventListener('click', toggle);
        hit.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
      }
    });
    // **只给一等的条目标名字**。初版八十二条全标，排出来七十五个——
    // 一整张图糊满彩字，等于一个都读不进去。剩下的靠悬停读：
    // 读数面板本来就是为「图上放不下的话都归这块」而设的。
    if (row.r === 1) {
      const [lx, ly] = xy(pts[0]['点']);
      const h = haloText(gLab, row.n, {
        size: 12.5, halo: 'var(--surface-2)', haloWidth: 3.6, weight: 600,
      });
      h.over.setAttribute('class', `pl-lab k-${row.k}`);
      // 90，在参照层（河名 200、城市名 150）之下：挤不下的是条目名，不是坐标纸
      jobs.push({ h, p: [lx, ly + 1], pri: 90, cands: placeCandidates('e') });
    }
  }

  for (const j of jobs) {
    solver.job({
      nodes: j.h.nodes, priority: j.pri, candidates: j.cands,
      apply: ([dx, dy, anchor]) => j.h.at(j.p[0] + dx, j.p[1] + dy, anchor || 'middle'),
    });
  }
  const { hidden } = solver.solve();
  // **这行字要随筛选走**。初版把「八十多个名字同时铺开」写死在里面，
  // 于是年代滑到只剩四条时，它还在说八十多个——图上四个点，字却在讲另一张图
  const one = rows.filter((r) => r.r === 1).length;
  const rest = rows.length - one;
  $('plate-tally').textContent =
    `图上 ${rows.length} 条落点，其中一等 ${one} 条标了名字`
    + (hidden ? `（另有 ${hidden} 条一等的与别的字撞位，未标）` : '')
    + (rest ? `；其余 ${rest} 条把指针放上去就读得到。` : '。');
  centreOnce(rows);
}

// 窄屏上图比框宽，进来时默认停在最左边——而最左边是新疆以西的空海。
// 故第一次画完把视口挪到点最密处（横坐标的中位数）。**只做一次**：
// 之后读者自己拖到哪儿是他的事，筛一次类别就把他拽回去是很讨厌的
let centred = false;
function centreOnce(rows) {
  if (centred || !rows.length) return;
  const box = host;
  if (box.scrollWidth <= box.clientWidth + 1) { centred = true; return; }
  const xs = rows.map((r) => xy(r['点'][0]['点'])[0]).sort((a, b) => a - b);
  const mid = xs[Math.floor(xs.length / 2)] / W;          // 0–1
  box.scrollLeft = Math.max(0, mid * box.scrollWidth - box.clientWidth / 2);
  centred = true;
}

/* ── 控件 ──────────────────────────────────────────────────────────────── */

function mountKinds() {
  const bar = $('plate-kinds');
  for (const k of KINDS) {
    const n = ROWS.filter((r) => r.k === k).length;
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
}

function mountYear() {
  const lo = Math.min(...ROWS.map((r) => r.y)), hi = Math.max(...ROWS.map((r) => r.y));
  const sl = $('plate-year'), out = $('plate-year-out');
  sl.min = String(lo); sl.max = String(hi); sl.value = String(hi);
  const sync = () => {
    state.upto = Number(sl.value);
    out.textContent = state.upto >= hi ? '全部' : `截至 ${yr(state.upto)} 年`;
    draw();
  };
  sl.addEventListener('input', sync);
  sync();
}

/** 文里那些「874 条」由脚本按实际数覆盖——手工写死的数字每次增补都会再错一次。 */
for (const node of document.querySelectorAll('[data-il-count=ev]')) {
  node.textContent = String(EVENTS.length);
}

// 主题按钮。本页不走 shell.js（没有筛选、没有章节、没有渲染循环要它管），
// 故这几行是自己的；行为与那边一致：没选过就按系统的反面来
const tt = $('theme-toggle');
tt.addEventListener('click', () => {
  const root = document.documentElement;
  const cur = root.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark'
    : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
  root.setAttribute('data-theme', next);
  tt.textContent = next === 'dark' ? '☀ 浅色' : '🌙 深色';
});

mountKinds();
mountYear();

// 窗口变了不用重排：viewBox 自己缩放，标签的位置是视图单位、不是像素。
// 唯一会变的是字的**实际大小**，而那正是我们想要的——图小了字跟着小
