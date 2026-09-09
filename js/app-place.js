// app-place.js — 地方线页（place.html）的入口。设计案见 docs/idea-placelines.md。
//
// **一条竖轴、一座城的大事记；轴按政权换手分段，卡按分量分档挂在两侧。**
// 全页运行时自 events.js 现抽，不走生成：events.js 一改，地方线跟着变
// （库主 2026-09-02 定的第一条盘规则）。这里只画机器骨架——
//   归地、分段、分档、角标、点卡开知识卡；
// 人写的那一半（换手表 TURNS、总结卡 CARDS、精选 PICKS、覆盖 OVERRIDES）
// 全在 js/place-text-<key>.js，由写手维护，**缺席时页面照常渲染**：
// 动态 import 失败即当空表，退回按 ERAS 时代分段。两半文件分开、互不迁就。
//
// 画法上的几个决定，各对着一个具体的两难：
//
//   **轴不按年等距**。北京最早一条是周口店（前 70 万年），最晚是人间词话（1908），
//   按年等距的话前 99.7% 的轴是一条空线，全部一百条挤在末端一毫米里。
//   故轴按**段**排：段界是换手（人写的换手表）或时代（ERAS 兜底），
//   段内按年先后铺卡，段与段之间不成比例——这张图问的是「换了几次旗、
//   每旗之下留下什么」，不是「过了多少年」。
//
//   **空段照画**。北京在前 1022 到 696 之间一条都没有（燕都之后、幽州之前）。
//   把空段抽掉会让轴看上去连绵不绝，而那段空白正是这座城在史料里的形状——
//   与本库「图上的留白说的是记录的形状，不是历史的形状」同一条。空段只占一行。
//   但**连着好几段机器续色的空段并成一条细带**（2026-09-08 库主拍板③）：北京
//   前220–313 连着八段、535–619 连着五段，段段没条目、段段只写「天下易主，本地
//   未另记换手」，铺开是八行同样的话。并成一带之后，那几百年在轴上仍占一格（空白
//   还是空白），政权名并列成丸子（换了几次旗还看得见），只是不再一段一行地重复。
//   人写过的段（有段题、有按语）一律不并——那是内容，不是机器的复读。
//
//   **出处默认收起**（2026-09-08 库主拍板④）。换手表 30 条与总结卡 8 张的出处
//   共 2700 余字，全显时把每个段头撑成三行。默认收、页首一颗「出处」钮全开全关，
//   段头留一个极小的「¶」示意这一段有出处可单独展开——收起不是删，是先让轴看得见。
//
//   **一行一卡，不并排**。宽屏上一等卡左右交错，理论上可以两卡并成一行省地方，
//   但那样一来两张卡的先后就要读者自己猜。时间轴上顺序比密度重要，故每卡独占一行。
//
//   **卡上是短注，卡里是长文**。卡面取 `yc`（短，与悬浮 tip 同一档），
//   点开的知识卡走 evSpec 取 `yl||yc`（长）——同库内既有分工，不另立一套。

import { h, el, fmtYearAxis, fmtSpan } from './charts.js';
import { EVENTS, kindLabel, countByKind, kindsByCount } from './events.js';
import { GEO_EVENTS } from './geo-events.js';
import { buildPlaceCatalog } from './place-catalog.js';
import { evSpec, mountEmbedCard, mdBold } from './knowledge.js';
// 形状与配色一律复用泳道图那一套：同一个库，事件的红三角在哪一页都得是红三角，
// 政权的色槽在哪一页都得是同一槽（slotVar 与 dynastyColorSlots 即那张色表）
import { evMark, dynastyColorSlots } from './views-lanes.js';
// 色槽本身不属于泳道视图，取自共用的 palette.js：页面不必为一个色名去 import 另一张图
import { slotVar } from './palette.js';
import { eventLegend as chipRow } from './events-ui.js';
import { DYNASTIES, DYN_MAP, ERAS, SUCCESSION, MERGED_INTO, ORTHODOX } from './dynasties.js';
import { LINE_STOPS } from './line-stops.js';
import { cardPics } from './pics-own-cards.js';
import { PLACES, membersOf, PLACE_END, PLACE_MIN, radiusText } from './places.js';
import { mountThemeToggle } from './theme.js';
import { lineBadgeSpec } from './line-badge.js';
import { mountSib } from './sib-nav.js';

const $ = (id) => document.getElementById(id);
const host = $('place');

/* ── 取地方 ───────────────────────────────────────────────────────────── */

const KEY = new URLSearchParams(location.search).get('key');
const PLACE = KEY ? PLACES[KEY] : null;

