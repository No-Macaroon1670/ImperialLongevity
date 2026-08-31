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
import { norm as searchNorm, withPy as searchWithPy, scoreKeys as searchScore } from './search-core.js';
import {
  el, softStroke, haloText, lakeLayer, LabelSolver, placeCandidates, NUDGES,
  graticulePath, reader, ANCHORS, RIVER_TAGS, LAKE_TAGS,
} from './plate.js';
import { GEO_EVENTS } from './geo-events.js';
import { GEO_DYN } from './geo-dynasties.js';
import { EVENT_KINDS, EVENTS } from './events.js';
import { evSpec, mountEmbedCard, mdBold } from './knowledge.js';
import { buildLineCatalog } from './line-catalog.js';
import { TERR } from './territories.js';
import { syncCounts } from './counts.js';
import { LINES } from './lines.js';
import { DYNASTIES } from './dynasties.js';
import { WORLDMAP, projectWorld } from './basemap-world.js';

// 世界图双版（库主三答定案 2026-08-24，点火 2026-08-31）：W/H 随版切换，
// 中国版一切不动，世界版只画「有境外落点」的合格条目
let W = BASEMAP.w, H = BASEMAP.h;
const $ = (id) => document.getElementById(id);
const xy = ([lat, lon]) => (state.world ? projectWorld(lon, lat) : project(lon, lat));
// 天文纪年→前N：**须加一**（-6999＝前7000）。此处原漏加，全图公元前年份
// 显示皆晚一年，史前三条入库时撞出（2026-08-31）；正本口径见 charts.fmtYearAxis
const yr = (y) => (y <= 0 ? `前 ${-y + 1}` : `${y}`);

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
  // 「全部」用 Infinity 而非 Y_HI：末年（1911）有好几件事，等密标尺上并排好几步，
  // 若以 upto>=Y_HI 当「全部」，拖到末年即提前放开「当时」滤镜——1911 与全部必须两回事
  upto: Infinity,
  // 都城层默认关（用户拍板）：初见先读事件；点图例「政权都城」或选中政权时再亮
  layers: new Set(['ev']),
  sel: null,               // 选中的条目（链展开）
  open: new Set(),         // 已展开的聚合点
  // 设置（见页面上的「设置」折叠块），都默认开
  aliveOnly: true,         // 都城只画滑块所指年份仍存续的政权
  showTerr: true,          // 画地形骨架（山脉填充与山川名）
  showExtent: true,        // 政权选中时画盛时疆域示意（毛边色块，四至锚点法）
  showLow: true,           // 画低置信的点
  showAuto: true,          // 画自动取的坐标（据 'w'，没人逐条核过）
  world: false,            // 世界版：只画有境外落点的条目，全落点组齐画
};

// 世界版的主点是**真主点**：中国版里主点出图时由链上末个图内点顶替（外主记档），
// 世界版图框够大，主点回归外主本尊
const mainIdx = (r) => (state.world && r['外主'] >= 0 ? r['外主'] : r['主']);
// 「图外」只对中国版成立；世界版里那些点就在图上
const hidOut = (c) => !state.world && c['外'];
// 世界版合格：链上有任何境外点（库主三答③：凡有境外落点即合格）
const worldFit = (r) => r['层'] === 'ev' && r['链'] && r['链'].some((c) => c['外']);

/** 年代滑块对两层的意思不一样，这是有意的：
 *
 * **事件用「截至」**——发生过就发生过了，滑到 1000 年，赤壁之战当然还在图上。
 * **政权用「当时」**——滑到哪年只画那一年还活着的政权。用「截至」的话，
 * 亡了一千年的都城会一直留在图上堆着（商周之际的图上挤满后世方块，
 * 用户实测看见的就是这个），而「此刻并存的政权」正是本站时间轴
 * 「河宽即并存政权数」的同一个读法。滑块拉满（＝不筛）时两层都全画。 */
const shown = () => ALL.filter((r) => state.layers.has(r['层'])
  // 世界版：政权层不上（都城皆境内，搬上去即「搬全量」，三答③明令不搬）；
  // 事件只收合格条目
  && (!state.world || (r['层'] === 'ev' && worldFit(r)))
  && (r['层'] !== 'ev' || !state.off.has(r.k))
  && (r['层'] === 'dyn' && state.aliveOnly && Number.isFinite(state.upto)
    ? (r.y <= state.upto && r.e >= state.upto)
    : r.y <= state.upto)
  // 主>=0 必须站在取 链[主] 之前：无图内点条目主=-1，链[-1] 是 undefined，
  // 关掉「画低置信」后短路失效即抛错、全图点消失（2026-08-26 库主实测报案）。
  // 世界版用 mainIdx：无图内点条目的外主在世界图框里是正主
  && mainIdx(r) >= 0
  && (state.showLow || !r['链'][mainIdx(r)]['约'])
  && (state.showAuto || r['据'] !== 'w'));

const idOf = (r) => `${r['层']}:${r.n}`;
// 调试窗：个人站，留着便宜（终端里 window.__map 直接看内脏）
window.__map = { state, ALL, TERR, idOf: null };
window.__map.idOf = idOf;
const trueXY = (r) => xy(r['链'][r._pi !== undefined ? r._pi : mainIdx(r)]['点']);
const kindLabel = (r) => (r['层'] === 'dyn' ? '政权' : (EVENT_KINDS[r.k] || {}).label || r.k);

/* ── 骨架 ─────────────────────────────────────────────────────────────── */

const svg = el('svg', {
  viewBox: `0 0 ${W} ${H}`, class: 'plate-svg',
  preserveAspectRatio: 'xMidYMid meet', role: 'img',
  'aria-label': '本库能落到地上的条目分布图',
});
const gGrid = el('g', { class: 'pl-grid' });
gGrid.appendChild(el('path', { d: graticulePath(project, BASEMAP.bbox, 10) }));
// 地形骨架：山脉淡淡填一层。名字在 draw() 里跟其他标签一起走排版器
const gTerr = el('g', { class: 'pl-terr' });
for (const t of (BASEMAP.terrain || [])) {
  if (t.d) gTerr.appendChild(el('path', { d: t.d }));
}
const gCoast = el('g');
// 柔边用叠描边，**不用滤镜**：feGaussianBlur 的滤镜区域跨整张图，实测滚动时
// 浏览器重绘不过来——图上内容钉住不动、底下的灰块自己在走，上半截被撕掉一条白带
softStroke(gCoast, BASEMAP.coast, 'pl-coast-fuzz');
gCoast.appendChild(el('path', { class: 'pl-coast', d: BASEMAP.coast }));
// 大湖夹在海岸与河之间（2026-08-26 底图水系扩建案）。次序即层序：
// 河要压在湖上，长江才是「过」洞庭鄱阳，不是流到湖里为止
lakeLayer(gCoast, BASEMAP.lakes, 'pl-lake');
gCoast.appendChild(el('path', { class: 'pl-river', d: BASEMAP.rivers }));
// 世界版底版：只有海岸线（河湖地形留给中国版），默认藏，setWorld 掀帘
const gWorld = el('g', { class: 'pl-worldbase', style: 'display:none' });
softStroke(gWorld, WORLDMAP.coast, 'pl-coast-fuzz');
gWorld.appendChild(el('path', { class: 'pl-coast', d: WORLDMAP.coast }));
const gRef = el('g', { class: 'pl-ref' });      // 参照城市与河名
const gLead = el('g', { class: 'pl-leads' });   // 散开之后拉回真位置的细线
const gChain = el('g', { class: 'pl-chain' });  // 选中时展开的链
const gDot = el('g', { class: 'pl-dots' });
const gLab = el('g', { class: 'pl-labs' });
const gHit = el('g', { class: 'pl-hits' });     // 看不见的命中区，压在最上面
const gLn = el('g', { class: 'pl-ln' });        // 地图走线：路线与站点，压在一切之上
// 盛时疆域示意层：压在海岸之上、一切点线之下——它是背景色块，不是数据
const gExt = el('g', { class: 'pl-extent' });
{
  const defs = el('defs');
  const f = el('filter', { id: 'pl-extent-blur', x: '-20%', y: '-20%', width: '140%', height: '140%' });
  f.appendChild(el('feGaussianBlur', { stdDeviation: 2.5 }));
  defs.appendChild(f);
  svg.appendChild(defs);
}
svg.append(gGrid, gTerr, gCoast, gWorld, gExt, gRef, gLead, gChain, gDot, gLab, gHit, gLn);

/** 画/清 盛时疆域毛边色块。轮廓点经 project() 落图，中点二次曲线抹圆——
 *  粗描本来就是示意，棱角只会让它看起来假精确 */
