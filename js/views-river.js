// views-river.js — 全页竖向「王朝之河」
//
// 与横向泳道的分工：泳道图把每个政权钉在一条固定的行上，读的是「谁在什么时候统治」；
// 这一张把时间竖过来、把河宽整个交给「当时并存的政权」瓜分，读的是**分合的形状**——
// 大一统时是一条满宽的大河，分裂时河面裂成数股各自着色的分叉，重新统一时再合流。
//
// 五个设计决定：
//
//   1. **河宽恒定，只按政权数均分。** 本库没有疆域或人口数据，若让分叉宽度去编码
//      「谁更大」，那是在画我们并不掌握的东西。均分是诚实的选择，而且它让唯一的
//      视觉变量——分叉数——正好等于那一刻并存的政权数，这恰是本图要回答的问题。
//      代价是三年的割据小国与盛唐同宽；点按详情与数据表给出真实规模。
//
//   2. **谱系锚落位 ＋ 惯性 ⇒ 河道永不交叉（老河守岸）。** 新政权楔入其谱系母体的
//      侧翼（骨肉两翼皆可、借道找锚的客不占岸侧、无锚者按全局总序落座），择侧按
//      楔入代价——贴空道 ＜ 挤邻居 ＜ 链式挪位。于是老河沉在岸边、过客从内侧穿行：
//      燕线 384–436 连续持右岸，五代中原线钉死左岸。落座之后位置交给惯性：继位
//      原地改名、挤入只侧移不越位——没有任何机制会让两条并存的河道互换左右，
//      共存者的次序一经确定终生不变，河道因此不可能相交。
//
//   3. **改道是长弯，交替处不断流。** 初版在每个政权起讫点瞬间重分河宽、只留 10px
//      圆角，整张图读起来像阶梯，密集期尽是毛刺。现按 alluvial diagram 的画法重做：
//      每次改道摊开成一段 ±TRANS_PX 的过渡区，用 smoothstep 缓动；新政权自一线细流
//      张开、亡者收束成细流而不掐断成零宽的尖（d3-sankey 的 linkMinWidth 同理），
//      法统相承者在交替处共用一段变色的窄颈。河面在政权建立**之前几年**就开始让位——
//      细流是排版的预告，不是史实的提前（君主色块的起讫始终是真实日期）。
//      所有河道共用同一过渡窗做同一插值，任一瞬间的布局仍是一个不重叠的分割。
//
//   4. **河道之间留缝。** 溪流靠底色间隔分开（随河宽 5–9px），不靠描边——参照
//      alluvial 诸例中溪流间的留白；缝隙在细流与窄颈处自然收窄，正是河流交汇的样子。
//
//   5. **不套滚动容器 + 点选而非悬停。** 竖向内容再嵌一层竖向滚动是滚动陷阱，
//      本图直接交给页面滚，全页只有一个滚动器；顶／底两条固定条充当上下节跳转
//      与「安全起滑区」。触屏没有悬停，点中君主即高亮、详情进底部固定卡片。
import { el, h, linear, hoverable, legend, tableView, notes, fmtYearAxis, fmt1, textWidth, glide } from './charts.js';
import { DYN_STATS } from './data.js';
import { ERAS, SUCCESSION, MERGED_INTO, SPRANG_FROM, ORDER_HINT, ORTHODOX, SECONDARY, DYN_MAP, TRANSITIONS } from './dynasties.js';
import { EVENTS, EVENT_KINDS, LEFT_BANK, evAnchor } from './events.js';
import { fmtDate } from './schema.js';
import { buildBands, dynastyColorSlots, slotVar, resolveInk, shortName, eventLegend, evMark } from './views-lanes.js';
import { mountKnowledge, evSpec } from './knowledge.js';
import { stampHash } from './search.js';

const GUTTER = 34;          // 左侧年份／时代标注的留白
const TRANS_PX = 56;        // 改道过渡区的目标半长（像素）——长 S 弯的来源
const WAVE_PX = 320;        // 窄河蜿蜒波长（像素）
const WAVE_WIDE_PX = 2200;  // 宽河蜿蜒波长：河相关系（Leopold & Wolman）给出蜿蜒波长
                            // ≈10–14×河宽,满宽河用 320px 波长正是「正弦墙纸」感的来源
const WAVE_WIDE_AMP = 3.8;  // 宽河振幅:只在河道占幅超过 55% 后随宽度渐入,
                            // 3.8px 保证与最窄邻居反相摆动时仍吃不掉 5px 缝
const STEM = 1.6;           // 细流的半宽：河道张开／收束的末端不归零（d3-sankey 的
                            // linkMinWidth 同理），交替期的空档里始终有一线水流
const EPS = 1e-6;
/** 河道间的底色缝：随河宽自适应。窄屏 5px 已够分隔，宽屏同样的 5px 显得挤 */
const gapFor = (w) => Math.max(5, Math.min(9, w * 0.008));

/** 沿法统链上溯到源头，用于把同一支的政权排在一起 */
function lineageRoot(key) {
  let k = key;
  const seen = new Set();
  while (SUCCESSION[k] && !seen.has(k)) { seen.add(k); k = SUCCESSION[k]; }
  return k;
}

/**
 * 谱系家长：tier-2 政权沿「排序改判 → 法统相承 → 裂土分出」逐级上溯，
 * 直到父级是正统／北方主线（不再进堆）或无父可寻，返回最后一个 tier-2 祖先。
 * 于是冉魏归后赵、后赵归汉赵，赵家（汉赵→后赵→冉魏→前秦→后秦→胡夏）连成
 * 一个相邻块，家族内按各自起年排——初版让无 SUCCESSION 者自成一根，
 * 冉魏（350 年立）被排到最右，横插进十六国中央，整片河面为它挪位。
 */
function familyHead(key, orth, sec) {
  let k = key;
  const seen = new Set();
  while (!seen.has(k)) {
    seen.add(k);
    const hint = ORDER_HINT[k];
    const p = (typeof hint === 'string' ? hint : null) || SUCCESSION[k] || SPRANG_FROM[k];
    if (!p || !DYN_MAP.has(p) || orth.has(p) || sec.has(p)) return k;
    k = p;
  }
  return k;
}

/**
 * 全局总序，决定新政权**出生时的落位**；此后位置交给惯性（见 layoutChannels：
 * 承统原地改名、挤入只侧移不越位），共存二者一经落位便不再互换左右——
 * 这正是「河道不交叉」的保证。
 * 正统与北方主线沿用法统链；其余政权按谱系家长归堆（见 familyHead）。
 */
function orderKeys(bands) {
  const orth = new Set(ORTHODOX), sec = new Set(SECONDARY);
  const bandOf = new Map(bands.map((b) => [b.d.key, b]));
  const groupKey = new Map();
  const groupStart = new Map();
  for (const b of bands) {
    const t = orth.has(b.d.key) ? 0 : sec.has(b.d.key) ? 1 : 2;
    const g = t === 2 ? familyHead(b.d.key, orth, sec) : lineageRoot(b.d.key);
    groupKey.set(b.d.key, g);
    const gb = bandOf.get(g);
    // 数值改判＝直接指定排序年（外置孤立政权，见 dynasties.js 注释）
    const hint = ORDER_HINT[b.d.key];
    groupStart.set(b.d.key, typeof hint === 'number' ? hint
      : gb ? gb.s : (DYN_MAP.get(g) ? DYN_MAP.get(g).s : b.s));
  }
  const tier = (b) => (orth.has(b.d.key) ? 0 : sec.has(b.d.key) ? 1 : 2);
  return bands.slice().sort((a, b) =>
    tier(a) - tier(b)
    || groupStart.get(a.d.key) - groupStart.get(b.d.key)
    || groupKey.get(a.d.key).localeCompare(groupKey.get(b.d.key))
    || a.s - b.s
    || a.d.key.localeCompare(b.d.key));
}

/**
 * 把时间切成「并存政权集合不变」的一段段，再把河宽切成 C 条**固定车道**。
 *
 * C ＝ 全图并存峰值（用户原案：「我们可以实际运用 7 个 Lane」）。任一时刻的 n 条
 * 河道各分得整数条车道：一统独占 C/C；两雄并立分 ⌈C/2⌉/⌊C/2⌋（七车道即 4/3）；
 * 三分则 3/2/2，依次类推，多出的车道自左先分（左侧是正统主线）。
 * 要点在于**车道边界是全图固定的网格**：政权生灭只转让整数条车道，
 * 未被转让的边界纹丝不动——这就是河流「更直」的来源，也一并消掉了
 * 此前按比例摊缝时远端河道跟着呼吸的毛病。缝隙从相邻河道交界各让 g0/2 刻出。
 */
