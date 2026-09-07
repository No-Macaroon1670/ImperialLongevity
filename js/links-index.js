// links-index.js — 边表的**读侧**索引：把 links.js／links-gen.js 那两串平行的行
// 装成「给我一个节点，还我它的必然联系」。
//
// 为什么单独一个模块、而且**懒加载**：
//   两张边表合起来 57 万字节（手核 30 万＋生成 27 万），再加上解析显示名要用的
//   人物表、君主表、政权表。这些东西只有在**读者点开一张卡**的时候才用得着，
//   而首屏（河流／泳道／舆图）画完之前一条边都不需要。故 knowledge.js 静态
//   import 本模块（它自己只有几 KB），本模块在第一次 relOf() 时才 import()
//   那几张表——不进首屏关键路径，是这个模块存在的全部理由。
//   索引只建一次（单例 Promise），四千余条边建 Map 是毫秒级的事。
//
// 契约见 links.js 头注：一个事实存一行，逆读由 VERBS 配。本模块**不新造边**，
// 只是把同一行按两头各挂一次，并按「从哪头看」翻译成读者看得懂的角色名。
//
// 导出面只有三个：relOf（取边）、citeMeta（引文行尾小字）、nodeLabel（解析显示名）。
// nodeLabel 目前**库内无调用点**——卡上的名字是 nodeItem 内联算的；它留在导出面上，
// 是给后续要读边表的消费端（走路径、地方线信号）用的。这句话写在这里，是免得
// 下一个人以为它正在被谁用（复核员 2026-09-07 指出：无声的死 API 比缺 API 更费事）。

import { fmtSpan } from './year.js';

// ── 标签规则（库主 2026-09-04 定案，与 docs/desk/mock-links-card.html 同步）──
//
// **组标签描述的永远是对面那一头**（胶囊里的东西），不是卡的主人。照这一条推：
//   · 人事／创制／作品族：role 指的是源。X 是靶（incoming）时，胶囊里是源，用 role
//     （「发动者 · 李世民」）；X 是源（outgoing）时，胶囊里是靶，用动词本身
//     （「发动 · 玄武门之变」，比 inv 的「由其发动」顺口）。
//   · 血亲／承继：incoming 用 role（父），outgoing 用 inv（子）。sym（兄弟）两向同词。
//   · 时段族：role 指靶（「所涵君主」）。outgoing（治世→君主）用 role，
//     incoming（君主卡上）用 inv：「在位于 · 贞观之治」。
//   · **地族两向都用 role**（2026-09-07 改）。原先照时段族给 incoming 派了 inv，
//     结果是一批单字标签：「起 125 孙程迎立顺帝」「一说 79 白虎观会议」——那 inv
//     是给「地 inv 事」这句话用的动词，不是描述事件的名词。地族的靶本该是 loc:，
//     loc: 没有卡、也就永远走不到 incoming 这一支；真正走到的是那 21 个**被当成
//     地点用的遗址类 ev:**（汉魏洛阳故城、龙门石窟…，52 条边）。在它们的卡上
//     role 恰好读得通：「战地 · 永嘉之乱」＝此地是那一战的战地。
const ROLE_BOTH = new Set(['地']);           // 两向都用 role
const ROLE_IS_TARGET = new Set(['时段']);    // outgoing 用 role、incoming 用 inv
// 分节内的组序：族在前、方向在中、动词在表内的登记次序在后。
// 「动词表的登记次序即角色轻重次序」——VERBS 里 发动／主谋／统帅／参战／对阵…／遇害／当事
// 本就是按分量排的，卡上照抄即可，不必再立一张优先级表。
const FAM_RANK = { 血亲: 0, 承继: 1, 人事: 2, 创制: 3, 事事: 4, 作品: 5, 时段: 6, 地: 7 };

// 层级（lv）小字：1 库内长文或一手逐字／2 维基条目／3 推断（links.js 的 l() 注）
const LV_LABEL = { 1: '库内', 2: '维基', 3: '推断' };