/** 多切片挑选：跟年代滑杆走，滑到哪年看哪年的疆域；「全部」用带 盛 标的默认切片 */
function pickSnap(t) {
  if (!t || !t.snaps || !t.snaps.length) return null;
  if (!Number.isFinite(state.upto)) return t.snaps.find((sn) => sn['盛']) || t.snaps[t.snaps.length - 1];
  let best = t.snaps[0];
  for (const sn of t.snaps) {
    if (Math.abs(sn.y - state.upto) < Math.abs(best.y - state.upto)) best = sn;
  }
  return best;
}
function drawExtent(key) {
  gExt.innerHTML = '';
  const snap = pickSnap(TERR[key]);
  if (!snap || !snap.pts || snap.pts.length < 3) return null;
  // 折线过**真锚点**（用户 2026-08-22 纠：中点平滑曲线从不经过任何一个研核
  // 顶点，等于形状背叛了取值）。「非精确」由毛边与透明度表达，不由变形表达
  const q = snap.pts.map(([lon, lat]) => project(lon, lat));
  const d = q.map(([x, y2], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y2.toFixed(1)}`).join('');
  gExt.appendChild(el('path', { class: 'pl-extent-blob', d: d + 'Z' }));
  return snap;
}
const clearExtent = () => { gExt.innerHTML = ''; };
$('plate').appendChild(svg);

/* ── 缩放与平移 ─────────────────────────────────────────────────────────
   435 条挤一张全国图，中原那片在任何静态画法下都是地毯——结构解法只有缩放：
   **聚合按屏上的距离算，放大了自然散开**。三条配套的规矩：

   · 所有尺寸（点半径、字号、聚合半径、散开距离）除以缩放系数，
     屏上大小恒定；描边靠 non-scaling-stroke，本来就恒定。
   · **这张图没有政区界线，放大就会迷路**（用户指出），故配三样定位锚：
     二级参照城市放大后才出现、角落一张鹰眼小图框出当前视口、
     沿边标经纬度数字。
   · 窄屏不上缩放：那边已经是「图比屏宽、左右拖」的模型，两套手势会打架。 */

const VIEW = { z: 1, cx: W / 2, cy: H / 2 };
let VB = [0, 0, W, H];
let drawTimer = 0;
const scheduleDraw = () => {
  clearTimeout(drawTimer);
  drawTimer = setTimeout(() => { draw(); if (LN.key) drawLn(); }, 140);
};

function applyView() {
  const vw = W / VIEW.z, vh = H / VIEW.z;
  VIEW.cx = Math.min(Math.max(VIEW.cx, vw / 2), W - vw / 2);
  VIEW.cy = Math.min(Math.max(VIEW.cy, vh / 2), H - vh / 2);
  VB = [VIEW.cx - vw / 2, VIEW.cy - vh / 2, vw, vh];
  svg.setAttribute('viewBox', VB.join(' '));
  // 触屏让权：全图态单指放行给页面滚动（pan-y），放大后地图独占手势。
  // 捏合任何时候都归我们——不设 none/pan-y 的话浏览器会拿去缩整页
  svg.style.touchAction = VIEW.z > 1 ? 'none' : 'pan-y';
  eyeSync();
}

function setZoom(nz, ax, ay) {
  nz = Math.min(8, Math.max(1, nz));
  if (ax !== undefined) {
    // 光标底下那一点在缩放前后钉住不动
    VIEW.cx = ax - (ax - VIEW.cx) * (VIEW.z / nz);
    VIEW.cy = ay - (ay - VIEW.cy) * (VIEW.z / nz);
  }
  VIEW.z = nz;
  state.open.clear();           // 缩放变了，聚合从头分组，展开态没有意义了
  applyView();
  scheduleDraw();               // viewBox 先生效（便宜），重画欠着一拍再算
}

const clientToView = (e) => {
  const b = svg.getBoundingClientRect();
  return [VB[0] + ((e.clientX - b.left) / b.width) * VB[2],
    VB[1] + ((e.clientY - b.top) / b.height) * VB[3]];
};

svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const pt = clientToView(e);
  setZoom(VIEW.z * Math.pow(1.0018, -e.deltaY), pt[0], pt[1]);
}, { passive: false });

// 拖着平移。拖过就不算点击——否则松手时会把选中的链顺手关掉
let panning = null, suppressClick = false, pinch = null;
svg.style.cursor = 'grab';   // 抓手三态：常态 grab、拖动 grabbing、松手复位（用户票据 2026-08-21）
const PTRS = new Map();   // pointerId → 屏坐标；两个成员即捏合态
svg.addEventListener('pointerdown', (e) => {
  tipHide();
  // 先入册再分流：第一指落在点上也不妨碍第二指进来变成捏合（手机上点大，很常见）
  PTRS.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (PTRS.size === 2) {
    const [a, b] = [...PTRS.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: VIEW.z };
    panning = null;                        // 第二指落下，单指平移让位
    e.preventDefault();
    try { svg.setPointerCapture(e.pointerId); } catch (_) { /* 合成指针无捕获权，忽略 */ }
    return;
  }
  if (e.target.classList && e.target.classList.contains('pl-hit')) return;
  if (VIEW.z <= 1) return;                 // 全图态单指留给页面滚动
  e.preventDefault();     // 掐掉浏览器的文本选择：不掐，拖图就是满图蓝色选区
  panning = { x: e.clientX, y: e.clientY, cx: VIEW.cx, cy: VIEW.cy, moved: false };
  svg.style.cursor = 'grabbing';
  try { svg.setPointerCapture(e.pointerId); } catch (_) { /* 合成指针无捕获权，忽略 */ }
});
svg.addEventListener('pointermove', (e) => {
  if (PTRS.has(e.pointerId)) PTRS.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && PTRS.size === 2) {
    const [a, b] = [...PTRS.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 8 && pinch.d > 8) {
      // 以两指中点为锚：捏合缩放，双指同移即顺带平移
      const pt = clientToView({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      setZoom(pinch.z * (d / pinch.d), pt[0], pt[1]);
    }
    return;
  }
  if (!panning) return;
  const b = svg.getBoundingClientRect();
  if (Math.abs(e.clientX - panning.x) + Math.abs(e.clientY - panning.y) > 4) panning.moved = true;
  VIEW.cx = panning.cx - (e.clientX - panning.x) * (VB[2] / b.width);
  VIEW.cy = panning.cy - (e.clientY - panning.y) * (VB[3] / b.height);
  applyView();
});
const endPtr = (e) => {
  PTRS.delete(e.pointerId);
  if (pinch && PTRS.size < 2) { pinch = null; suppressClick = true; scheduleDraw(); }
  if (panning && panning.moved) { suppressClick = true; scheduleDraw(); }
  if (!PTRS.size) panning = null;
  if (!PTRS.size) svg.style.cursor = 'grab';
};
svg.addEventListener('pointerup', endPtr);
svg.addEventListener('pointercancel', endPtr);
// 指头在图外抬起时本地收不到 up：window 兜底清册，别让幽灵指针卡死捏合态
window.addEventListener('pointerup', endPtr);
window.addEventListener('pointercancel', endPtr);

// 控件：＋ － 全。滚轮不是人人都想得到，按钮谁都看得见
const zctl = document.createElement('div');
zctl.className = 'pl-zoomctl';
// 「全」曾被读成「全球」（库主实测，2026-08-31，世界版上线当日）：世界版一存在，
// 地图角上的单字「全」就有了第二义。两手同治：复位钮改双字「全图」自明；
// 切世界版的钮就地补进这一柱（用户的手本能先来这儿找它）
zctl.innerHTML = '<button type="button" data-z="in" title="放大">＋</button>'
  + '<button type="button" data-z="out" title="缩小">－</button>'
  + '<button type="button" data-z="reset" title="回到全图" class="pl-z-wide">全图</button>'
  + '<button type="button" data-z="world" title="世界中的中国史：有境外落点的条目" class="pl-z-wide">世界</button>';
$('plate').appendChild(zctl);
zctl.addEventListener('click', (e) => {
  // closest 而非 e.target：库主实测报「点全无反应」（2026-08-31）——本地未复现，
  // 但 e.target 判法有已知脆点（命中按钮内任何子节点即失灵），一并加固
  const btn = e.target && e.target.closest ? e.target.closest('button[data-z]') : null;
  const a = btn && btn.dataset.z;
  if (a === 'in') setZoom(VIEW.z * 1.6);
  else if (a === 'out') setZoom(VIEW.z / 1.6);
  else if (a === 'reset') { VIEW.cx = W / 2; VIEW.cy = H / 2; setZoom(1); }
  else if (a === 'world') setWorld(!state.world);
});

// 鹰眼：全图轮廓 + 当前视口框。放大了才出现——全图状态下它就是废话
const eye = document.createElement('div');
eye.className = 'pl-eye';
const esvg = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });
esvg.appendChild(el('path', { class: 'pl-eye-coast', d: BASEMAP.coast }));
esvg.appendChild(el('path', { class: 'pl-eye-river', d: BASEMAP.rivers }));
const eyeRect = el('rect', { class: 'pl-eye-rect', x: 0, y: 0, width: W, height: H });
esvg.appendChild(eyeRect);
eye.appendChild(esvg);
$('plate').appendChild(eye);
function eyeSync() {
  // 鹰眼是中国版的定位锚（框出的是中国底图坐标系），世界版不摆
  eye.classList.toggle('on', !state.world && VIEW.z > 1.01);
  eyeRect.setAttribute('x', VB[0]); eyeRect.setAttribute('y', VB[1]);
  eyeRect.setAttribute('width', VB[2]); eyeRect.setAttribute('height', VB[3]);
}

/* ── 双版切换（世界图双版案）─────────────────────────────────────────── */
// 左下「中国小版」返回钮已裁（库主裁：与缩放柱中国钮同屏冗余，2026-08-31 二裁；
// 图例chip同日同由裁去）——切版只余缩放柱一门，双向：世界↔中国
let syncAll = () => {};    // mountKinds 挂上真身，切版后同步图例双态

function setWorld(on) {
  if (state.world === !!on) return;
  state.world = !!on;
  W = on ? WORLDMAP.w : BASEMAP.w;
  H = on ? WORLDMAP.h : BASEMAP.h;
  VIEW.z = 1; VIEW.cx = W / 2; VIEW.cy = H / 2;
  state.sel = null;
  state.open.clear();
  gExt.innerHTML = '';
  [gGrid, gTerr, gCoast].forEach((g) => { g.style.display = on ? 'none' : ''; });
  gWorld.style.display = on ? '' : 'none';
  // 缩放柱里的世界钮双态同步（图例钮、左下小版钮俱裁后，此钮即唯一切版门）
  const zw = zctl.querySelector('button[data-z="world"]');
  if (zw) {
    zw.textContent = on ? '中国' : '世界';
    zw.title = on ? '回到中国版' : '世界中的中国史：有境外落点的条目';
    zw.classList.toggle('on', on);
  }
  svg.setAttribute('aria-label', on ? '世界版：有境外落点的条目——流散与出海' : '本库能落到地上的条目分布图');
  syncAll();
  applyView();
  draw();
}
esvg.addEventListener('pointerdown', (e) => {
  const b = esvg.getBoundingClientRect();
  VIEW.cx = ((e.clientX - b.left) / b.width) * W;
  VIEW.cy = ((e.clientY - b.top) / b.height) * H;
  applyView(); scheduleDraw();
});

// 二级参照城市：全图状态下画它们只会添乱，放大后正是读者要抓的扶手
const ANCHORS_FAR = [
  ['洛阳', 34.62, 112.45], ['开封', 34.80, 114.31], ['郑州', 34.75, 113.63],
  ['济南', 36.65, 117.12], ['太原', 37.87, 112.55], ['大同', 40.08, 113.30],
  ['杭州', 30.27, 120.16], ['福州', 26.07, 119.30], ['南昌', 28.68, 115.86],
  ['贵阳', 26.65, 106.63], ['桂林', 25.27, 110.29], ['南宁', 22.82, 108.32],
  ['银川', 38.49, 106.23], ['西宁', 36.62, 101.78], ['呼和浩特', 40.84, 111.75],
  ['哈尔滨', 45.80, 126.53], ['敦煌', 40.14, 94.66], ['喀什', 39.47, 75.99],
  ['拉萨', 29.65, 91.14], ['徐州', 34.26, 117.19], ['安阳', 36.10, 114.35],
  ['扬州', 32.39, 119.41],
];

// 悬停浮卡：照时间轴那张迷你知识卡的样子（用户定的）——名、年、类别，
// 加一段简注摘要，直接跟在点上出现，不必点、也不必低头看读数面板。
// 读数面板仍然给行迹链那类结构信息，浮卡给「这是谁、讲什么」
const YC = new Map(EVENTS.map((e) => [e.n, e.yc || '']));
const BIO = new Map(DYNASTIES.map((d) => [d.key, d.bio || '']));

// 悬停小卡是**预览**，不是全卡——那份待遇(全文、不截断)留给点开后的全卡
// (knowledge.js 的 fillCard)。这里仍按字数截，只是把截断点从「CSS 逐行硬切、
// 半句吊尾」改成「按句界切」：找不到整句边界才退回硬切，宁可一句读全也别
// 齐刷刷切在同一字数上。**粗体**转 <strong> 走 mdBold，与全卡同一条约定。
const TIP_MAX = 120, TIP_SLACK = 20;
const SENT_END = ['。', '！', '？', '」'];
function truncateSentence(s, max = TIP_MAX, slack = TIP_SLACK) {
  if (!s) return '';
  if (s.length <= max) return s;
  const win = s.slice(0, max + slack);
  let cut = -1;
  for (const ch of SENT_END) { const i = win.lastIndexOf(ch); if (i > cut) cut = i; }
  let out = cut >= 0 ? win.slice(0, cut + 1) : s.slice(0, max);
  // 切点若落在 ** 中间会留下单只星号；宁可这一段不加粗，也不露记号
  if ((out.match(/\*\*/g) || []).length % 2 === 1) out = out.replace(/\*\*/g, '');
  return out + '……';
}

const tip = document.createElement('div');
tip.className = 'pl-tip';
tip.innerHTML = '<div class="pl-tip-t"></div><div class="pl-tip-m"></div><div class="pl-tip-b"></div>';
$('plate').appendChild(tip);
function tipShow(x, y, title, meta, body) {
  const b = svg.getBoundingClientRect(), pb = $('plate').getBoundingClientRect();
  tip.querySelector('.pl-tip-t').textContent = title;
  tip.querySelector('.pl-tip-m').textContent = meta || '';
  const bd = tip.querySelector('.pl-tip-b');
  const preview = truncateSentence(body || '');
  bd.innerHTML = preview ? mdBold(preview) : '';
  bd.style.display = preview ? '' : 'none';
  const px = ((x - VB[0]) / VB[2]) * b.width + b.left - pb.left;
  const py = ((y - VB[1]) / VB[3]) * b.height + b.top - pb.top;
  tip.style.left = `${px}px`;
  // 靠上就翻到点的下方，别让卡被图框裁掉
  const flip = py < 190;
  tip.style.top = `${py + (flip ? 14 : -8)}px`;
  tip.classList.toggle('pl-tip-below', flip);
  tip.classList.add('on');
}
const tipHide = () => tip.classList.remove('on');

// 链点的单字角标（洛阳·显）在坞里就地释义——全表在 docs/geo-model.md，这里逐字照抄
const ROLE_GLOSS = {
  生: '出生地', 造: '制作地', 显: '显赫、成事之地', 立: '建立、树立之地',
  卒: '逝世地', 发: '出土、发现地', 葬: '埋葬、原置之地', 现: '现藏、现陈之地',
  贬: '贬所', 址: '遗址本体所在', 行: '行迹中途', 战: '交战地',
  都: '都城', 起: '起事地', 迁: '迁都之后的都城', 陪: '与正都并存的陪都', 灾: '受灾中心',
  说: '诸说之一', 颁: '颁行地', 摹: '著名临摹本、拓本所在', 仿: '化石模型、复制件所在',
};
const IDLE = ['这张图', '一条目一个点',
  '指到点上看名字，点一下展开它去过的地方。半透明的点是今地不确定；带数字的大点是挤在一处的一簇——大簇点一下先拉近，贴近了再点就地散开；双击下方类别芯片只看那一类，「全开」复原。'];
const rd = reader($('plate-read'), IDLE);
// 嵌入条卡(用户提议的 meld):钉住一条时在元信息行下长出河页同款条卡。
const EMB = mountEmbedCard($('plate-read'));
const EV_BY_N = new Map(EVENTS.map((e) => [e.n, e]));
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
const DCAP = 1;               // 朝簇阈值：同城只要 >1 朝就直接折成一个方块（用户拍板，不设起步线）
// 朝簇文案直接说「几朝古都」（用户定的口径）；数字转汉字只做到十九，再往上照用数字
const cnum = (n) => (n === 2 ? '两' : n <= 10 ? '一二三四五六七八九十'[n - 1]
  : n < 20 ? `十${'一二三四五六七八九'[n - 11]}` : String(n));

function group(rows) {
  const gs = [];
  const nz = NEAR / VIEW.z;      // 按屏上的距离聚，放大了自然散开
  // 分量大的先占位，小的往它身边靠——聚合点落在哪儿由重要的那几条决定
  for (const r of rows.slice().sort((a, b) => a.r - b.r)) {
    const [x, y] = trueXY(r);
    let hit = null;
    for (const g of gs) {
      if ((g.cx - x) ** 2 + (g.cy - y) ** 2 <= nz * nz) { hit = g; break; }
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
/** 展开环的真实外径：与 spread() 同一套分环公式算到最外环。
 *  推挤账要用它——合并判据用折叠圆（封顶26），环却无上限，中间那段
 *  「判据说不用并、环却画得到」正是邻簇被视觉吸进环里的几何根源
 *  （2026-08-24 库主周末bug报＋侦察定案） */
function ringR(n) {
  const k = 1 / VIEW.z;
  let rest = n > 6 ? n - 1 : n;
  let ring = 0, rad = 0, i = 0;
  while (i < rest) {
    const cap = Math.min(rest - i, 6 + ring * 4);
    rad = (5 + 1.9 * Math.min(cap, 6) + ring * 13.5) * k;
    i += cap; ring += 1;
  }
  return rad;
}

function spread(g) {
  const n = g.rows.length;
  if (n === 1) { g.rows[0].px = g.rows[0].x; g.rows[0].py = g.rows[0].y; return; }
  const rest = g.rows.slice();
  if (n > 6) { const c = rest.shift(); c.px = g.cx; c.py = g.cy; }
  const k = 1 / VIEW.z;
  let ring = 0, i = 0;
  while (i < rest.length) {
    const cap = Math.min(rest.length - i, 6 + ring * 4);
    // 间距版本二（用户实测「展开后不太好选」）：满环邻距 ≈17–20 屏素、环距 13.5，
    // 配合成组命中圈收小（见画点处），点缝里不再是抽签。小组（2–3 个）仍收着，
    // 免得两点隔心相对、引线连成一根假关系线（版本一的教训，见上）
    const rad = (5 + 1.9 * Math.min(cap, 6) + ring * 13.5) * k;
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
  const M = 7 / VIEW.z;              // 留一点边，箭头不至于被裁掉
  const [bx, by, bw, bh] = VB;       // 截到**当前视口**：放大后图框就是视口
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
  if (!test(-dx, px - (bx + M)) || !test(dx, (bx + bw - M) - px)
      || !test(-dy, py - (by + M)) || !test(dy, (by + bh - M) - py)) return null;
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
  const L = 9 / VIEW.z, Wd = 4.4 / VIEW.z;
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
  // 主点已被散开挪过位子，链要从它**现在画在哪儿**接出去，否则线会脱开那个点。
  // 世界版每个链点都可点（影子行带 _pi）：锚要跟着**被点的那一枚**走——
  // 库主实测点了景德镇影子点，士林步点被錨到景德镇（2026-08-31 士林错位案）
  const ai = row._pi !== undefined ? row._pi : mainIdx(row);
  const at = (i) => (i === ai ? [ax, ay] : xy(chain[i]['点']));

  if (row['式'] === '诸说') {
    // 诸说不连线——它们不是先后的行迹，是并存的主张。全摆出来，让读者看见
    // 这地方至今没定论；主说实心，其余空心
    chain.forEach((c, i) => {
      if (hidOut(c)) return;
      const [x, y] = at(i);
      if (i !== mainIdx(row)) {
        gChain.appendChild(el('circle', { class: `pl-claim ${cls}`, cx: x, cy: y, r: 5 / VIEW.z }));
      }
      const h = haloText(gChain, c['名'],
        { size: 10.5 / VIEW.z, halo: 'var(--surface-2)', haloWidth: 3.2 / VIEW.z });
      h.over.setAttribute('class', 'pl-chain-t');
      jobs.push({ h, p: [x, y], pri: 300 - i, cands: placeCandidates('e', 1 / VIEW.z) });
    });
    return jobs;
  }

  // 链：逐段画，段末一个箭头。**同一段路来回走的，两程各自向外错开**，
  // 否则第二程盖在第一程上，读者看不出他回来过
  const legs = [];
  // 时序骨干剔除陪都：陪与正都**并存**，进了箭头序列会被读成迁都
  const seq = [];
  chain.forEach((c, i) => { if (c['角'] !== '陪') seq.push(i); });
  // **分藏不成行迹**（库主案 2026-08-31，易县罗汉散海外实见）：连续两个及以上
  // 「现／摹」是平行的收藏地，不是一条走出来的路——罗汉像被画成
  // 易县→纽约→伦敦→费城→多伦多的巡游，实情是一组造像四散各馆，
  // 馆与馆之间毫无因果。故藏点各自从上一个非收藏节点散射连出，
  // 藏点之间不画箭头；整链皆藏点（富春两半、黄庭经两摹）则只摆点不画线
  const HOLD = new Set(['现', '摹', '仿']);
  for (let i = 0; i + 1 < seq.length; i += 1) {
    const a = seq[i], b = seq[i + 1];
    if (HOLD.has(chain[a]['角']) && HOLD.has(chain[b]['角'])) {
      let src = -1;
      for (let j = i; j >= 0; j -= 1) {
        if (!HOLD.has(chain[seq[j]]['角'])) { src = seq[j]; break; }
      }
      if (src >= 0) legs.push([src, b]);
    } else legs.push([a, b]);
  }
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
    if (hidOut(chain[b])) {
      // 图外：按**真实大圆方位角**指出去，不照投影里的方向。屏上北是 −y，
      // 故方位角 θ 对应的方向向量是 (sinθ, −cosθ)。长度取够穿出图框即可
      const th = bearing(chain[a]['点'], chain[b]['点']);
      const far = (W + H) * 2;
      rx = px + far * Math.sin(th);
      ry = py - far * Math.cos(th);
    }
    const ang = Math.atan2(ry - py, rx - px);
    const off = total > 1 ? ((idx - (total - 1) / 2) * 7) / VIEW.z : 0;   // 只有一程时不挪
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
        size: 10 / VIEW.z, halo: 'var(--surface-2)', haloWidth: 3.2 / VIEW.z,
      });
      h.over.setAttribute('class', 'pl-chain-t pl-out-t');
      jobs.push({ h, p: [x2, y2], pri: 290, cands: placeCandidates('w', 1 / VIEW.z) });
    }
  });

  chain.forEach((c, i) => {
    if (c['角'] !== '陪' || hidOut(c)) return;
    let j = i - 1;
    while (j >= 0 && chain[j]['角'] === '陪') j -= 1;
    if (j < 0) j = mainIdx(row);
    const [px, py] = at(j);
    const [rx, ry] = at(i);
    const seg = clipSeg(px, py, rx, ry);
    if (!seg) return;
    gChain.appendChild(el('line', {
      class: `pl-leg pl-leg-pei ${cls}`, x1: seg[0], y1: seg[1], x2: seg[2], y2: seg[3],
    }));
  });

  chain.forEach((c, i) => {
    if (hidOut(c)) return;
    const [x, y] = at(i);
    if (i !== mainIdx(row)) {
      gChain.appendChild(el('circle', {
        class: `pl-step ${cls}${c['约'] ? ' pl-low' : ''}`, cx: x, cy: y, r: 4.6 / VIEW.z,
      }));
    }
    const h = haloText(gChain, `${c['名']}·${c['角']}`, {
      size: 10.5 / VIEW.z, halo: 'var(--surface-2)', haloWidth: 3.2 / VIEW.z,
    });
    h.over.setAttribute('class', 'pl-chain-t');
    jobs.push({ h, p: [x, y], pri: 300 - i, cands: placeCandidates('e', 1 / VIEW.z) });
  });
  return jobs;
}

/* ── 读数 ─────────────────────────────────────────────────────────────── */

function say(row, pin) {
  const chain = row['链'];
  const here = chain[mainIdx(row)];
  const bits = [];
  if (row['式'] === '诸说') {
    const others = chain.filter((_, i) => i !== mainIdx(row)).map((c) => c['名']);
    bits.push(`${chain.length} 说并存，主说 ${here['名']}`);
    if (others.length) bits.push(`另有：${others.join('、')}`);
  } else if (chain.length > 1) {
    const seqC = chain.filter((c) => c['角'] !== '陪');
    const peiC = chain.filter((c) => c['角'] === '陪');
    // 分藏不成行迹（与链的画法同一条规矩）：尾部连续两个及以上藏点不再用
    // 箭头串起，改记「分藏」——箭头是因果，分藏没有因果
    const HOLD2 = new Set(['现', '摹', '仿']);
    const tail = [];
    while (seqC.length && HOLD2.has(seqC[seqC.length - 1]['角'])) tail.unshift(seqC.pop());
    const nm = (c) => `${c['名']}·${c['角']}${hidOut(c) ? '（图外）' : ''}`;
    let t;
    if (tail.length >= 2) {
      t = seqC.map(nm).join(' → ');
      t += `${t ? '；' : ''}分藏：${tail.map((c) => `${c['名']}${hidOut(c) ? '（图外）' : ''}`).join('、')}`;
    } else {
      seqC.push(...tail);
      t = seqC.map(nm).join(' → ');
    }
    if (peiC.length) t += `；陪都：${peiC.map((c) => `${c['名']}${hidOut(c) ? '（图外）' : ''}`).join('、')}`;
    bits.push(t);
  } else {
    bits.push(`${here['名']}·${here['角']}`);
  }
  if (row['式'] !== '诸说') {
    const tags = [...new Set((chain.length > 1 ? chain : [here]).map((c) => c['角']))]
      .filter((t) => ROLE_GLOSS[t]);
    if (tags.length) bits.push(tags.map((t) => `${t}＝${ROLE_GLOSS[t]}`).join('，'));
  }
  if (!state.world && row['外主'] >= 0) bits.push(`主点其实在${chain[row['外主']]['名']}，出了这张图的范围`);
  if (here['约']) bits.push('今地属推定，故画成半透明');
  if (row['据'] === 'w') bits.push('坐标取自该条目的维基页，没有人核过它是不是这件事发生的地方');
  const kick = row['层'] === 'dyn'
    ? `${yr(row.y)} – ${yr(row.e)}　政权`
    : `${yr(row.y)}　${kindLabel(row)}`;
  if (pin) {
    const ev = row['层'] === 'dyn' ? null : EV_BY_N.get(row.n);
    // 政权钉住时铺盛时疆域示意；示警随坞行走（与「今地属推定」同一层级语言）
    if (row['层'] === 'dyn' && state.showExtent && TERR[row.key]) {
      const snap = drawExtent(row.key);
      if (snap) bits.push(`底色为疆域约略示意，据${yr(snap.y)}前后（${snap.span}）——四至锚点粗描，非精确边界，古之疆域本非线状`);
    } else clearExtent();   // 无疆域数据的政权也要清——否则明→东晋换选时明的大块滞留（实测踩到）
    // meld 去重:卡的头两行(年份类别、标题)已由 CSS 藏掉,坞行代任;
    // 卡头本来更全的起讫年并回坞行,别把 892–1252 缩成 892
    const kick2 = ev && ev.y2 ? `${yr(ev.y)} – ${yr(ev.y2)}　${kindLabel(row)}` : kick;
    rd.pin(kick2, row.n, bits.join('　·　'));
    if (ev) EMB.show(evSpec(ev)); else EMB.hide();
  } else rd.hover(kick, row.n, bits.join('　·　'));
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
  const iz = 1 / VIEW.z;
  // 世界版：参照层（城市/河湖名/地形名/经纬扶手）整层不上——那些全是中国版布景
  const cities = state.world ? [] : (VIEW.z >= 1.8 ? ANCHORS.concat(ANCHORS_FAR) : ANCHORS);
  for (const [name, lat, lon] of cities) {
    const [x, y] = project(lon, lat);
    const c = el('circle', { class: 'pl-city', cx: x, cy: y, r: 2 * iz });
    gRef.appendChild(c);
    solver.obstacle(c);
    const h = haloText(gRef, name, { size: 10.5 * iz, halo: 'var(--surface-2)', haloWidth: 3 * iz });
    h.over.setAttribute('class', 'pl-city-t');
    jobs.push({ h, p: [x, y], pri: 150, cands: placeCandidates('e', iz) });
  }
  for (const [name, lat, lon] of (state.world ? [] : RIVER_TAGS)) {
    const [x, y] = project(lon, lat);
    const h = haloText(gRef, name, { size: 12 * iz, halo: 'var(--surface-2)', haloWidth: 3.4 * iz });
    h.over.setAttribute('class', 'pl-river-t');
    jobs.push({ h, p: [x, y], pri: 200,
      cands: NUDGES.tight.map(([a, b]) => [a * iz, b * iz, 'middle']) });
  }
  // 湖名（2026-08-26 库主令）：与河名同的贴身微挪，字小一号、优先级次之——
  // 湖名丢了可惜，但不许为它挤掉河名或站名
  for (const [name, lat, lon] of (state.world ? [] : LAKE_TAGS)) {
    const [x, y] = project(lon, lat);
    const h = haloText(gRef, name, { size: 10.5 * iz, halo: 'var(--surface-2)', haloWidth: 3 * iz });
    h.over.setAttribute('class', 'pl-lake-t');
    jobs.push({ h, p: [x, y], pri: 130,
      cands: NUDGES.tight.map(([a, b]) => [a * iz, b * iz, 'middle']) });
  }
  // 地形的名字：斜体、极淡，排版优先级垫底——山名是布景，谁都可以压过它。
  // 面状名不许跑远（跑远了就指着别的山了），只用小步挪的候选
  gTerr.style.display = (!state.world && state.showTerr) ? '' : 'none';
  if (!state.world && state.showTerr) {
    for (const t of (BASEMAP.terrain || [])) {
      if (t.rank > 2 && VIEW.z < 1.4) continue;   // 小地物的名字放大了才给
      const h = haloText(gRef, t.n, {
        size: (t.cls === 'flat' ? 11.5 : 10.5) * iz, italic: true,
        halo: 'var(--surface-2)', haloWidth: 3 * iz,
      });
      h.over.setAttribute('class', 'pl-terr-t');
      jobs.push({ h, p: t.c, pri: 60,
        cands: NUDGES.open.map(([a2, b2]) => [a2 * iz, b2 * iz, 'middle']) });
    }
  }

  // 放大后沿边标经纬度：没有政区界线的图，数字是最不含糊的扶手
  if (!state.world && VIEW.z >= 1.6) {
    const [w0, , e0, n0] = BASEMAP.bbox;
    for (let lon = 80; lon <= 130; lon += 10) {
      const [x] = project(lon, n0);
      if (x < VB[0] + 8 * iz || x > VB[0] + VB[2] - 8 * iz) continue;
      const t = el('text', { class: 'pl-grid-t', x, y: VB[1] + 12 * iz,
        'text-anchor': 'middle', 'font-size': 9 * iz });
      t.textContent = `${lon}°E`;
      gRef.appendChild(t);
    }
    for (let lat = 20; lat <= 50; lat += 10) {
      const [, y] = project(w0, lat);
      if (y < VB[1] + 10 * iz || y > VB[1] + VB[3] - 6 * iz) continue;
      const t = el('text', { class: 'pl-grid-t', x: VB[0] + 5 * iz, y: y - 3 * iz,
        'text-anchor': 'start', 'font-size': 9 * iz });
      t.textContent = `${lat}°N`;
      gRef.appendChild(t);
    }
  }

  // 政权都城不进事件聚簇（用户实测：都城被吸进数字大簇后不再单独画，
  // 永远点不出来）——事件照旧聚簇，都城自己跟自己分组（同城多朝互相散开），
  // 同城超过 DCAP 朝折成一个「朝簇」方块（点开摊开）。93 个都城是独立图层，理应永远可点
  // 世界版点阵（三答②③）：合格条目全落点组齐画——每个落点一枚影子行，
  // 名字只标真主点那枚（_minor 不标）；弧线仍点开才画（drawChain 照旧）
  const evSrc = state.world
    ? rows.filter((r) => r['层'] !== 'dyn').flatMap((r) => r['链'].map((c, i) => (
      { ...r, _pi: i, _minor: i !== mainIdx(r) })))
    : rows.filter((r) => r['层'] !== 'dyn');
  const gs = group(evSrc);
  const gsDyn = group(rows.filter((r) => r['层'] === 'dyn'));
  // ── 聚合点把压在它圆下面的邻居一并吸进来 ──────────────────────
  // 不吸的话必然叠：聚合圆的半径（最大 26）比分组距离（11）大，
  // 圆边底下的散点没进组、却被圆压着（用户截图里 40、26 旁边正是这样）。
  // 吸进来会让圆更大、可能又压到新邻居，故循环到不再变为止
  const gidOf = (g) => `${Math.round(g.cx)},${Math.round(g.cy)}`;
  const clusterR = (n) => Math.min(26, 9 + Math.sqrt(n) * 2.4) / VIEW.z;
  let moved = true;
  while (moved) {
    moved = false;
    for (const c of gs) {
      if (c.rows.length <= CAP || state.open.has(gidOf(c))) continue;
      const R = clusterR(c.rows.length) + 9 / VIEW.z;   // 圆本身 + 散点自己的半径
      for (const g of gs) {
        if (g === c || !g.rows.length) continue;
        if ((g.cx - c.cx) ** 2 + (g.cy - c.cy) ** 2 < R * R) {
          c.rows.push(...g.rows);
          g.rows.length = 0;
          c.cx = c.rows.reduce((s2, m) => s2 + m.x, 0) / c.rows.length;
          c.cy = c.rows.reduce((s2, m) => s2 + m.y, 0) / c.rows.length;
          moved = true;
        }
      }
    }
  }
  // 选中的那条若被吸进簇里，替读者把簇打开——否则 draw 会把它当「被筛掉」，
  // 选中态连坞带疆域块一起自毁（搜索定位到北京簇里的元大都，实测踩到）。
  // 必须放在吸收循环**之后**：吸收前它所在的小组可能还不足 CAP，检查会放过它
  // 选中的那条若被吸进簇里，替读者把簇打开——否则 draw 会把它当「被筛掉」，
  // 选中态连坞带疆域块一起自毁。注意 group() 存的是 {r,x,y} 包装对象，
  // 判成员要拆 m.r（第一版拿包装喂 idOf，永远比不中，实测踩过）
  // 让位平移必须在自动展开**之前**：gid 由组心坐标算出，先展开后平移的话，
  // 自动展开记下的 gid 与渲染时算出的对不上，朝簇照旧折着，选中的政权
  // 画不出来又被当「被筛掉」清掉（搜索定位东晋，实测踩到）
  // 展开簇不再豁免推离源：折叠时用折叠圆半径，展开时用环真实外径——
  // 否则朝簇方块失去推挤便退回环心，看着像被吸进去（2026-08-24 修）
  const EVF = gs.filter((g) => g.rows.length > CAP)
    .map((g) => ({ cx: g.cx, cy: g.cy,
      R: state.open.has(gidOf(g)) ? ringR(g.rows.length) : clusterR(g.rows.length) }));
  for (const dg of gsDyn) {
    // 让位量要算**双方**半径：朝簇自己也有个大方块（南京十朝反手压住杭州簇心，实测）
    const selfR = 11 / VIEW.z;
    for (const ef of EVF) {
      const dx = dg.cx - ef.cx, dy = dg.cy - ef.cy;
      const d0 = Math.hypot(dx, dy);
      const want = ef.R + selfR + 8 / VIEW.z;
      if (d0 < want) {
        const ux = d0 > 0.001 ? dx / d0 : 1, uy = d0 > 0.001 ? dy / d0 : 0;
        dg.cx = ef.cx + ux * want;
        dg.cy = ef.cy + uy * want;
      }
    }
  }
  if (state.sel) {
    for (const c of gs) {
      if (c.rows.length > CAP && !state.open.has(gidOf(c))
          && c.rows.some((m) => idOf(m.r) === state.sel)) {
        state.open.clear();
        state.open.add(gidOf(c));
      }
    }
    // 朝簇的折叠阈值是 DCAP 不是 CAP——搜索定位到 4–8 朝的朝簇（明在北京组）时，
    // 少了这一扫成员画不出来，selAt 落空，选中态又会被当「被筛掉」自毁（实测踩到）
    for (const c of gsDyn) {
      if (c.rows.length > DCAP && !state.open.has(gidOf(c))
          && c.rows.some((m) => idOf(m.r) === state.sel)) {
        state.open.clear();
        state.open.add(gidOf(c));
      }
    }
  }
  // 并排让位（用户方案）：都城组若压在折叠事件簇的圆上，平移到簇边并排站——
  // 实测不让位时十个簇心有八个的点击被都城命中区抢走（杭州簇点出越国）
  const gs2 = gs.filter((g) => g.rows.length).concat(gsDyn);
  // ── 簇名两遍算 ──────────────────────────────────────────────────
  // 先各自起名（众数落点名，不足四成兜底「最近参照城＋一带」），再解**汇合**：
  // 「北京市 34 条」与「北京一带 52 条」并立时读者分不清谁是谁（用户指出）。
  // 实核：北京市那摞落点 100% 在城内（北京市25＋北京9）——城里已立门户，
  // 兜底簇改「北京周边」（用户裁定）；两个兜底簇撞同一锚时近者留名、远者按方位
  const NAMES = new Map();
  {
    const folded = [];
    for (const g of gs2) {
      const fc = g.rows[0].r['层'] === 'dyn' ? DCAP : CAP;
      if (g.rows.length > fc && !state.open.has(gidOf(g))) folded.push(g);
    }
    const stub = (n) => n.replace(/[市省县区區]$/, '');
    for (const g of folded) {
      const cnt = {};
      for (const m2 of g.rows) {
        const nm = m2.r['链'][m2.r._pi !== undefined ? m2.r._pi : mainIdx(m2.r)]['名'];
        cnt[nm] = (cnt[nm] || 0) + 1;
      }
      const top = Object.entries(cnt).sort((a2, b2) => b2[1] - a2[1])[0];
      if (top && top[1] >= g.rows.length * 0.4) {
        NAMES.set(gidOf(g), top[0]);
      } else {
        let best = null, bd = Infinity, bxy = null;
        for (const [nm, lat, lon] of ANCHORS.concat(ANCHORS_FAR)) {
          const [ax, ay] = project(lon, lat);
          const d2 = (ax - g.cx) ** 2 + (ay - g.cy) ** 2;
          if (d2 < bd) { bd = d2; best = nm; bxy = [ax, ay]; }
        }
        NAMES.set(gidOf(g), `${best}一带`);
        g.anc = best; g.ad = bd; g.axy = bxy;
      }
    }
    const modeStubs = new Set(folded.map((g) => NAMES.get(gidOf(g)))
      .filter((n) => !/[一带周边]$/.test(n)).map(stub));
    const byAnchor = new Map();
    for (const g of folded) {
      if (!g.anc) continue;
      if (!byAnchor.has(g.anc)) byAnchor.set(g.anc, []);
      byAnchor.get(g.anc).push(g);
    }
    for (const [anc, list] of byAnchor) {
      if (modeStubs.has(stub(anc))) {
        for (const g of list) NAMES.set(gidOf(g), `${anc}周边`);
      }
      if (list.length > 1) {
        list.sort((a2, b2) => a2.ad - b2.ad);
        for (let i = 1; i < list.length; i++) {
          const g = list[i];
          const dx = g.cx - g.axy[0], dy = g.cy - g.axy[1];
          const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? '以东' : '以西') : (dy > 0 ? '以南' : '以北');
          NAMES.set(gidOf(g), `${anc}${dir}`);
        }
      }
    }
  }
  let packed = 0, folded = 0, selAt = null;
  const dynHits = [];   // 都城命中区收尾抬顶：不抬会被后画的事件命中圈压住（用户实测点不中）
  const openHits = [];  // 点开的簇成员也抬顶：洋葱脚下常压着别组散点的大命中圈，
                        // 读者点开簇就是要选簇里的条目，簇成员优先吃点击（用户实测「不好选」）
  const clusterHits = []; // 折叠簇钮永远最顶：簇圆不透明，读者点到的像素是圆就该开圆——
                          // 洋葱摊得大时脚会伸到邻簇圆下，不抬簇钮，邻簇的心会被成员抢走（实测）
  const clusterVis = [];  // 簇的圆面同抬：命中层抬了画层不抬，别组的点会画在圆上——
                          // 看得见却点不中，比看不见更糟。视觉与命中必须同序
  const openVis = [];     // 展开簇的成员点面，最后压顶（层序见 draw 尾）
  const openVisBase = []; // 展开簇的托盘与引线，压在成员点面之下、其余一切之上

  for (const g of gs2) {
    const gid = gidOf(g);
    const isDynG = g.rows.length > 0 && g.rows[0].r['层'] === 'dyn';
    // 都城组阈值收紧（用户方案：十朝古都折成一个「N朝」方点，与事件簇并排）
    const foldCap = isDynG ? DCAP : CAP;
    if (g.rows.length > foldCap && !state.open.has(gid)) {
      // 收成一个点，标上条数。**半径随条数长**——点大即那地方事多，
      // 这本身是条信息，不只是「这儿挤」。点开才展成一环
      folded += g.rows.length;
      // 朝簇＝默认尺寸的都城方块，**不随朝数缩放**（用户拍板）——朝数写在块里，
      // 「一叠」的感觉靠背后错位垫两个叠影方块给出来
      const R = isDynG ? 6.6 / VIEW.z : clusterR(g.rows.length);
      if (isDynG) {
        for (const off of [4.4, 2.2]) {
          const o = off / VIEW.z;
          const gh = el('rect', {
            class: 'pl-dyn-ghost',
            x: g.cx - R + o, y: g.cy - R - o, width: R * 2, height: R * 2,
          });
          gDot.appendChild(gh);
          clusterVis.push(gh);
        }
      }
      const c = isDynG
        ? el('rect', { class: 'pl-cluster pl-dyn', x: g.cx - R, y: g.cy - R, width: R * 2, height: R * 2 })
        : el('circle', { class: 'pl-cluster', cx: g.cx, cy: g.cy, r: R });
      gDot.appendChild(c);
      clusterVis.push(c);
      solver.obstacle(c);
      const t = el('text', {
        class: 'pl-cluster-n', x: g.cx, y: g.cy + R * (isDynG ? 0.42 : 0.34), 'text-anchor': 'middle',
        'font-size': isDynG ? R * 1.15 : Math.max(10 / VIEW.z, R * 0.82),
      });
      t.textContent = String(g.rows.length);
      gDot.appendChild(t);
      clusterVis.push(t);
      // 聚合点报「这是哪儿」，不报「挤在一处」——挤不挤看得见，用不着说
      // （用户指出）。地名取簇内主点地名的众数；分散得没有众数就用最近的参照城市
      const where = NAMES.get(gid) || '此地';
      // 百来条的洋葱在 1× 下摊开盖半个华北——这图本不该在那个高度细看。
      // 大簇在低倍率下点一下先**拉近**（分组会自然裂细），贴近了再点才就地摊开
      // 拉近得裂得开才有意义：士林區 38 条全在台北故宫**同一个点**上，
      // 放大多少倍都还是一簇（用户点出的反例）——真坐标散布小到 3× 也
      // 拆不散（全员仍在 NEAR/3 分组圈里）的共址簇，直接摊开
      const span = Math.max(...g.rows.map((m2) => Math.hypot(m2.x - g.cx, m2.y - g.cy)));
      const zoomFirst = !isDynG && g.rows.length > 15 && VIEW.z < 3   // 阈值 15（用户调低：15–25 档）
        && span > NEAR / 3;
      const hit = el('circle', {
        class: 'pl-hit', cx: g.cx, cy: g.cy, r: R + (isDynG ? 2 : 3) / VIEW.z, tabindex: '0', role: 'button',
        'aria-label': isDynG ? `${where}，${cnum(g.rows.length)}朝古都，展开`
          : `${where}，${g.rows.length} 条，${zoomFirst ? '拉近' : '展开'}`,
      });
      gHit.appendChild(hit);
      clusterHits.push(hit);
      const open = () => {
        if (zoomFirst) {
          VIEW.cx = g.cx; VIEW.cy = g.cy;
          setZoom(Math.min(3, VIEW.z * 1.9));
          return;
        }
        state.open.clear();   // 展开态独占（用户拍板）：开新簇收旧簇
        state.open.add(gid); draw();
      };
      hit.addEventListener('click', (e) => { e.stopPropagation(); open(); });
      hit.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
      hit.addEventListener('mouseenter', () => {
        tipShow(g.cx, g.cy - R, isDynG ? `${where} · ${cnum(g.rows.length)}朝古都` : `${where} · ${g.rows.length} 条`, zoomFirst ? '点一下拉近' : '点一下摊开',
          `${g.rows.slice(0, 5).map((m) => m.r.n).join('、')}${g.rows.length > 5 ? '…' : ''}`);
        rd.hover(where, isDynG ? `${cnum(g.rows.length)}朝古都` : `${g.rows.length} 条`,
          `${g.rows.slice(0, 6).map((m) => m.r.n).join('、')}${g.rows.length > 6 ? ' 等' : ''}　·　${zoomFirst ? '点一下拉近' : '点一下摊开'}`);
      });
      hit.addEventListener('mouseleave', () => { tipHide(); if (!state.sel) rd.leave(); });
      continue;
    }

    spread(g);
    // 成员级二次驱离：spread() 会把都城成员甩回事件簇圆里（燕国压北京簇心，实测）
    if (g.rows.length && g.rows[0].r['层'] === 'dyn') {
      for (const m2 of g.rows) {
        for (const ef of EVF) {
          const dx = m2.px - ef.cx, dy = m2.py - ef.cy;
          const dd = Math.hypot(dx, dy), want = ef.R + 8 / VIEW.z;
          if (dd < want) {
            const ux = dd > 0.001 ? dx / dd : 1, uy = dd > 0.001 ? dy / dd : 0;
            m2.px = ef.cx + ux * want;
            m2.py = ef.cy + uy * want;
          }
        }
      }
    }
    // 摊开的簇垫一块**托盘**：折叠圆充气成盘，成员点坐在盘上（用户提出
    // 摊开后与盘下杂点混在一起看不清；Leaflet 的 spiderfy 只拉蛛腿不垫底，
    // 但我们的折叠圆本来就是不透明的，充气是它自然的下一步）。
    // 盘同时按「所见即所点」吃掉盘下杂点的点击——看不见的东西不该能点中
    if (g.rows.length > foldCap) {
      const pr = Math.max(...g.rows.map((m2) => Math.hypot(m2.px - g.cx, m2.py - g.cy))) + 11 / VIEW.z;
      const plate = el('circle', { class: 'pl-plate', cx: g.cx, cy: g.cy, r: pr });
      gDot.appendChild(plate);
      openVisBase.push(plate);
      const blocker = el('circle', { class: 'pl-hit pl-plate-hit', cx: g.cx, cy: g.cy, r: pr, 'aria-hidden': 'true' });
      blocker.addEventListener('click', (e) => e.stopPropagation());
      gHit.appendChild(blocker);
      openHits.push(blocker);   // 先于成员命中入列：垫底吃杂点，成员命中照常压其上
    }
    if (g.rows.length > 1) packed += g.rows.length;

    for (const m of g.rows) {
      const { r } = m;
      const id = idOf(r);
      const cls = r['层'] === 'dyn' ? 'k-dyn' : `k-${r.k}`;
      const low = r['链'][r._pi !== undefined ? r._pi : mainIdx(r)]['约'];
      // 散开之后拉一根细线回真位置：散开是为了点得中，细线是为了别让读者
      // 忘了它本来在哪儿。挪二十单位在这张图上就是一百多公里
      // 只在挪得够远时才拉引线：挪不到一个点的直径，引线给不出信息，
      // 只添乱——两个点之间的短线会被读成「这两条有关系」
      const moved = Math.hypot(m.px - m.x, m.py - m.y);
      if (moved > 9 / VIEW.z) {
        const ln = el('line', { x1: m.x, y1: m.y, x2: m.px, y2: m.py });
        if (g.rows.length > foldCap) {
          ln.setAttribute('class', 'pl-lead2');   // 抬到托盘上，别被盘盖掉蛛腿
          gDot.appendChild(ln);
          openVisBase.push(ln);
        } else gLead.appendChild(ln);
      }
      // 三等占全库大半，跟一等抢同样的墨量整张图就是一张地毯——
      // 小一号、淡一点，眼睛先看见大点，凑近才读小点
      const rad = ((r.r === 1 ? 5.8 : r.r === 2 ? 4.2 : 3) + (r['层'] === 'dyn' ? 0.8 : 0)) / VIEW.z;
      const kls = `pl-dot ${cls}${low ? ' pl-low' : ''}${r.r === 3 ? ' pl-r3' : ''}`
        + `${r['层'] === 'dyn' ? ' pl-dyn' : ''}${state.sel === id ? ' on' : ''}`;
      /* **政权都城画成方块。** 都城是一座城、一个座位，方的一眼读得出是另一层；
         再说圆的深灰点跟聚合点撞脸——那也是个深灰的圈 */
      const dot = r['层'] === 'dyn'
        ? el('rect', { class: kls, x: m.px - rad, y: m.py - rad, width: rad * 2, height: rad * 2 })
        : el('circle', { class: kls, cx: m.px, cy: m.py, r: rad });
      gDot.appendChild(dot);
      if (g.rows.length > foldCap) openVis.push(dot);
      solver.obstacle(dot);

      // 孤点命中圈给足（图上空旷，宽命中只帮不害）；散开成组的收小到贴着
      // 邻距的一半——展开环邻距 13.5–20 屏素，命中半径 24 会互相压掉大半，
      // 点谁全看画序（用户实测「不太好选」）。7.5 上下，圈与圈基本互不相压
      const baseHit = r['层'] === 'dyn' ? Math.max(rad * 1.8, 9 / VIEW.z) : Math.max(rad * 2.4, 11 / VIEW.z);
      const hit = el('circle', {
        class: 'pl-hit', cx: m.px, cy: m.py,
        r: g.rows.length > 1 ? Math.max(rad + 1.2 / VIEW.z, 7.5 / VIEW.z) : baseHit,
        tabindex: '0', role: 'button', 'aria-label': `${r.n}，${yr(r.y)}`,
      });
      gHit.appendChild(hit);
      if (r['层'] === 'dyn') dynHits.push(hit);
      if (g.rows.length > foldCap) openHits.push(hit);   // 走到这儿还超阈值＝展开中的簇
      const enter = () => {
        const meta = r['层'] === 'dyn' ? `${yr(r.y)} – ${yr(r.e)}　政权` : `${yr(r.y)}　${kindLabel(r)}`;
        const body = r['层'] === 'dyn' ? BIO.get(r.key) : YC.get(r.n);
        tipShow(m.px, m.py - rad, r.n, meta, body);
        if (!state.sel) { dot.classList.add('hot'); say(r, false); }
      };
      const leave = () => {
        tipHide();
        dot.classList.remove('hot');
        if (!state.sel) { rd.leave(); goOff(); }
      };
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
      const dynOnly = state.layers.has('dyn')
        && (!state.layers.has('ev') || state.off.size >= KINDS.length);
      // 放大了名字就该多：全图只标一等，放到 2.5 倍后二等也标，
      // 4 倍后三等也标——那时视口里没剩几个点，标得下
      const labOk = !r._minor && (r.r === 1 || (VIEW.z >= 2.5 && r.r === 2) || VIEW.z >= 4 || state.world);
      if (!state.sel && (labOk || (r['层'] === 'dyn' && dynOnly))) {
        const h = haloText(gLab, r.n, {
          size: (r['层'] === 'dyn' ? 11.5 : 12.5) / VIEW.z, halo: 'var(--surface-2)',
          haloWidth: 3.6 / VIEW.z, weight: 600,
        });
        h.over.setAttribute('class', `pl-lab ${cls}`);
        jobs.push({ h, p: [m.px, m.py + 1 / VIEW.z], pri: 90, cands: placeCandidates('e', 1 / VIEW.z) });
      }
    }
  }

  // 都城命中区整体抬到命中层最上：方块比圆点少、又常与事件同城，被压住就点不中
  for (const h of dynHits) gHit.appendChild(h);
  for (const h of clusterHits) gHit.appendChild(h);
  for (const h of openHits) gHit.appendChild(h);
  for (const v of clusterVis) gDot.appendChild(v);
  for (const v of openVisBase) gDot.appendChild(v);
  for (const v of openVis) gDot.appendChild(v);
  if (selAt) {
    jobs.push(...drawChain(selAt.r, selAt.x, selAt.y));
    say(selAt.r, true);
  } else if (state.sel) {
    state.sel = null;               // 选中的那条被筛掉了：松开，别留个指着空处的链
    rd.unpin(); goOff(); EMB.hide(); clearExtent();
  } else if (rd.pinned && !LN.key) {
    // 再点一下或点空白取消选中,此前只清 state.sel、坞一直钉着旧文案(嵌卡让这
    // 个滞留显了形);走线模式的钉住不走 state.sel,故要避开
    rd.unpin(); goOff(); EMB.hide(); clearExtent();
  }

  for (const j of jobs) {
    solver.job({
      nodes: j.h.nodes, priority: j.pri, candidates: j.cands,
      apply: ([dx, dy, anchor]) => j.h.at(j.p[0] + dx, j.p[1] + dy, anchor || 'middle'),
    });
  }
  const { hidden } = solver.solve();
  tally(rows, gs2, packed, folded, hidden);
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
  if (centred || !rows.length || VIEW.z > 1) return;
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
  const syncs = [];
  const refresh = () => { syncs.forEach((f) => f()); draw(); };
  /* 单击开关一类；**双击只看这一类**（类别多了之后逐个关太费手，用户提的）。
     双击前浏览器会先派发两次单击，把这一类翻了两遍等于没翻，净效果正好是独显 */
  const chip = (cls, html, isOn, toggle, solo) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip pl-chip ${cls}`;
    b.title = '单击开关；双击只看这一类';
    b.innerHTML = html;
    syncs.push(() => b.classList.toggle('on', isOn()));
    b.addEventListener('click', () => { toggle(); refresh(); });
    b.addEventListener('dblclick', () => { solo(); refresh(); });
    bar.appendChild(b);
  };
  for (const k of KINDS) {
    const n = EV_ROWS.filter((r) => r.k === k).length;
    chip(`k-${k}`, `<span class="pl-swatch"></span>${(EVENT_KINDS[k] || {}).label || k} ${n}`,
      () => state.layers.has('ev') && !state.off.has(k),
      () => {
        if (!state.layers.has('ev')) { state.layers.add('ev'); state.off = new Set(KINDS.filter((x) => x !== k)); return; }
        if (state.off.has(k)) state.off.delete(k); else state.off.add(k);
      },
      () => { state.layers = new Set(['ev']); state.off = new Set(KINDS.filter((x) => x !== k)); });
  }
  if (HAS_DYN) {
    chip('k-dyn', `<span class="pl-swatch"></span>政权都城 ${DYN_ROWS.length}`,
      () => state.layers.has('dyn'),
      () => { if (state.layers.has('dyn')) state.layers.delete('dyn'); else state.layers.add('dyn'); },
      () => { state.layers = new Set(['dyn']); });
  }
  // 全开：一键回到什么都画的状态。类别一多，逐个点开比逐个点关还费手。
  // 双态（2026-08-28 库主点子，与泳道图例同款）：全亮时这颗钮变「全关」——
  // 先全关再点一类即独看，与双击独显互为备份
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'chip pl-chip pl-chip-all';
  const allOn = () => state.layers.has('ev') && !state.off.size
    && (!HAS_DYN || state.layers.has('dyn'));
  syncs.push(() => {
    all.textContent = allOn() ? '全关' : '全开';
    all.title = allOn() ? '全部关掉，再点选一类即独看' : '重新点亮全部类别';
  });
  all.addEventListener('click', () => {
    if (allOn()) {
      state.off = new Set(KINDS);
      state.layers = new Set(['ev']);   // ev 层留着、类别全灭；dyn 层一并息灯
    } else {
      state.off.clear();
      state.layers = new Set(HAS_DYN ? ['ev', 'dyn'] : ['ev']);
    }
    refresh();
  });
  bar.appendChild(all);
  // 图例行不再放世界版chip（库主裁：与缩放柱的世界钮冗余，2026-08-31）——
  // 左下小版钮亦于同日二裁（同一冗余），切换只余缩放柱一处
  syncAll = refresh;
  refresh();
}