/* ── 出处的显隐 ───────────────────────────────────────────────────────── */
// 出处**不删、默认收**（去 clutter 案 §一.6、库主拍板④）。为什么用节点自己的
// `hidden` 而不是像 shell.js 那样挂一个 class 到容器上：本页的出处散在两处
// （段头 .plc-seg-s、总结卡 .plc-sum-src），而段头的「¶」要能单独开一段——
// 一段开着、别的收着这个态，class 开关表达不了，节点自报最直白。
// 键名与 shell.js 的 il.* 一族同族，只管这一页。
const SRC_KEY = 'il.src.place';
let srcOn = false;
try { srcOn = localStorage.getItem(SRC_KEY) === '1'; } catch { /* 隐私模式 */ }

/** 建一个出处节点，按当前总开关定初始显隐（draw() 重画时新节点自动跟上）。 */
function srcNode(tag, cls, txt) {
  // h() 走 setAttribute，`hidden: false` 会写成 hidden="false" 而 HTML 照样藏起来；
  // 故显隐一律走属性节点的 .hidden 属性，不进 h() 的 attrs
  const n = h(tag, { class: cls, text: txt });
  n.hidden = !srcOn;
  return n;
}

/** 段头那颗极小的「¶」：示意这一段有出处，点它单独开合这一段。 */
function pilcrow(node) {
  const b = h('button', {
    class: 'linkish', type: 'button',
    style: 'font-size:.72rem;line-height:1;padding:0 3px;color:var(--muted)',
    title: '出处（点开只开这一段；页首「出处」钮全开全关）',
    'aria-label': '这一段的出处', 'aria-expanded': String(srcOn), text: '¶',
    onclick: (e) => {
      e.stopPropagation();
      node.hidden = !node.hidden;
      b.setAttribute('aria-expanded', String(!node.hidden));
    },
  });
  return b;
}

/** 总开关：全页出处一齐开合，并把每颗「¶」的 aria-expanded 拨回同一态。 */
function setSrcAll(on) {
  srcOn = on;
  try { localStorage.setItem(SRC_KEY, on ? '1' : '0'); } catch { /* 隐私模式 */ }
  for (const n of document.querySelectorAll('.plc-seg-s, .plc-sum-src')) n.hidden = !on;
  for (const b of document.querySelectorAll('.plc-seg-h .linkish, .plc-sum-t .linkish')) {
    b.setAttribute('aria-expanded', String(on));
  }
}

/* ── 分档 ─────────────────────────────────────────────────────────────── */
// 一等：r===1，或列在精选里（PICKS）——库主定的「curation 与算法分开」：
// 算法只认 r，人只管往上提，两者不互相迁就。二三等照 r。
const tierOf = (ev, picks) => (ev.r === 1 || picks.has(ev.n) ? 1 : ev.r === 2 ? 2 : 3);

/* ── 政权配色 ─────────────────────────────────────────────────────────── */
const SLOTS = dynastyColorSlots();
const colorOfDyn = (key) => {
  const s = SLOTS.get(key);
  return s === undefined ? '--lane-other' : slotVar(s);
};
/**
 * ERAS 兜底段的颜色：借该时代**治下最长的那个政权**的色槽。
 * 时代本身没有颜色，按序号轮换也能分辨，但那样一来轴上的颜色就不再有意思；
 * 借那一朝的颜色，读者在泳道图上见过的色块在这里还认得出。
 *
 * 但只借最长的一朝会撞车：泳道图那张色表只保证「同时并存的政权不同色」，
 * 而商、汉、东晋、唐彼此并不并存，于是四家一齐占着第一个色槽——实测
 * 夏商西周、秦汉、三国两晋南北朝、隋唐连着四段全是同一片蓝，等于没有分段。
 * 故按时长降序备一串候选，撞上一段就顺次换下一朝，都撞才退到轮换槽位。
 */
function eraColors() {
  const out = [];
  let prev = '--lane-other';        // 史前那一段用的中性色，第一带也不许与它撞
  ERAS.forEach((e, i) => {
    const cands = DYNASTIES.filter((d) => d.era === e.key)
      .sort((a, b) => (b.e - b.s) - (a.e - a.s)).map((d) => colorOfDyn(d.key));
    const c = cands.find((x) => x !== prev)
      || (slotVar(i % 8) !== prev ? slotVar(i % 8) : slotVar((i + 1) % 8));
    out.push(c);
    prev = c;
  });
  return out;
}

/* ── 分段 ─────────────────────────────────────────────────────────────── */
/**
 * 把成员切成段。两种口径：
 *   有换手表（TURNS）——段界即换手年，段题、政权、都城身份、按语都由人写；
 *   没有——退回 ERAS 时代分段（八带），只借时代名与颜色，不编造任何身份。
 * 两种口径都在最前面留一个「早于第一段」的兜底段：北京的周口店、山顶洞人
 * 早于 ERAS 的起点二十万倍，没有这一段它们会掉出轴外。
 */
