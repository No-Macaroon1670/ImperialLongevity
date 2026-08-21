// render_line_map.mjs — 在 node 里跑 js/plate.js，把一条故事线的大图渲成静态 SVG。
//
// 立项理由见 docs/architecture-seams.md 末节：制图代码一度有三份（plate.js、
// app-map.js、build_line_page.py 的 map_svg），而消费者有三个——
//   ① 故事页大图（构建时静态嵌进 story-*.html）
//   ② 时间轴走线的右下小地图（运行时，js/minimap.js）
//   ③ 地图页（运行时，js/app-map.js）
// ②③ 早就在用 plate.js；只有 ① 另起了一套 python。本文件是把 ① 也接上去的那根管子：
// **同一个 LabelSolver、同一份 ANCHORS、同一个 project()**，新开一条线只带数据来。
// python 那边的 map_svg/mapper/fit_box/clamp/build_marks 与那份自己抄的 ANCHORS
// 已经删净——**不留退路**，留了就等于把刚还掉的两百行债又养起来。
//
// ── 为什么要垫片 ────────────────────────────────────────────────────────
// plate.js 里跟 DOM 打交道的只有两处，别处一行都没有：
//   · el()                  → document.createElementNS
//   · LabelSolver.rectOf()  → node.getBoundingClientRect()
// 其余（ANCHORS / SIDES / placeCandidates / drift / graticulePath / parallelPath、
// 以及排版器的撞框与调度逻辑）在 node 里直接就能跑，实测过。
//
// 所以不用 jsdom。**jsdom 反而不能用**：它不做排版，getBoundingClientRect 一律
// 返回全零，而 rectOf 量不出框就 `seated = true` 放行——于是每个标签都取第一个候选位，
// 避让整个空转，比原先那套 python 贪心还差。要的是「能量出字有多宽」，不是「有个 DOM」。
//
// 故这里自造一个只有三十来行语义的垫片：造节点、记属性、能序列化，外加一个按
// **字宽表**算出来的 getBoundingClientRect（字宽表在 js/plate-line.js，与浏览器侧
// 那个「不许出框」的判据共用同一张，免得两边估得不一样）。零依赖，与本项目
// 「无构建、无 node_modules」的立身之本一致。
//
// 用法：
//     node tools/mining/render_line_map.mjs shiku            # SVG 打到 stdout
//     node tools/mining/render_line_map.mjs shiku -o out.svg
//     node tools/mining/render_line_map.mjs shiku --no-dust --width 258
//
// 这条线没有一站带地理档时，**什么都不输出**（stdout 空串）：调用方据此决定
// 那一节要不要出现。地图上没东西可画，就不该有一张空底图占着版面。

import { BASEMAP } from '../../js/basemap.js';
import {
  el, haloText, LabelSolver, placeCandidates, NUDGES, ANCHORS, RIVER_TAGS,
} from '../../js/plate.js';
import {
  xy, fitBox, unitOf, inViewOf, clampTo, marksOf, dustOf, dustGroup,
  textWidth, tagJob, runJobs,
} from '../../js/plate-line.js';
import { lineOf } from '../../js/lines.js';
import { GEO } from '../../js/geo.js';
import { GEO_EVENTS } from '../../js/geo-events.js';

/* ═══ 一、极小 SVG DOM 垫片 ═══════════════════════════════════════════════
   够 plate.js 用，不多一分。                                              */

const XML_ESC = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

class SNode {
  constructor(tag) {
    this.tag = tag; this.attrs = new Map(); this.children = []; this.text = '';
  }

