// minimap.js — 故事线走到哪儿了，在地上是哪儿。
//
// 只在宽屏出现，贴在讲解坞**对角**的那个角上：讲解在左下，它就去右下；
// 讲解被挤到右边（dock-right），它就换到左边。窄屏没有这个角可用，整块隐藏。
//
// 它回答的是时间轴回答不了的一个问题：石窟线那十一站在图上只是十一个年份，
// 在地上却是一条自西向东的路——拜城、敦煌、天水、大同、洛阳。文字讲「佛教东传」，
// 地图上那个点真的在往东挪。
//
// **一站不一定一个点**（见 js/geo.js）：确定的一处是实心点，诸说是若干空心点，
// 文物的现藏地是一条细线连出去、末端一个空心方块，没有地点的站整块淡出。
// 这几条的展开归 js/plate-line.js 的 marksOf()——**跟故事页那张大图同一个函数**。
//
// 底图只有海岸线与黄河长江，没有国界（理由见 tools/mining/build_basemap.py）。
//
// 图上的字全部走 js/plate.js：**衬底**（同一段字画两遍，底下那遍描一圈纸色粗边）
// 与**排版器**（按优先级逐个试位置，撞上就换，全撞就不画）。
// 之前这两样都没有：城市名压在海岸线上糊成一片，站名又跟城市名叠在一起。
// 排版顺序即优先级——站名 > 河名 > 城市名。城市名是坐标纸，让位是它的本分。
//
// 2026-08-21：取景、贴边、站表展开、登记标签这几样搬进 js/plate-line.js，
// 与故事页大图（tools/mining/render_line_map.mjs）合成一份。原先这儿的
// fit/clamp/inFrame/everyPoint 与那边的 fit_box/clamp/build_marks 是同一件事的
// 两种写法。留边 pad 一并归到 **1.30**（本来这儿是 1.35，取景比故事页松一档）。

