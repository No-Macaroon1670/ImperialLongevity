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
//
//   **一行一卡，不并排**。宽屏上一等卡左右交错，理论上可以两卡并成一行省地方，
//   但那样一来两张卡的先后就要读者自己猜。时间轴上顺序比密度重要，故每卡独占一行。
//
//   **卡上是短注，卡里是长文**。卡面取 `yc`（短，与悬浮 tip 同一档），
//   点开的知识卡走 evSpec 取 `yl||yc`（长）——同库内既有分工，不另立一套。

import { h, el, fmtYearAxis } from './charts.js';
import { EVENTS, EVENT_KINDS } from './events.js';
import { GEO_EVENTS } from './geo-events.js';
import { evSpec, mountEmbedCard, mdBold } from './knowledge.js';
// 形状与配色一律复用泳道图那一套：同一个库，事件的红三角在哪一页都得是红三角，
// 政权的色槽在哪一页都得是同一槽（slotVar 与 dynastyColorSlots 即那张色表）
import { evMark, dynastyColorSlots, slotVar } from './views-lanes.js';
import { eventLegend as chipRow } from './events-ui.js';
import { DYNASTIES, DYN_MAP, ERAS, SUCCESSION, MERGED_INTO, ORTHODOX } from './dynasties.js';
import { LINE_STOPS } from './line-stops.js';
import { cardPics } from './pics-own-cards.js';
import { PLACES, membersOf, PLACE_END, PLACE_MIN } from './places.js';
import { GEO_STATS } from './geo-stats.js';
import { syncCounts } from './counts.js';

const $ = (id) => document.getElementById(id);
const host = $('place');
// 圈码与 knowledge.js 的角标同源（那边的 CIRC 没导出，抄一行比为它开一个导出干净）
const CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

/* ── 取地方 ───────────────────────────────────────────────────────────── */

const KEY = new URLSearchParams(location.search).get('key');
const PLACE = KEY ? PLACES[KEY] : null;

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
      const kind = (EVENT_KINDS[ev.k] || {}).label || '大事';
      kicker.textContent = `${ev.y2 ? `${fmtYearAxis(ev.y)}–${fmtYearAxis(ev.y2)}` : fmtYearAxis(ev.y)} · ${kind}`;
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
const lineBadges = (ev) => (LINE_STOPS[ev.n] || []).map((l) => h('a', {
  class: 'plc-line-badge', href: `story/${l.key}.html#s${l.i}`,
  title: `这件事是${l.name}的第 ${l.i} 站，点开读故事线`,
  text: `${l.name}第${CIRC[l.i - 1] || l.i}站 →`,
  onclick: (e) => e.stopPropagation(),        // 角标是去别处的门，别把它读成「点开这张卡」
}));

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
      h('span', { class: 'plc-yr', text: ev.y2 ? `${fmtYearAxis(ev.y)}–${fmtYearAxis(ev.y2)}` : fmtYearAxis(ev.y) }),
      h('span', { class: 'plc-kind' }, [kindGlyph(ev.k), h('span', { text: (EVENT_KINDS[ev.k] || {}).label || '大事' })]),
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
  return h('section', { class: 'plc-sum' }, [
    h('h3', { class: 'plc-sum-t', text: seg.t }),
    ...c.p.map((s) => h('p', { class: 'plc-sum-p' }, [richText(s)])),
    c.src && c.src.length ? h('p', { class: 'plc-sum-src small', text: '出处：' + c.src.join('；') }) : null,
  ]);
}