function mountYear() {
  const sl = $('plate-year'), out = $('plate-year-out');
  // 等事密度标尺（库主定，2026-08-29，只本页用）：滑杆刻度是**事件序号**不是年——
  // 每挪一步多放一件事进图。线性年标尺退役的原因：域已达前4749，可前2000年
  // 只有事件 7% 却占轨道六成，滑杆大半是死区。事件序号天然「疏处压、密处展」，
  // 且 state.upto 保持年份语义，「截至/当时」两层读法与疆域切片零改动。
  // 同年多事在轨道上是并排几步（拖过去年份不动）——这不是毛病，等密本义如此。
  // 刻度线每二十件事一格（库主给的尺度），datalist 在不认它的浏览器里静默无害。
  const STOPS = EV_ROWS.map((r) => r.y).sort((a, b) => a - b);
  sl.min = '0'; sl.max = String(STOPS.length); sl.step = '1';
  sl.value = sl.max;
  const dl = $('plate-year-ticks');
  if (dl) {
    // 两端必须各有一格刻度：有 list 的滑杆在部分浏览器带磁吸，末格只到980的话
    // 拖到头会被吸在980上、永远够不着「全部」（库主实测报案，2026-08-29）
    for (let i = 0; i <= STOPS.length; i += 20) {
      const o = document.createElement('option');
      o.value = String(Math.min(i, STOPS.length));
      dl.appendChild(o);
    }
    if (STOPS.length % 20) {
      const o = document.createElement('option');
      o.value = String(STOPS.length);
      dl.appendChild(o);
    }
  }
  const sync = () => {
    const i = Number(sl.value);
    state.upto = i >= STOPS.length ? Infinity : STOPS[i];
    // 只写年份，解释挪进了 label 的悬停提示（库主令：不常驻）。
    // 拖动时文字变宽把滑杆挤得跳（用户实测指出）——动态文字必须定宽
    out.textContent = Number.isFinite(state.upto) ? `${yr(state.upto)} 年` : '全部';
    // 疆域层跟滑杆换切片：钉着的政权若有多张图，滑到哪年换哪张（坞行年份暂不追改，
    // 下次钉住时自然对齐——追改要重排 bits，代价大于收益）
    if (state.sel && state.sel.startsWith('dyn:') && state.showExtent) {
      const nm = state.sel.slice(4);
      const kk = Object.keys(TERR).find((x) => TERR[x]['名'] === nm);
      if (kk) drawExtent(kk);
    }
    draw();
  };
  sl.addEventListener('input', sync);
  sync();
}