function layoutChannels(bands, x0, x1) {
  const ordered = orderKeys(bands);
  const rank = new Map(ordered.map((b, i) => [b.d.key, i]));
  const cuts = [...new Set(bands.flatMap((b) => [b.s, b.e]))].sort((p, q) => p - q);
  const raw = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], z = cuts[i + 1];
    if (z - a < EPS) continue;
    const mid = (a + z) / 2;
    const live = bands.filter((b) => b.s <= mid && mid <= b.e)
      .sort((p, q) => rank.get(p.d.key) - rank.get(q.d.key));
    raw.push({ a, z, live, n: live.length });
  }
  // 长段细分：承平数十年的段切成 ≤SUBDIV 年的小段——缓回收与「承平回归」
  // 都按段落步，一段一步、渐进不跳变；不细分则 979–1038 这类六十年长段
  // 只有一次机会调整
  const SUBDIV = 24;
  const raw2 = [];
  for (const r of raw) {
    const len = r.z - r.a;
    if (len <= SUBDIV) { raw2.push(r); continue; }
    const parts = Math.ceil(len / SUBDIV);
    for (let p2 = 0; p2 < parts; p2++) {
      raw2.push({ a: r.a + (len * p2) / parts, z: r.a + (len * (p2 + 1)) / parts, live: r.live, n: r.n });
    }
  }
  const C = Math.max(1, ...raw2.map((r) => r.n));
  const laneW = (x1 - x0) / C;
  const g0 = gapFor(x1 - x0);
  const HOLD = 16;                       // 空车道的回收等待期（年）

  // 有状态车道扫掠：宽度只在四种时刻变化——新政权挤入（不得不让）、
  // 征服承接（灭国的水立刻归征服者：前秦并前燕当场涨，那是史实）、
  // 空置满 HOLD 年后的缓回收、以及天下一统。其余时候一律保持现状：
  // 政权死后其车道先空置成**留白**，邻居不立刻胀开——快变期宁可留白，
  // 不要急弯。此前按瞬时 n 重分配，政权一生一灭全体幸存者跟着起伏，
  // 密集期尽是 peak and shift。
  const owner = new Array(C).fill(null);
  const freedAt = new Array(C).fill(-1e9);
  const freedBy = new Array(C).fill(null);   // 空车道的原主——隔年承统的认领凭据
  const heirOf = new Map();                  // 前身 → 首位法统后继（谱系锚的走链用）
  for (const [s2, p2] of Object.entries(SUCCESSION)) if (!heirOf.has(p2)) heirOf.set(p2, s2);
  const runOf = (k) => {
    let a = -1, b = -1;
    for (let l = 0; l < C; l++) if (owner[l] === k) { if (a < 0) a = l; b = l; }
    return a < 0 ? null : [a, b];
  };
  const slices = [];
  let fresh = true;
  let prevSig = '';
  for (const r of raw2) {
    if (!r.n) {
      for (let l = 0; l < C; l++) if (owner[l]) { owner[l] = null; freedAt[l] = r.a; }
      slices.push({ a: r.a, z: r.z, live: [], n: 0, at: new Map() });
      fresh = true;                      // 空档（楚汉之争）之后重新起排
      continue;
    }
    const liveSet = new Set(r.live.map((b) => b.d.key));
    if (fresh) {
      const base = Math.floor(C / r.n), rem = C % r.n;
      owner.fill(null);
      let lane = 0;
      r.live.forEach((b, i) => {
        const size = base + (i < rem ? 1 : 0);
        for (let l = lane; l < lane + size; l++) owner[l] = b.d.key;
        lane += size;
      });
      fresh = false;
    } else {
      // 1) 亡者三序：承统改名 → 征服承接 → 空置留白。
      //    继位者与前身同段交接时**原地**接管其整段河道——继位是改名，不是搬家。
      //    此前继位者被当作新丁按全局次序另寻插入口：北燕（407 年立，燕家序在
      //    南燕之后）落到南燕右侧的空位，后燕的河道只好弯过南燕头顶去接，
      //    承统窄颈横跨了第三条河的河面
      const deadKeys = [...new Set(owner.filter((k) => k && !liveSet.has(k)))];
      for (const k of deadKeys) {
        const [a, b] = runOf(k);
        const heir = r.live.find((b2) => SUCCESSION[b2.d.key] === k && !owner.includes(b2.d.key));
        if (heir) {
          for (let l = a; l <= b; l++) owner[l] = heir.d.key;
          continue;
        }
        const tgt = MERGED_INTO[k];
        const leftK = a > 0 ? owner[a - 1] : null;
        const rightK = b < C - 1 ? owner[b + 1] : null;
        if (tgt && liveSet.has(tgt) && (leftK === tgt || rightK === tgt)) {
          for (let l = a; l <= b; l++) owner[l] = tgt;
          continue;
        }
        // 灭梁式：后继与前身短暂并存（李存勖 923-4 称帝、923-11 灭梁），
        // 前身亡时后继已在场、原地转让走不了——若两者相邻，水归胜者，
        // 视同征服承接。排在 MERGED_INTO 之后：北魏的残统按既载入西魏，
        // 不被已在场的东魏抢走。此洞曾让后梁的岸道空置成留白，
        // 闽（927）借道楔入时白捡了正统线的左岸
        const heirIn = r.live.find((b2) => SUCCESSION[b2.d.key] === k);
        const hr = heirIn ? runOf(heirIn.d.key) : null;
        if (hr && (hr[0] === b + 1 || hr[1] === a - 1)) {
          for (let l = a; l <= b; l++) owner[l] = heirIn.d.key;
        } else {
          for (let l = a; l <= b; l++) { owner[l] = null; freedAt[l] = r.a; freedBy[l] = k; }
        }
      }
      // 2) 新生：**老河守岸**——新政权楔入其谱系母体的侧翼，而不是按全局次序
      //    绕到边上。此前按排位落座：凡比后燕晚生的燕凉政权排位都在它右边，
      //    右岸永远让给最新的入场者，老住户被一次次向内挤（后燕 386 得右岸、
      //    396 让后凉、400 又被南燕的链式挪位推离）。惯性改造后「河道永不交叉」
      //    已不依赖出生排位（只需共存者落位后永不互换），排位从必需降为备用。
      //    择侧按**楔入代价**：母体两翼各算一次（贴着空道 0 ＜ 可挤邻居 1 ＜
      //    链式牵动 n 条河），代价低者胜，平手回退排位侧——过客从内侧穿行。
      const insCost = (p3) => {
        if ((p3 < C && owner[p3] === null) || (p3 > 0 && owner[p3 - 1] === null)) return 0;
        const size = (k3) => { if (!k3) return 0; const rr = runOf(k3); return rr[1] - rr[0] + 1; };
        if (size(p3 > 0 ? owner[p3 - 1] : null) > 1 || size(p3 < C ? owner[p3] : null) > 1) return 1;
        let best = 99;
        for (let l = p3, n3 = 1; l < C; l++) {
          if (owner[l] === null) { best = Math.min(best, n3); break; }
          const rr = runOf(owner[l]);
          if (l === rr[0] && rr[1] > rr[0]) { best = Math.min(best, n3); break; }
          if (l === rr[1]) n3++;
        }
        for (let l = p3 - 1, n3 = 1; l >= 0; l--) {
          if (owner[l] === null) { best = Math.min(best, n3); break; }
          const rr = runOf(owner[l]);
          if (l === rr[1] && rr[1] > rr[0]) { best = Math.min(best, n3); break; }
          if (l === rr[0]) n3++;
        }
        return best;
      };
      for (const b2 of r.live) {
        const k = b2.d.key;
        if (owner.includes(k)) continue;
        // 隔年承统的认领：前身亡后隔了几年（其间无空窗清场）才建号的，其旧河道
        // 若仍空置未被回收，凭 freedBy 原地整段接管——西晋亡（316）至东晋立（317）
        // 隔一年而汉赵仍在场，东晋接的正是西晋留在原处的车道
        const pred0 = SUCCESSION[k];
        if (pred0 && !liveSet.has(pred0)) {
          let bA = -1, bB = -1, a2 = -1;
          for (let l = 0; l <= C; l++) {
            if (l < C && owner[l] === null && freedBy[l] === pred0) { if (a2 < 0) a2 = l; }
            else if (a2 >= 0) { if (l - 1 - a2 > bB - bA) { bA = a2; bB = l - 1; } a2 = -1; }
          }
          if (bA >= 0) {
            for (let l = bA; l <= bB; l++) owner[l] = k;
            continue;
          }
        }
        // 法统继承：后继者整段接手前身留下的空车道（北宋亡，南宋接其全部
        // 车道，而不是按新丁只挤 1 条——此前南宋被挤成单车道，与辽金大理
        // 等宽，正统主线看着突兀）。接手范围＝插入口两侧的连续空段，
        // 那正是前身的旧河道
        const inherit = SUCCESSION[k] && !liveSet.has(SUCCESSION[k]);
        const target = inherit ? C : Math.max(1, Math.floor(C / r.n));
        const rk = rank.get(k);
        let posRank = 0;
        for (let l = 0; l < C; l++) {
          const o = owner[l];
          if (o && rank.get(o) < rk) posRank = l + 1;
        }
        // 谱系锚：先血缘母体（裂土自立），再法统前身；亡者顺「水的去向」走链
        //（征服者承其水、继位者承其位），直到找到在场者。西夏锚宋、桓楚锚晋、
        // 十国锚五代中原线；辽、大理、蜀汉这类无从锚起的，退回全局排位落座。
        // **骨肉与客的分别**：直接裂自／承自在场母体者是骨肉，两翼皆可（东西魏
        // 分北魏，本就是同一片水）；借道走链找到的锚只是邻居，是客——客不许占
        // 岸侧：闽（933，锚借道到后唐）曾从左翼楔入，把中原正统线挤离左岸
        let anchor = null, direct = false;
        for (const c3 of [SPRANG_FROM[k], SUCCESSION[k]]) {
          if (c3 && owner.includes(c3)) { anchor = c3; direct = true; break; }
        }
        if (!anchor) {
          let a3 = SPRANG_FROM[k] || SUCCESSION[k];
          const seen2 = new Set([k]);
          while (a3 && !seen2.has(a3) && !owner.includes(a3)) {
            seen2.add(a3);
            a3 = MERGED_INTO[a3] || heirOf.get(a3) || null;
          }
          if (a3 && !seen2.has(a3) && owner.includes(a3)) anchor = a3;
        }
        let pos = posRank;
        if (anchor) {
          const [aA, aB] = runOf(anchor);
          const cL = direct || aA > 0 ? insCost(aA) : Infinity;
          const cR = direct || aB < C - 1 ? insCost(aB + 1) : Infinity;
          if (cL < Infinity || cR < Infinity)
            pos = cL < cR ? aA : cR < cL ? aB + 1 : (posRank <= aA ? aA : aB + 1);
        }
        let got = 0;
        for (let l = pos; l < C && got < target && owner[l] === null; l++) { owner[l] = k; got++; }
        for (let l = pos - 1; l >= 0 && got < target && owner[l] === null; l--) { owner[l] = k; got++; }
        while (!inherit && got < target) {
          const run = runOf(k) || [pos, pos - 1];
          const lK = run[0] > 0 ? owner[run[0] - 1] : null;
          const rK = run[1] < C - 1 ? owner[run[1] + 1] : null;
          const lRun = lK ? runOf(lK) : null;
          const rRun = rK ? runOf(rK) : null;
          const lSize = lRun ? lRun[1] - lRun[0] + 1 : 0;
          const rSize = rRun ? rRun[1] - rRun[0] + 1 : 0;
          if (rSize >= lSize && rSize > 1) { owner[run[1] + 1] = k; got++; }
          else if (lSize > 1) { owner[run[0] - 1] = k; got++; }
          else break;
        }
        if (!owner.includes(k) && inherit) {
          // 前身未留空位（罕见：被征服承接走了）：按普通新丁再走一遍挤入
          const t2 = Math.max(1, Math.floor(C / r.n));
          let got2 = 0;
          for (let l = pos; l < C && got2 < t2 && owner[l] === null; l++) { owner[l] = k; got2++; }
          while (got2 < t2) {
            const run = runOf(k) || [pos, pos - 1];
            const lK = run[0] > 0 ? owner[run[0] - 1] : null;
            const rK = run[1] < C - 1 ? owner[run[1] + 1] : null;
            const lRun = lK ? runOf(lK) : null;
            const rRun = rK ? runOf(rK) : null;
            const lSize = lRun ? lRun[1] - lRun[0] + 1 : 0;
            const rSize = rRun ? rRun[1] - rRun[0] + 1 : 0;
            if (rSize >= lSize && rSize > 1) { owner[run[1] + 1] = k; got2++; }
            else if (lSize > 1) { owner[run[0] - 1] = k; got2++; }
            else break;
          }
        }
        if (!owner.includes(k)) {
          // 链式挪位：两邻皆已保底时，向两侧找**最近的松动处**——空车道，或宽逾
          // 一条的河道——把途中的河道整体侧移一条，在正确的次序缝里腾出一条车道。
          // 途中者宽度不变、次序不变，只挪一条车道的位置。此前这里整片退回标准
          // 分配：555 年西梁一入场，梁骤失两车道、西魏北齐全体平移——在场的河
          // 应当优先保住自己的车道，一个新丁不该让同屏所有河道瞬间重排
          let sR = -1, sL = -1;
          for (let l = pos; l < C; l++) {
            if (owner[l] === null) { sR = l; break; }
            const rr = runOf(owner[l]);
            if (l === rr[0] && rr[1] > rr[0]) { sR = l; break; }
          }
          for (let l = pos - 1; l >= 0; l--) {
            if (owner[l] === null) { sL = l; break; }
            const rr = runOf(owner[l]);
            if (l === rr[1] && rr[1] > rr[0]) { sL = l; break; }
          }
          if (sR >= 0 && (sL < 0 || sR - pos <= pos - 1 - sL)) {
            for (let l = sR; l > pos; l--) owner[l] = owner[l - 1];
            owner[pos] = k;
          } else if (sL >= 0) {
            for (let l = sL; l < pos - 1; l++) owner[l] = owner[l + 1];
            owner[pos - 1] = k;
          }
        }
        if (!owner.includes(k)) {
          // 理论上不可达（n ≤ C 时松动处必然存在），留作最后的正确性保险
          const base = Math.floor(C / r.n), rem = C % r.n;
          owner.fill(null);
          let lane = 0;
          r.live.forEach((b3, i3) => {
            const size = base + (i3 < rem ? 1 : 0);
            for (let l = lane; l < lane + size; l++) owner[l] = b3.d.key;
            lane += size;
          });
          break;
        }
      }
      // 3) 缓回收：空置满 HOLD 年的车道并入相邻 run——优先给低于公平份额的一侧
      const fairOf = new Map();
      {
        const base = Math.floor(C / r.n), rem = C % r.n;
        r.live.forEach((b2, i2) => fairOf.set(b2.d.key, base + (i2 < rem ? 1 : 0)));
      }
      const deficit = (k2) => {
        if (!k2) return -99;
        const rr = runOf(k2);
        return (fairOf.get(k2) ?? 0) - (rr ? rr[1] - rr[0] + 1 : 0);
      };
      for (let l = 0; l < C; l++) {
        if (owner[l] !== null || r.a - freedAt[l] < HOLD) continue;
        const lK = l > 0 ? owner[l - 1] : null;
        const rK = l < C - 1 ? owner[l + 1] : null;
        if (lK === null && rK === null) continue;
        owner[l] = deficit(lK) >= deficit(rK) ? (lK || rK) : (rK || lK);
      }
      // 3.5) 承平回归：格局未变的时段里，向公平份额缓步靠拢（每段至多转让一条）。
      // 只救济低于公平份额者，从相邻的超额者处取——征服所得在无人饥饿时不没收
      //（元并金的水不会平白还给南宋），北宋收十国后被辽隔断的失衡由此纠正
      const sig = r.live.map((b2) => b2.d.key).join('|');
      if (sig === prevSig) {
        let uk = null, udef = 0;
        for (const b2 of r.live) {
          const d2 = deficit(b2.d.key);
          if (d2 > udef) { udef = d2; uk = b2.d.key; }
        }
        if (uk) {
          const run = runOf(uk);
          // 沿相邻链找最近的超额者，整链向饥饿者平移一条车道：中间者宽度
          // 不变、位置侧移一条（北宋的公平份额压在大理手里、隔着辽——
          // 单看两邻永远转不过去）。空档挡路则不穿（留白由缓回收另行处理）
          const chain = (dir) => {
            let edge = dir > 0 ? run[1] : run[0];
            const path = [];
            while (true) {
              const nl = edge + dir;
              if (nl < 0 || nl >= C) return null;
              const k2 = owner[nl];
              if (k2 === null) return null;
              const rr = runOf(k2);
              path.push({ k: k2, run: rr });
              if (-deficit(k2) > 0) return path;
              edge = dir > 0 ? rr[1] : rr[0];
            }
          };
          if (run) {
            const pR = chain(1), pL = chain(-1);
            const pick = pR && pL ? (pR.length <= pL.length ? { p: pR, d: 1 } : { p: pL, d: -1 })
              : pR ? { p: pR, d: 1 } : pL ? { p: pL, d: -1 } : null;
            if (pick) {
              const lanes = pick.p.map((seg) => (pick.d > 0 ? seg.run[0] : seg.run[1]));
              owner[lanes[0]] = uk;
              for (let i2 = 1; i2 < lanes.length; i2++) owner[lanes[i2]] = pick.p[i2 - 1].k;
            }
          }
        }
      }
      prevSig = sig;
      // 4) 一统：满河语法不可让
      if (r.n === 1) owner.fill(r.live[0].d.key);
    }
    // 盒子：连续 run；与邻接河道之间各让 g0/2，邻接留白侧不内缩
    const at = new Map();
    for (const b2 of r.live) {
      const run = runOf(b2.d.key);
      if (!run) continue;
      const leftOwned = run[0] > 0 && owner[run[0] - 1] !== null;
      const rightOwned = run[1] < C - 1 && owner[run[1] + 1] !== null;
      at.set(b2.d.key, [
        x0 + run[0] * laneW + (leftOwned ? g0 / 2 : 0),
        x0 + (run[1] + 1) * laneW - (rightOwned ? g0 / 2 : 0),
      ]);
    }
    slices.push({ a: r.a, z: r.z, live: r.live, n: r.n, at });
  }
  return { slices, ordered, rank, C };
}

/**
 * 某政权不在此段时的「退化盒」：一条 STEM 半宽的细流，落在离它**真实位置**
 * （相邻段的盒）最近的缝里——细流垂直落座，不斜穿。初版按全局排位找「本应在的
 * 缝」；惯性与谱系锚落位之后，排位与实际位置可以分离，排位缝可能落在别的河道
 * 身上（南燕亡后的尾迹曾按排位横扫北燕的头顶，只是压在色块下不易察觉）。
 * 新生河道自细流张开，消亡河道收束成细流——不掐断成零宽的尖。
 */
function degenerate(slice, refBox, x0, x1) {
  const cx = refBox ? (refBox[0] + refBox[1]) / 2 : (x0 + x1) / 2;
  const boxes = [...slice.at.values()].sort((p, q) => p[0] - q[0]);
  let best = null, bd = Infinity;
  let prev = x0;
  for (const b of [...boxes, [x1, x1]]) {
    const g = [prev, Math.max(prev, b[0])];
    prev = Math.max(prev, b[1]);
    const c2 = Math.min(Math.max(cx, g[0]), g[1]);
    const d2 = Math.abs(c2 - cx);
    if (d2 < bd) { bd = d2; best = [g, c2]; }
  }
  const [g, c2] = best;
  const x = g[1] - g[0] < 2 * STEM ? (g[0] + g[1]) / 2
    : Math.min(Math.max(c2, g[0] + STEM), g[1] - STEM);
  return [Math.max(x0, x - STEM), Math.min(x1, x + STEM)];
}