function buildSegs(turns, members) {
  const y0 = members.length ? members[0].y : -2069;
  const segs = [];
  if (turns.length) {
    if (y0 < turns[0].y) segs.push({ y: y0, y2: turns[0].y - 1, t: '早于第一次换手', color: '--lane-other', pre: true });
    // 讫年取 max(起年, 下一转折年-1)：**同一年里易两次手是常事**——1123 金军入燕京
    // 与宋得燕山府、1644 大顺入京与清定鼎燕京，两对都在同年。直接减一会算出
    // 「1644 – 1643」这种倒着的区间，看上去像数据错了；夹住之后它自报一个年份，
    // 段身空一线，正好说出「这一年这座城换了两次主」
    turns.forEach((tn, i) => {
      const end = i + 1 < turns.length ? Math.max(tn.y, turns[i + 1].y - 1) : PLACE_END;
      const first = {
        y: tn.y, y2: end,
        t: tn.t, who: tn.who, status: tn.status, note: tn.note, src: tn.src,
        color: tn.who ? colorOfDyn(tn.who) : '--lane-other',
        // 第二面旗（库主 2026-09-09「那两段能不能混旗」）：一片地同时归两家时不选边，
        // who 记大半所属（续色仍跟它走），who2 记另一家，段身与轴线画成两色条纹
        who2: tn.who2 && DYN_MAP.has(tn.who2) ? tn.who2 : null,
        color2: tn.who2 && DYN_MAP.has(tn.who2) ? colorOfDyn(tn.who2) : null,
      };
      segs.push(first);
      // 换手表只记**本地**换手；天下易主（秦→汉、汉→魏→晋、北朝→隋→唐、明→清）不列
      //（写手与工程接口约定）。政权带若在段内就亡了，轴色不能赖到下一次本地换手——
      // 沿 SUCCESSION 找法统承接者续色（承接者多于一个时先取正统序列），无承接者退
      // MERGED_INTO 的吞并者；易代之际的空窗（秦亡到汉兴）留灰。续出的子段没有段题，
      // 都城身份沿用（身份只在本地换手处变），按语自报「天下易主」
      let cur = first;
      const seen = new Set();
      while (cur.who && !seen.has(cur.who)) {
        seen.add(cur.who);
        const d = DYN_MAP.get(cur.who);
        if (!d || d.e >= cur.y2) break;
        const heirs = DYNASTIES.filter((x) => SUCCESSION[x.key] === cur.who && x.s >= d.e - 1 && x.s <= cur.y2);
        const orth = new Set(ORTHODOX);
        let heir = heirs.find((x) => orth.has(x.key)) || heirs.sort((a, b) => a.s - b.s)[0];
        if (!heir) { const m = MERGED_INTO[cur.who]; heir = m ? DYN_MAP.get(m) : null; }
        if (!heir || heir.s > cur.y2 || heir.e <= d.e) break;
        const start = Math.max(heir.s, d.e + 1);
        if (start > d.e + 1) {   // 易代之际无主的年份：不硬派给谁
          segs.push({ y: d.e + 1, y2: start - 1, t: '', who: null, status: cur.status, auto: true,
            note: '易代之际，本地未另记换手', color: '--lane-other' });
        }
        const sub = { y: start, y2: cur.y2, t: '', who: heir.key, status: cur.status, auto: true,
          note: '天下易主，本地未另记换手', color: colorOfDyn(heir.key) };
        // 前一段的讫年：插了易代空窗就停在政权亡年，否则贴到承接者起年之前
        cur.y2 = Math.max(cur.y, start > d.e + 1 ? d.e : start - 1);
        segs.push(sub);
        cur = sub;
      }
    });
  } else {
    if (y0 < ERAS[0].s) segs.push({ y: y0, y2: ERAS[0].s - 1, t: '史前', color: '--lane-other', pre: true });
    // ERAS 各带首尾互相重叠（隋唐 581 起而南北朝记到 589），段界一律取**起年**：
    // 重叠年归后一带，与泳道图给读者定位时的读法一致
    const cols = eraColors();
    ERAS.forEach((e, i) => segs.push({
      y: e.s, y2: i + 1 < ERAS.length ? ERAS[i + 1].s - 1 : PLACE_END,
      t: e.name, color: cols[i], era: true,
    }));
  }
  for (const sg of segs) sg.items = [];
  for (const ev of members) {
    // 落到最后一个起年不晚于它的段里；比首段还早的（不会有，首段已兜底）落首段
    let k = 0;
    for (let i = 0; i < segs.length; i++) if (ev.y >= segs[i].y) k = i;
    segs[k].items.push(ev);
  }
  return segs;
}