// 点空处 / 按 Esc = **全收回**：链收回去，展开过的聚合点也收回去。
// 「松开之后图没变回原样」是用户实测指出的——展开的那一环一直留着，
// 读者以为自己没退出来
const collapse = () => {
  if (suppressClick) { suppressClick = false; return; }   // 刚拖完图，不是点空白
  if (!state.sel && !state.open.size) return;
  state.sel = null; state.open.clear(); draw();
};
svg.addEventListener('click', collapse);
addEventListener('keydown', (e) => {
  if (LN.key) {
    // 走线时方向键翻站，Esc 退出走线
    if (e.key === 'ArrowRight') lnGoto(LN.at + 1);
    else if (e.key === 'ArrowLeft') lnGoto(LN.at - 1);
    else if (e.key === 'Escape') { exitLine(); history.replaceState(null, '', location.pathname); }
    return;
  }
  if (e.key === 'Escape') collapse();
});

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

syncCounts({ ev: EVENTS.length, geo: EV_ROWS.length, dyn: DYN_ROWS.length });

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

/* ── 地图走法：同一条故事线，在地图上走 ─────────────────────────────
   与时间轴的走法（tour.js）**共用同一份数据**：站表在 js/lines.js、
   每站的地理档在它的 geo 字段（js/geo.js）。两边只是各自的薄适配器——
   时间轴那边高亮河道与泳道，这边点亮落点、画出全程的路线。
   深链也对称：timeline.html#line=<key> 走图，map.html#line=<key> 走地。

   基础图层在走线时压暗但不撤：读者仍看得见「这条线穿过一个多热闹的地方」，
   而路线自己压在最上面。 */