/**
 * 目标河道近岸上的细流盒。用于「支流汇入干流／干流分出支流」：
 * 亡者的收束点（或新生者的涌出点）骑在吞并者（或母体）的河岸上，
 * 尾迹经由过渡窗弯向河岸、没入其君主色块之下——亡国是汇流，不是蒸发。
 *
 * 相邻性按**几何**判定：在两者并存的参照段里，二者之间不得隔着第三条河道
 * （初版按全局排位找缝，惯性落位后排位与位置可分离，会指错邻居）。
 * 隔着第三者时弯过去必然横穿别人（河道永不交叉是硬约束），返回 null
 * 退回缝隙细流——数据记的是史实，几何画得出才画。
 */
function bankStem(stemSlice, refSlice, key, tgt) {
  const bK = refSlice.at.get(key), bT = refSlice.at.get(tgt), boxT = stemSlice.at.get(tgt);
  if (!bK || !bT || !boxT) return null;
  const lo = Math.min(bK[1], bT[1]), hi = Math.max(bK[0], bT[0]);
  for (const [k2, b2] of refSlice.at) {
    if (k2 === key || k2 === tgt) continue;
    if (b2[0] >= lo - EPS && b2[1] <= hi + EPS) return null;
  }
  return (bK[0] + bK[1]) / 2 > (bT[0] + bT[1]) / 2
    ? [boxT[1] - STEM, boxT[1] + STEM]
    : [boxT[0] - STEM, boxT[0] + STEM];
}

/**
 * 相邻两个**稳定段**之间的过渡：窗 [c − ha, c + span + hb]，半长取「所需长度」
 * 与「邻段一半」的较小者，因此过渡窗彼此不相交。窗内所有河道用同一 smoothstep
 * 在旧新两个分割之间插值——两个不重叠分割的凸组合仍是不重叠分割。
 *
 * **微段桥接**：短于 MIN_SLICE 的段不作过渡目标。魏受禅至蜀汉自立仅数月，
 * 河面不值得完整到达「魏独占满幅」再立刻改道——那会挤出「深掐到点＋平顶急弯」；
 * 何况禅让两端常差一个月（献帝逊位 220-11、曹丕受禅 220-12），不桥接则微腰
 * 根本触发不了。桥接后由前一稳定段直接过渡到下一稳定段（span＝桥接跨度），
 * 微段的布局仍供点查（edgeAt 的过渡窗优先于段常态，桥内自动被窗覆盖）。
 * 两个例外不桥接：微段里有前后两端都不在的独有政权（中华帝国仅存 83 天，
 * 桥掉就从图上消失了）；连续微段合计超过 BRIDGE_MAX（吞掉真实短命格局就失真了）。
 */
function buildTransitions(slices, rank, pxYear, x0, x1) {
  const tau = TRANS_PX / pxYear;
  const MIN_SLICE = 1.5;
  const BRIDGE_MAX = 4;
  const GAP_BRIDGE_MAX = 16;   // 空窗桥接上限（年）：楚汉之争 5 年、居摄 3 年皆在内
  const trans = [];
  const flows = [];
  const necks = [];            // 承统对及其过渡窗——河床的墨韵渐变按窗铺 stop

  // 桥接两类段：微段（<MIN_SLICE，禅让两端差一个月那类）与**空窗段**
  //（n=0、≤GAP_BRIDGE_MAX，秦亡至汉兴的楚汉之争、平帝崩至王莽代汉的居摄）。
  // 空窗桥接后，承统的窄颈才有机会跨过空窗触发——否则前朝收尖、后朝再起尖，
  // 两尖相抵读作「文明断了又重启」。空窗里若无承统关系，过渡照旧收束成细流，
  // 只是收束的弯被摊得更长更缓
  const idx = [0];
  let i = 1;
  while (i < slices.length) {
    let j = i, spanShort = 0, spanEmpty = 0;
    while (j < slices.length - 1) {
      const L = slices[j].z - slices[j].a;
      if (slices[j].n === 0 && L <= GAP_BRIDGE_MAX && spanEmpty + L <= GAP_BRIDGE_MAX) { spanEmpty += L; j++; continue; }
      if (slices[j].n > 0 && L < MIN_SLICE && spanShort + L <= BRIDGE_MAX) { spanShort += L; j++; continue; }
      break;
    }
    if (j > i) {
      const A = slices[idx[idx.length - 1]], B = slices[j];
      const ok = slices.slice(i, j).every((m) =>
        m.live.every((b) => A.at.has(b.d.key) || B.at.has(b.d.key)));
      if (ok) { idx.push(j); i = j + 1; continue; }
    }
    idx.push(i);
    i += 1;
  }

  for (let k = 1; k < idx.length; k++) {
    const A = slices[idx[k - 1]], B = slices[idx[k]];
    const c = A.z;
    const span = B.a - A.z;
    const from = new Map(A.at), to = new Map(B.at);
    const local = [];
    for (const k2 of B.at.keys()) if (!from.has(k2)) from.set(k2, degenerate(A, B.at.get(k2), x0, x1));
    for (const k2 of A.at.keys()) if (!to.has(k2)) to.set(k2, degenerate(B, A.at.get(k2), x0, x1));
    // 亡入／分出：吞并者（母体）相邻时，细流直接放到对方河岸上——支流汇入
    // 干流、干流分出支流。中间隔着第三条河道时不能弯（河道永不交叉是硬约束），
    // 改记一条「穿流带」：半透明的细带穿过去，压在途经河道的君主色块之下、
    // 只在河床与缝隙间隐约可见，点选该政权时点亮——sankey 图的半透明 ribbon 同理
    for (const k2 of A.at.keys()) {
      if (B.at.has(k2)) continue;
      const tgt = MERGED_INTO[k2];
      if (!tgt) continue;
      const st = B.at.has(tgt) ? bankStem(B, A, k2, tgt) : null;
      if (st) to.set(k2, st);
      else local.push({ key: k2, tgt, dir: 'merge' });
    }
    for (const k2 of B.at.keys()) {
      if (A.at.has(k2)) continue;
      const src = SPRANG_FROM[k2];
      if (!src) continue;
      const st = A.at.has(src) ? bankStem(A, B, k2, src) : null;
      if (st) from.set(k2, st);
      else local.push({ key: k2, tgt: src, dir: 'spring' });
    }
    // 法统相承的交棒（汉→新、东汉→魏、唐→后梁…）：前后两河共用一个「河口」盒。
    // 前朝收进它、新朝从它张开——交替处是一段变色的宽阔河口，而非两个背对背的尖。
    // 河口取七成五而非六成：用户对照 river delta 指出六成仍收得太紧，
    // 交替应读作「同一条河换了名字」，不是「河面塌缩重生」
    const dying = [...A.at.keys()].filter((k2) => !B.at.has(k2));
    const pairs = [];
    for (const yk of B.at.keys()) {
      if (A.at.has(yk)) continue;
      const xk = SUCCESSION[yk];
      if (!xk || !dying.includes(xk)) continue;
      pairs.push({ xk, yk });
      const XA = A.at.get(xk), YB = B.at.get(yk);
      const cx = ((XA[0] + XA[1]) / 2 + (YB[0] + YB[1]) / 2) / 2;
      // 连续性三级：同切禅让＝75% 宽河口（同一条河换了名字）；隔着空窗的承统
      //（秦→汉、汉→新）＝10px 细颈贯穿空窗——法统如一线悬丝穿过乱世，
      // 空窗本身仍由四周的留白与细颈的窄读出；断流只留给无承继关系的真正终结
      const w = span < MIN_SLICE
        ? Math.max(2 * STEM, Math.min(XA[1] - XA[0], YB[1] - YB[0]) * 0.75)
        : Math.max(10, Math.min(XA[1] - XA[0], YB[1] - YB[0]) * 0.06);
      const waist = [cx - w / 2, cx + w / 2];
      to.set(xk, waist);
      from.set(yk, waist);
    }
    // 近直角压平：过渡窗的长度随本次改道的最大位移伸长（至多三倍标准窗、
    // 不超过邻段一半）。位移大而窗短，边就近乎横切——统一与大分裂这类
    // 整幅重排，弯道必须给得更长
    let dx = 0;
    for (const [k2, fb] of from) {
      const tb2 = to.get(k2);
      if (tb2) dx = Math.max(dx, Math.abs(fb[0] - tb2[0]), Math.abs(fb[1] - tb2[1]));
    }
    const need = Math.max(tau, Math.min(3 * tau, (dx * 0.7) / pxYear));
    const ha = Math.min(need, (A.z - A.a) / 2);
    const hb = Math.min(need, (B.z - B.a) / 2);
    for (const p2 of pairs) necks.push({ ...p2, a: c - ha, z: c + span + hb });
    for (const f of local) {
      f.c = f.dir === 'merge' ? c + span : c;
      f.h = f.dir === 'merge' ? hb : ha;
      f.stem = (f.dir === 'merge' ? to : from).get(f.key);
      flows.push(f);
    }
    trans.push({ c, span, ha, hb, from, to });
  }
  return { trans, flows, necks };
}

const smoothstep = (u) => u * u * (3 - 2 * u);

/**
 * 确定性蜿蜒：河道整体做 ±amp 的横向摆动。
 * 相位取**法统源头**（lineageRoot）的散列而非政权名——「继位是改名，不是搬家」
 * 在车道（原地接管）与河口（共用腰）之后抵达律动层：唐与后梁在河口两侧
 * 同一支波贯穿，腰部不再有与叙事矛盾的相位拐点；正统一线从秦汉到明清
 * 是同一笔摆动。不用随机数，同一筛选下重绘逐像素稳定；
 * 两个不同频的正弦叠出「河」而非「正弦墙纸」的观感。
 * 窄河振幅不超过缝宽的三成，相邻河道即便反相摆动也吃不掉缝隙。
 */
function waveOf(key, t, pxYear, amp, wavePx = WAVE_PX) {
  let hsh = 0;
  for (let i = 0; i < key.length; i++) hsh = (hsh * 31 + key.charCodeAt(i)) % 997;
  const ph = (hsh / 997) * Math.PI * 2;
  const u = (t * pxYear) / wavePx * Math.PI * 2;
  return amp * (Math.sin(u + ph) + 0.4 * Math.sin(2.3 * u + 1.7 * ph));
}

/** 河道 key 在时刻 t 的左右边界；不存在（生前窗外／死后窗外）时返回 null */
function edgeAt(key, t, slices, trans) {
  for (const T of trans) {
    if (t < T.c - T.ha - EPS || t > T.c + T.span + T.hb + EPS) continue;
    const A = T.from.get(key), B = T.to.get(key);
    if (A && B) {
      const s = smoothstep(Math.min(1, Math.max(0, (t - (T.c - T.ha)) / (T.ha + T.span + T.hb))));
      return [A[0] + (B[0] - A[0]) * s, A[1] + (B[1] - A[1]) * s];
    }
    break;                                     // 窗内但该河道两侧都无盒 → 交给段常态
  }
  const S = slices.find((s) => t >= s.a - EPS && t <= s.z + EPS);
  return (S && S.at.get(key)) || null;
}

/**
 * 在 [ta, tb] 内采样河道边界。过渡窗内按 smoothstep 补 12 个采样点；
 * 常态段每 ~44px 也补一点——蜿蜒要靠这些点显形。折线过点即视觉平滑，
 * 不必维护贝塞尔的簿记。边界一律经 edgeFn（含蜿蜒偏移）取得。
 */
function sampleEdges(edgeFn, ta, tb, trans, pxYear) {
  const ts = new Set([ta, tb]);
  for (const T of trans) {
    const w0 = T.c - T.ha, w1 = T.c + T.span + T.hb;
    if (w1 < ta || w0 > tb) continue;
    for (let i = 0; i <= 12; i++) {
      const t = w0 + (w1 - w0) * i / 12;
      if (t > ta && t < tb) ts.add(t);
    }
  }
  const step = 44 / pxYear;
  for (let t = ta + step; t < tb; t += step) ts.add(t);
  const out = [];
  for (const t of [...ts].sort((a, b) => a - b)) {
    const e = edgeFn(t);
    if (e) out.push({ t, x0: e[0], x1: e[1] });
  }
  return out;
}

/** 采样点连成的封闭多边形：左岸顺流而下，右岸逆流而上 */
function polyPath(samples, y, inset = 0) {
  if (samples.length < 2) return '';
  if (Math.max(...samples.map((p) => p.x1 - p.x0)) < inset * 2 + 1.2) return '';
  const pt = samples.map((p) => {
    const half = Math.min(inset, (p.x1 - p.x0) / 2);
    return { yy: y(p.t), l: p.x0 + half, r: p.x1 - half };
  });
  let d = `M${pt[0].l.toFixed(1)},${pt[0].yy.toFixed(1)}`;
  for (let i = 1; i < pt.length; i++) d += `L${pt[i].l.toFixed(1)},${pt[i].yy.toFixed(1)}`;
  for (let i = pt.length - 1; i >= 0; i--) d += `L${pt[i].r.toFixed(1)},${pt[i].yy.toFixed(1)}`;
  return `${d}Z`;
}