// 引文里的**内部字段名**改说人话（2026-09-07，与 note 整体不出同一处收口）。
// 写边的员按字段名记出处：「库内 yc：「…」」＝取自条目的短简介，「库内 p 字段」＝
// 取自条目的落点字段。字段名是本库的内部约定，出门就该换成读者的词；换掉的只是
// **这一个标签**，引文本身（「」里的那句）一字不动——引文取证不许改写，是本库军规。
const CITE_WORDS = [
  [/库内 yc/g, '库内简注'], [/库内 yl/g, '库内长文'],
  [/库内 p 字段/g, '库内落点字段'],
  [/库内 dynasties\.js /g, '库内政权表 '], [/ bio：/g, ' 简介：'],
];
const pubCite = (s) => CITE_WORDS.reduce((t, [re, to]) => t.replace(re, to), s || '');

/** 节点 id → 类型与裸名。id 体例见 links.js 头注。模块内私用（不出导出面） */
function splitId(id) {
  const i = id.indexOf(':');
  return i < 0 ? { kind: '', rest: id } : { kind: id.slice(0, i), rest: id.slice(i + 1) };
}

let idxP = null;   // 单例：第一次 relOf 时点火，此后所有卡共用

async function build() {
  const [lk, gen, evm, dym, psm, dtm] = await Promise.all([
    import('./links.js'), import('./links-gen.js'), import('./events.js'),
    import('./dynasties.js'), import('./persons.js'), import('./data.js'),
  ]);
  const VERBS = lk.VERBS;
  // 动词在表内的登记次序（组序用）
  const vIdx = new Map(Object.keys(VERBS).map((k, i) => [k, i]));

  // 邻接表：一行挂两头（src 侧记 out、dst 侧记 in），行本身不复制
  const adj = new Map();
  const push = (id, side, row, wd) => {
    let a = adj.get(id);
    if (!a) { a = []; adj.set(id, a); }
    a.push({ row, out: side, wd });
  };
  const feed = (rows, gened) => {
    for (const r of rows) {
      // ⓦ：机读自 Wikidata 的那批（血亲第一批），引文以「Wikidata」起头。
      // 生成物里的另外三类（p 字段展开、君主表前后任、era 涵盖）是库内推出的，不打这个标。
      const wd = gened && /^Wikidata/.test(r.cite || '');
      push(r.src, true, r, wd);
      push(r.dst, false, r, wd);
    }
  };
  feed(lk.LINKS, false);
  feed(gen.LINKS_GEN, true);

  // 显示名与「点开哪张卡」所需的载荷
  const evByName = new Map();
  for (const e of evm.EVENTS) if (!evByName.has(e.n)) evByName.set(e.n, e);
  const perById = new Map(psm.PERSONS.map((p) => [p.id, p]));
  const empByKey = new Map();
  for (const e of dtm.EMPERORS) {
    const k = `${e.name}@${e.dynKey}`;
    if (!empByKey.has(k)) empByKey.set(k, e);
  }
  return { VERBS, vIdx, adj, evByName, perById, empByKey, dynMap: dym.DYN_MAP };
}

const ready = () => (idxP || (idxP = build()));

let IDX = null;    // build 完成后镜像一份，供同步的 nodeLabel 使用

/**
 * 节点 id → 显示名。**同步**函数：索引装好之前只能按 id 拆字（够用——
 * 卡上的胶囊一律是 relOf() 之后才画的，那时索引必然已在）。
 */
export function nodeLabel(id) {
  const { kind, rest } = splitId(id);
  if (kind === 'r') {
    const e = IDX && IDX.empByKey.get(rest);
    return e ? e.name : rest.split('@')[0];      // 找不到就用 @ 前的本名
  }
  if (kind === 'p') { const p = IDX && IDX.perById.get(rest); return p ? p.name : rest; }
  if (kind === 'd') { const d = IDX && IDX.dynMap.get(rest); return d ? d.name : rest; }
  return rest;                                    // ev: 的 n、loc: 的地名本身就是显示名
}

