// plate-line.js — 画「一条故事线」的图，那些三家都要的零件。
//
// plate.js 管**怎么画**（滤镜、halo、贪心排版器、经纬网）；这一层管**画一条线**：
// 取景、贴边、站表怎么摊成图上的点、全库尘点怎么铺底、一条标签怎么登记。
// 三个消费者共用：
//
//   js/minimap.js                       时间轴走线的右下小地图（运行时）
//   tools/mining/render_line_map.mjs    故事页那张大图（构建时，在 node 里跑）
//   js/app-map.js                       地图页（取景是交互缩放，暂只取 inFrame 一样）
//
// 以前这几样各写各的：minimap 的 fit/clamp/everyPoint 与 build_line_page.py 的
// fit_box/clamp/build_marks 是同一件事的两种写法，而且**已经走样**——python 那份
// 自己抄的 ANCHORS 漏了沈阳、长沙两座，同一张图上两版画出来的城不一样多，
// 只是以前没人对着看。归一之后，新开一条线只带数据来，地图代码零改动。
//
// **这里不 import geo-events.js。** 那是二百六十 KB 的全库落点，只有真要铺尘点的
// 页面才该付这个钱。故 dustOf() 吃现成的 GEO_EVENTS 当参数，谁要谁自己取
// （构建脚本直接 import，minimap 是懒加载）。
//
// **也不碰 document。** 模块体里一行 DOM 都没有，只有函数被调用时才造节点——
// node 里那个垫片（render_line_map.mjs 第一节）是在 import 之后才装上的。

import { BASEMAP, project } from './basemap.js';
import { el, haloText } from './plate.js';

/** geo 存的是 [纬, 经]，project 吃的是 (经, 纬)。这个方向搞反过一次，记在这儿。 */
export const xy = ([lat, lon]) => project(lon, lat);

/** 点在底图范围内吗。底图只覆盖中国，而现藏地可能在境外（《金刚经》在伦敦）。 */
export const inFrame = ([lat, lon]) => {
  const [w, s, e, n] = BASEMAP.bbox;
  return lon >= w && lon <= e && lat >= s && lat <= n;
};

/* ── 取景 ────────────────────────────────────────────────────────────────
   按本线自己的范围算，不用固定的全国框：石窟线从拜城铺到大足，全国框正合适；
   赤壁线除台北外全在长江中游，全国框里七说会挤成一个点——而「七说」正是
   那一站要给读者看的东西。                                                 */

/**
 * @param pts     已投影的点 [[x, y], ...]（**框内**的那些，境外点不参与取景）
 * @param pad     留边。**1.30**，三家同一个值（用户 2026-08-21 拍：跟已经上线的
 *                六张故事图对齐；小地图原先那个 1.35 一并归到这里）
 * @param minspan 最小跨度：一条线若只落在一座城，别把地图放大到街道
 */
export function fitBox(pts, { pad = 1.30, minspan = 150, ratio = 1000 / 630 } = {}) {
  if (!pts || !pts.length) return [0, 0, 1000, BASEMAP.h];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const w0 = Math.max(Math.max(...xs) - Math.min(...xs), minspan);
  const h0 = Math.max(Math.max(...ys) - Math.min(...ys), minspan * 0.62);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  let W = w0 * pad, H = h0 * pad;
  if (W / H < ratio) W = H * ratio; else H = W / ratio;
  return [cx - W / 2, cy - H / 2, W, H];
}

/** 屏上想要多大就写多大，再折算回视图单位——viewBox 一缩放，写死的半径就会跟着变：
 *  点在石窟线上正好，到赤壁线上就成了一团。`px` 是这张图在屏上的宽。
 *
 *  顺手取两位小数：静态图上这些数会原样写进 HTML，`9.529388230846774` 一个字号
 *  就是十七个字节，一页三十个标签就是半 KB 的纯噪声。在小地图上这一档是
 *  千分之几个像素，看不出来。 */
export const unitOf = (vb, px) => (v) => Math.round(((v * vb[2]) / px) * 100) / 100;