  setAttribute(k, v) { this.attrs.set(k, v); return this; }

  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }

  removeAttribute(k) { this.attrs.delete(k); }

  set textContent(v) { this.text = v; this.children.length = 0; }

  get textContent() { return this.text; }

  set innerHTML(v) { if (v === '') this.children.length = 0; }

  appendChild(c) { if (c) { c.parent = this; this.children.push(c); } return c; }

  append(...cs) { cs.forEach((c) => this.appendChild(c)); }

  remove() {
    const p = this.parent; if (!p) return;
    const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1);
  }

  /** 只支持「标签名」与「a, b」这种最朴素的选择器，plate/minimap 用的就这些。 */
  querySelectorAll(sel) {
    const want = sel.split(',').map((s) => s.trim());
    const out = [];
    const walk = (n) => {
      for (const c of n.children) { if (want.includes(c.tag)) out.push(c); walk(c); }
    };
    walk(this);
    return out;
  }

  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }

  /** 数字属性，带默认值。 */
  n(k, d = 0) { const v = parseFloat(this.attrs.get(k)); return Number.isFinite(v) ? v : d; }

  /* ── 量框 ──────────────────────────────────────────────────────────
     全程在**视图单位**里算，不折算到屏幕像素：排版器只做相对比较，
     换算成什么单位不影响谁撞谁。（LabelSolver.hits 里那个 1 的容差，
     在 viewBox 宽 ≈ 渲染宽的本项目里正好还是「一个像素」的意思。）  */
  getBoundingClientRect() {
    const t = this.attrs.get('transform');
    let ox = 0, oy = 0;
    const m = t && /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(t);
    if (m) { ox = +m[1]; oy = +m[2]; }
    const R = (l, top, r, b) => ({
      left: l + ox, top: top + oy, right: r + ox, bottom: b + oy,
      width: r - l, height: b - top,
    });
    switch (this.tag) {
      case 'text': {
        const fs = this.n('font-size', 12);
        const tr = parseFloat(this.attrs.get('letter-spacing')) || 0;
        const w = textWidth(this.text, fs, tr);
        const x = this.n('x'), y = this.n('y');
        const a = this.attrs.get('text-anchor') || 'start';
        const l = x - (a === 'middle' ? w / 2 : (a === 'end' ? w : 0));
        // 描边（halo 那一遍）在浏览器里也算进框，故照加半个描边宽
        const pad = (parseFloat(this.attrs.get('stroke-width')) || 0) / 2;
        return R(l - pad, y - fs * 0.86 - pad, l + w + pad, y + fs * 0.20 + pad);
      }
      case 'circle': {
        const cx = this.n('cx'), cy = this.n('cy'), r = this.n('r');
        return R(cx - r, cy - r, cx + r, cy + r);
      }
      case 'rect': {
        const x = this.n('x'), y = this.n('y');
        return R(x, y, x + this.n('width'), y + this.n('height'));
      }
      case 'line': {
        const x1 = this.n('x1'), y1 = this.n('y1'), x2 = this.n('x2'), y2 = this.n('y2');
        return R(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2));
      }
      default:
        return R(0, 0, 0, 0);      // path 一类：不入避让账（底图不该挤掉地名）
    }
  }

  toString() {
    const a = [...this.attrs].map(([k, v]) => ` ${k}="${XML_ESC(v)}"`).join('');
    const inner = this.text
      ? XML_ESC(this.text)
      : this.children.map((c) => c.toString()).join('');
    return inner || this.tag === 'svg' || this.tag === 'g'
      ? `<${this.tag}${a}>${inner}</${this.tag}>`
      : `<${this.tag}${a}/>`;
  }
}

/** 装上去。plate.js 里 el() 是调用时才摸 document 的，故 import 之后装也来得及。 */
globalThis.document = {
  createElementNS: (_ns, tag) => new SNode(tag),
  createElement: (tag) => new SNode(tag),
};

/* ═══ 二、站表 ═══════════════════════════════════════════════════════════ */

/** LINES[key].stops 是 [序, ...本线站表, 落点]：首尾两张是定调卡，图上没有东西
 *  可打光（它们的标志是 `full`）。长文页的章号与行程条数的是**中间那段**，
 *  故图上的序号也只能数那一段——序号跟章号对不上，读者就没法把图上第几个点
 *  对到长文第几节，而那正是序号存在的唯一理由。 */
const bodyStops = (line) => (line.stops || []).filter((s) => !s.full);

/* ═══ 三、画 ═════════════════════════════════════════════════════════════ */