const LN = { key: null, at: 0, stops: [], bar: null };

const lnRep = (g) => (g
  ? (g['点'] || (g['诸说'] && g['诸说'][0] && g['诸说'][0]['点']) || null)
  : null);

function lnLabel(i) {
  if (i === 0) return '序';
  if (i === LN.stops.length - 1) return '终';
  return String(i);
}

function drawLn() {
  gLn.innerHTML = '';
  if (!LN.key) return;
  const iz = 1 / VIEW.z;          // 走线层的尺寸同样跟着缩放走，别吹大
  const jobs = [];
  const pts = [];
  LN.stops.forEach((st, i) => {
    const rp = lnRep(st.g);
    if (rp) pts.push({ i, p: xy(rp) });
  });
  // 顺次相连的淡虚线：石窟线在地上是一条自西向东的路，读者要看见全程。
  // 勘合线是一片散点——那这条弯来弯去的线本身就是「散」的证据
  for (let i = 0; i + 1 < pts.length; i += 1) {
    gLn.appendChild(el('line', {
      class: 'pl-ln-route', x1: pts[i].p[0], y1: pts[i].p[1],
      x2: pts[i + 1].p[0], y2: pts[i + 1].p[1],
    }));
  }
  for (const { i, p } of pts) {
    const cur = i === LN.at;
    gLn.appendChild(el('circle', {
      class: `pl-ln-stop${cur ? ' cur' : ''}`, cx: p[0], cy: p[1], r: (cur ? 10 : 7.5) * iz,
    }));
    const t = el('text', {
      class: `pl-ln-n${cur ? ' cur' : ''}`, x: p[0], y: p[1] + 3.4 * iz,
      'text-anchor': 'middle', 'font-size': (cur ? 10 : 8.5) * iz,
    });
    t.textContent = lnLabel(i);
    gLn.appendChild(t);
    const hit = el('circle', {
      class: 'pl-hit', cx: p[0], cy: p[1], r: 14 * iz,
      tabindex: '0', role: 'button', 'aria-label': `第 ${lnLabel(i)} 站`,
    });
    gLn.appendChild(hit);
    hit.addEventListener('click', (e) => { e.stopPropagation(); lnGoto(i); });
    hit.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); lnGoto(i); }
    });
    hit.addEventListener('mouseenter', () => tipShow(p[0], p[1] - 10 * iz,
      LN.stops[i].t || '', `第 ${lnLabel(i)} 站`, ''));
    hit.addEventListener('mouseleave', tipHide);
  }
  // 当前站的细节，照小地图那套读法：诸说空心、现藏一条虚线牵出去
  const st = LN.stops[LN.at];
  const g = st && st.g;
  if (g) {
    const rp = lnRep(g);
    if (g['诸说']) {
      for (const sc of g['诸说']) {
        const [x, y] = xy(sc['点']);
        gLn.appendChild(el('circle', { class: 'pl-ln-maybe', cx: x, cy: y, r: 5.5 * iz }));
        const h = haloText(gLn, sc['名'], { size: 10.5 * iz, halo: 'var(--surface-2)', haloWidth: 3.2 * iz });
        h.over.setAttribute('class', 'pl-ln-t');
        jobs.push({ h, p: [x, y], pri: 250, cands: placeCandidates('e', iz) });
      }
    }
    if (g['地名'] && rp) {
      const [x, y] = xy(rp);
      const h = haloText(gLn, g['地名'], { size: 12 * iz, halo: 'var(--surface-2)', haloWidth: 3.4 * iz });
      h.over.setAttribute('class', 'pl-ln-t cur');
      jobs.push({ h, p: [x, y], pri: 300, cands: placeCandidates('e', iz) });
    }
    if (g['现藏'] && rp) {
      // 现藏可能在图外（《金刚经》在伦敦）：照链的规矩，朝真实大圆方位画到边上
      const [px, py] = xy(rp);
      let [qx, qy] = xy(g['现藏']);
      const [w0, s0, e0, n0] = BASEMAP.bbox;
      const out = !(g['现藏'][1] >= w0 && g['现藏'][1] <= e0
        && g['现藏'][0] >= s0 && g['现藏'][0] <= n0);
      if (out) {
        const th = bearing(rp, g['现藏']);
        qx = px + (W + H) * 2 * Math.sin(th);
        qy = py - (W + H) * 2 * Math.cos(th);
      }
      const seg = clipSeg(px, py, qx, qy);
      if (seg) {
        gLn.appendChild(el('line', {
          class: 'pl-ln-flow', x1: seg[0], y1: seg[1], x2: seg[2], y2: seg[3],
        }));
        gLn.appendChild(el('rect', {
          class: `pl-ln-held${out ? ' out' : ''}`,
          x: seg[2] - 4.5 * iz, y: seg[3] - 4.5 * iz, width: 9 * iz, height: 9 * iz,
        }));
        const h = haloText(gLn, `${g['藏于'] || '现藏'}${out ? '（图外）' : ''}`,
          { size: 10.5 * iz, halo: 'var(--surface-2)', haloWidth: 3.2 * iz });
        h.over.setAttribute('class', 'pl-ln-t');
        jobs.push({ h, p: [seg[2], seg[3]], pri: 260, cands: placeCandidates(out ? 'w' : 'e', iz) });
      }
    }
  }
  const solver = new LabelSolver();
  gLn.querySelectorAll('circle, rect').forEach((n) => solver.obstacle(n));
  for (const j of jobs) {
    solver.job({
      nodes: j.h.nodes, priority: j.pri, candidates: j.cands,
      apply: ([dx, dy, anchor]) => j.h.at(j.p[0] + dx, j.p[1] + dy, anchor || 'middle'),
    });
  }
  solver.solve();
}