/* ── 知识卡坞 ─────────────────────────────────────────────────────────── */
/**
 * 点一张卡，弹出知识卡（宽屏浮在那张卡的对面一侧，窄屏贴底）——**复用 knowledge.js 那一张**
 * （mountEmbedCard + evSpec），不另造卡：摘要、图、百度、馆藏页、维基文库、
 * 视频、故事线角标全是既有的一套，地方线不该有自己的一份。
 * 坞头那三行（年份类别、条名、落点）是嵌入卡自己藏起来的部分（.kp-embed 藏
 * .kp-sub/.kp-title），由坞代念，与时光舆图的阅读坞同一个分工。
 */
function mountDock() {
  const kicker = h('div', { class: 'plc-dock-k' });
  const title = h('div', { class: 'plc-dock-t' });
  const where = h('div', { class: 'plc-dock-w' });
  const close = h('button', { class: 'plc-dock-x', type: 'button', title: '关闭（Esc）', 'aria-label': '关闭', text: '✕' });
  const body = h('div', { class: 'plc-dock-b' });
  const box = h('aside', { class: 'plc-dock', 'aria-live': 'polite' }, [close, kicker, title, where, body]);
  document.body.appendChild(box);
  const card = mountEmbedCard(body);
  let cur = null;
  const hide = () => {
    box.classList.remove('on');
    document.body.classList.remove('plc-dock-on');
    for (const n of document.querySelectorAll('.plc-card.sel, .plc-row.sel')) n.classList.remove('sel');
    cur = null;
  };
  close.addEventListener('click', hide);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  return {
    open(ev, node) {
      if (cur === ev.n) { hide(); return; }       // 再点同一张即收起，与地图页的取消选中同手感
      cur = ev.n;
      for (const n of document.querySelectorAll('.plc-card.sel, .plc-row.sel')) n.classList.remove('sel');
      if (node) node.classList.add('sel');
      // 坞落在**所点那张卡的对面**：宽屏上坞是浮层，浮在哪边就盖住哪边一列，
      // 盖住的若正是刚点开的那张卡，读者会以为自己点丢了。折叠条（居中）默认落右
      box.dataset.side = node && node.dataset && node.dataset.side === 'r' ? 'l' : 'r';
      const kind = kindLabel(ev.k);
      kicker.textContent = `${fmtSpan(ev.y, ev.y2)} · ${kind}`;
      title.textContent = ev.n;
      // 落点小字：这条为什么算北京的。归地是个判断，判断就该看得见
      where.textContent = '本地落点：' + ev.hits.map((x) => x.名 + '（' + x.角 + (x.km !== undefined ? ` ${x.km}km` : '') + '）').join('、');
      card.show(evSpec(ev));
      box.classList.add('on');
      document.body.classList.add('plc-dock-on');
    },
    hide,
  };
}

/* ── 卡片 ─────────────────────────────────────────────────────────────── */
const kindGlyph = (k) => {
  const g = el('svg', { width: 13, height: 13, viewBox: '0 0 13 13', class: 'ev-glyph' });
  g.appendChild(evMark(k, 6.5, 6.5, 4.6));
  return g;
};

/** 故事线角标：凡某线之站，卡上标一条链去故事页对应站（库主 2026-09-02 令）。
 *  站序与 story/<key>.html 的 section id 同源（build_line_page.py 生成 LINE_STOPS）。 */
const lineBadges = (ev) => (LINE_STOPS[ev.n] || []).map((l) => {
  const b = lineBadgeSpec(l);                 // 三串字的正本在 line-badge.js，知识卡同吃
  return h('a', {
    class: 'plc-line-badge', href: b.href, title: b.title, text: b.text,
    onclick: (e) => e.stopPropagation(),      // 角标是去别处的门，别把它读成「点开这张卡」
  });
});

/**
 * 一张事件卡。一等带图（有本地手选图才上，维基缩略图留给知识卡去拉——
 * 卡阵里一百张实时抓图会把页面拖垮），二等窄卡不带图。
 * 正文取短注 `yc`；OVERRIDES 里写了的以人写的段落顶替（库主的 custom 机制）。
 */
function evCard(ev, tier, side, over, dock) {
  const ovr = over[ev.n];
  // 取图走 cardPics()（馆方开放图当主体、自摄补语境细节的规则集中在那里）；地方线卡只挂主图
  const pp = tier === 1 ? cardPics(ev.n) : null;
  const pic = pp ? { src: pp.main.src, credit: pp.main.note } : null;
  const body = ovr && ovr.p && ovr.p.length
    ? ovr.p.map((s) => h('p', { class: 'plc-card-p' }, [richText(s)]))
    : (ev.yc ? [h('p', { class: 'plc-card-p' }, [richText(ev.yc)])] : []);
  const card = h('article', {
    class: `plc-card plc-t${tier}${ovr ? ' plc-custom' : ''}`, 'data-side': side,
    tabindex: '0', role: 'button',
    title: '点开读这一条',
    style: `--ev: var(--ev-${ev.k})`,
  }, [
    h('div', { class: 'plc-card-m' }, [
      h('span', { class: 'plc-yr', text: fmtSpan(ev.y, ev.y2) }),
      h('span', { class: 'plc-kind' }, [kindGlyph(ev.k), h('span', { text: kindLabel(ev.k) })]),
    ]),
    h('h3', { class: 'plc-card-t', text: ovr && ovr.t ? ovr.t : ev.n }),
    pic ? h('figure', { class: 'plc-card-fig' }, [
      h('img', { class: 'plc-card-pic', src: pic.src, alt: ev.n, loading: 'lazy' }),
      h('figcaption', { class: 'plc-card-cap', text: pic.credit }),
    ]) : null,
    ...body,
    // 没上过任何故事线的条不留空行——空的角标行会在卡底压出一道无缘无故的白边
    LINE_STOPS[ev.n] ? h('div', { class: 'plc-card-l' }, lineBadges(ev)) : null,
  ]);
  const open = () => dock.open(ev, card);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  return card;
}