/** 点在取景框里（且离边有 frac 那么远）。参照层的城市靠它筛：贴边的城不画。 */
export const inViewOf = (vb, frac = 0.03) => ([x, y]) => {
  const m = vb[2] * frac;
  return x > vb[0] + m && x < vb[0] + vb[2] - m
      && y > vb[1] + m && y < vb[1] + vb[3] - m;
};

/** 出了取景框就贴到边上。地图放不下不等于那件事没发生。返回 [x, y, 是否被挪过]。 */
export function clampTo([x, y], vb, m) {
  const cx = Math.min(Math.max(x, vb[0] + m), vb[0] + vb[2] - m);
  const cy = Math.min(Math.max(y, vb[1] + m), vb[1] + vb[3] - m);
  return [cx, cy, cx !== x || cy !== y];
}

/* ── 站表 → 图上的标记 ───────────────────────────────────────────────────
   **一站不一定一个点**（见 js/geo.js）：
     · 确定的一处 → 实心点
     · 诸说（隆中两说、赤壁七说）→ 若干空心点。本库通例是各源不一致就一个都不给；
       地图上「不给」不是空白，而是把候选全摆出来，让读者自己看见至今没定论。
     · 文物的现藏地 → 一条细线从出处连到现藏，末端一个空心方块。
     · 没有地点的站（《三国演义》成书）→ 不硬编一个点，整站不出现。

   **境外的现藏地不参与取景**：《金刚经》现藏伦敦，若算进包围盒，整张图会被拉成
   欧亚大陆、中国这边挤成一小团（实测踩过）。它照画，只是贴到图框边上并标「图外」——
   那卷经离境这件事正是石窟线的结尾，不能因为放不下就抹掉。                  */

/**
 * @param entries 逐站的地理项（没有地理档的站给 null），**位置即站号**
 * @param from    第一项算第几站。故事页的章号从 1 起，序不算站
 * @returns { marks, pts }  pts 是框内的投影点，喂给 fitBox
 */
export function marksOf(entries, { from = 1 } = {}) {
  const marks = [], pts = [];
  (entries || []).forEach((g, k) => {
    if (!g) return;
    const all = [], keep = [];
    const main = g['点'] ? xy(g['点']) : null;
    if (main) { all.push(main); if (inFrame(g['点'])) keep.push(main); }
    const says = [];
    for (const s of (g['诸说'] || [])) {
      if (!s['点']) continue;
      const p = xy(s['点']);
      says.push(p); all.push(p);
      if (inFrame(s['点'])) keep.push(p);
    }
    let held = null, off = false;
    if (g['现藏']) {
      held = xy(g['现藏']);
      off = !inFrame(g['现藏']);
      if (!off) keep.push(held);
    }
    if (!all.length && !held) return;
    // 名字：有地名用地名；只有诸说就报个数（「七说」本身就是那一站的内容）；
    // 都没有就用藏于。图外且没有地名的，名字里带上「（图外）」
    let name = g['地名'] || (g['诸说'] ? `${g['诸说'].length} 说` : g['藏于']);
    if (off && !g['地名']) name = `${name || ''}（图外）`;
    marks.push({
      no: from + k,
      main,
      says,
      pts: all,
      held,
      off,
      place: g['地名'] || null,
      heldName: g['藏于'] || null,
      sayCount: (g['诸说'] || []).length,
      name,
    });
    pts.push(...keep);
  });
  return { marks, pts };
}

/* ── 尘点铺底 ────────────────────────────────────────────────────────────
   全库落点作暗尘：点密之处自然是名城，库一长图自动跟上，零策展维护
   （用户 2026-08-21 定的星野版）。0.15 度网格去重压字节。

   `外: true` 的条目剔掉——那是境外的，铺进来只会在图框边上堆一条无意义的边。
   （旧的 python 版拿正则扫 geo-events.js，剔不掉这些；走结构遍历就没这问题。）*/