function lnGoto(i) {
  LN.at = Math.max(0, Math.min(LN.stops.length - 1, i));
  const st = LN.stops[LN.at];
  drawLn();
  const name = LINES[LN.key].name;
  const kick = `${name}　第 ${lnLabel(LN.at)} / ${LN.stops.length - 2} 站`;
  const body = [st.b, st.b2].filter(Boolean).join('　');
  rd.pin(kick, st.t, body + (st.g ? '' : '　·　这一站没有地点，图上不硬造一个'));
  { const ev = EV_BY_N.get(st.t); if (ev) EMB.show(evSpec(ev)); else EMB.hide(); }
  goOff();
  if (LN.bar) {
    const read = LN.bar.querySelector('[data-a=read]');
    const tl = LN.bar.querySelector('[data-a=tl]');
    if (read) read.href = st.read || `story/${LN.key}.html`;
    if (tl) tl.href = `timeline.html#line=${LN.key}&at=${LN.at}`;
    LN.bar.querySelector('[data-a=prev]').disabled = LN.at === 0;
    const nx = LN.bar.querySelector('[data-a=next]');
    nx.textContent = LN.at === LN.stops.length - 1 ? '走完了' : '下一站 →';
    nx.disabled = LN.at === LN.stops.length - 1;
  }
  // 窄屏：把视口挪到当前站
  const box = $('plate');
  const rp = st.g && lnRep(st.g);
  if (rp && box.scrollWidth > box.clientWidth + 1) {
    box.scrollLeft = Math.max(0, (xy(rp)[0] / W) * box.scrollWidth - box.clientWidth / 2);
  }
}