/* ── 色标＝筛选钮 ─────────────────────────────────────────────────────── */
// 与泳道图的 eventLegend 同式而不同数：那边数的是全库，这边只数**本地**——
// 一座城的类型构成正是地方线要说的事（北京的文化 21 条 vs 战事 3 条）。
// 交互（单击开关一类、双击只看一类、末尾一颗全开/全关）此前是逐行誊抄的第二份，
// 2026-09-04 归并到 js/events-ui.js（SSOT 卷 D11）：本地只剩「数本地」与本页的字形尺寸。
function localLegend(members, off, onChange) {
  const counts = {};
  for (const ev of members) counts[ev.k] = (counts[ev.k] || 0) + 1;
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

  // 顶部统计一句：全自动，随库长。数字写死的话每次增补都会再错一次（counts.js 同理）
  const first = members[0], last = members[members.length - 1];
  const tally = h('p', { class: 'small plc-tally' }, [
    h('strong', { text: `本地共 ${members.length} 条` }),
    h('span', {
      text: `：一等 ${tiers[1]}、二等 ${tiers[2]}、三等 ${tiers[3]}；`
        + (members.length
          ? `最早 ${fmtYearAxis(first.y)}（${first.n}），最晚 ${fmtYearAxis(last.y)}（${last.n}）。`
          : '（本地暂无条目。）')
        + (TURNS.length ? `轴按 ${TURNS.length} 个转折分段。` : '换手表未到，轴暂按时代分段。'),
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
      h('p', { class: 'muted small', style: 'margin:10px 0 4px', text: '本地类型构成（点色标筛选，双击只看一类）' }),
      localLegend(members, off, (next) => { off.clear(); for (const k of next) off.add(k); draw(); }),
    );
    const shown = members.filter((ev) => !off.has(ev.k));
    lineBox.replaceChildren(...buildSegs(TURNS, shown).map((seg) => segNode(seg, { PICKS, OVERRIDES, CARDS, dock })));
  };
  draw();

  host.replaceChildren(
    h('div', { class: 'head' }, [h('h2', { text: `${place.name} · 一条竖轴上的大事记` })]),
    tally, legendWrap, lineBox,
    h('div', { class: 'notice', style: 'margin-top:16px' }, [
      h('p', { style: 'margin:0' }, [
        h('strong', { text: '这条线是怎么抽出来的。' }),
        `凡本库条目的落点落在${place.name}——地名对得上，或坐标在城中心 ${place.radiusKm} 公里内——即算这座城的一条。`,
        h('strong', { text: '但现藏地不算：' }),
        '藏在这里的东西未必是这里的事，否则国博、故宫所在地会把全国的文物吞进来。'
        + '造、发（出土）、址、战、行、都、迁、灾、显、说都算，摹本与复制件同现藏一并不计。',
      ]),
      h('p', { style: 'margin:6px 0 0' }, [
        h('strong', { text: '轴不按年等距。' }),
        '段界是政权换手（人核过的换手表）或时代（换手表未到时的兜底），段与段之间不成比例；'
        + '空段照画——那段空白说的是记录的形状，不是历史的形状。',
      ]),
    ]),
  );
}

/** 一段：段头（年范围、题、政权、都城身份、按语）＋总结卡＋卡阵＋折叠的三等条。 */
function segNode(seg, ctx) {
  const { PICKS, OVERRIDES, CARDS, dock } = ctx;
  const dyn = seg.who ? DYN_MAP.get(seg.who) : null;
  const cap = seg.status === '都' || seg.status === '陪都';
  const head = h('div', { class: 'plc-seg-h' + (seg.auto ? ' plc-seg-auto' : '') }, [
    // 只管一年的段（同年再易手）报一个年份，不写「1644 – 1644」
    h('span', { class: 'plc-seg-y', text: seg.y2 > seg.y ? `${fmtYearAxis(seg.y)} – ${fmtYearAxis(seg.y2)}` : fmtYearAxis(seg.y) }),
    h('span', { class: 'plc-seg-t', text: seg.t }),
    dyn ? h('span', { class: 'plc-seg-d', text: dyn.name }) : null,
    // 都城期加亮：这座城当没当过首都，是地方线上最要紧的一条身份线索
    seg.status && seg.status !== '非都' ? h('span', { class: 'plc-seg-cap', text: seg.status }) : null,
    seg.note ? h('span', { class: 'plc-seg-n small', text: seg.note }) : null,
    seg.src ? h('span', { class: 'plc-seg-s small', text: `（${seg.src}）` }) : null,
  ]);

  // 一等左右交错、二等一律贴右：交错是给一等的排场，二等挤在同一侧成一列，
  // 读起来才像「主线之外还有这些」，而不是又一批同等分量的东西
  const three = [];
  let flip = 0;
  const cards = h('div', { class: 'plc-cards' });
  for (const ev of seg.items) {
    const t = tierOf(ev, PICKS);
    if (t === 3) { three.push(ev); continue; }
    cards.appendChild(evCard(ev, t, t === 1 ? (flip++ % 2 ? 'r' : 'l') : 'r', OVERRIDES, dock));
  }

  const fold = three.length ? h('details', { class: 'plc-more' }, [
    h('summary', { text: `还有 ${three.length} 条 ▸` }),
    h('div', { class: 'plc-rows' }, three.map((ev) => foldRow(ev, dock))),
  ]) : null;

  // 空段的注分两种说法：上面若已有一张过关的总结，「留白说的是记录的形状」
  // 就说重了——那一段并非无话可说，只是库内还没有可点开的单条
  const sum = sumCard(seg, CARDS);
  const empty = seg.items.length ? null : h('p', { class: 'plc-empty small muted',
    text: sum ? '本段库内暂无可点开的单条，只有上面这张总结。' : '本段本地无条目——留白说的是记录的形状。' });

  return h('section', {
    class: 'plc-seg' + (cap ? ' plc-cap' : '') + (seg.items.length ? '' : ' plc-seg-void'),
    style: `--seg: var(${seg.color})`,
  }, [head, sum, empty, cards, fold]);
}

/* ── 页面：索引 ───────────────────────────────────────────────────────── */
// 够格才列（成员 ≥ PLACE_MIN 条），按条数降序；不够格的地名不列——
// 一条只有七条大事的「地方线」不是线，是一张单子，读者该回时光舆图去看点。
function renderIndex(badKey) {
  const rows = Object.values(PLACES).map((p) => {
    const ms = membersOf(p, EVENTS, GEO_EVENTS);
    const kinds = {};
    for (const ev of ms) kinds[ev.k] = (kinds[ev.k] || 0) + 1;
    return { p, ms, kinds };
  }).filter((r) => r.ms.length >= PLACE_MIN).sort((a, b) => b.ms.length - a.ms.length);

  host.replaceChildren(
    h('div', { class: 'head' }, [h('h2', { text: '有线可走的地方' })]),
    // key 写错与不带 key 是两回事：写错要说出来，否则读者会以为这个地方一条都没有
    badKey ? h('p', { class: 'notice warn', text: `没有「${badKey}」这个地方线——下面是眼下有线可走的地方。` }) : null,
    h('p', { class: 'small', style: 'color:var(--text-2)', text:
      `本库条目够铺一条竖轴的地方（成员 ${PLACE_MIN} 条以上）列在下面，按条数排。`
      + '不够的地方不列——那些条目在时光舆图上各有落点，只是还不足以成线。' }),
    rows.length ? h('div', { class: 'plc-index' }, rows.map(({ p, ms, kinds }) => h('a', {
      class: 'plc-index-i', href: `place.html?key=${encodeURIComponent(p.key)}`,
    }, [
      h('span', { class: 'plc-index-n', text: p.name }),
      h('span', { class: 'plc-index-c', text: `${ms.length} 条` }),
      h('span', { class: 'plc-index-y small', text: `${fmtYearAxis(ms[0].y)} – ${fmtYearAxis(ms[ms.length - 1].y)}` }),
      h('span', { class: 'plc-index-k small' }, Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([k, c]) => h('span', { class: 'plc-index-kk' }, [kindGlyph(k), h('span', { text: `${(EVENT_KINDS[k] || {}).label || k} ${c}` })]))),
    ]))) : h('p', { class: 'muted small', text: '暂无够格开线的地方。' }),
  );
}

/* ── 起 ───────────────────────────────────────────────────────────────── */
if (PLACE) renderPlace(PLACE);
else renderIndex(KEY);

// 页首那几个数字由数据现算（counts.js 的唯一实现）：写死的数字每次增补都会再错一次
syncCounts({ ev: EVENTS.length, dyn: DYNASTIES.length, geo: GEO_STATS.ev });

// 主题按钮：与地图页同一段（本页不走 shell.js 的渲染循环，只借这八行）
{
  const tt = $('theme-toggle');
  if (tt) tt.addEventListener('click', () => {
    const root = document.documentElement;
    const cur = root.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark'
      : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
    root.setAttribute('data-theme', next);
    tt.textContent = next === 'dark' ? '☀ 浅色' : '🌙 深色';
  });
}