export function renderLineMap(key, opt = {}) {
  const {
    cls = 'hmap', width = 640, dust = true, anchors = true, labels = true,
    halo = 'var(--bg, #0e0d0c)', family = 'var(--sans)', index = true,
  } = opt;

  const line = lineOf(key);
  if (!line) throw new Error(`没有这条线：${key}`);
  const geo = GEO[key] || {};
  const { marks, pts } = marksOf(bodyStops(line).map((s) => geo[s.ev || ''] || null));
  // 一站都没有地理档：不画。空底图不该占着版面
  if (!marks.length) return { svg: '', vb: null, stat: { placed: 0, hidden: 0, forced: 0 }, marks: 0, jobs: 0 };
  const VB = fitBox(pts);

  const u = unitOf(VB, width);
  const inView = inViewOf(VB);          // 参照层用：离边 3% 以内的城不画
  const toEdge = inViewOf(VB, 0);       // 尘点用：铺到框边为止，它是底纹
  const clamp = (p) => clampTo(p, VB, u(9));

  const svg = el('svg', {
    class: cls,
    viewBox: VB.map((v) => v.toFixed(1)).join(' '),
    preserveAspectRatio: 'xMidYMid meet',
    'aria-hidden': 'true',
  });
  // 底图：只有海岸线与黄河长江，没有国界（理由见 tools/mining/build_basemap.py）。
  // 大图上不用 feGaussianBlur——滤镜区域跨整张图，滚动时浏览器重绘不过来
  // （plate.js 的 softStroke 抬头记着这一条）。故这里就是两根干净的线。
  svg.appendChild(el('path', { class: 'm-coast', d: BASEMAP.coast }));
  svg.appendChild(el('path', { class: 'm-river', d: BASEMAP.rivers }));

  if (dust) {
    svg.appendChild(dustGroup(dustOf(GEO_EVENTS), {
      cls: 'm-dust', gcls: 'm-dusts', r: u(1.1).toFixed(1), keep: toEdge,
    }));
  }

  const sv = new LabelSolver();
  const jobs = [];
  /** 登记一条待排的字。pri 大的先落座；撞满了就不画（must 的除外）。
   *  frame 传 VB，tagJob 会自动补上「不许出框」那条 validate。 */
  const tag = (g2, text, cssCls, size, pri, cands, p, extra = {}) => {
    jobs.push(tagJob(g2, text, {
      cls: cssCls, size, pri, cands, at: p, family, halo,
      haloWidth: u(2.6), frame: VB, margin: u(2), ...extra,
    }));
  };

  /* ── 参照层：今天的城市与两条河。它们不是史料，是给眼睛的坐标纸，故让位是本分 ── */
  if (anchors) {
    const gRef = el('g', { class: 'm-ref' });
    for (const [name, lat, lon] of ANCHORS) {
      const p = xy([lat, lon]);
      if (!inView(p)) continue;
      const dot = el('circle', {
        class: 'm-city', cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: u(2.2).toFixed(1),
      });
      gRef.appendChild(dot);
      sv.obstacle(dot);
      if (labels) tag(gRef, name, 'm-city-t', u(9.5), 10, placeCandidates('e', u(1)), p);
    }
    // 河名贴在河上，**不能跑远**——跑远了就指着别的地方了，故只微挪
    if (labels) {
      for (const [name, lat, lon] of RIVER_TAGS) {
        const p = xy([lat, lon]);
        if (!inView(p)) continue;
        const nudge = NUDGES.tight.map(([dx, dy]) => [u(dx * 0.6), u(dy * 0.6), 'middle']);
        tag(gRef, name, 'm-river-t', u(10), 50, nudge, p);
      }
    }
    svg.appendChild(gRef);
  }

  /* ── 站点层 ────────────────────────────────────────────────────────── */
  const seen = [];       // 同名近点去重：两站共用一个地名（莫高窟/藏经洞）只出一次
  for (const mk of marks) {
    const g2 = el('g', { class: 'm-stop', ...(cls === 'gmap' ? { id: `gm-${mk.no}` } : {}) });
    if (mk.held) {
      const h2 = clamp(mk.held);
      if (mk.pts.length) {
        const a2 = clamp(mk.pts[0]);
        const ln = el('line', {
          class: 'm-flow',
          x1: a2[0].toFixed(1), y1: a2[1].toFixed(1),
          x2: h2[0].toFixed(1), y2: h2[1].toFixed(1),
        });
        g2.appendChild(ln);
      }
      const box = el('rect', {
        class: `m-held${mk.off ? ' m-off' : ''}`,
        x: (h2[0] - u(4)).toFixed(1), y: (h2[1] - u(4)).toFixed(1),
        width: u(8).toFixed(1), height: u(8).toFixed(1),
      });
      g2.appendChild(box);
      sv.obstacle(box);
      // 图外的不标名：名字钉在框边上，读者会以为东西就在那儿；
      // 虚线方块只说「往那个方向」，长文那行小字里的「（图外）」才说清楚
      if (labels && !mk.off && mk.heldName) {
        tag(g2, mk.heldName, 'm-held-t', u(9.5), 80, placeCandidates('e', u(1)), h2);
      }
    }
    for (const p0 of mk.pts) {
      const p = clamp(p0);
      const dot = el('circle', {
        class: mk.pts.length > 1 ? 'm-maybe' : 'm-dot',
        cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: u(5).toFixed(1),
      });
      g2.appendChild(dot);
      sv.obstacle(dot);
    }
    if (labels && mk.pts.length && mk.name) {
      const p = clamp(mk.pts[0]);
      const dup = seen.some(([n2, x2, y2]) => n2 === mk.name
        && Math.abs(x2 - p[0]) + Math.abs(y2 - p[1]) < u(40));
      if (!dup) {
        seen.push([mk.name, p[0], p[1]]);
        // 站名优先级最高：这一站的名字是**必须**画出来的那个
        tag(g2, mk.name, 'm-stop-t', u(12.5), 100, placeCandidates('e', u(1)), p);
      }
      if (index) {
        // 序号贴点，先试西北角，再绕一圈。**它是导轨号，跟着点走比好看重要**：
        // 长文左栏的行程条上是第几站，图上就得能数到第几个点。故除了给足候选位，
        // 还挂 must——撞满时宁可跟别的字叠一点，也不能整个掉号（plate.js 的保底档）
        tag(g2, String(mk.no), 'm-idx', u(8.5), 90,
          placeCandidates('nw', u(0.72)), p, { haloWidth: u(2.2), must: true });
      }
    }
    svg.appendChild(g2);
  }

  /* ── 一次把图上所有的字摆好。**宁可少画一个地名，也不要两个叠在一起。** ── */
  let stat = { placed: 0, hidden: 0, forced: 0 };
  if (labels) stat = runJobs(sv, jobs, { round: true });
  // 排版器把撞满的标签设成 display:none。静态图不必留着这些死节点，直接摘掉
  for (const j of jobs) {
    if (j.h.over.getAttribute('display') === 'none') j.h.remove();
  }

  return { svg: svg.toString(), vb: VB, stat, marks: marks.length, jobs: jobs.length };
}