// 库内简注的唯一标记语法是 `**粗体**`（见 knowledge.js 的 mdBold）：
// 那里已经把转义（&、<）与转换写对了一遍，这里直接借它的产物塞进一个 span，不再自己拼
function richText(s) {
  const sp = document.createElement('span');
  sp.innerHTML = mdBold(s);
  return sp;
}

/** 三等条：折进段末的「还有 N 条 ▸」，一行一条，点开同样弹知识卡。 */
function foldRow(ev, dock) {
  const row = h('button', {
    class: 'plc-row', type: 'button', style: `--ev: var(--ev-${ev.k})`,
    onclick: () => dock.open(ev, row),
  }, [
    h('span', { class: 'plc-row-y', text: fmtYearAxis(ev.y) }),
    kindGlyph(ev.k),
    h('span', { class: 'plc-row-n', text: ev.n }),
  ]);
  return row;
}

/* ── 总结卡 ───────────────────────────────────────────────────────────── */
// 库主裁：**总结卡不做半自动**——「有真正过关的总结才是 value add」。
// 故这里一个字也不生成：CARDS 里有这个转折题就画一张通栏卡，没有就什么都不画，
// 不留占位、不写「暂无总结」——空占位比空白更糟，它在替没做的事占地方。
function sumCard(seg, cards) {
  const c = cards[seg.t];
  if (!c || !c.p || !c.p.length) return null;
  // 出处默认收（§一.6）：卡题末缀一颗「¶」，与段头同一副手感
  const src = c.src && c.src.length
    ? srcNode('p', 'plc-sum-src small', '出处：' + c.src.join('；')) : null;
  return h('section', { class: 'plc-sum' }, [
    h('h3', { class: 'plc-sum-t' }, [seg.t, src ? pilcrow(src) : null]),
    ...c.p.map((s) => h('p', { class: 'plc-sum-p' }, [richText(s)])),
    src,
  ]);
}

/* ── 色标＝筛选钮 ─────────────────────────────────────────────────────── */
// 与泳道图的 eventLegend 同式而不同数：那边数的是全库，这边只数**本地**——
// 一座城的类型构成正是地方线要说的事（北京的文化 21 条 vs 战事 3 条）。
// 交互（单击开关一类、双击只看一类、末尾一颗全开/全关）此前是逐行誊抄的第二份，
// 2026-09-04 归并到 js/events-ui.js（SSOT 卷 D11）：本地只剩「数本地」与本页的字形尺寸。
function localLegend(members, off, onChange) {
  const counts = countByKind(members);
  // 「本地类型构成（点色标筛选，双击只看一类）」那行小字撤了（去 clutter 案 D-B3）：
  // 操作句归就地提示，不占正文——两种手势现在都写在芯片自己的 title 里，
  // 正本在 events-ui.js 那一句（四家同变），本页不另抄一份
  return chipRow({ counts, off, glyph: kindGlyph, onChange, owner: 'place' });
}

