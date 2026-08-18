// data.js — 装配数据库：展开紧凑记录、解析日期、计算派生变量与 DSI
import { CAUSE, FLAGS, parseDate, yearsBetween, pairPrecision } from './schema.js';
import { DYNASTIES, DYN_MAP, ERA_MAP } from './dynasties.js';
import d0 from './data-0-xianqin.js';
import d1 from './data-1-qin-han.js';
import d2 from './data-2-sanguo-jin.js';
import d3 from './data-3-shiliuguo.js';
import d4 from './data-4-nanbeichao.js';
import d5 from './data-5-sui-tang.js';
import d6 from './data-6-wudai-shiguo.js';
import d7 from './data-7-song-liao-xia-jin.js';
import d8 from './data-8-yuan-ming.js';
import d9 from './data-9-qing.js';

const RAW = [...d0, ...d1, ...d2, ...d3, ...d4, ...d5, ...d6, ...d7, ...d8, ...d9];

const EPS = 1 / 365.2425;

function expandFlags(s) {
  const out = {};
  for (const key of Object.values(FLAGS)) out[key] = 0;
  if (!s) return out;
  for (const ch of s) if (FLAGS[ch]) out[FLAGS[ch]] = 1;
  return out;
}

function buildOne(r, seq) {
  const dyn = DYN_MAP.get(r.d);
  if (!dyn) throw new Error(`未知朝代 key: ${r.d}（${r.n}）`);
  const flags = expandFlags(r.F);

  const birth = parseDate(r.b);
  const death = parseDate(r.x);
  const censor = parseDate(r.xc);          // 末次可考日期（失踪等）
  const acc = parseDate(r.a);
  const accRule = parseDate(r.r);
  const abd = parseDate(r.z);

  // 多次在位
  const reigns = (r.rg || [[r.a, r.z]]).map(([s, e]) => ({ s: parseDate(s), e: parseDate(e) }));
  const lastReign = reigns[reigns.length - 1];
  const reignEnd = lastReign.e || death || censor;
  let reignYears = 0;
  let reignKnown = true;
  for (const rg of reigns) {
    const end = rg.e || death || censor;
    if (!rg.s || !end) { reignKnown = false; continue; }
    reignYears += Math.max(0, end.t - rg.s.t);
  }

  const obsEnd = death || censor;
  const died = death ? 1 : 0;
  const lifespan = death && birth ? yearsBetween(birth, death) : null;
  const obsAge = obsEnd && birth ? yearsBetween(birth, obsEnd) : null;
  const accAge = acc && birth ? yearsBetween(birth, acc) : null;

  const cause = CAUSE[r.c ?? 5];
  const violent = cause.violent;

  // 大一统属性：默认继承朝代，但允许逐帝覆盖（u）。
  // 必要性：元的前四位大汗（1206–1259）与清入关前的努尔哈赤、皇太极，
  // 虽属「元」「清」两朝，其在位时中国并未统一，不能计入大一统组。
  const unified = r.u !== undefined ? r.u : dyn.u;
  const unifiedLoose = r.u !== undefined ? r.u : dyn.uL;
  // political_order：显式给定优先；否则由该帝的大一统属性推导
  const order = r.o !== undefined ? r.o : (unified ? 1 : 0);

  return {
    id: `${r.d}-${seq}`,
    name: r.n,
    temple: r.t,
    posth: r.p || '',
    dynKey: r.d,
    dynasty: dyn.name,
    era: dyn.era,
    eraName: ERA_MAP.get(dyn.era).name,
    ethnicity: r.e || '汉',
    titleClass: r.tc || '帝',

    birth, death, censor, acc, accRule, abd, reigns, reignEnd,
    datePrecision: pairPrecision(birth, obsEnd),

    lifespan,                 // 死亡年龄（年，含小数）；删失者为 null
    obsAge,                   // 观察终点年龄（死亡或删失）
    died,                     // 1=观察到死亡，0=删失
    accAge,
    reignYears: reignKnown ? reignYears : null,
    diedInOffice: !abd && !r.rg ? died : (lastReign.e ? 0 : died),

    causeCode: r.c ?? 5,
    causeLabel: cause.label,
    causeKey: cause.key,
    violent,                  // 1 非正常死亡 / 0 正常 / null 不明
    founder: r.f || 0,
    lastRuler: r.l || 0,
    order,
    unified,
    unifiedLoose,
    consorts: r.cs ?? null,
    children: r.ch ?? null,
    note: r.no || '',
    // wk：维基词条覆盖。夏商君主的人名直搜是雷区（实测：子庄→景昌王、
    // 子发→东陵连嚣子发、子和→宋穆公），先秦批次逐王显式给出核验过的正题
    wk: r.wk || null,
    ...flags,
  };
}

export const EMPERORS = RAW.map(buildOne);

// ── 朝代聚合与 DSI ───────────────────────────────────────────────────────
export const DYN_STATS = new Map();
for (const d of DYNASTIES) {
  const list = EMPERORS.filter((e) => e.dynKey === d.key && !e.nominal);
  const span = d.e - d.s + 1;
  DYN_STATS.set(d.key, {
    ...d,
    span,
    n: list.length,
    dsi: list.length ? span / list.length : null,
    emperors: list,
  });
}
for (const e of EMPERORS) {
  const st = DYN_STATS.get(e.dynKey);
  e.dsi = st.dsi;
  e.dynSpan = st.span;
  e.dynN = st.n;
}