function enterLine(key, at) {
  const L = LINES[key];
  if (!L || !L.geo) return false;
  if (LN.key) exitLine();
  LN.key = key;
  LN.stops = L.stops.map((st) => ({ ...st, g: st.ev ? (L.geo[st.ev] || null) : null }));
  state.sel = null; state.open.clear();
  svg.classList.add('pl-lining');
  draw();
  const bar = document.createElement('div');
  bar.className = 'pl-ln-bar';
  bar.innerHTML = '<button type="button" class="chip" data-a="prev">← 上一站</button>'
    + '<button type="button" class="chip" data-a="next">下一站 →</button>'
    + '<a class="chip" data-a="read" target="_self">读全文 ↗</a>'
    + '<a class="chip" data-a="tl" target="_self">到时间轴上走这一站 ↗</a>'
    + '<button type="button" class="chip" data-a="exit">退出走线 ✕</button>';
  $('plate-read').after(bar);
  bar.addEventListener('click', (e) => {
    const act = e.target.dataset && e.target.dataset.a;
    if (act === 'prev') lnGoto(LN.at - 1);
    else if (act === 'next') lnGoto(LN.at + 1);
    else if (act === 'exit') { exitLine(); history.replaceState(null, '', location.pathname); }
  });
  LN.bar = bar;
  lnGoto(Number.isFinite(at) ? at : 0);
  return true;
}