/* ── 页面：一个地方 ───────────────────────────────────────────────────── */
async function renderPlace(place) {
  document.title = `${place.name}地方线：这座城的大事记 · 中国帝王寿命数据库`;
  const h1 = $('plc-h1');
  if (h1) h1.textContent = `${place.name}地方线`;

  const members = membersOf(place, EVENTS, GEO_EVENTS);
  // 人写的那一半缺席也要照常出图：文件没写、写坏、路径错，一律当空表。
  // （控制台会留一条 404——那是给维护者看的，读者这边什么都不缺）
  const txt = await place.text().catch(() => ({}));
  const TURNS = (Array.isArray(txt.TURNS) ? txt.TURNS : []).slice().sort((a, b) => a.y - b.y);
  const CARDS = txt.CARDS && typeof txt.CARDS === 'object' ? txt.CARDS : {};
  const PICKS = new Set(Array.isArray(txt.PICKS) ? txt.PICKS : []);
  const OVERRIDES = txt.OVERRIDES && typeof txt.OVERRIDES === 'object' ? txt.OVERRIDES : {};

  const dock = mountDock();
  const tiers = { 1: 0, 2: 0, 3: 0 };
  for (const ev of members) tiers[tierOf(ev, PICKS)]++;

  // 顶部统计一句：全自动，随库长。数字写死的话每次增补都会再错一次（counts.js 同理）。
  // 常显只留三格「多少条 · 从哪年到哪年 · 几个转折」；分档口径、归地半径与首尾两条
  // 的条名进 title（去 clutter 案 D-B2：数字与口径挂到它说明的那个元件上）
  const first = members[0], last = members[members.length - 1];
  const brief = `本地共 ${members.length} 条`;
  const tip = `一等 ${tiers[1]}、二等 ${tiers[2]}、三等 ${tiers[3]}：一等是 r=1 或人写的精选，二三等照 r 分。`
    + `凡本库条目的落点地名对得上${place.name}，或坐标在${radiusText(place)}，即算这座城的一条。`
    + (members.length ? `最早的是${first.n}，最晚的是${last.n}。` : '');
  const tally = h('p', { class: 'small plc-tally' }, [
    h('strong', { class: 'has-tip', title: tip, 'aria-label': `${brief}。${tip}`, text: brief }),
    h('span', {
      text: (members.length ? ` · ${fmtYearAxis(first.y)} – ${fmtYearAxis(last.y)}` : ' · 本地暂无条目')
        + (TURNS.length ? ` · ${TURNS.length} 个转折` : ' · 换手表未到，轴暂按时代分段'),
    }),
  ]);

  const legendWrap = h('div', { class: 'plc-legend' });
  const lineBox = h('div', { class: 'plc-line' });
  const off = new Set();
  const draw = () => {
    // 筛完就收坞：卡阵整段重画，坞里那张卡的本体已经不在页面上了——
    // 留着它开着，读者再点同一条时会先关一次（坞记着「当前是它」），像是点不动
    dock.hide();
    legendWrap.replaceChildren(
      localLegend(members, off, (next) => { off.clear(); for (const k of next) off.add(k); draw(); }),
    );
    const shown = members.filter((ev) => !off.has(ev.k));
    lineBox.replaceChildren(...packSegs(buildSegs(TURNS, shown))
      .map((x) => (x.band ? bandNode(x.band) : segNode(x.seg, { PICKS, OVERRIDES, CARDS, dock }))));
  };

  // 页级口径块：**放第一张图之上**（去 clutter 案 §一.2）。从前它压在四十来段之后的页尾，
  // 读者滚完全页才见口径，等于没说
  const how = h('details', { class: 'notes' }, [
    h('summary', {}, [
      h('strong', { text: '这条线是怎么抽出来的' }),
      h('span', { class: 'sm-sep', text: '·' }),
      '现藏地不算',
    ]),
    h('p', {}, [
      `凡本库条目的落点落在${place.name}——地名对得上，或坐标在${radiusText(place)}——即算这座城的一条。`,
      h('strong', { text: '但现藏地不算：' }),
      '藏在这里的东西未必是这里的事。'
      + '造、发（出土）、址、战、行、都、迁、灾、显、说都算，摹本与复制件同现藏一并不计。',
    ]),
    h('p', {}, [
      h('strong', { text: '轴不按年等距。' }),
      '段界是政权换手（人核过的换手表）或时代（换手表未到时的兜底），段与段之间不成比例；'
      + '空段照画——空着的那一段，是史料里没记这座城，不是这座城没有事。',
    ]),
  ]);

  // 「出处」总开关：与页首 h2 同一行（.desc-toggle 自带 margin-left:auto 顶到最右）。
  // 只借 shell.js 那颗钮的样子，不借它的 JS——本页不载 shell
  const srcBtn = h('button', {
    class: 'chip desc-toggle', type: 'button', 'aria-pressed': String(srcOn),
    title: '换手表与总结卡的出处。默认收起，段头的「¶」可只开一段',
    text: '出处',
    onclick: () => {
      setSrcAll(srcBtn.getAttribute('aria-pressed') !== 'true');
      srcBtn.setAttribute('aria-pressed', String(srcOn));
    },
  });
  // 换城走 📍 目录浮层（与全景页、舆图页顶栏那颗钮同一件）：地方线没有索引页，
  // 也不在页首互链里——它同故事线一样从页内进（库主 2026-09-08）
  const back = h('button', { class: 'chip', type: 'button', text: '📍 换一座城', onclick: () => pcat.open() });

  draw();

  // 节题独占一行、工具另起一行（库主 2026-09-08 追加 §六.2），全景页同一套。
  // 从前三件挤在一条 flex 行上：1440 宽三者同行，375 宽却折成三行——h2 一行、
  // 「← 换一座城」一行、「出处」被 .desc-toggle 的 margin-left:auto 顶到第三行
  // 右缘孤零零挂着。宽窄两副样子正是这条拍板要消灭的那种。收进显式的
  // `.sec-tools`（flex-basis:100%）之后恒定两行，两屏同构
  host.replaceChildren(...[
    h('div', { class: 'head sec-head' }, [
      // 副题：登记条的 sub（区域线的边界话，如江南「太湖两岸，江海之间」，库主 2026-09-09 定）；
      // 没有 sub 的城照旧
      h('h2', { text: `${place.name} · ${place.sub || '一条竖轴上的大事记'}` }),
      h('div', { class: 'sec-tools' }, [back, srcBtn]),
    ]),
    // lede：登记条里的一句边界话（区域线用：说清哪两座都城各自成线、这里是它们之间的什么）
    place.lede ? h('p', { class: 'small plc-lede', text: place.lede }) : null,
    tally, how, legendWrap, lineBox,
  ].filter(Boolean));
}