/* ═══ 四、命令行 ═════════════════════════════════════════════════════════ */

// 「是不是被直接执行的」用 pathToFileURL 比对，别拿文件名尾巴凑：Windows 上
// 反斜杠与盘符会让字符串比对错判，而这个脚本正是从 python 子进程里被调起来的
const { pathToFileURL } = await import('node:url');
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const a = process.argv.slice(2);
  const key = a.find((s) => !s.startsWith('-')) || 'shiku';
  const flag = (n) => a.includes(n);
  const val = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const r = renderLineMap(key, {
    cls: val('--class', 'hmap'),
    width: +val('--width', 640),
    dust: !flag('--no-dust'),
    anchors: !flag('--no-anchors'),
    index: !flag('--no-index'),
  });
  const line = r.vb
    ? `${key}：${r.marks} 站，标签 ${r.stat.placed} 落座 / ${r.stat.hidden} 让位`
      + `${r.stat.forced ? ` / ${r.stat.forced} 硬摆` : ''}，`
      + `取景 [${r.vb.map((v) => v.toFixed(1)).join(' ')}]，${r.svg.length} 字节`
    : `${key}：一站都没有地理档，不画`;
  const out = val('-o', val('--out', null));
  if (out) {
    const fs = await import('node:fs');
    fs.writeFileSync(out, r.svg, 'utf8');
    process.stderr.write(`${line} → ${out}\n`);
  } else {
    process.stderr.write(`${line}\n`);
    process.stdout.write(r.svg);
  }
}