// 字号量纲：u(N) 即物理 N px（unitOf 把物理像素换算进 viewBox）。
// 2026-08-22 库主指出字太小、当有物理下限——直接抬到正文级：
// 站名 12 / 现藏 11 / 河名 10 / 城市 9。撞了让位照旧归排版器。
import { BASEMAP } from './basemap.js';
import {
  el, plateFilters, lakeLayer, LabelSolver, placeCandidates, NUDGES,
  ANCHORS, RIVER_TAGS,
} from './plate.js';
import {
  xy, fitBox, unitOf, inViewOf, clampTo, marksOf, dustOf, dustGroup, tagJob, runJobs,
} from './plate-line.js';


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
  // 大湖夹在海岸与河之间（2026-08-26 底图水系扩建案）。次序即层序：河压在湖上。
  // 赤壁线取景正在长江中游，洞庭与鄱阳会占掉小地图不小的一块——这是它该占的：
  // 那一战就打在长江与洞庭之间
  lakeLayer(svg, BASEMAP.lakes, 'mm-lake');
  svg.appendChild(el('path', { class: 'mm-river', d: BASEMAP.rivers }));
  const gRef = el('g', { class: 'mm-ref' });     // 参照：城市与河名
  const gAll = el('g', { class: 'mm-all' });     // 全程：淡点
  const gNow = el('g', { class: 'mm-now' });     // 本站：亮
  svg.append(gRef, gAll, gNow);
  const note = document.createElement('div');
  note.className = 'mm-note';
  wrap.append(svg, note);
  document.body.appendChild(wrap);

  // 屏上想要多大就写多大，再折算回视图单位——viewBox 一缩放，
  // 写死的半径就会跟着变；点在石窟线上正好，到赤壁线上就成了一团。
  // 宽度**现量**，不写死：CSS 里改成了 clamp()（用户嫌 258px 太小），
  // 这儿再留个 258 就会字号失配，而且下次调 CSS 还得记得来改这行
  let PX = 258;
  let u = unitOf(VB, PX);
  let inView = inViewOf(VB, 0.04);

  const fit = () => {
    PX = wrap.clientWidth || PX;               // 此刻已显示，量得到真宽
    const { pts } = marksOf(allOf() || []);
    if (!pts.length) return;
    VB = fitBox(pts);                          // 留边 1.30，与故事页同一个值
    u = unitOf(VB, PX);
    inView = inViewOf(VB, 0.04);
    svg.setAttribute('viewBox', VB.join(' '));
    // 糊的程度写在用户单位里，viewBox 一缩放就会跟着变。描边有
    // non-scaling-stroke 顶着，滤镜没有，故这里现折算回去
    const b = defs.querySelector('feGaussianBlur');
    if (b) b.setAttribute('stdDeviation', u(0.85).toFixed(2));
  };

  // 待排的字。位置由 solve() 一次性定——各画各的必然叠，这是 eco-web 那次的教训。
  // `frame: VB` 让 plate-line 顺手补上「不许出框」那条判据：小图上字相对更大，
  // 一个贴着右缘的「乌鲁木齐」排版器认为没撞上谁，落座之后被 viewBox 裁掉半个字
  const refJobs = [], nowJobs = [];
  const tag = (g2, name, cls, size, pri, cands, at) => tagJob(g2, name, {
    cls, size, pri, cands, at, frame: VB, margin: u(1.5),
    halo: 'var(--surface-1)', haloWidth: u(2.6),
  });

  /** 参照层：视野内的城市与河名。节点只造一次，摆哪儿每次重排。 */
  const drawRef = () => {
    gRef.innerHTML = ''; refJobs.length = 0;
    for (const [name, lat, lon] of ANCHORS) {
      const p = xy([lat, lon]);
      if (!inView(p)) continue;
      gRef.appendChild(el('circle', { class: 'mm-city', cx: p[0], cy: p[1], r: u(1.6) }));
      refJobs.push(tag(gRef, name, 'mm-city-t', u(9), 10, placeCandidates('e', u(1)), p));
    }
    // 河名贴在河上，**不能跑远**——跑远了就指着别的地方了，故只微挪
    for (const [name, lat, lon] of RIVER_TAGS) {
      const p = xy([lat, lon]);
      if (!inView(p)) continue;
      const nudge = NUDGES.tight.map(([dx, dy]) => [u(dx * 0.6), u(dy * 0.6), 'middle']);
      refJobs.push(tag(gRef, name, 'mm-river-t', u(10), 50, nudge, p));
    }
  };

  /** 一次把图上所有的字摆好。站名最先落座，城市名最后，撞满了就不画。 */
  const layout = () => {
    const sv = new LabelSolver();
    gNow.querySelectorAll('circle, rect').forEach((n) => sv.obstacle(n));
    gRef.querySelectorAll('circle').forEach((n) => sv.obstacle(n));
    runJobs(sv, refJobs.concat(nowJobs));
  };

  // 全程底稿只画一次：每站取一个代表点（诸说取第一个，只为让读者看见全程的展布）
  const drawAll = () => {
    gAll.innerHTML = '';
    for (const mk of marksOf(allOf() || []).marks) {
      const p = mk.main || mk.says[0];
      if (p) gAll.appendChild(el('circle', { cx: p[0], cy: p[1], r: u(3.2) }));
      if (mk.held) gAll.appendChild(el('circle', { cx: mk.held[0], cy: mk.held[1], r: u(3.2) }));
    }
  };

  // 尘点铺底：全库落点当坐标纸，点密之处自然是名城（用户 2026-08-21 定的星野版，
  // 与故事页大图同一套；尘点不进避让账，halo 让字骑在底纹上照样读得出）。
  // **懒加载**：js/geo-events.js 有 260 KB，时间轴页本来一点都不载它。小地图只在
  // 宽屏、且只在带地理档的线上才出现，故等它真的出现了再去取；取不到就没有底纹，
  // 不报错也不挡路——底纹是坐标纸，不是内容
  const drawDust = () => {
    import('./geo-events.js').then(({ GEO_EVENTS }) => {
      const g = dustGroup(dustOf(GEO_EVENTS), {
        cls: 'mm-dust', gcls: 'mm-dusts', r: u(0.9).toFixed(2), keep: inViewOf(VB, 0),
      });
      svg.insertBefore(g, gRef);              // 垫在参照层下面
    }).catch(() => { /* 没取到就没有底纹 */ });
  };

  let drawn = false;
  const show = (ev) => {
    if (innerWidth <= 1000) { wrap.classList.remove('on'); return; }
    const g = ev ? geoOf(ev) : null;
    const mk = g ? marksOf([g]).marks[0] : null;
    if (!mk) { wrap.classList.remove('on'); return; }     // 没地点就不硬造一个
    wrap.classList.add('on');      // **先显示再画**：量宽度、量字框都要它可见
    if (!drawn) { fit(); drawRef(); drawAll(); drawDust(); drawn = true; }
    gNow.innerHTML = ''; nowJobs.length = 0;
    let msg = '';
    for (const p of mk.says) {
      gNow.appendChild(el('circle', { class: 'mm-maybe', cx: p[0], cy: p[1], r: u(4.5) }));
    }
    if (mk.sayCount) msg = `${mk.sayCount} 说并存`;
    if (mk.main) {
      gNow.appendChild(el('circle', { class: 'mm-here', cx: mk.main[0], cy: mk.main[1], r: u(4.5) }));
      // 地名直接标在点旁：底下那行小字要跨到眼睛外面去才读得到。
      // 优先级给到最高——这一站的名字是**必须**画出来的那个
      if (mk.place) {
        nowJobs.push(tag(gNow, mk.place, 'mm-here-t', u(12), 100,
          placeCandidates('e', u(1)), mk.main));
      }
      msg = mk.place || '';
    }
    if (mk.held) {
      // 这儿的「图外」问的是**出没出这张图的取景框**（比 marksOf 那个「出没出底图
      // 范围」严）：小地图按本线取景，台北在底图里，却常常落在赤壁线的框外
      const [hx, hy, off] = clampTo(mk.held, VB, u(9));
      const from = mk.main || mk.says[0];
      if (from) {
        const [fx, fy] = clampTo(from, VB, u(9));
        gNow.appendChild(el('line', { class: 'mm-flow', x1: fx, y1: fy, x2: hx, y2: hy }));
      }
      gNow.appendChild(el('rect', {
        class: 'mm-held' + (off ? ' mm-off' : ''),
        x: hx - u(4), y: hy - u(4), width: u(8), height: u(8),
      }));
      // 现藏地也标名字。**图外的不标**：名字钉在框边上，读者会以为东西就在那儿；
      // 虚线方块只说「往那个方向」，那行小字里的「（图外）」才说清楚
      if (!off && mk.heldName) {
        nowJobs.push(tag(gNow, mk.heldName, 'mm-held-t', u(11), 80,
          placeCandidates('e', u(1)), [hx, hy]));
      }
      const where = mk.heldName + (off ? '（图外）' : '');
      msg = msg ? `${msg} → 现藏${where}` : `现藏${where}`;
    }
    note.textContent = msg;
    layout();
  };

  const hide = () => wrap.classList.remove('on');
  const side = (right) => wrap.classList.toggle('mm-left', !right);
  return {
    show, hide, side,
    destroy() { wrap.remove(); },
  };
}