/** 段的年份字面。只管一年的段（同年再易手）报一个年份，不写「1644 – 1644」。 */
const segYears = (y, y2) => (y2 > y ? `${fmtYearAxis(y)} – ${fmtYearAxis(y2)}` : fmtYearAxis(y));

/**
 * 连着的机器续色空段并成一条细带（库主拍板③）。**只并机器的复读**：
 * `auto`（天下易主／易代之际续出来的段）且段内一条都没有，且连着两段以上。
 * 人写过的段一律不并，哪怕它也空着——那一行有段题、有按语，是内容。
 * 返回 `[{seg}|{band:[seg,…]}]`，渲染时一带出一节，轴上仍占一格。
 */
function packSegs(segs) {
  const out = [];
  const mergeable = (s) => s.auto && s.items.length === 0;
  for (let i = 0; i < segs.length; i++) {
    if (!mergeable(segs[i])) { out.push({ seg: segs[i] }); continue; }
    let j = i;
    while (j + 1 < segs.length && mergeable(segs[j + 1])) j++;
    if (j > i) { out.push({ band: segs.slice(i, j + 1) }); i = j; }
    else out.push({ seg: segs[i] });
  }
  return out;
}

/** 一条细带：年跨度 ＋ 并列的政权丸子 ＋「N 段无本地条目」。段题与按语都不写。 */
function bandNode(run) {
  const why = '天下易主或易代之际，本地未另记换手：政权带按法统承接续色，段题空着。'
    + `这 ${run.length} 段本库没有这座城的条目。`;
  const pills = [];
  for (const sg of run) {
    const d = sg.who ? DYN_MAP.get(sg.who) : null;
    // 无主的空窗（秦亡到汉兴）没有丸子可摆——它在「N 段」的数里，不硬派给谁
    if (d) pills.push(h('span', { class: 'plc-seg-d', style: `--seg: var(${sg.color})`, text: d.name }));
  }
  const head = h('div', { class: 'plc-seg-h plc-seg-auto' }, [
    h('span', { class: 'plc-seg-y has-tip', title: why, 'aria-label': why,
      text: segYears(run[0].y, run[run.length - 1].y2) }),
    ...pills,
    h('span', { class: 'plc-seg-n small', text: `${run.length} 段无本地条目` }),
  ]);
  // 带色取中性灰：一带跨好几朝，轴上再挑一朝的颜色代表它就是撒谎
  return h('section', { class: 'plc-seg plc-seg-void plc-seg-band', style: '--seg: var(--lane-other)' }, [head]);
}