/** 一头的载荷：卡片按 kind 决定造哪种 spec；loc 无卡，ok 为假即画成不可点的灰胶囊 */
function nodeItem(id) {
  const { kind, rest } = splitId(id);
  const it = { id, kind, name: nodeLabel(id), yr: '', dyn: '', ok: false, ref: null, sortY: Infinity };
  if (kind === 'ev') {
    const ev = IDX.evByName.get(rest);
    if (ev) {
      it.ref = ev; it.ok = true; it.sortY = ev.y;
      it.yr = fmtSpan(ev.y, ev.y2);
      const d = ev.d && IDX.dynMap.get(ev.d);
      it.dyn = d ? d.name : '';
    }
  } else if (kind === 'r') {
    const e = IDX.empByKey.get(rest);
    const d = IDX.dynMap.get(rest.split('@')[1] || '');
    if (e && d) { it.ref = { e, band: { d } }; it.ok = true; }
  } else if (kind === 'p') {
    it.ref = IDX.perById.get(rest) || { id: rest, name: rest };
    it.ok = true;
  } else if (kind === 'd') {
    const d = IDX.dynMap.get(rest);
    if (d) { it.ref = d; it.ok = true; }
  }
  return it;
}

/** 从 X 这头看这条边，对面那一头该挂什么标签 */
function labelOf(VERBS, verb, out) {
  const V = VERBS[verb] || {};
  if (V.sym) return V.role || verb;
  if (ROLE_BOTH.has(V.fam)) return V.role || verb;
  if (ROLE_IS_TARGET.has(V.fam)) return out ? (V.role || verb) : (V.inv || verb);
  if (!out) return V.role || verb;
  return (V.fam === '血亲' || V.fam === '承继') ? (V.inv || verb) : verb;
}

/**
 * 这条边落在卡的哪一节。分节名由消费端按卡型给（事件卡与人物卡叫法不同）。
 * 地族分两节，判准是**方向**：X 是源（一件事）时，对面是地点，归「地」；
 * X 是靶时，X 自己正被当成地点用（遗址／地标那 21 条 ev:），对面是发生在这儿的事——
 * 那一节顶「地」的名就读不通了（「地 · 永嘉之乱」），另立 here 节叫「此地发生」。
 */
function secOf(fam, otherKind, out) {
  if (fam === '血亲' || fam === '承继') return 'kin';
  if (fam === '地') return out ? 'loc' : 'here';
  if (fam === '作品' || fam === '时段') return 'work';
  return otherKind === 'ev' ? 'evs' : 'act';     // 人对事：在人的卡上是「事」，在事的卡上是「人」
}

// 分节次序与标题。事件卡先人后事再地再作品（库主定案），「此地发生」跟在事对事之后
// ——它装的也是事，只是从这块地皮那一侧看过去的。
// 人／君主／政权卡照样稿：血亲与承继 → 事（按年）→ 作品与时段；here 在那三种卡上
// 结构上出不来（人不会是地族的靶），列在末尾只是免得哪天真出了一条就被静静吞掉。
const SEC_EV = [['act', '人'], ['evs', '事对事'], ['here', '此地发生'], ['loc', '地'], ['work', '作品'], ['kin', '血亲']];
const SEC_NODE = [['kin', '血亲与承继'], ['evs', '事（按年）'], ['act', '人'], ['work', '作品与时段'], ['loc', '地'], ['here', '此地发生']];

/**
 * 取一个节点的必然联系，已按节／组／条排好。
 * @returns null（无边，整栏不出）或 { count, wd, secs: [{ key, title, groups: [...] }] }
 *          group = { label, items: [item], cites: [{ name, cite, lv, note, q }] }
 */