export function dustOf(GEO_EVENTS, grid = 0.15) {
  const seen = new Set(), out = [];
  for (const g of Object.values(GEO_EVENTS || {})) {
    for (const c of ((g && g['链']) || [])) {
      if (!c['点'] || c['外']) continue;
      const [lat, lon] = c['点'];
      const k = `${Math.round(lat / grid)},${Math.round(lon / grid)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([lat, lon]);
    }
  }
  return out;
}

/** 尘点画成一层。`keep` 是可选的取景筛子；尘点是底纹，铺到框边为止，不怕贴边。 */
export function dustGroup(pts, { cls = 'm-dust', gcls = 'm-dusts', r = 1, keep = null } = {}) {
  const g = el('g', { class: gcls });
  for (const ll of (pts || [])) {
    const p = xy(ll);
    if (keep && !keep(p)) continue;
    g.appendChild(el('circle', {
      class: cls, cx: p[0].toFixed(1), cy: p[1].toFixed(1), r,
    }));
  }
  return g;
}

/* ── 字宽 ────────────────────────────────────────────────────────────────
   排版器量框靠 getBoundingClientRect，浏览器里是真量；但「这个候选位会不会
   把字挤出图框」这个判断要在**摆之前**就知道，于是需要一张字宽表。
   本库地名全是汉字，全角 1.0 em 很准；西文是估的，偏一点只影响挤不挤，
   不影响对不对（排版器只做相对比较）。node 侧的垫片量框用的也是这张表。  */

const emOf = (ch) => {
  const c = ch.codePointAt(0);
  if (c >= 0x2e80) return 1.0;                       // CJK、假名、全角标点
  if (c === 0x20) return 0.28;                       // 空格
  if (c >= 0x30 && c <= 0x39) return 0.56;           // 数字
  if (c >= 0x41 && c <= 0x5a) return 0.68;           // 拉丁大写
  if ('.,;:!|\'`ijlt'.includes(ch)) return 0.30;     // 窄字形
  return 0.55;                                       // 其余西文
};

export const textWidth = (s, size, tracking = 0) => {
  let em = 0, n = 0;
  for (const ch of String(s ?? '')) { em += emOf(ch); n += 1; }
  return em * size + Math.max(0, n - 1) * tracking;
};

/* ── 登记一条待排的字 ────────────────────────────────────────────────────
   位置一律由 solve() 一次性定——各画各的必然叠，这是 eco-web 那次的教训。     */

/**
 * `frame` 给了就自动补一个「不许出框」的 validate：排版器只管谁压谁，不知道
 * 图框在哪儿——一个贴着右缘的「北京」它认为没撞上任何人，于是落座，然后被
 * viewBox 裁掉半个字（原型第一版实测踩到）。job.validate 就是留给这种
 * 「本地才知道的合法性」的口子，**不必改 plate.js 一行**。
 */
export function tagJob(g, text, {
  cls = null, size = 11, pri = 0, cands = [], at = [0, 0], must = false,
  halo, haloWidth, family = null, tracking = null, frame = null, margin = 0,
} = {}) {
  const h = haloText(g, text, { size, family, tracking, halo, haloWidth });
  if (cls) h.over.setAttribute('class', cls);   // 颜色交给样式表，class 压得过属性
  const job = { h, pri, cands, p: at, must };
  if (frame) {
    const w = textWidth(text, size, tracking || 0);
    job.validate = ([dx, dy, anchor]) => {
      const x = at[0] + dx, y = at[1] + dy;
      const l = x - (anchor === 'middle' ? w / 2 : (anchor === 'end' ? w : 0));
      return l > frame[0] + margin && l + w < frame[0] + frame[2] - margin
          && y - size * 0.86 > frame[1] + margin
          && y + size * 0.20 < frame[1] + frame[3] - margin;
    };
  }
  return job;
}

/** 把登记好的字一次交给排版器。`round` 把落位取到一位小数——那些数会原样
 *  写进 HTML，`12.538668724798388` 一个字号就是十七个字节的纯噪声。 */
export function runJobs(sv, jobs, { round = false } = {}) {
  const at = (v) => (round ? +v.toFixed(1) : v);
  for (const j of jobs) {
    // 上一站藏起来的，这一站重新给机会（小地图逐站重排，同一批节点反复用）
    j.h.nodes.forEach((n) => n && n.removeAttribute('display'));
    sv.job({
      nodes: j.h.nodes,
      priority: j.pri,
      candidates: j.cands,
      validate: j.validate,
      must: j.must,
      apply: ([dx, dy, anchor]) => j.h.at(at(j.p[0] + dx), at(j.p[1] + dy), anchor || 'middle'),
    });
  }
  return sv.solve();
}