function exitLine() {
  if (!LN.key) return;
  LN.key = null; LN.stops = [];
  gLn.innerHTML = '';
  svg.classList.remove('pl-lining');
  if (LN.bar) { LN.bar.remove(); LN.bar = null; }
  rd.unpin(); goOff(); EMB.hide(); clearExtent();
  draw();
}

function lnFromHash() {
  const m = /(?:^|[#&])line=([a-z0-9_-]+)/i.exec(location.hash || '');
  if (!m) return null;
  const a2 = /(?:^|[#&])at=(\d+)/.exec(location.hash || '');
  return { key: m[1], at: a2 ? Number(a2[1]) : 0 };
}

addEventListener('hashchange', () => {
  const k = lnFromHash();
  if (k) enterLine(k.key, k.at);
  else exitLine();
});

/** 入口：故事线的启动链接，跟在类别行后面。 */
function mountLineChips() {
  const bar = $('plate-kinds');
  // 故事线书钮（2026-08-26 库主令：与时间轴同款 📖 元件标准化，居搜索框右侧；
  // 「走一条线：」文字排与折叠单/文字钮一并退役）。目录浮层走共用件 line-catalog.js：
  // 图页池子只列带 geo 的线，选中即走图，零轴位移
  const geoLines = Object.values(LINES).filter((L) => L.geo);
  const cat = buildLineCatalog({
    lines: geoLines,
    onPick: (L) => { history.replaceState(null, '', `#line=${L.key}`); enterLine(L.key, 0); },
  });
  const btn = document.createElement('button');
  btn.type = 'button';
  // 与骰子同排须同视觉档（2026-08-26 库主令：一繁一简别扭，取双简）——
  // 只留 📖 图标，名字进 title/aria；搜索行寸土寸金
  btn.className = 'pl-dice pl-book';
  btn.textContent = '📖';
  btn.title = '故事线目录：穿过这张图的几种读法';
  btn.setAttribute('aria-label', '故事线目录');
  btn.addEventListener('click', cat.open);

  // 搜索框（用户 2026-08-22 提）：轻装版——只搜图上有落点的条目与政权名，
  // 不引河页搜索的大池子（那会把君主全表拖进图页；拼音键记在接缝清单待并）。
  // 选中即定位：挪视野、拉近、种下选中态——坞与嵌卡随 say() 一起到位
  const sbox = document.createElement('div');
  sbox.className = 'pl-search';
  const sidx = [];   // 懒建：首次敲键时按 ALL 铺（含拼音键）
  const sin = document.createElement('input');
  sin.type = 'search'; sin.placeholder = '搜图上的条目 / 政权…';
  sin.autocomplete = 'off'; sin.setAttribute('aria-label', '搜索并定位');
  const slist = document.createElement('div');
  slist.className = 'pl-search-list';
  // 骰子照搬时间轴（用户指令带到地图）：解决「不知道该搜什么」。
  // 池取 ALL——地图上政权有都城点，落点不虚，不照时间轴排除政权
  let lastPick = null;
  const dice = document.createElement('button');
  dice.type = 'button'; dice.className = 'pl-dice'; dice.title = '随机跳到图上一条';
  dice.setAttribute('aria-label', '随机跳到图上一条');
  dice.textContent = '🎲';
  dice.addEventListener('click', () => {
    // 骰子只掷在正看着的宇宙里（用户票据 2026-08-21）：shown() 已含层/类别/
    // 年代滑块/低置信/自动坐标全套开关；全关到没得摇时退回全库，免得按钮装死
    let pool = shown();
    if (pool.length < 2) pool = ALL;
    if (pool.length < 2) return;
    let pick = null;
    for (let a2 = 0; a2 < 8 && (!pick || pick === lastPick); a2 += 1) {
      pick = pool[Math.floor(Math.random() * pool.length)];
    }
    lastPick = pick;
    dice.classList.remove('rolling');
    void dice.offsetWidth;               // 重启动画：不回流的话连按第二下不动（时间轴同注）
    dice.classList.add('rolling');
    locate(pick);
  });
  sbox.append(sin, dice, btn, slist);   // 骰子居右（用户指定：不另起一行）；书钮再靠右（2026-08-26 库主令）
  bar.after(sbox);
  const locate = (r) => {
    slist.innerHTML = ''; sin.value = r.n;
    if (r['层'] !== 'dyn' && state.off.has(r.k)) state.off.delete(r.k);   // 关着的类先点亮
    state.layers.add(r['层'] === 'dyn' ? 'dyn' : 'ev');
    const [x, y2] = trueXY(r);
    VIEW.cx = x; VIEW.cy = y2;
    setZoom(Math.max(VIEW.z, 4.5));
    state.sel = idOf(r);
    say(r, true);
    scheduleDraw();
    // 骰子/搜索落点：底部全卡太远，小卡就地弹出（用户票据 2026-08-21）。
    // 双 rAF 等新视图落定再算屏坐标；悬停别处会顶掉它，按下地图即收。
    const meta = r['层'] === 'dyn' ? `${yr(r.y)} – ${yr(r.e)}　政权` : `${yr(r.y)}　${kindLabel(r)}`;
    const body = r['层'] === 'dyn' ? BIO.get(r.key) : YC.get(r.n);
    requestAnimationFrame(() => requestAnimationFrame(() =>
      tipShow(x, y2 - 8 / VIEW.z, r.n, meta, body)));
  };
  sin.addEventListener('input', () => {
    const q = sin.value.trim();
    slist.innerHTML = '';
    if (q.length < 1) return;
    // 检索核与时间轴同源（search-core.js，用户指令合体）：拼音全拼与首字母
    // 从此可搜（yuan→元、wdwcaitaopen 不行但 wudaowen 行）。排序仍是
    // 精确→前缀→包含、短名优先——不然查「元」时含元的事件把八个坑全占了，
    // 政权「元」自己反而挤不进候选（实测踩到）
    if (!sidx.length) {
      for (const r of ALL) sidx.push({ r, keys: searchWithPy([r.n, r.ya, r.w].filter(Boolean).map(searchNorm)) });
    }
    const nq = searchNorm(q);
    const hitRows = sidx
      .map((it) => ({ r: it.r, s: searchScore(it.keys, nq) }))
      .filter((x) => x.s < 99)
      .sort((a2, b2) => (a2.s * 100 + a2.r.n.length) - (b2.s * 100 + b2.r.n.length))
      .slice(0, 8)
      .map((x) => x.r);
    for (const r of hitRows) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${r.n}　${kindLabel(r)} · ${yr(r.y)}`;
      b.addEventListener('click', () => locate(r));
      slist.appendChild(b);
    }
  });
  sin.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const b = slist.querySelector('button'); if (b) b.click(); }
    if (e.key === 'Escape') { slist.innerHTML = ''; sin.value = ''; }
  });
}

function mountSettings() {
  const wire = (id, key) => {
    const box = $(id);
    if (!box) return;
    box.addEventListener('change', () => { state[key] = box.checked; draw(); });
  };
  wire('pl-set-alive', 'aliveOnly');
  wire('pl-set-low', 'showLow');
  wire('pl-set-auto', 'showAuto');
  wire('pl-set-terr', 'showTerr');
  wire('pl-set-ext', 'showExtent');
  const ext = $('pl-set-ext');
  if (ext) ext.addEventListener('change', () => { if (!ext.checked) clearExtent(); });
}

fillCoverage();
mountKinds();
mountLineChips();
mountYear();
mountSettings();
{
  const k0 = lnFromHash();
  if (k0) enterLine(k0.key, k0.at);
}