export async function relOf(nodeId) {
  IDX = await ready();
  const rows = IDX.adj.get(nodeId);
  if (!rows || !rows.length) return null;
  const { VERBS, vIdx } = IDX;

  const groups = new Map();      // sec|label → 组
  let anyWd = false;
  let shown = 0;
  const selfRest = splitId(nodeId).rest;
  for (const { row, out, wd } of rows) {
    const V = VERBS[row.verb] || {};
    const otherId = out ? row.dst : row.src;
    // 自指边不上卡（63 条，全是「ev:周口店遗址 址在 loc:周口店遗址」这一式：
    // 遗址条既是事、又被别的事当地点用，故库内两个前缀各存一枚）。在自己的卡上
    // 摆一枚写着自己名字的灰胶囊，对读者是零信息（复核员 2026-09-07 实测 13 张卡中招）
    if (splitId(otherId).rest === selfRest) continue;
    const item = nodeItem(otherId);
    const label = labelOf(VERBS, row.verb, out);
    const sec = secOf(V.fam || '', item.kind, out);
    shown++;
    const key = `${sec}|${label}`;
    let g = groups.get(key);
    if (!g) {
      g = { sec, label, items: [], cites: [], seen: new Map(),
        // 组序：族 → 方向（靶在前、源在后，父母兄先于子孙）→ 动词登记次序
        rank: [FAM_RANK[V.fam] ?? 9, out ? 1 : 0, vIdx.get(row.verb) ?? 99] };
      groups.set(key, g);
    }
    // 同一组里同一个人可能被两行同标签的边点到（如两句引文各证一次）：胶囊只出一枚，引文各列一行
    if (!g.seen.has(otherId)) { g.seen.set(otherId, item); g.items.push(item); }
    if (wd) { g.seen.get(otherId).wd = true; anyWd = true; }
    // note 不带出来（见 citeMeta 的注：那是员的工序日志）
    g.cites.push({ name: item.name, cite: pubCite(row.cite), lv: row.lv || 1, q: row.q || '' });
  }

  const order = splitId(nodeId).kind === 'ev' ? SEC_EV : SEC_NODE;
  const secs = [];
  for (const [key, title] of order) {
    const gs = [...groups.values()].filter((g) => g.sec === key);
    if (!gs.length) continue;
    gs.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2]);
    for (const g of gs) {
      // 组内：事按年（一条人物线读下来就是编年），人与地按边序（表里的次序即写手的次序）
      if (g.items.every((x) => x.kind === 'ev')) g.items.sort((a, b) => a.sortY - b.sortY);
      delete g.seen;
    }
    secs.push({ key, title, groups: gs });
  }
  if (!shown) return null;                       // 只剩自指边，等于没有边
  // count 报的是**卡上真画出来的边**：自指边已经滤掉，头行写「边 9」而卡上数得出 10 条，
  // 读者会以为哪里少了一枚
  return { count: shown, wd: anyWd, secs };
}

/**
 * 引文行尾的小字：**只有层级与存疑**。
 *
 * note 不出（2026-09-07 复核员指出并实测）：那个字段是**员的工序日志**，不是给读者的话。
 * 全库 2403 条 note 里满是内部字段名与内部 id——「君主表无吕雉，照简报走 p:」
 * 「yc 未提，金方只能走政权」「据库内君主表 ehan 汉殇帝刘隆系之」；就算滤掉带
 * 行话的那 224 条，剩下的也是「故不用遇害」「待库主裁」这类改笔判词。
 * 彻底的解法是把它拆成 note（内部）与 pub（可见）两个字段，但那要动 links.js 的
 * 写侧与全部四千行数据，故先在**读侧**收口：宁可少说一句，不可把工序日志端上桌。
 * q（存疑）留着——它写的是「两说并存、世系打架」，正是读者该知道的那一句。
 */
export const citeMeta = (c) => {
  const lv = LV_LABEL[c.lv] || '';
  // 引文自己已经以「库内…」开口时不再补一遍层级，否则行尾是「…库内 p 字段 · 库内」
  const bits = [lv && (c.cite || '').startsWith(lv) ? '' : lv];
  if (c.q) bits.push(`存疑：${c.q}`);
  return bits.filter(Boolean).join(' · ');
};