/** 一段：段头（年范围、题、政权、都城身份、按语）＋总结卡＋卡阵＋折叠的三等条。 */
function segNode(seg, ctx) {
  const { PICKS, OVERRIDES, CARDS, dock } = ctx;
  const dyn = seg.who ? DYN_MAP.get(seg.who) : null;
  const cap = seg.status === '都' || seg.status === '陪都';
  // 出处默认收（§一.6）：有出处的段头缀一颗「¶」，点它只开这一段
  const src = seg.src ? srcNode('span', 'plc-seg-s small', `（${seg.src}）`) : null;
  // 机器续色段那句按语（「天下易主，本地未另记换手」）是**口径不是信息**，
  // 十五段各说一遍。收进年份的 title，段头只留年份＋政权丸子（去 clutter 案 D-B7）
  const head = h('div', { class: 'plc-seg-h' + (seg.auto ? ' plc-seg-auto' : '') }, [
    h('span', {
      class: 'plc-seg-y' + (seg.auto && seg.note ? ' has-tip' : ''),
      title: seg.auto && seg.note ? seg.note : null,
      'aria-label': seg.auto && seg.note ? `${segYears(seg.y, seg.y2)}：${seg.note}` : null,
      text: segYears(seg.y, seg.y2),
    }),
    h('span', { class: 'plc-seg-t', text: seg.t }),
    dyn ? h('span', { class: 'plc-seg-d', text: dyn.name }) : null,
    // 混旗段：第二颗丸子着第二面旗的色，两颗并排就是「这一段两家同时在」
    seg.who2 ? h('span', { class: 'plc-seg-d plc-seg-d2', style: `--seg: var(${seg.color2})`, text: DYN_MAP.get(seg.who2).name }) : null,
    // 都城期加亮：这座城当没当过首都，是地方线上最要紧的一条身份线索
    seg.status && seg.status !== '非都' ? h('span', { class: 'plc-seg-cap', text: seg.status }) : null,
    seg.note && !seg.auto ? h('span', { class: 'plc-seg-n small', text: seg.note }) : null,
    src ? pilcrow(src) : null,
    src,
  ]);

  // 一等左右交错、二等一律贴右：交错是给一等的排场，二等挤在同一侧成一列，
  // 读起来才像「主线之外还有这些」，而不是又一批同等分量的东西
  const three = [];
  let flip = 0, row = 0;
  const cards = h('div', { class: 'plc-cards' });
  for (const ev of seg.items) {
    const t = tierOf(ev, PICKS);
    if (t === 3) { three.push(ev); continue; }
    const card = evCard(ev, t, t === 1 ? (flip++ % 2 ? 'r' : 'l') : 'r', OVERRIDES, dock);
    // 每张卡显式占自己一行。不写行，网格自动摆位会让「左卡跟在右卡后」另起一行、
    // 「右卡跟在左卡后」挤进同一行——并不并排只看 DOM 先后，与年份无关；并排的那对
    // 共用一个轴点，前606 与前293 看着像同时（库主 2026-09-08 两张截图）。行一钉，
    // 一等的左右交错就是真正的之字形，时间从上往下单调
    card.style.gridRow = String(++row);
    cards.appendChild(card);
  }

  const fold = three.length ? h('details', { class: 'plc-more' }, [
    h('summary', { text: `还有 ${three.length} 条 ▸` }),
    h('div', { class: 'plc-rows' }, three.map((ev) => foldRow(ev, dock))),
  ]) : null;

  // 空段不再配注（库主 2026-09-08：「本段本地无条目——留白说的是记录的形状」连着七段重复七遍，
  // 说的是设计理由不是信息）。段题里的「天下易主，本地未另记换手」已把空说清；空段只占一行。
  const sum = sumCard(seg, CARDS);
  const empty = null;

  return h('section', {
    class: 'plc-seg' + (cap ? ' plc-cap' : '') + (seg.items.length ? '' : ' plc-seg-void') + (seg.who2 ? ' plc-seg-mixed' : ''),
    style: `--seg: var(${seg.color})` + (seg.who2 ? `; --seg2: var(${seg.color2})` : ''),
  }, [head, sum, empty, cards, fold]);
}

/* ── 页面：不带城名／城名写错 ────────────────────────────────────────── */
// 地方线没有索引页（库主 2026-09-08：「这个页面也没加什么。故事线都没开页面」）：
// 不带 key 或 key 写错时，就地弹 📍 目录浮层——与全景页、舆图页顶栏那颗钮开的是同一件，
// 挑城的地方只有这一处。key 写错与不带 key 是两回事：写错要说出来，否则读者会以为这个地方一条都没有
function renderFallback(badKey) {
  host.replaceChildren(...[
    badKey ? h('p', { class: 'notice warn', text: `没有「${badKey}」这条地方线。` }) : null,
    h('p', { class: 'small' }, [
      h('button', { class: 'chip', type: 'button', text: '📍 选一座城', onclick: () => pcat.open() }),
    ]),
  ].filter(Boolean));
  pcat.open();
}

/* ── 起 ───────────────────────────────────────────────────────────────── */
// 页首两件事赶在渲染之前办完，免得页首先空一拍再跳版。
// 主题按钮：本页不走 shell.js 的渲染循环，走 theme.js 那一份（读存值、搬出 lede、持久化）。
// 家安在标题行末：本页没有「设置」块，留在 lede 里会被那条 display:none 藏一辈子
// （2026-09-07 库主实测缺开关）。**排在 mountSib 之前**——互链一行靠 margin-left:auto
// 顶到最右，窄屏又整行独占；按钮排在它后面会被挤成第三行
{
  const h1 = document.getElementById('plc-h1');
  mountThemeToggle(h1 ? h1.parentNode : null);
}
// 页首互链一行：字面与释义的正本在 js/sib-nav.js，五页共用一份（去 clutter 案 §一.1）。
// 从前这里是一段 64 字散文，替另外三页各写了一句 lede；现在名字自明，释义进 title
mountSib();
// 📍 目录浮层：单城页「换一座城」与无城名兜底共用这一件
const pcat = buildPlaceCatalog();

if (PLACE) renderPlace(PLACE);
else renderFallback(KEY);