// ── 分组变量定义（供图表选择） ────────────────────────────────────────────
export const GROUPINGS = {
  unified: {
    label: '大一统 vs 分裂',
    levels: [
      { key: 1, label: '大一统王朝', test: (e, o) => (o.looseUnified ? e.unifiedLoose : e.unified) === 1 },
      { key: 0, label: '分裂时期',   test: (e, o) => (o.looseUnified ? e.unifiedLoose : e.unified) === 0 },
    ],
  },
  violent: {
    label: '正常 vs 非正常死亡',
    levels: [
      { key: 0, label: '正常死亡', test: (e) => e.violent === 0 },
      { key: 1, label: '非正常死亡', test: (e) => e.violent === 1 },
    ],
  },
  founder: {
    label: '开国 vs 非开国',
    levels: [
      { key: 0, label: '非开国皇帝', test: (e) => e.founder === 0 },
      { key: 1, label: '开国皇帝', test: (e) => e.founder === 1 },
    ],
  },
  alchemy: {
    label: '丹药组 vs 非丹药组',
    levels: [
      { key: 0, label: '无服丹药记载', test: (e) => e.alchemy === 0 },
      { key: 1, label: '有服丹药记载', test: (e) => e.alchemy === 1 },
    ],
  },
  lastRuler: {
    label: '亡国 vs 非亡国',
    levels: [
      { key: 0, label: '非亡国之君', test: (e) => e.lastRuler === 0 },
      { key: 1, label: '亡国之君', test: (e) => e.lastRuler === 1 },
    ],
  },
  order: {
    label: '政治秩序（三分）',
    levels: [
      { key: 1, label: '统一稳定期', test: (e) => e.order === 1 },
      { key: 2, label: '统一末期',   test: (e) => e.order === 2 },
      { key: 0, label: '分裂时代',   test: (e) => e.order === 0 },
    ],
  },
  era: {
    label: '时代',
    levels: [...ERA_MAP.values()].map((x) => ({ key: x.key, label: x.name, test: (e) => e.era === x.key })),
  },
};

// ── 生存分析输入构造 ─────────────────────────────────────────────────────
// scale='age'   ：以年龄为时间轴，登基年龄处左截断（delayed entry）
// scale='reign' ：以在位年数为时间轴，登基处 t=0
// censorAtAbd   ：退位者在退位时删失（仅用于 reign 尺度；隔离「在位期间」的风险）
// fromAge      ：年龄尺度的条件起点。左截断下，若干「襁褓即位」的皇帝会让低龄处的
//                风险集只剩一两人，KM 估计在那里毫无意义（S 会被一次死亡打掉一半）。
//                默认自 15 岁起估计条件生存 S(t | T>15)；设为 0 可看未加条件的原始曲线。
export function survivalInput(list, { scale = 'age', censorAtAbd = true, fromAge = 15 } = {}) {
  const rows = [];
  const dropped = [];
  for (const e of list) {
    if (scale === 'age') {
      if (e.accAge === null || e.obsAge === null) { dropped.push(e); continue; }
      let entry = Math.max(0, e.accAge);
      let exit = e.obsAge;
      if (exit <= entry) exit = entry + EPS;
      if (fromAge > 0) {
        if (exit <= fromAge) { dropped.push(e); continue; }   // 未活到条件起点
        entry = Math.max(entry, fromAge);
      }
      rows.push({ e, entry, exit, event: e.died });
    } else {
      const start = e.reigns[0].s;
      if (!start) { dropped.push(e); continue; }
      let end, event;
      if (censorAtAbd && e.abd) { end = e.abd; event = 0; }
      else { end = e.death || e.censor; event = e.death ? 1 : 0; }
      if (!end) { dropped.push(e); continue; }
      let exit = end.t - start.t;
      if (exit <= 0) exit = EPS;
      rows.push({ e, entry: 0, exit, event });
    }
  }
  return { rows, dropped };
}

export const COVARIATES = [
  { key: 'accAgeZ',   label: '登基年龄（每+10岁）', get: (e) => (e.accAge === null ? null : e.accAge / 10), needsBirth: true },
  { key: 'unified',   label: '大一统王朝',          get: (e, o) => (o?.looseUnified ? e.unifiedLoose : e.unified) },
  { key: 'dsi',       label: '王朝稳定度 DSI（每+10年/帝）', get: (e) => (e.dsi === null ? null : e.dsi / 10) },
  { key: 'warfare',   label: '亲历大规模战争',      get: (e) => e.warfare },
  { key: 'civilWar',  label: '经历内战',            get: (e) => e.civilWar },
  { key: 'coup',      label: '遭遇政变',            get: (e) => e.coup },
  { key: 'alchemy',   label: '服丹药',              get: (e) => e.alchemy },
  { key: 'founder',   label: '开国皇帝',            get: (e) => e.founder },
  { key: 'capitalFall', label: '首都陷落',          get: (e) => e.capitalFall },
  { key: 'alcohol',   label: '酗酒记载',            get: (e) => e.alcohol },
  { key: 'reignYearsZ', label: '在位年数（每+10年）', get: (e) => (e.reignYears === null ? null : e.reignYears / 10), timeAxis: 'reign' },
];

export { DYNASTIES, DYN_MAP, ERA_MAP };