// ── 主渲染 ───────────────────────────────────────────────────────────────
export function renderRiver(host, list, opts) {
  // 重绘前记下读者正看着哪一年（同 views-lanes 的做法；host 跨视图切换存活，
  // 泳道里看到唐、切到河流仍落在唐）
  if (host.__yearOfScroll) host.__anchorYear = host.__yearOfScroll();
  host.innerHTML = '';
  // 槽位只从首位君主**实际在位**起算。buildBands 的带首含称帝前掌权期（泳道的
  // 半高段需要它），照搬到河流会让孙权自 200 年就占满一个槽——东汉最后二十年被
  // 挤出满宽、曹魏蜀汉的分叉凭空悬置。掌权期本就不计入任何统计，也不该占河面。
  const bands = buildBands(list).map((b) => {
    const s2 = Math.min(...b.segs.map((g) => g.s));
    return s2 > b.s ? { ...b, s: s2 } : b;
  });
  if (!bands.length) { host.appendChild(h('p', { class: 'muted', text: '当前筛选无数据。' })); return; }

  let pxYear = opts.riverPx || 7;
  const byDynasty = opts.laneColor !== 'unified';
  const markViolent = opts.laneViolent !== false;
  const slots = dynastyColorSlots();
  const ink = resolveInk(host);

  const W = Math.max(300, Math.floor(host.getBoundingClientRect().width) || 360);
  const t0 = Math.min(...bands.map((b) => b.s)) - 4;
  const t1 = Math.max(...bands.map((b) => b.e)) + 4;
  // 轴跨钳制：竖河画到夏初时 16px/年 × 约四千年 ≈ 6.4万px 高，iOS Safari 对
  // 超高 SVG 的栅格化内存是实际风险。生效值按跨度封顶在约 4.5万px（现库
  // 拉满 3.4万px，行为不变；轴前伸后最松档自动让步）。
  pxYear = Math.min(pxYear, Math.max(3, 45000 / (t1 - t0)));
  const H = Math.round((t1 - t0) * pxYear);
  const y = linear([t0, t1], [0, H]);
  // ── 两岸的事件轨 ────────────────────────────────────────────────────────
  // 竖河远比横轴适合装事件:同样是密集的一个十年,横轴上只有一百四十像素要塞
  // 十条名字,竖河里那是**一百四十像素的高**,一条名字才占十六——于是名字可以
  // 横写(汉字本来的读法),也几乎不必互相让位。
  // 代价是河面要让出两条边栏。窄到一定程度就不值:十六国九股并流时,
  // 河宽每让出一百像素,每股就少十一像素——名字先挤不下的是河里,不是岸上。
  // 故设河宽下限,让不出边栏时就不设边栏(改由 setupNarrowEvents 走另一套排法)。
  const showEvents = opts.laneEvents !== false;
  const BAND_MIN = 340;                    // 河宽下限:低于此不再割边栏
  const STRIP_MIN = 70;                    // 边栏下限:窄于此写不下名字
  // 要么给足,要么不给:三四十像素的边栏一个字都摆不下,却照样从河面上割走
  // 八十像素——那是两头落空。宽度不够时边栏归零,河面吃满(窄屏另有排法)。
  const stripRaw = Math.floor((W - GUTTER - 6 - BAND_MIN) / 2);
  const EV_STRIP = showEvents && stripRaw >= STRIP_MIN ? Math.min(150, stripRaw) : 0;
  const RX0 = GUTTER + EV_STRIP, RX1 = W - 6 - EV_STRIP;
  const tau = TRANS_PX / pxYear;

  const { slices, ordered, rank, C } = layoutChannels(bands, RX0, RX1);
  const { trans, flows, necks } = buildTransitions(slices, rank, pxYear, RX0, RX1);
  window.__RIVER__ = { slices, trans, flows, necks, rank, C };   // 调试钩子：布局自检用
  const flowsBy = new Map();
  for (const f of flows) { if (!flowsBy.has(f.key)) flowsBy.set(f.key, []); flowsBy.get(f.key).push(f); }
  const bandBy = new Map(bands.map((b) => [b.d.key, b]));
  const rootOf = new Map(bands.map((b) => [b.d.key, lineageRoot(b.d.key)]));  // 法统同相
  const amp = Math.min(1.6, gapFor(RX1 - RX0) * 0.3);
  // 河相蜿蜒律:窄河用 λ320 的小摆,河道占幅超过 55% 后按 smoothstep 渐入
  // λ2200 的宽河长摆——真实河流的蜿蜒波长约为河宽的 10–14 倍,大河从不高频抖动。
  // 两套**固定**波形按宽度因子交叉混合,权重连续变化而波形不变,无 chirp 拐点。
  // 越界处逐缘钳制而非把整体位移钳为零:旧钳制 w=max(RX0-b0[0], min(RX1-b0[1], w))
  // 在满宽段恒等于 0——大一统河段的蜿蜒振幅精确为零,「盛唐读成方柱」正源于此;
  // 现在满宽河在摆向一侧时贴岸内收 3.8px,河身在两岸之间从容游动
  const edge = (key, t) => {
    const b0 = edgeAt(key, t, slices, trans);
    if (!b0) return null;
    const root = rootOf.get(key) || key;
    const f = smoothstep(Math.min(1, Math.max(0,
      ((b0[1] - b0[0]) / (RX1 - RX0) - 0.55) / 0.45)));
    const w = (1 - f) * waveOf(root, t, pxYear, amp)
            + f * waveOf(root, t, pxYear, WAVE_WIDE_AMP, WAVE_WIDE_PX);
    return [Math.max(RX0, b0[0] + w), Math.min(RX1, b0[1] + w)];
  };
  const sample = (key, ta, tb) => sampleEdges((t) => edge(key, t), ta, tb, trans, pxYear);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'river-svg', role: 'img' });
  const defs = el('defs');                 // 河床渐变(首尾洇散 × 河口墨韵)
  svg.appendChild(defs);
  // 年代拟测（F 旗 Y）的斜纹：与泳道视图同一语汇（vy-hatch-l），id 分开
  // 只因两个 SVG 可能先后挂进同一份 DOM，url(#) 按文档解析，不冒撞 id 的险
  defs.appendChild(el('pattern', {
    id: 'vy-hatch-r', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)',
  }, [el('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: 'var(--surface-1)', 'stroke-width': 2.2, opacity: 0.55 })]));
  // 四个绘制层，DOM 顺序即遮挡顺序：所有河床垫底，君主段全体压在其上——
  // 因此新朝的预告细流（先于建国张开的淡色）只会显现在缝隙与河床里，
  // 绝不会浮在邻河的君主色块之上
  const gBeds = el('g'), gStrips = el('g'), gEmps = el('g'), gLabels = el('g');
  const gEvents = el('g', { class: 'river-ev' });
  const evNodes = [];      // 供两翼卡自动跟随锚点用

  // ── 时代界线：只画一条细线，不再交替填充底色——灰条纹的语义太稀薄
  //（用户实测会把它误读成某种标记），且与河床的淡色（预告楔、尾迹、空档）混淆。
  // 时代的位置感交给纪年滑杆上的界标
  ERAS.forEach((era) => {
    const yb = Math.min(H, y(era.e));
    if (yb <= 0 || yb >= H) return;
    svg.appendChild(el('line', { x1: 0, x2: W, y1: yb, y2: yb, class: 'ref-line', opacity: .5 }));
  });

  // ── 年份刻度：每 100 年一道，贴左栏 ─────────────────────────────────────
  const step = pxYear >= 12 ? 50 : 100;
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
    svg.appendChild(el('line', { x1: GUTTER - 4, x2: W, y1: y(t), y2: y(t), class: 'grid', opacity: .5 }));
    svg.appendChild(el('text', { x: GUTTER - 7, y: y(t) + 3.5, class: 'tick', 'text-anchor': 'end', 'font-size': 9.5 },
      fmtYearAxis(t)));
  }
  svg.appendChild(gBeds); svg.appendChild(gStrips); svg.appendChild(gEmps); svg.appendChild(gLabels);
  svg.appendChild(gEvents);

  // ── 两岸事件轨 ──────────────────────────────────────────────────────────
  // **按性质分岸**,不为排版而左右交替:
  //   左岸政事——战事、民变、灾疫、外交、立制:朝廷做的事与遭的事
  //   右岸文教——著述、科技、学派:这个文明留下来的东西
  // 碰撞因此减半是顺带的好处,要紧的是两岸的疏密自己会说话:唐末左岸挤满而
  // 右岸空落,北宋右岸大放而左岸尽是败绩。若只为把标签分开而交替左右,
  // 这层意思就白丢了。
  // 分法取 176:120 而非「兵祸/文治」的 72:224——后者更好听,但本库有一百一十二
  // 条文化类(我们有意补进的文学与科技),右岸会挤到掉名字而左岸空着一半。
  if (EV_STRIP > 0) {
    const evOff = new Set(opts.evOff || []);
    const FS = 10.5, ROW = 12.5;
    const R = { 1: 4, 2: 3, 3: 2.2 };
    const rk = (e) => e.r || 2;
    // 同年错开,与泳道图同理(见 views-lanes.js 的长注)。竖河里时间是纵向的,
    // 故沿河岸上下摊开;同年但分属两岸的本来就不撞,只在同岸内分组。
    const sameYear = new Map();
    for (const e2 of EVENTS) {
      if (evOff.has(e2.k) || e2.k === 'era') continue;
      const key = `${e2.y}|${LEFT_BANK.has(e2.k) ? 'L' : 'R'}`;
      if (!sameYear.has(key)) sameYear.set(key, []);
      sameYear.get(key).push(e2);
    }
    for (const g of sameYear.values()) g.sort((a2, b2) => (a2.o || 99) - (b2.o || 99));
    const fanOf = (e2) => {
      const g = sameYear.get(`${e2.y}|${LEFT_BANK.has(e2.k) ? 'L' : 'R'}`);
      return g && g.length > 1 ? (g.indexOf(e2) - (g.length - 1) / 2) * 6 : 0;
    };
    const taken = { L: [], R: [] };
    const maxCh = Math.max(3, Math.floor((EV_STRIP - 22) / FS));
    // 分量高的先挑位子(同泳道图),缩放小的年代只留一等的名字
    for (const ev of [...EVENTS].sort((a, b) => rk(a) - rk(b))) {
      // 不再按 TRANSITIONS 滤:凡**收进 events.js 的**就是我们判定该画的。
      // 那条规则本是为「别把改朝换代画两遍」,但它连淝水之战、隋灭陈之战、
      // 陈桥兵变、靖康之变都一并挡掉了——正是先前特意补回来的那十一条,
      // 补进数据却仍被这里拦在轨外,等于白补。承继细丝的刻痕在河身、
      // 事件点在表头,两处register不同,并存不算重复。
      if (evOff.has(ev.k) || ev.k === 'era') continue;
      const ty = y(evAnchor(ev)) + fanOf(ev);
      if (ty < -20 || ty > H + 20) continue;
      const kind = EVENT_KINDS[ev.k] || EVENT_KINDS.gov;
      const left = LEFT_BANK.has(ev.k);
      const bank = left ? RX0 : RX1;
      const dir = left ? -1 : 1;
      const rad = R[rk(ev)];
      gEvents.appendChild(evMark(ev.k, bank + dir * 7, ty, rad,
        { class: 'mark ev-dot', 'data-evi': String(EVENTS.indexOf(ev)) }));
      // 短引线搭到岸上:眼睛不必拿尺子量「这条名字对着哪一年」
      gEvents.appendChild(el('line', {
        x1: bank + dir * 3, x2: bank + dir * (7 - rad - 1), y1: ty, y2: ty,
        stroke: `var(--ev-${ev.k})`, 'stroke-width': 1, opacity: .55 }));
      const lane = left ? taken.L : taken.R;
      // 同泳道图:分量只管抢位子的先后,不卡死谁有资格留名(见 views-lanes.js 的注)
      const room = !lane.some((v) => Math.abs(v - ty) < ROW);
      if (room) {
        lane.push(ty);
        const nm = [...(ev.ya || ev.n)];
        const txt = nm.length > maxCh ? nm.slice(0, maxCh - 1).join('') + '…' : nm.join('');
        gEvents.appendChild(el('text', {
          x: bank + dir * 14, y: ty + 3.6, 'font-size': FS,
          'text-anchor': left ? 'end' : 'start',
          fill: 'var(--text-2)', 'pointer-events': 'none',
          'data-evi': String(EVENTS.indexOf(ev)) }, txt));
      }
      const hit = el('rect', {
        x: left ? bank - EV_STRIP - 2 : bank + 2, y: ty - ROW / 2,
        width: EV_STRIP, height: ROW,
        fill: 'transparent', 'pointer-events': 'all', class: 'kp-hit ev-hit' });
      hit.dataset.evi = String(EVENTS.indexOf(ev));
      evNodes.push({ ev, y: ty, left });
      hoverable(hit, () => [
        { color: `var(--ev-${ev.k})`, label: kind.label,
          value: ev.y2 ? `${fmtYearAxis(ev.y)}–${fmtYearAxis(ev.y2)}` : fmtYearAxis(ev.y) },
        { label: '事件', value: ev.n },
        ...(ev.yc ? [ev.yc] : []),
        '点它可在卡片里读这条大事记的词条。',
      ], () => ev.ya || ev.n);
      gEvents.appendChild(hit);
    }
  }

  // ── 河道 ────────────────────────────────────────────────────────────────
  const empNodes = [];
  const labelNodes = [];
  // 河面上已经写了字的地方：君主名（海名式疏排／竖排）、非正常死亡的刻痕、
  // 朝代名。窄屏的事件层要写进河道里，就得先知道哪些地方已经有人——
  // 否则「诛吕安刘」会正好压在「后 少 帝」的三个字上（用户实测截图）。
  const inkTaken = [];
  for (const b of ordered) {
    const cvar = byDynasty ? slotVar(slots.get(b.d.key)) : (b.d.u ? '--c-unified' : '--c-split');
    const col = `var(${cvar})`;
    const st = DYN_STATS.get(b.d.key);

    // 河床：淡色底。首尾各向外多要 tau——楔尖与合拢尾就长在这段延伸里，
    // 生前死后窗外的采样返回 null 自动裁掉，无须另算窗的实际半长
    const bedSamples = sample(b.d.key, b.s - 3 * tau, b.e + 3 * tau);
    const bedPath = polyPath(bedSamples, y, 1);
    if (!bedPath) continue;
    // 首尾洇散 × 河口墨韵:每床一个纵向渐变,stop-opacity 给首尾方向性剖面、
    // stop-color 在承统过渡窗里做两朝色的互渗。剖面与连续性三级同构:
    //   无前身 → 预告楔自 0 洇入(浓淡编码「离真实建号还有多远」,预告不再与
    //             在位空档同浓);承统头 → 窗内自前朝色洇入、透明度 0→1;
    //   承统尾 → 窗内洇向新朝色、透明度 1→0——前尾与新头在共用的窗里恰好互补,
    //             细颈全程合成恒定一层(秦→汉的悬丝不洇断,还顺带修掉此前
    //             两床叠压的双重加深);亡入尾 → 保 0.6 终值(没入对岸,非蒸发);
    //   真正断流 → 洇出至 0。君主色块分毫不动,洇与渗只发生在河床层;
    // stop-color 走 CSS 变量,亮暗主题自动跟随
    const bedA = b.s - 3 * tau, bedZ = b.e + 3 * tau;
    const off = (t2) => Math.min(1, Math.max(0, (t2 - bedA) / (bedZ - bedA)));
    const headN = necks.find((n2) => n2.yk === b.d.key);
    const tailN = necks.find((n2) => n2.xk === b.d.key);
    const varOf = (k2) => {
      const bb = bandBy.get(k2);
      return bb ? (byDynasty ? slotVar(slots.get(k2)) : (bb.d.u ? '--c-unified' : '--c-split')) : null;
    };
    const predV = headN ? varOf(headN.xk) : null;
    const succV = tailN ? varOf(tailN.yk) : null;
    const stops = [];
    if (predV) stops.push([0, predV, 0], [off(headN.a), predV, 0], [off(headN.z), cvar, 1]);
    else stops.push([0, cvar, 0], [off(b.s), cvar, 1]);
    if (succV) stops.push([off(tailN.a), cvar, 1], [off(tailN.z), succV, 0], [1, succV, 0]);
    else if (MERGED_INTO[b.d.key] && bandBy.has(MERGED_INTO[b.d.key]))
      stops.push([off(b.e), cvar, 1], [1, cvar, 0.6]);
    else stops.push([off(b.e), cvar, 1], [1, cvar, 0]);
    const gid = `river-bed-${b.d.key}`;
    const grad = el('linearGradient', {
      id: gid, gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0, y1: y(bedA), y2: y(bedZ),
    });
    let prevOff = 0;
    for (const [o, cv, op] of stops) {
      prevOff = Math.max(prevOff, o);
      grad.appendChild(el('stop', {
        offset: prevOff.toFixed(4), style: `stop-color:var(${cv});stop-opacity:${op}`,
      }));
    }
    defs.appendChild(grad);
    const bed = el('path', { d: bedPath, fill: `url(#${gid})`, opacity: .16, class: 'mark', 'data-dyn': b.d.key });
    hoverable(bed, () => [
      { color: col, value: `${fmtYearAxis(b.d.s)}–${fmtYearAxis(b.d.e)}`, label: '国祚' },
      { label: '历时', value: `${st.span} 年` },
      { label: '皇帝', value: `${st.n} 位（当前筛选 ${b.n} 位）` },
      { label: 'DSI', value: st.dsi === null ? '—' : `${fmt1(st.dsi)} 年/帝` },
      ...(b.d.bio ? [b.d.bio] : []),
      ...(b.d.note ? [b.d.note] : []),
    ], () => b.d.name);
    gBeds.appendChild(bed);

    // 穿流带：亡入（或分出）对象不相邻时的半透明细带。画在河床层，
    // 于是途经河道的君主色块天然盖在它上面——主河在上，穿流只在底色间可见
    for (const f of (flowsBy.get(b.d.key) || [])) {
      const RIB = 84 / pxYear;                       // 带长（年）
      const sx = (f.stem[0] + f.stem[1]) / 2;
      const tv = f.dir === 'merge' ? f.c + f.h + RIB : f.c - f.h - RIB;
      const tb = edge(f.tgt, tv) || edge(f.tgt, f.c + (f.dir === 'merge' ? f.h : -f.h)) || edge(f.tgt, f.c);
      if (!tb) continue;
      const bx = sx < (tb[0] + tb[1]) / 2 ? tb[0] + STEM : tb[1] - STEM;
      const [ya, yb2] = f.dir === 'merge'
        ? [y(f.c + f.h), y(Math.min(tv, t1))]
        : [y(Math.max(tv, t0)), y(f.c - f.h)];
      const [xa, xb2] = f.dir === 'merge' ? [sx, bx] : [bx, sx];
      const my = (ya + yb2) / 2;
      const d = `M${(xa - STEM).toFixed(1)},${ya.toFixed(1)}`
        + `C${(xa - STEM).toFixed(1)},${my.toFixed(1)} ${(xb2 - STEM).toFixed(1)},${my.toFixed(1)} ${(xb2 - STEM).toFixed(1)},${yb2.toFixed(1)}`
        + `L${(xb2 + STEM).toFixed(1)},${yb2.toFixed(1)}`
        + `C${(xb2 + STEM).toFixed(1)},${my.toFixed(1)} ${(xa + STEM).toFixed(1)},${my.toFixed(1)} ${(xa + STEM).toFixed(1)},${ya.toFixed(1)}Z`;
      const rib = el('path', { d, fill: col, opacity: .22, class: 'mark river-flow', 'data-dyn': b.d.key });
      hoverable(rib, () => [
        f.dir === 'merge'
          ? `${b.d.name}亡入${(bands.find((x) => x.d.key === f.tgt) || { d: { name: f.tgt } }).d.name}（${fmtYearAxis(f.c)}）——中间隔着别的河道，故以穿流带示意，点选可点亮。`
          : `${b.d.name}裂出自${(bands.find((x) => x.d.key === f.tgt) || { d: { name: f.tgt } }).d.name}（${fmtYearAxis(f.c)}）——中间隔着别的河道，故以穿流带示意，点选可点亮。`,
      ], () => (f.dir === 'merge' ? '亡入' : '分出'));
      gBeds.appendChild(rib);
    }

    // 称帝前掌权期：贴河道左缘的窄条。不是正式在位期，视觉上必须与君主段可区分
    for (const g of b.preRule) {
      const s0 = sample(b.d.key, g.s, g.x);
      const w = s0.length ? Math.min(7, (s0[0].x1 - s0[0].x0) / 3) : 0;
      if (!w) continue;
      const d = polyPath(s0.map((p) => ({ t: p.t, x0: p.x0, x1: p.x0 + w })), y, 0.5);
      if (!d) continue;
      const node = el('path', { d, fill: col, opacity: .5, class: 'mark' });
      hoverable(node, () => [
        { color: col, value: `${fmtDate(g.e.accRule, { yearOnly: true })}–${fmtDate(g.e.acc, { yearOnly: true })}`, label: '掌权（未称帝）' },
        { label: '称帝', value: fmtDate(g.e.acc) },
        '此段为该君主实际掌握政权最高权力、但尚未即皇帝位的时期，不计入「在位年数」。',
      ], () => `${b.d.name}·${g.e.temple}`);
      gStrips.appendChild(node);
    }

    // 君主分段：实色块。段间缝按像素给（1.1px），不按年——按年给会在密集期
    // 放大成一屏横纹；起讫日期本身始终是真实值，缝只是绘图退让
    for (const g of b.segs) {
      const gapY = Math.min(1.1 / pxYear, (g.x - g.s) * 0.22);
      const segSamples = sample(b.d.key, g.s + gapY, g.x - gapY);
      const d = polyPath(segSamples, y, 1);
      if (!d) continue;
      const node = el('path', { d, fill: col, class: 'mark river-emp',
        ...(g.e.yearsSurmised ? { opacity: 0.55 } : {}) });
      node.dataset.emp = g.e.id;
      const tip = () => [
        { color: col, value: `${fmtDate(g.e.acc, { yearOnly: true })}–${g.e.reignEnd ? fmtDate(g.e.reignEnd, { yearOnly: true }) : '？'}`, label: '在位' },
        { label: '在位年数', value: g.e.reignYears === null ? '—' : `${g.e.reignYears.toFixed(1)} 年` },
        { label: '享年', value: g.e.lifespan === null ? '不详' : `${Math.floor(g.e.lifespan)} 岁` },
        { label: '登基年龄', value: g.e.accAge === null ? '不详' : `${Math.floor(g.e.accAge)} 岁` },
        { label: '死因', value: g.e.causeLabel },
        ...(g.e.yearsSurmised ? ['斜纹段＝低置信年份：推算所得（传统系年铺入，或诸家体系并存取其一），非史源确年；依据见本条备注。'] : []),
        ...(g.e.note ? [g.e.note] : []),
      ];
      hoverable(node, tip, () => `${b.d.name}·${g.e.temple}`);
      gEmps.appendChild(node);
      if (g.e.yearsSurmised) {
        gEmps.appendChild(el('path', { d, fill: 'url(#vy-hatch-r)', 'pointer-events': 'none', class: 'mark' }));
      }
      const midBox0 = edge(b.d.key, (g.s + g.x) / 2);
      empNodes.push({ node, e: g.e, band: b, col, tip,
        y0: y(g.s), y1: y(g.x), cx: midBox0 ? (midBox0[0] + midBox0[1]) / 2 : W / 2 });

      // 非正常死亡：段末右缘的红色刻痕。初版横贯全河道，在五代十国这类
      // 短祚扎堆的年代叠成一片红白横纹——刻痕保留信号、去掉噪音
      if (markViolent && g.e.violent === 1 && g.e.reignEnd && Math.abs(g.x - g.e.reignEnd.t) < 0.01) {
        const box = edge(b.d.key, Math.max(g.s, g.x - gapY));
        if (box) {
          const wN = Math.max(9, Math.min((box[1] - box[0]) * 0.4, 46));
          gEmps.appendChild(el('line', {
            x1: box[1] - 1.5 - wN, x2: box[1] - 1.5, y1: y(g.x) - 1.4, y2: y(g.x) - 1.4,
            stroke: 'var(--critical)', 'stroke-width': 2.5, 'stroke-linecap': 'round',
          }));
          inkTaken.push([box[1] - 2.5 - wN, box[1] - 0.5, y(g.x) - 3.4, y(g.x) + 0.6]);
        }
      }

      // 君主简称。窄河道竖排（汉字的本来排法，省横向空间）；河道宽过阈值时
      // 转横排并按宽度微调字号——满幅大河里竖排两个字读起来滑稽。
      // 阈值 110px：竖排只在横排放不开的地方出现，两种排法不会同屏打架
      const nm = shortName(g.e);
      const midBox = edge(b.d.key, (g.s + g.x) / 2);
      const chW = midBox ? midBox[1] - midBox[0] : 0;
      const runH = y(g.x) - y(g.s);
      const inkCol = ink[cvar] === 'dark' ? 'var(--text-1)' : 'var(--surface-1)';
      if (midBox && chW >= 110 && runH >= 18) {
        // 海名式疏排:地图给大水域注名的百年惯例——字距即领域感。名字属于整片
        // 河面,字距随河宽增长(两字名封顶 1.0em 防散架,长名 1.5em),
        // 「武帝」在满宽汉河里疏成横过河心的一行题字。逐字 tspan dx 而非
        // letter-spacing:后者在末字后多算一格,居中会右偏
        const fs = chW >= 280 ? 13.5 : 12;
        const base = textWidth(nm, fs);
        const sp = Math.max(0, Math.min(fs * (nm.length <= 2 ? 1.0 : 1.5),
          (chW * 0.35 - base) / Math.max(1, nm.length - 1)));
        const total = base + sp * (nm.length - 1);
        if (total + 12 < chW) {
          const x0 = (midBox[0] + midBox[1]) / 2 - total / 2;
          const cy = y((g.s + g.x) / 2);
          const tEl = el('text', {
            x: x0, y: cy + fs * 0.36,
            'font-size': fs, fill: inkCol, 'pointer-events': 'none',
          });
          [...nm].forEach((c, i) => tEl.appendChild(el('tspan', i ? { dx: sp.toFixed(1) } : {}, c)));
          gEmps.appendChild(tEl);
          inkTaken.push([x0 - 3, x0 + total + 3, cy - fs * 0.62, cy + fs * 0.62]);
        }
      } else if (midBox && chW >= 15 && runH >= nm.length * 10 + 6) {
        const tx = (midBox[0] + midBox[1]) / 2;
        const ty = y(g.s) + (runH - nm.length * 10) / 2 + 9;
        const t = el('text', {
          x: tx, y: ty, 'font-size': 10, 'text-anchor': 'middle',
          fill: inkCol, 'pointer-events': 'none',
        });
        [...nm].forEach((c, i) => t.appendChild(el('tspan', { x: tx, dy: i ? 10 : 0 }, c)));
        gEmps.appendChild(t);
        inkTaken.push([tx - 8, tx + 8, ty - 9, ty + 10 * (nm.length - 1) + 2.5]);
      }
    }

    // 朝代名：写在河道起点上方；滚动时吸附于视口上缘，但不越出自身区间
    const box0 = edge(b.d.key, Math.min(b.e, b.s + Math.min(tau, (b.e - b.s) / 2))) || edge(b.d.key, b.s);
    if (!box0) continue;
    const lw = textWidth(b.d.name, 11.5);
    const cx = (box0[0] + box0[1]) / 2;
    const lx = Math.max(GUTTER + 2, Math.min(W - lw - 2, cx - lw / 2));
    const dot = el('circle', { cx: box0[0] + 5, cy: y(b.s) + 6, r: 3, fill: col });
    // 朝代名滚动时会吸顶游走，登记的是它的**起点**——那是它待得最久的位置，
    // 也是「西汉」两个字与「齐王墓方镜」撞在一起的地方
    inkTaken.push([lx - 3, lx + lw + 3, y(b.s) - 2, y(b.s) + 13]);
    inkTaken.push([box0[0], box0[0] + 10, y(b.s) + 1, y(b.s) + 11]);
    const label = el('text', {
      x: lx, y: y(b.s) + 10,
      'font-size': 11.5, 'font-weight': 640, fill: 'var(--text-1)', 'pointer-events': 'none',
      stroke: 'var(--page)', 'stroke-width': 3, 'paint-order': 'stroke',
    }, b.d.name);
    gLabels.appendChild(dot); gLabels.appendChild(label);
    labelNodes.push({ dot, label, y0: y(b.s), y1: y(b.e), lw, key: b.d.key });
  }

  // 事件层放在最后：它要避开的不只是彼此，还有河道里已有的字
  // （君主名与朝代名）——先画河才知道那些字占了哪里
  if (EV_STRIP === 0 && showEvents) {
    // ── 河道内的事件层（窄屏） ──────────────────────────────────────────────
    // 手机上让不出两条边栏，于是把事件放进**河道本身**——事件本就发生在历史
    // 这条河里，而不是发生在它的岸边。有空间就直接写名字，没空间只留标记。
    //
    // 归属阶梯（四级，越靠前越硬；能确定才进河道，不能确定的一律不占河）：
    //   ① `d` 字段显式指定——era 类早就是这么做的（并存时代里，重叠面积从来
    //      不是归属的证据：咸平之治会被面积猜到辽国、乾淳之治猜到大理）；
    //   ② **改朝换代类落过渡段的正中**。这一类的归属本是个死结——淝水之战放进
    //      前秦的河道还是东晋的？放哪边都是替读者判断。而它们本来就不属于任何
    //      一边，属于「一边变成另一边」的那一刻，落在过渡的正中即两不亏欠；
    //   ③ 当时只有一个政权在场：无歧义（安史之乱→唐）；
    //   ④ 其余落在**河道之间的缝上**——与②同一个道理：说不准归谁，就不占谁。
    const evOff = new Set(opts.evOff || []);
    // ROW 13.5 而非字号的 11.5：10px 的字实际占 12px 高，再贴着排就是两行字
    // 挨在一起没有一丝白；13.5 给出一线呼吸
    const FS = 10, ROW = 13.5;
    const R = { 1: 4, 2: 3, 3: 2.3 };
    const rk = (e) => e.r || 2;
    // 二三等要「河道宽松」才放出来，宽松有两个方向：
    //   横向 MIN_W——河道窄到写不下就别挤（十六国的九股并流里，二三等一律不放）；
    //   纵向 PAD ——名字要多大的清净才配写出来。一等按自身高度找空当，二等要
    //     两倍半、三等要五倍。于是**标记可以密、名字必须疏**：那正是
    //     「有空间时直接写名字，没空间时只画标记」——标记是「这儿有一件事」，
    //     写不写得下名字是另一回事，不该让一条写不下的名字连点都不留。
    const MIN_W = { 1: 0, 2: 40, 3: 80 };
    // PAD 比初版松（2.6/5 → 1.8/2.8）：那时名字全挤在岸边一列上，一列之内
    // 只能靠拉大纵向间距来防挤；如今落位会自己摊到几档上，横向已经分开了，
    // 再要求那么大的纵向清净，白白扔掉三十来条本可以写出来的名字
    const PAD = { 1: 1.15, 2: 1.8, 3: 2.8 };
    // 改朝换代事件的索引：条目名 → 那次改道的中点。TRANSITIONS 的键即「前者>后者」，
    // 而 buildTransitions 已经算出每次改道前后两端的河道盒，中点直接可用。
    // 同名多处的（刘裕北伐既灭南燕又灭后秦、东汉统一战争两见）按年份就近取
    const transByW = new Map();
    for (const [pair, tr] of Object.entries(TRANSITIONS)) {
      const [xk, yk] = pair.split('>');
      for (const t of trans) {
        if (!t.from.has(xk) || !t.to.has(yk) || t.to.has(xk)) continue;
        const A = t.from.get(xk), B = t.to.get(yk);
        if (!transByW.has(tr.w)) transByW.set(tr.w, []);
        transByW.get(tr.w).push({ c: t.c + t.span / 2, x: ((A[0] + A[1]) + (B[0] + B[1])) / 4 });
      }
    }
    const sliceAt = (t) => slices.find((s) => t >= s.a - EPS && t < s.z + EPS);
    // 缝上事件（key null）此前拿着全河宽 [RX0,RX1] 的自由度找空位，结果全
    // 漂进河面较空的那一条：南越与西汉并流的九十三年里，马王堆帛书、诛吕
    // 安刘、封狼居胥全被挤进南越河（用户实测）。收紧为「贴缝走廊」：只准
    // 在锚点 ±CORR 内滑动——密处名字挤不下自然退成标记，也不越河认亲
    const CORR = 58;
    const corridor = (x, lo, hi) => ({ lo: Math.max(lo, x - CORR), hi: Math.min(hi, x + CORR) });
    const CAMEO = new Set([...DYN_MAP.values()].filter((d) => d.cameo).map((d) => d.key));
    const anchorOf = (ev) => {
      if (ev.d) {
        const b = edge(ev.d, ev.y);
        if (b) return { x: (b[0] + b[1]) / 2, w: b[1] - b[0], lo: b[0] + 1, hi: b[1] - 1, key: ev.d };
      }
      // 未落在河道里的（改朝换代与归属未定）也不贴岸：留 2px 免得字被裁在边上
      const cands = transByW.get(ev.w);
      if (cands) {
        const best = cands.reduce((m, c) => (Math.abs(c.c - ev.y) < Math.abs(m.c - ev.y) ? c : m));
        // 只认时间上对得上的那一次：事件与改道相差二十年以上，多半是同名异事
        if (Math.abs(best.c - ev.y) <= 20) return { x: best.x, w: RX1 - RX0, ...corridor(best.x, RX0 + 2, RX1 - 2), key: null };
      }
      const sl = sliceAt(evAnchor(ev));
      if (!sl || !sl.n) return null;
      const boxes = [];
      for (const k of sl.at.keys()) { const b = edge(k, ev.y); if (b) boxes.push([b, k]); }
      if (!boxes.length) return null;
      if (boxes.length === 1) {
        const [b, k] = boxes[0];
        // 客串政权（cameo，单主入库）不自动认领无主事件：西楚独占河面的那
        // 几年里，鸿门宴、楚汉战争并不因此成了西楚的内政——落缝上语义
        if (CAMEO.has(k)) {
          const cx = (b[0] + b[1]) / 2;
          return { x: cx, w: b[1] - b[0], ...corridor(cx, b[0] + 1, b[1] - 1), key: null };
        }
        return { x: (b[0] + b[1]) / 2, w: b[1] - b[0], lo: b[0] + 1, hi: b[1] - 1, key: k };
      }
      boxes.sort((a, b) => a[0][0] - b[0][0]);
      const mid = (RX0 + RX1) / 2;
      let x = null;
      for (let i = 0; i + 1 < boxes.length; i++) {
        const seam = (boxes[i][0][1] + boxes[i + 1][0][0]) / 2;
        if (x === null || Math.abs(seam - mid) < Math.abs(x - mid)) x = seam;
      }
      return x === null ? null : { x, w: (RX1 - RX0) / boxes.length, ...corridor(x, RX0 + 2, RX1 - 2), key: null };
    };
    // 占位表：河面上已有的字（君主名、朝代名、刻痕）先入表，事件只能填空当；
    // 而后标记与名字也各自登记，后来者按分量高低依次找位。名字挤不下就只留
    // 标记，标记也挤不下就整条不画（一等除外——锚点恒画，宁可与人相叠）
    const taken = inkTaken.slice();
    const free = (x0, x1, y0, y1) => !taken.some((p) => x0 < p[1] && x1 > p[0] && y0 < p[3] && y1 > p[2]);
    for (const ev of [...EVENTS].sort((a, b) => rk(a) - rk(b) || a.y - b.y)) {
      if (evOff.has(ev.k) || ev.k === 'era') continue;
      const ty = y(ev.y);
      if (ty < -20 || ty > H + 20) continue;
      const an = anchorOf(ev);
      if (!an || an.w < MIN_W[rk(ev)]) continue;
      const kind = EVENT_KINDS[ev.k] || EVENT_KINDS.gov;
      const rad = R[rk(ev)];
      const txt = ev.ya || ev.n;
      // 标记＋间隙＋名字。textWidth 按 1em 估汉字宽,实测字面要 1.05em,
      // 再加描边衬底左右各溢出 1.3px——不留这点余量,密处会蹭到邻居
      const gw = rad * 2 + 3 + textWidth(txt, FS) * 1.06 + 3;
      // **贴岸排**，与宽屏两岸同一条规则:左岸政事(战事、民变、灾疫、外交、立制)、
      // 右岸文教(著述、科技、遗存)——只是这回贴的是**本河道自己的两岸**。
      // 三个好处一并到手:两岸的疏密照旧自己说话(唐末左岸挤满、北宋右岸大放);
      // 河心让给君主名(海名式疏排本就写在河心);且名字排成两列而不是撒在河面上——
      // 初版从河心起找空位,每条各偏一点,读起来像一片词云而不是一条时间轴。
      // 缝上的(改朝换代、归属未定)不属于任何一条河,仍居中于缝。
      const bank = an.key ? (LEFT_BANK.has(ev.k) ? 'L' : 'R') : 'C';
      // 落位分两步:先把本半区切成几档,再**挑最空的那一档**——不是「第一个放得下的」。
      // 挑第一个会把所有名字压在岸边排成一条，另半边整片空着（北宋一水的文教类，
      // 右岸叠成一柱、左岸空白）；挑最空的则自动摊开，密处两三档并用、疏处仍归岸边。
      // 「空」按**与最近邻的纵向净距**算，只看 x 上真正相交的那些——超过 SPREAD
      // 就都算足够空，不再为几像素的差别把名字甩到对岸。
      // 本半区排不下时才越过河心（tier 1）：不是取消两岸之分，而是让「一岸挤爆、
      // 另一岸空着」时名字有地方去——两岸都忙的年代（唐）自然轮不到它。
      const SPREAD = 110;
      const clearance = (x0, x1, hh) => {
        let min = SPREAD;
        for (const p of taken) {
          if (x0 >= p[1] || x1 <= p[0]) continue;        // x 不相交，互不相干
          const dy = Math.max(p[2] - (ty + hh), (ty - hh) - p[3]);
          if (dy < 0) return null;                       // 撞上了
          if (dy < min) min = dy;
        }
        return min;
      };
      const seek = (w, hh) => {
        const span = an.hi - an.lo;
        if (w > span) return null;
        const room = span - w;
        const own = bank === 'C' ? room : room / 2;      // 本半区的可移动量
        const N = 3;
        const cands = [];
        for (let i = 0; i <= N; i++) cands.push([(own * i) / N, 0]);
        for (let i = 1; i <= N; i++) cands.push([own + ((room - own) * i) / N, 1]);
        let best = null;
        for (const [d, tier] of cands) {
          const x = Math.max(an.lo, Math.min(an.hi - w,
            bank === 'R' ? an.hi - w - d : bank === 'L' ? an.lo + d : an.x - w / 2 + (d - own / 2)));
          const gap = clearance(x, x + w, hh);
          if (gap === null) continue;
          // 同档次里取最空的；差不多空（6px 以内）时取更贴岸的那一档，免得为一点点
          // 差别把整列名字晃来晃去
          if (!best || tier < best.tier || (tier === best.tier && gap > best.gap + 6)) best = { x, gap, tier };
        }
        return best ? best.x : null;
      };
      let lab = true;
      let x0 = seek(gw, (ROW / 2) * PAD[rk(ev)]);
      if (x0 === null) { lab = false; x0 = seek(rad * 2 + 2, rad + 1); }
      if (x0 === null) {
        if (rk(ev) > 1) continue;
        x0 = bank === 'R' ? an.hi - rad * 2 - 2 : bank === 'L' ? an.lo : an.x - rad - 1;
      }
      const gwNow = lab ? gw : rad * 2 + 2;
      // 标记在**外侧**(贴岸那一头)、名字向河心伸展——与两岸事件轨的引线同向
      const mx = bank === 'R' && lab ? x0 + gwNow - rad : x0 + rad + 1;
      const half = lab ? ROW / 2 : rad + 1;            // 登记的是实占，不是求得的清净
      taken.push([x0, x0 + gwNow, ty - half, ty + half]);
      const g = el('g', { class: 'river-evi' });
      g.dataset.dyn = an.key || '';        // 空＝落在缝上（改朝换代或归属未定），布局自检用
      // 形状分类、页色细边分图地:标记压在饱和的君主色块上，而河道本身正是用
      // 同一套色板着色的——蓝点落在蓝河上就等于没画（见 views-lanes 的 evMark）
      g.appendChild(evMark(ev.k, mx, ty, rad,
        { class: 'mark ev-dot', stroke: 'var(--page)', 'stroke-width': 0.8,
          'data-evi': String(EVENTS.indexOf(ev)) }));
      if (lab) {
        // 名字压在君主色块之上，故以页色描边作衬——与朝代名同一套写法。
        // 贴右岸者名字右对齐(自河心向岸边收),两侧于是各成一列齐整的边
        g.appendChild(el('text', {
          x: bank === 'R' ? x0 + gwNow - rad * 2 - 3 : x0 + rad * 2 + 3, y: ty + 3.4,
          'font-size': FS, fill: 'var(--text-1)', 'text-anchor': bank === 'R' ? 'end' : 'start',
          stroke: 'var(--page)', 'stroke-width': 2.6, 'paint-order': 'stroke',
          'pointer-events': 'none' }, txt));
      }
      const hit = el('rect', {
        x: x0 - 3, y: ty - Math.max(half, 5.5), width: gwNow + 6, height: Math.max(half, 5.5) * 2,
        fill: 'transparent', 'pointer-events': 'all', class: 'kp-hit ev-hit' });
      hit.dataset.evi = String(EVENTS.indexOf(ev));
      hoverable(hit, () => [
        { color: `var(--ev-${ev.k})`, label: kind.label,
          value: ev.y2 ? `${fmtYearAxis(ev.y)}–${fmtYearAxis(ev.y2)}` : fmtYearAxis(ev.y) },
        { label: '事件', value: ev.n },
        ...(ev.yc ? [ev.yc] : []),
        ...(an.key ? [] : ['画在河道之间的缝上：改朝换代本就发生在两条河之间；'
          + '其余落在缝上的，是并存年代里归属尚未判定的，不占任何一条河。']),
        '再点一下可读这条大事记的词条。',
      ], () => ev.ya || ev.n);
      g.appendChild(hit);
      gEvents.appendChild(g);
    }
  }

  const wrap = h('div', { class: 'river-wrap' }, [svg]);
  host.appendChild(wrap);

  // 触屏上锁定改**双击**:滚动两万多像素的长卷时指尖常擦到河面,单击即选中
  // 会一路误标(用户实测)。首击仍有触屏悬停提示(hoverable 的 touch 路径)
  // 托底,双击的意图性才配得上「锁定 + 链式点亮 + 详情卡」这一整套动作。
  // 桌面鼠标无此误触面,保持单击。事件层同此规矩:单击显示名字、双击开知识卡。
  const coarse = matchMedia('(pointer: coarse)');
  let lastTap = { id: null, t: 0 };
  const twiceOn = (id) => {
    const now = performance.now();
    const twice = lastTap.id === id && now - lastTap.t < 400;
    lastTap = { id, t: now };
    return twice;
  };

  // 桌面两翼知识卡:上行左朝代、右皇帝,下行接住两岸事件轨(见 knowledge.js)
  const kClean = mountKnowledge(empNodes, wrap, evNodes);
  // 点事件:哪岸点的就落哪栏。左岸政事落左栏、右岸文教落右栏——
  // 卡片正在它那条轨的下方,眼睛不必横跨整条河去找刚点的那件事。
  // 窄屏没有两翼,落到底部的手机单卡(一次只开一张)
  const openEvent = (ev) => {
    if (!kClean.showEvent) return;
    if (kClean.soloMode && kClean.soloMode()) clearSel();   // 底部只容得下一张卡
    kClean.showEvent(evSpec(ev), LEFT_BANK.has(ev.k) ? 'left' : 'right');
    stampHash('ev', ev.n);
  };
  wrap.addEventListener('click', (e) => {
    const hit = e.target.closest && e.target.closest('.ev-hit');
    if (!hit) return;
    const ev = EVENTS[Number(hit.dataset.evi)];
    if (!ev) return;
    e.stopPropagation();
    if (coarse.matches && !twiceOn(`ev:${hit.dataset.evi}`)) return;
    openEvent(ev);
  });

  // ── 纪年滑杆：仅本节占据视口时出现，贴左缘；拖动即跳到对应年份。
  // 两万像素的长卷里「翻到某一年」不该只能靠一路滚——滑杆就是这一节的目录。
  // 杆上的短横线是时代界标（秦汉/魏晋南北朝/…的分界）
  const scrub = h('div', { class: 'river-scrub' });
  // 手柄常驻、**读数只在动的时候现身**:年份药丸是不透明的,又贴着左缘——
  // 事件层贴岸排之后,左岸正是政事类事件的落脚处,一块常驻的白底就压在它们身上
  // (用户实测:一个球看着像被裁了一半,底下还压着一个)。读数随滚动浮出、
  // 停手一秒余即隐去:要看年份的时候它在,读河面的时候它不在。
  const thumb = h('div', { class: 'rs-thumb' });
  const read = h('div', { class: 'rs-read' });
  const track = h('div', { class: 'rs-track' });
  // 干流微图:把本图唯一的核心变量 n(t) 的「=1」区间(天下一统)印上滑轨——
  // 滑杆既是目录,目录就该印出合分的节律。短于 5 年的 n=1 段不印:微段桥接
  // 只影响绘制不影响 slices,曹丕受禅至蜀汉自立的数月「一统」印上去是史观失真;
  // 短段放大到 0.9%(约 3px)保证可见,轻微时长失真可接受
  {
    const uni = [];
    for (const s of slices) {
      if (s.n !== 1) continue;
      const last = uni[uni.length - 1];
      if (last && s.a - last.z < EPS) last.z = s.z;
      else uni.push({ a: s.a, z: s.z });
    }
    const pct = (t) => ((t - t0) / (t1 - t0)) * 100;
    const gs = [];
    for (const u of uni.filter((u2) => u2.z - u2.a >= 5)) {
      let p1 = pct(u.a), p2 = pct(u.z);
      if (p2 - p1 < 0.9) { const m = (p1 + p2) / 2; p1 = m - 0.45; p2 = m + 0.45; }
      gs.push(`var(--border) ${p1.toFixed(2)}%`, `var(--c-unified) ${p1.toFixed(2)}%`,
        `var(--c-unified) ${p2.toFixed(2)}%`, `var(--border) ${p2.toFixed(2)}%`);
    }
    if (gs.length) track.style.background =
      `linear-gradient(to bottom, ${['var(--border) 0%', ...gs, 'var(--border) 100%'].join(', ')})`;
  }
  scrub.appendChild(track);
  for (const era of ERAS) {
    const f = (era.e - t0) / (t1 - t0);
    if (f > 0.02 && f < 0.98) scrub.appendChild(h('div', { class: 'rs-era', style: `top:${(f * 100).toFixed(2)}%` }));
  }
  scrub.appendChild(thumb);
  scrub.appendChild(read);
  document.body.appendChild(scrub);
  // 读数浮出、停手即隐:药丸不透明又贴左缘,常驻就一直压着左岸的事件
  let readT = null;
  const flashRead = () => {
    read.classList.add('on');
    if (readT) clearTimeout(readT);
    readT = setTimeout(() => read.classList.remove('on'), 1300);
  };
  const scrubTo = (clientY) => {
    const r = scrub.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    const t = t0 + f * (t1 - t0);
    const wrapTop = wrap.getBoundingClientRect().top + scrollY;
    scrollTo({ top: wrapTop + y(t) - innerHeight * 0.45, behavior: 'instant' });
  };
  let scrubbing = false;
  scrub.addEventListener('pointerdown', (e) => {
    scrubbing = true;
    scrubTo(e.clientY);
    try { scrub.setPointerCapture(e.pointerId); } catch { /* 合成指针无捕获可言 */ }
    e.preventDefault();
  });
  scrub.addEventListener('pointermove', (e) => { if (scrubbing) scrubTo(e.clientY); });
  scrub.addEventListener('pointerup', () => { scrubbing = false; });

  // ── 点选高亮 ────────────────────────────────────────────────────────────
  // 触屏没有悬停，故以点选替代：选中者留亮，同屏其余压暗，详情进底部固定卡片。
  const card = h('div', { class: 'river-card' });
  document.body.appendChild(card);
  let selected = null;
  let litEls = [];
  // 法统链两跳:点选时沿 SUCCESSION 上下各亮两跳,微光递减——「这条河从哪来、
  // 到哪去」是点选后最自然的追问,链式微光是唯一能让「法统一线」在 2.6 万 px
  // 长卷上显形的方式,且静息态零新增像素。两跳封顶是底线:不封顶则点一下清朝
  // 亮出半部通史,喧宾夺主
  const succRev = new Map();
  for (const b of bands) {
    const p = SUCCESSION[b.d.key];
    if (p && bandBy.has(p)) { if (!succRev.has(p)) succRev.set(p, []); succRev.get(p).push(b.d.key); }
  }
  const chainOf = (key) => {
    const lv = new Map([[key, 0]]);
    let frontier = [key];
    for (let hop = 1; hop <= 2; hop++) {
      const next = [];
      for (const k of frontier) {
        const p = SUCCESSION[k];
        if (p && bandBy.has(p) && !lv.has(p)) { lv.set(p, hop); next.push(p); }
        for (const c2 of (succRev.get(k) || [])) if (!lv.has(c2)) { lv.set(c2, hop); next.push(c2); }
      }
      frontier = next;
    }
    return lv;
  };
  const clearSel = () => {
    selected = null;
    card.classList.remove('on');
    document.body.classList.remove('river-card-on');
    for (const n of empNodes) n.node.classList.remove('dim', 'dim2', 'sel');
    for (const e2 of litEls) e2.setAttribute('opacity', e2.dataset.o0);
    litEls = [];
  };
  const select = (item) => {
    selected = item;
    if (kClean.hideSolo) kClean.hideSolo();     // 底部只容得下一张卡:开这张即收那张
    const lv = chainOf(item.band.d.key);
    for (const n of empNodes) {
      const hop = lv.get(n.band.d.key);
      n.node.classList.toggle('sel', n === item);
      // 链上成员的君主段只压到半暗(dim2)——河床在暗纱下发光是自相矛盾的画面
      n.node.classList.toggle('dim2', n !== item && hop !== undefined);
      n.node.classList.toggle('dim', n !== item && hop === undefined);
    }
    // 点亮链上各政权的河床与穿流带,亮度随跳数递减:被压在君主色块下的
    // 汇流去向、贯穿空窗的承统细颈,由此连成一条可见的水脉
    for (const e2 of litEls) e2.setAttribute('opacity', e2.dataset.o0);
    litEls = [];
    const bedOp = ['0.34', '0.27', '0.22'], flowOp = ['0.55', '0.42', '0.32'];
    for (const [k, hop] of lv) {
      for (const e2 of svg.querySelectorAll(`path[data-dyn="${k}"]`)) {
        e2.dataset.o0 = e2.getAttribute('opacity');
        e2.setAttribute('opacity', e2.classList.contains('river-flow') ? flowOp[hop] : bedOp[hop]);
        litEls.push(e2);
      }
    }
    card.innerHTML = '';
    card.appendChild(h('div', { class: 'rc-title' }, [
      h('span', { class: 'rc-dot' }), h('span', { text: `${item.band.d.name}·${item.e.temple}` }),
    ]));
    card.querySelector('.rc-dot').style.background = item.col;
    const rows = item.tip().filter((r) => typeof r !== 'string');
    card.appendChild(h('div', { class: 'rc-rows' }, rows.map((r) =>
      h('span', { class: 'rc-row' }, [
        h('b', { text: r.value }), h('span', { class: 'muted', text: r.label }),
      ]))));
    const noteTxt = item.tip().find((r) => typeof r === 'string');
    if (noteTxt) card.appendChild(h('p', { class: 'rc-note muted small', text: noteTxt }));
    // 窄屏此前根本弹不出知识卡(整个面板被 1100px 挡在门外)。这张卡给的是
    // 本库的数据,词条摘要在手机单卡里,故留一个按钮换过去——两张不并存
    if (kClean.soloMode && kClean.soloMode()) {
      card.appendChild(h('button', { class: 'rc-more', type: 'button', text: '读词条 ↗',
        onclick: () => { clearSel(); kClean.showEmperor(item); } }));
    }
    card.appendChild(h('button', { class: 'rc-close', type: 'button', text: '✕', onclick: clearSel }));
    card.classList.add('on');
    document.body.classList.add('river-card-on');
  };
  for (const n of empNodes) {
    n.node.addEventListener('click', (ev) => {
      ev.stopPropagation();
      stampHash('e', n.e.name || n.e.temple);
      if (coarse.matches && !twiceOn(n.e.id)) return;
      select(n);
    });
  }
  svg.addEventListener('click', () => { if (selected) clearSel(); });

  // ── 手势提示 ────────────────────────────────────────────────────────────
  // 触屏上「单击出名字、双击开词条」是约定，不是常识——图上没有任何东西
  // 在说这件事，读者点一下只看见一条转瞬即逝的提示，多半就以为到此为止了。
  // 提示占的正是卡片那块地方：**卡在就不提示，卡不在才提示**，于是它既是
  // 说明也是那块地方的占位，读者一开卡就明白提示说的是什么。
  // 只在触屏出现：鼠标那边本来就是单击开卡，说「双击」反而是错的。
  const hint = coarse.matches
    ? h('div', { class: 'river-hint', text: '点一下看名字 · 双击读词条' }) : null;
  if (hint) document.body.appendChild(hint);

  // ── 滚动时的标签吸附 ────────────────────────────────────────────────────
  // 页面自身在滚，故监听 window 而非容器；仅当区间跨过视口上缘时才吸附，
  // 否则同屏的两个朝代会双双挤到顶上互相压字。
  let raf = null;
  const sync = () => {
    raf = null;
    const box = wrap.getBoundingClientRect();
    const top = -box.top + (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0) + 44;
    const bottom = top + window.innerHeight;
    // 纪年滑杆：**河面盖住滑杆自己那一段**才出现，滑块标出视口中部对应的年份。
    // 原先只判「越过视口中线」，可滑杆是定高居中的（46vh，即中线上下各 23vh）：
    // 河一到结尾，杆的下半截就悬在图外，压住底下的说明文字（用户实测）。
    // 改判杆的上下缘：河面退出杆所在的那一段，杆即收起——出没与它自己的身量一致
    const half = Math.min(innerHeight * 0.46, 340) / 2 + 6;   // +6 给读数药丸留余量
    const inView = box.top < innerHeight * 0.5 - half && box.bottom > innerHeight * 0.5 + half;
    scrub.classList.toggle('on', inView);
    // 有没有卡在场交给 CSS 判（body 上的 kp-solo-on / river-card-on）：
    // 卡是点开的、不是滚出来的，用类名比在滚动回调里轮询干净
    if (hint) hint.classList.toggle('on', inView);
    if (inView) {
      const tMid = Math.min(t1, Math.max(t0, y.invert(-box.top + innerHeight * 0.45)));
      const pct = `${(((tMid - t0) / (t1 - t0)) * 100).toFixed(2)}%`;
      thumb.style.top = pct;
      read.style.top = pct;
      flashRead();
      // 浮标带时代名:界标画在杆上却匿名,补名是把既有元素的语义读完。
      // ERAS 有重叠期(960–979 两带并置),首匹配即钦定的主叙事(见 dynasties.js)
      const era = ERAS.find((e2) => tMid >= e2.s && tMid < e2.e);
      read.textContent = era ? `${fmtYearAxis(tMid)} · ${era.name}` : fmtYearAxis(tMid);
    }
    for (const n of labelNodes) {
      const vis = n.y1 > top - 40 && n.y0 < bottom;
      n.dot.setAttribute('opacity', vis ? 1 : 0);
      n.label.setAttribute('opacity', vis ? 1 : 0);
      if (!vis) continue;
      const stick = (n.y0 <= top && top < n.y1) ? Math.min(top + 12, Math.max(n.y0 + 10, n.y1 - 6)) : n.y0 + 10;
      n.label.setAttribute('y', stick);
      n.dot.setAttribute('cy', stick - 4);
      // 横向也要跟随：河道随世事左右迁移，圆点若钉在建国时的 x，
      // 吸附滚动后就会浮在别家的河床上（北魏分裂处的西魏圆点即此症）
      const tAt = y.invert(stick);
      const boxNow = edge(n.key, Math.min(Math.max(tAt, t0), t1));
      if (boxNow) {
        const cxNow = (boxNow[0] + boxNow[1]) / 2;
        n.label.setAttribute('x', Math.max(GUTTER + 2, Math.min(W - n.lw - 2, cxNow - n.lw / 2)));
        n.dot.setAttribute('cx', boxNow[0] + 5);
      }
    }
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(sync); };
  addEventListener('scroll', onScroll, { passive: true });
  requestAnimationFrame(sync);

  // 视图挂在 window 与 body 上的东西（滚动监听、固定卡片）在重绘或切走时必须撤：
  // scroll 监听不撤会随每次筛选累积一个引用死 DOM 的监听器，
  // 卡片不撤会留在泳道视图上。app.js 的 panorama render 包装器每次渲染前调用此钩子。
  host.__riverCleanup = () => {
    card.remove(); scrub.remove(); if (hint) hint.remove();
    if (readT) clearTimeout(readT);
    document.body.classList.remove('river-card-on');
    removeEventListener('scroll', onScroll);
    kClean();
  };

  // 定位接口:与横向泳道同名同义,由搜索与深链调用(见 js/search.js)
  // `o.smooth` 走缓动并把 Promise 挂在 __locate.pending 上——导览要等到位了再打光,
  // 而搜索跳转只想立刻到,两者共用这一个入口
  const goY = (t, o = {}) => {
    // 跳转即松钉,同泳道那一侧(见 views-lanes.js 的 goX)。河流有四张卡,
    // 留下陈货的机会更多
    if (kClean && kClean.releasePins) kClean.releasePins();
    const yPix = y(Math.min(Math.max(t, t0), t1));
    const dest = () => wrap.getBoundingClientRect().top + scrollY + yPix - innerHeight * 0.42;
    const p = (o.smooth
      ? glide(() => scrollY, (v) => scrollTo({ top: v, behavior: 'instant' }), dest())
      : (scrollTo({ top: dest(), behavior: 'instant' }), Promise.resolve()))
      // 到站再校一次：手机上跳转常发生在软键盘收起的同时（搜索/骰子都在
      // 输入框旁），起跳时按缩半的视口算的落点，键盘一收就漂到黑条底下
      // ——「随机跳到的锚点顶在盒子最上沿」（用户实测）即此
      .then(() => {
        const d = dest();
        if (Math.abs(d - scrollY) > 40) scrollTo({ top: d, behavior: 'instant' });
      });
    host.__locate.pending = p;
    return p;
  };
  host.__locate = {
    view: 'river',
    pending: Promise.resolve(),
    year: goY,
    /** 某段年份在视口中的矩形——导览的「熄灯打光」按它挖洞,随滚动逐帧重算 */
    rect(a, b) {
      const wr = wrap.getBoundingClientRect();
      const ya = wr.top + y(Math.min(Math.max(a, t0), t1));
      const yb = wr.top + y(Math.min(Math.max(b, t0), t1));
      return { x: wr.left, y: ya, w: wr.width, h: Math.max(yb - ya, 10) };
    },
    emperor(id, o) {
      const n = empNodes.find((q) => q.e.id === id);
      if (!n) return false;
      goY(y.invert((n.y0 + n.y1) / 2), o);
      // 卡片立刻开:摘要要向维基取,趁着滚动这一路把请求发出去,到站时正好读得上。
      // 窄屏走词条单卡,与跳到事件一致——此前开的是底部数据卡,同一个骰子
      // 掷出君主与大事两种卡(用户实测)。图上双击选中仍走数据卡(查数入口,
      // 卡上有「读词条」可换),这里只管骰子/搜索/深链这类「读一读」的跳转
      if (kClean.soloMode && kClean.soloMode() && kClean.showEmperor) {
        clearSel();
        kClean.showEmperor(n);
      } else {
        select(n);
      }
      return n.node;
    },
    dynasty(key, o) {
      const b = bands.find((q) => q.d.key === key);
      if (!b) return false;
      goY((b.s + b.e) / 2, o);
      return true;
    },
    // 搜索与深链(#ev=安史之乱)落到事件:跳到那一年并开卡。两个视图同名同义,
    // 调用方只说「去哪儿」——此前河流一侧只能退回按年份跳
    event(i, o) {
      const ev = EVENTS[i];
      if (!ev) return false;
      goY(ev.y2 ? (ev.y + ev.y2) / 2 : ev.y, o);
      openEvent(ev);
      return true;
    },
  };

  // 落点：重绘回到读者离开的那一年；首绘落在秦始皇（理由同 views-lanes——
  // 开卷即四千年，帝制的门口才是锚）。河流的位置即页面位置，故这里会动页滚；
  // 深链随后由 search.js 覆盖
  {
    const wrapTop = () => wrap.getBoundingClientRect().top + scrollY;
    goY(host.__anchorYear ?? -220);
    host.__yearOfScroll = () => y.invert(scrollY + innerHeight * 0.42 - wrapTop());
  }

  // ── 图例与说明 ──────────────────────────────────────────────────────────
  const peak = slices.reduce((m, s) => Math.max(m, s.n), 0);
  const peakSlice = slices.find((s) => s.n === peak);
  host.appendChild(h('p', { class: 'muted small', style: 'margin:10px 0 0', text:
    `河宽切成 ${C} 条固定车道，按当时并存的政权数整数分配：一股独占全部车道＝天下一统，`
    + `两股分 ${Math.ceil(C / 2)}/${Math.floor(C / 2)}，依次类推。最挤处为 ${fmtYearAxis(peakSlice.a)} 年的 ${peak} 股。`
    + (markViolent ? ' 河道右缘的红色刻痕＝该帝非正常死亡。' : '')
    + ' 各河道的淡色底＝河床：称帝前的预告、亡后的尾迹、在位空档，皆由它透出——'
    + '浓淡有向：预告楔自无洇入，越早越淡；真正断绝的世系洇出至无。'
    + ' 点按任一段可锁定该君主，并顺法统链上下各点亮两跳（触屏为双击，'
    + '免得滚动时误触；单击仅浮出简要提示）。'
    + ' 左缘纪年滑杆轨上的色段＝天下一统的时段。'
    + ' 宽屏两翼另有知识卡——左翼是当前时段的主导朝代、右翼是视口内的名君，'
    + '随滚动自动更替；点选任一君主则两卡联动钉住（右卡其人、左卡其朝）。'
    + '摘要实时取自中文维基百科，并附全文、百度百科与相关视频的直达链接。' }));
  // 事件层的读法与筛选:窄屏事件在河道里,宽屏在两岸
  if (showEvents) {
    host.appendChild(h('p', { class: 'muted small', style: 'margin:8px 0 0', text: EV_STRIP > 0
      ? '两岸的事件轨：左岸政事（战事、民变、灾疫、外交、立制），右岸文教（著述、科技、遗存）。'
        + '点一条即在卡片里读它的词条。'
      : '事件画在河道里——事件本就发生在这条河上。落在河道之间的缝上的，'
        + '是改朝换代（本就发生在两条河之间）与并存年代里归属尚未判定的，两者都不占任何一条河。'
        + '点一下显示名字，再点一下读词条。标记按类别取**形状**与颜色（见下方色标）：'
        + '尖头与十字、方块、菱形、圆点＝那一年发生的事；扁条、屋形、六边＝起讫历时数百年者（图上只标起点）。' }));
    // 治世·中兴不列:它在泳道里是皇帝格子外的虚线外套,河流没有那一层
    for (const n of eventLegend(opts, { skip: ['era'] })) host.appendChild(n);
  }
  // 按朝代配色时不放图例：65 个色块的对照表没人查得动，何况每条河道
  // 都直接标着朝代名，颜色只是辅助通道。仅两色语义模式保留两行图例
  if (!byDynasty) {
    host.appendChild(legend([
      { color: 'var(--c-unified)', label: '大一统王朝' },
      { color: 'var(--c-split)', label: '分裂时期政权' },
    ]));
  }

  host.appendChild(notes([
    `河宽**不编码疆域或人口**——本库没有这两项数据，若让分叉的宽窄去表示「谁更大」，`
    + `那是在画我们并不掌握的东西。故河宽恒定、按政权数均分，唯一的视觉变量「分叉数」`
    + `正好等于那一刻并存的政权数。代价是三年的割据小国与盛唐同宽，真实规模见点按详情与数据表。`,
    `**左右次序按谱系归堆**：正统序列与北方主线各按法统连线，其余政权沿`
    + `「排序改判 → 法统相承 → 裂土分出」上溯到谱系家长归堆——赵家`
    + `（汉赵→后赵→冉魏→前秦→后秦→胡夏）、燕家、凉家各自连成相邻块，`
    + `家族内按起年排。个别政权疆土与血统不一致（西燕裂自前秦而血统属燕），`
    + `由 dynasties.js 的 ORDER_HINT 手工改判。`
    + `称帝前掌权期不占槽位：孙权 200 年已掌江东，但吴的河道自其首位皇帝在位起才张开。`,
    `河道之间**永不交叉**：新政权楔入其**谱系母体**的侧翼（西夏锚宋、桓楚锚晋、`
    + `十国锚五代中原线；母体已亡则顺「水的去向」——征服者承其水、继位者承其位——`
    + `走链找到在场者；辽、大理这类无从锚起的按全局总序落座），此后没有任何机制会让`
    + `两条并存的河道互换左右——继位原地改名、挤入只侧移不越位——`
    + `共存者的次序一经落位终生不变，故不可能相交。`
    + `政权消失时右邻左移即为「合流」，新政权插入时右邻右让即为「分叉」。`,
    `**老河守岸**：楔入母体侧翼时按**代价**择侧（贴着空道 ＜ 挤一条邻居 ＜ 链式挪位`
    + `牵动数条），且**骨肉与客有别**——直接裂自／承自母体者是骨肉，两翼皆可`
    + `（东西魏分北魏，本是同一片水）；借道走链找到锚的只是客，客不占岸侧。`
    + `于是老河沉在岸边、过客从内侧穿行：燕家水系 384–436 连续持有右岸`
    + `（西燕先坐、亡入后燕、北燕承之），五代中原正统线 907–960 钉死左岸，`
    + `吴闽南汉在内侧排队。前后短暂并存的交替（李存勖 923-4 称帝、923-11 灭梁）`
    + `原地转让走不了，改按征服承接——水归胜者，岸随水传。`,
    `**在场的河优先保住自己的车道（惯性）**：继位是改名不是搬家——北燕原地接管`
    + `后燕的河道、北周接西魏、陈接梁，不按全局次序另寻插入口（否则北燕按「燕家排行」`
    + `落到南燕右侧，后燕的河道得弯过南燕头顶去接）。新政权入场也不触发整片重排：`
    + `先吃身旁空位，两邻让无可让时向最近的松动处**链式挪位**——途中河道只侧移一条`
    + `车道、宽度次序不变（此前 555 年西梁一入场，梁骤失两车道、西魏北齐全体平移）。`,
    `**河宽切成 ${C} 条固定车道，宽度只在四种时刻变化**：新政权挤入（不得不让）、`
    + `征服承接（灭国的水立刻归征服者——前秦并前燕当场涨，那是史实）、`
    + `空置满 16 年后的缓回收、以及天下一统。其余时候一律保持现状：政权死后其车道`
    + `先空置成**留白**，邻居不立刻胀开——快变期宁可留白，不要急弯。`
    + `车道边界是全图固定的网格，未被转让的边界纹丝不动，这是河流「更直」的来源。`
    + `位移大的改道（统一、大分裂）会把过渡窗自动拉长至多三倍，不出现近乎直角的急弯；`
    + `河道另有确定性蜿蜒，且**按河相关系随河宽换步**：真实河流的蜿蜒波长约为河宽的`
    + ` 10–14 倍（Leopold & Wolman），大河从不高频抖动——窄流用 320px 波长的小摆，`
    + `河道占幅超过 55% 后渐入 2200px 波长的从容长摆，满宽大一统在两岸之间贴岸游动；`
    + `蜿蜒相位取**法统源头**的散列——继位是改名不是搬家，车道、河口之外，律动也不换笔。`
    + `理想的调节量是真实疆域面积（河宽即国力、自带总量上限），但本库没有逐年疆域数据，`
    + `且元、清这类跨界政权难以归一——整数车道是「不画我们不掌握的东西」前提下的诚实近似。`,
    `**亡国是汇流，不是蒸发**：政权终结时其疆土并入谁家、建立时从谁家裂出，`
    + `都是已知的史实（见 dynasties.js 的 MERGED_INTO / SPRANG_FROM 及逐条依据）。`
    + `河道收束时弯向吞并者的河岸并没入其下（陈并于隋、北齐亡于北周、南宋亡于元…），`
    + `新河道的细流自母体的河岸涌出（清起于叛明的后金、金起于叛辽的完颜部…）。`
    + `吞并者与亡者之间隔着第三条河道时不弯——河道永不交叉是硬约束，此时改画一条`
    + `半透明的**穿流带**：压在途经河道的君主色块之下、只在底色间隐约可见，`
    + `点选该政权即点亮（sankey 图的半透明 ribbon 同理）。`
    + `禅让式的法统相承另有画法（变色微腰），两者都成立时微腰优先。`,
    `**连续性三级**：同切点的禅让画成 75% 宽河口（同一条河换了名字）；隔着空窗的`
    + `承统（秦亡至汉兴隔楚汉之争、平帝崩至王莽代汉隔居摄）画成 10px 细颈贯穿空窗——`
    + `法统如一线悬丝穿过乱世，空窗仍由四周的留白与细颈之窄读出；`
    + `**断流只留给无承继关系的真正终结**。`,
    `**改道摊开成长弯，交替处不断流**：每次政权更替的河宽重分摊在一段约 ±${TRANS_PX}px 的`
    + `过渡区里（不超过邻段一半，以免过渡区互相穿透），用 smoothstep 缓动。新河道自一线细流张开、`
    + `亡者收束成细流而**不掐断成零宽的尖**（d3-sankey 的 linkMinWidth 同理）；`
    + `法统相承者（汉→新、唐→后梁…）在交替处共用一段变色的窄颈，河面不断流。`
    + `河面在政权建立前数年即开始让位——**细流是排版的预告，不是史实的提前**：`
    + `淡色河床可早于建国数年张开，但君主色块的起讫始终是真实日期。`
    + `所有河道在同一过渡窗内做同一插值，任一瞬间的布局仍是不重叠的分割，这是长弯不打架的保证。`,
    `**不套滚动容器**：竖向内容再嵌一层竖向滚动是经典的滚动陷阱，手指落在容器上页面就像卡住了。`
    + `本图直接交给页面滚动，全页只有一个滚动器。代价是这一节很长（${Math.round(H)}px），`
    + `故顶／底两条固定条既是上下节跳转，也是保证能起滑的安全区。`,
    `**河床的浓淡有向，与连续性三级同构**：无前身的政权，预告楔自无洇入——浓淡编码`
    + `「离真实建号还有多远」，排版预告不再与在位空档同浓；承统交替处，前朝的河床尾`
    + `与新朝的河床头在共用的过渡窗里互补洇变（前尾渐隐、新头渐显、两色互渗），`
    + `细颈全程合成恒定的一层，秦→汉的悬丝不因洇散而断；亡入者的尾迹保留六成浓度`
    + `没入对岸（汇流不是蒸发）；**洇出至无只留给无承继关系的真正终结**。`
    + `君主色块分毫不动——洇与渗都只发生在河床层。`,
    `君主之间的空缺由淡色河床透出，那正是「该段年份没有在位君主的记录」——`
    + `成因与逐条核对见「空档审计」一节。`,
  ], { label: '这张图为什么这样画' }));

  host.appendChild(tableView(
    ['次序', '朝代', '起讫', '历时(年)', '皇帝数', 'DSI', '大一统'],
    ordered.map((b, i) => {
      const st = DYN_STATS.get(b.d.key);
      return [i + 1, b.d.name, `${fmtYearAxis(b.d.s)}–${fmtYearAxis(b.d.e)}`, st.span, b.n,
        st.dsi === null ? null : st.dsi.toFixed(1), b.d.u ? '是' : '否'];
    }),
    { caption: '河道次序（左→右）与朝代一览' },
  ));
}
