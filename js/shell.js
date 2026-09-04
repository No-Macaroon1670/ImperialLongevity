// app.js — 状态、一级过滤器、版块编排
import { h } from './charts.js';
import { EMPERORS, DYNASTIES, DYN_STATS, GROUPINGS, COVARIATES } from './data.js';
import { ERAS } from './dynasties.js';
import { describe, fmtP } from './stats.js';

// ── 状态 ─────────────────────────────────────────────────────────────────
const S = {
  unified: new Set([1, 0]),                 // 大一统 / 分裂
  death: new Set(['normal', 'violent', 'unknown']),
  onlyFounder: false, onlyLast: false, onlyAlchemy: false,
  eras: new Set(ERAS.map((e) => e.key)),
  // 先秦扩张起默认全含：春秋战国的国君多数终身是公/侯，楚吴越诸王也只称王，
  // 不全含的话新收的二百余位在两页上一位都看不见。副作用同样是刻意的：
  // 原先默认隐藏的 38 位「仅称王者」（十国诸王、南越后三主）一并进入默认视图
  // ——「全部入库」的口径本就该如此。要整体摘出先秦，用「时代」chips 反选两带。
  titles: new Set(['帝', '天王', '汗', '王', '公', '侯', '子', '卿', '伯']),
  includeNominal: false,
  looseUnified: false,
  yearFrom: null, yearTo: null,

  timelineMode: 'dual', timelineSort: 'birth',
  // 全景视图的两种读法：竖向河流（顺着页面滚，看分合岔流）与横向泳道（看谁在何时统治）。
  // 默认按屏宽选：手机竖屏顺着拇指的方向读河流；宽屏一屏并列看得到更多政权，泳道更强。
  panoramaMode: matchMedia('(max-width: 720px)').matches ? 'river' : 'lanes',
  riverPx: 7,
  lanePx: 14, laneColor: 'dynasty', laneViolent: true, laneStrands: false, evOff: [],
  // 年号纪年线三档（2026-08-28 库主定）：全＝各带常显、选＝点选朝代才显、无＝关。
  // 默认「选」——点带即出，与承继丝同一手势；常显交给「全」档
  laneNianhao: 'sel',
  // 大事记分级开关（2026-08-28 库主令：大事记 tog 与分量 seg 合并为一组独立档位）：
  // 数组存**要看的等级**，各档独立勾选——只看三等（小众事件）也行；全取掉＝无大事记
  evRanks: [1, 2, 3],
  scatterX: 'birth',
  kmGroup: 'unified', kmScale: 'reign', kmCensorAbd: true, kmCI: true, kmFromAge: 15,
  cifScale: 'age',
  boxGroup: 'unified', boxMetric: 'lifespan',
  dsiLevel: 'dynasty', dsiMinN: 2,
  heatFacet: true,
  coxScale: 'age', coxVars: ['accAgeZ', 'unified', 'dsi', 'warfare', 'coup', 'alchemy'],
  dbQuery: '',

  // 窄屏下过滤器面板的展开状态。必须存在 S 里而不是 DOM 上——
  // 任一 chip 变动都会触发全量 render()，buildFilters 把整条过滤器重建一遍，
  // 挂在节点上的状态会随之丢失，表现为「点一下筛选面板就自己收起来」。
  filtersOpen: false,
};

// 只读探针：给搜索/骰子这类外围件看一眼当前视图开关（不给写权——写仍走 setOpt）
export const tlProbe = { evOff: () => new Set(S.evOff || []) };

function filtered() {
  return EMPERORS.filter((e) => {
    if (!S.includeNominal && e.nominal) return false;
    if (!S.titles.has(e.titleClass)) return false;
    if (!S.unified.has(S.looseUnified ? e.unifiedLoose : e.unified)) return false;
    const dk = e.violent === null ? 'unknown' : e.violent ? 'violent' : 'normal';
    if (!S.death.has(dk)) return false;
    if (S.onlyFounder && !e.founder) return false;
    if (S.onlyLast && !e.lastRuler) return false;
    if (S.onlyAlchemy && !e.alchemy) return false;
    if (!S.eras.has(e.era)) return false;
    const y = (e.reigns[0].s || e.birth || e.death)?.t;
    if (S.yearFrom !== null && y !== undefined && y < S.yearFrom) return false;
    if (S.yearTo !== null && y !== undefined && y > S.yearTo) return false;
    return true;
  });
}

// ── 一级过滤器 UI ────────────────────────────────────────────────────────
function chip(label, active, onClick, dotColor) {
  const b = h('button', { class: 'chip', 'aria-pressed': String(active), onclick: onClick });
  if (dotColor) { const d = h('span', { class: 'il-dot' }); d.style.background = dotColor; b.appendChild(d); }
  // 勾号**常驻占位**、未选态只隐形（库主实测案 2026-08-31：点掉大事记一二三等，
  // ✓ 进出让按钮忽宽忽窄，控件行一缩、同容器的词条卡跟着漂）——宽度恒定即无重排
  const c = h('span', { class: 'check', text: '✓' });
  if (!active) c.style.visibility = 'hidden';
  b.appendChild(c);
  b.appendChild(h('span', { text: label }));
  return b;
}
function toggleIn(set, v, min = 1) {
  if (set.has(v)) { if (set.size > min) set.delete(v); } else set.add(v);
}

/**
 * 收起态要回答的问题只有一个：「我现在筛掉了什么？」
 * 故摘要只列出**偏离默认值**的那几组——全默认时说「全部」，
 * 而不是把七组条件原样复述一遍（那还不如展开看）。
 */
function filterSummary() {
  const on = [];
  if (S.unified.size < 2) on.push(S.unified.has(1) ? '仅大一统' : '仅分裂期');
  if (S.death.size < 3) on.push('死亡性质');
  if (S.onlyFounder) on.push('开国');
  if (S.onlyLast) on.push('亡国');
  if (S.onlyAlchemy) on.push('丹药');
  if (S.eras.size < ERAS.length) on.push(`时代 ${S.eras.size}/${ERAS.length}`);
  if (S.titles.size !== 9) on.push('入库范围');   // 默认全含九类，少任何一类即偏离
  if (S.includeNominal) on.push('含名义君主');
  if (S.looseUnified) on.push('宽松大一统');
  if (S.yearFrom !== null || S.yearTo !== null) on.push('年份');
  return on;
}

function buildFilters(host) {
  // 面板内的滚动位置在重建后要还原：面板滚到一半时点 chip，
  // 若不还原就会弹回顶部，看上去像页面自己跳了一下
  const prevScroll = host.querySelector('.filters-inner')?.scrollTop || 0;
  host.innerHTML = '';
  host.classList.toggle('open', S.filtersOpen);

  // 窄屏专用的收起条（桌面端由 CSS 隐藏）
  const active = filterSummary();
  const toggle = h('button', {
    class: 'filters-toggle', type: 'button',
    'aria-expanded': String(S.filtersOpen), 'aria-controls': 'filters-panel',
    onclick: () => { S.filtersOpen = !S.filtersOpen; render(); },
  }, [
    h('span', { class: 'ft-caret', text: '▾' }),
    h('span', { class: 'ft-label', text: '筛选' }),
    h('span', { class: `ft-summary${active.length ? ' on' : ''}`,
      text: active.length ? `${active.join('·')} · ${filtered().length} 位` : `全部 ${filtered().length} 位` }),
  ]);
  host.appendChild(h('div', { class: 'filters-bar' }, [toggle]));

  const row = h('div', { class: 'filters-inner', id: 'filters-panel' });

  const g1 = h('div', { class: 'fgroup' }, [h('span', { class: 'flabel', text: '时期' })]);
  g1.appendChild(chip('大一统', S.unified.has(1), () => { toggleIn(S.unified, 1); render(); }, 'var(--c-unified)'));
  g1.appendChild(chip('分裂时期', S.unified.has(0), () => { toggleIn(S.unified, 0); render(); }, 'var(--c-split)'));
  row.appendChild(g1);

  const g2 = h('div', { class: 'fgroup' }, [h('span', { class: 'flabel', text: '死亡性质' })]);
  for (const [k, lab] of [['normal', '正常死亡'], ['violent', '非正常死亡'], ['unknown', '死因不明']]) {
    g2.appendChild(chip(lab, S.death.has(k), () => { toggleIn(S.death, k); render(); }));
  }
  row.appendChild(g2);

  const g3 = h('div', { class: 'fgroup' }, [h('span', { class: 'flabel', text: '仅限' })]);
  g3.appendChild(chip('开国皇帝', S.onlyFounder, () => { S.onlyFounder = !S.onlyFounder; render(); }));
  g3.appendChild(chip('亡国之君', S.onlyLast, () => { S.onlyLast = !S.onlyLast; render(); }));
  g3.appendChild(chip('丹药组', S.onlyAlchemy, () => { S.onlyAlchemy = !S.onlyAlchemy; render(); }));
  row.appendChild(g3);

  const g4 = h('div', { class: 'fgroup' }, [h('span', { class: 'flabel', text: '时代' })]);
  for (const era of ERAS) {
    g4.appendChild(chip(era.name, S.eras.has(era.key), () => { toggleIn(S.eras, era.key); render(); }));
  }
  // 一键滤除先秦（决策 4 的批注）：先秦年代分层复杂（部分低置信），
  // 审稿人质疑「数据太软」时，点它即得帝制时代（秦以降）的干净样本
  {
    const preQ = ['xsz', 'cqzg'];
    const on = preQ.every((k) => !S.eras.has(k));
    g4.appendChild(chip('仅帝制时代', on, () => {
      if (on) preQ.forEach((k) => S.eras.add(k));
      else preQ.forEach((k) => S.eras.delete(k));
      render();
    }));
  }
  row.appendChild(g4);

  const g5 = h('div', { class: 'fgroup' }, [h('span', { class: 'flabel', text: '入库范围' })]);
  for (const t of ['帝', '天王', '汗', '王', '公', '侯', '子', '卿', '伯']) {
    g5.appendChild(chip(t === '帝' ? '皇帝' : t === '王' ? '称王者' : t === '公' ? '诸侯·公' : t === '侯' ? '诸侯·侯' : t === '子' ? '诸侯·子' : t === '卿' ? '晋卿' : t === '伯' ? '诸侯·伯' : t,
      S.titles.has(t), () => { toggleIn(S.titles, t); render(); }));
  }
  g5.appendChild(chip('名义君主', S.includeNominal, () => { S.includeNominal = !S.includeNominal; render(); }));
  row.appendChild(g5);

  const g6 = h('div', { class: 'fgroup' }, [h('span', { class: 'flabel', text: '大一统定义' })]);
  g6.appendChild(chip(S.looseUnified ? '宽松（北宋计入）' : '严格（秦汉晋隋唐元明清）', true,
    () => { S.looseUnified = !S.looseUnified; render(); }));
  row.appendChild(g6);

  const g7 = h('div', { class: 'fgroup' }, [h('span', { class: 'flabel', text: '登基年份' })]);
  const inFrom = h('input', { type: 'number', placeholder: '起', style: 'width:78px' });
  const inTo = h('input', { type: 'number', placeholder: '止', style: 'width:78px' });
  inFrom.value = S.yearFrom ?? ''; inTo.value = S.yearTo ?? '';
  inFrom.addEventListener('change', () => { S.yearFrom = inFrom.value === '' ? null : +inFrom.value; render(); });
  inTo.addEventListener('change', () => { S.yearTo = inTo.value === '' ? null : +inTo.value; render(); });
  g7.appendChild(inFrom); g7.appendChild(h('span', { class: 'muted small', text: '–' })); g7.appendChild(inTo);
  row.appendChild(g7);

  row.appendChild(h('button', {
    class: 'linkish', text: '重置',
    onclick: () => {
      S.unified = new Set([1, 0]); S.death = new Set(['normal', 'violent', 'unknown']);
      S.onlyFounder = S.onlyLast = S.onlyAlchemy = false;
      S.eras = new Set(ERAS.map((e) => e.key)); S.titles = new Set(['帝', '天王', '汗', '王', '公', '侯', '子', '卿', '伯']);
      S.includeNominal = false; S.looseUnified = false; S.yearFrom = S.yearTo = null;
      render();
    },
  }));
  const cnt = h('span', { class: 'filter-count', id: 'filter-count' });
  row.appendChild(cnt);
  if (themeBtnRef) row.appendChild(themeBtnRef);   // 深色开关驻常驻筛选条尾（index 的「设置」）
  host.appendChild(row);
  row.scrollTop = prevScroll;
}

// ── 版块定义 ─────────────────────────────────────────────────────────────
// when：可选谓词，仅在当前状态满足时才显示该控件（如泳道专属选项）
const sel = (key, label, options, when) => ({ type: 'select', key, label, options, when });
const tog = (key, label, when) => ({ type: 'toggle', key, label, when });
// 只有两三个选项时用分段器而非下拉：下拉把另一个选项藏起来，读者得先点开
// 才知道有得选，换一次要两下；分段器两个都摆在明面上，换一次一下。
let themeBtnRef = null;   // 深色开关的活节点：谁建「设置」块谁把它接走（2026-08-22 统一令）
const seg = (key, label, options, when) => ({ type: 'seg', key, label, options, when });
// 连续量用滑杆。时间缩放本来给的是三档预设，可「多宽算合适」取决于屏宽与
// 你正在看哪一段，三档常常没有一档正好；滑杆让读者自己定，并且看得见量纲。
const rng = (key, label, { min, max, step = 1, fmt }, when) =>
  ({ type: 'range', key, label, min, max, step, fmt, when });
// 设置折叠块:低频开关收进来,与地图页「设置」同一形态。改一次管很久的叠加
// 不值得常驻工具条——窄屏上它们会把条杆挤断行。
const grp = (label, items) => ({ type: 'group', label, items });

// 点外面即合（2026-08-26 库主令：设置开态浮层化，零位移）：浮层不再撑开条杆，
// 也就不再有「它还开着」的体感，不给一条自然的关法它会一直悬着盖住底下的控件。
// 只挂一次全局监听：buildControls 每次 render 都重建 details 节点，逐节点挂会
// 随重建次数累积同样多份。判断用 closest 而非节点比对——点浮层里的开关会触发
// render()，事件冒到 document 时 e.target 已是被换掉的旧节点，跟活节点比对必然
// 不相等、于是刚点完就把浮层关掉；只问「这一下落在某个 .lc-set 里吗」就没这毛病。
// 点 summary 自身同样命中 closest 而放行，故与 details 原生开合不打架：
// 开的那一下不会被同一次点击立刻关回去。
// 浮层落位（库主 2026-09-03 手机实测「设置在手机上容易被切断」）：CSS 默认 right:0 右对齐，
// 是按「设置惯在条杆右端」写的；窄屏上条杆折行后「设置」落在左端，右对齐的浮层就整块
// 甩出视口左缘。开的那一下量一次：右对齐探出左缘就改左对齐，左对齐再探出右缘就贴着视口摆。
// 齿轮弹层里内层体是 static（见 styles.css section.lc-open 例外），不归这里管。
function placeLcSetBody(det) {
  const body = det.querySelector('.lc-set-body');
  if (!body || getComputedStyle(body).position !== 'absolute') return;
  body.style.left = ''; body.style.right = '';
  const vw = document.documentElement.clientWidth, pad = 8;
  const r = det.getBoundingClientRect(), w = body.getBoundingClientRect().width;
  if (r.right - w >= pad) return;                       // 右对齐放得下，照旧
  body.style.right = 'auto'; body.style.left = '0';
  const over = r.left + w - (vw - pad);
  if (over > 0) body.style.left = `${-Math.min(over, Math.max(0, r.left - pad))}px`;
}
let lcSetCloserBound = false;
function bindLcSetOutsideClose() {
  if (lcSetCloserBound) return;
  lcSetCloserBound = true;
  document.addEventListener('click', (e) => {
    if (e.target?.closest?.('details.lc-set')) return;
    const open = document.querySelectorAll('details.lc-set[open]');
    if (!open.length) return;
    for (const det of open) det.open = false;
    S._lcSetOpen = false;   // toggle 事件是异步的，render() 可能先读到，故当场同步
  });
}

function buildControls(sec) {
  const wrap = h('div', { class: 'local-controls' });
  for (const c of sec.controls) {
    if (c.when && !c.when(S)) continue;
    if (c.type === 'group') {
      const det = h('details', { class: 'pl-settings lc-set' });
      // render() 每改一个开关就整条重建;不记开合状态的话,勾一下块就合上了
      if (S._lcSetOpen) det.open = true;
      det.addEventListener('toggle', () => { S._lcSetOpen = det.open; if (det.open) placeLcSetBody(det); });
      bindLcSetOutsideClose();
      det.appendChild(h('summary', { text: c.label }));
      const inner = buildControls({ controls: c.items });   // 递归复用同一台机器
      inner.classList.add('lc-set-body');
      if (c.label === '设置' && themeBtnRef) inner.appendChild(themeBtnRef);   // 深色开关入住
      det.appendChild(inner);
      wrap.appendChild(det);
      continue;
    }
    if (c.type === 'select') {
      const s = h('select');
      for (const [v, lab] of c.options) {
        const o = h('option', { value: String(v), text: lab });
        if (String(S[c.key]) === String(v)) o.selected = true;
        s.appendChild(o);
      }
      s.addEventListener('change', () => {
        const raw = s.value;
        S[c.key] = /^-?\d+$/.test(raw) ? +raw : raw;
        render();
      });
      wrap.appendChild(h('label', {}, [h('span', { text: c.label }), s]));
    } else if (c.type === 'seg') {
      const boxSeg = h('div', { class: 'segctl', role: 'radiogroup', 'aria-label': c.label });
      for (const [v, lab] of c.options) {
        const on = String(S[c.key]) === String(v);
        boxSeg.appendChild(h('button', {
          type: 'button', class: `seg${on ? ' on' : ''}`, role: 'radio', 'aria-checked': String(on),
          text: lab,
          onclick: () => { S[c.key] = /^-?\d+$/.test(String(v)) ? +v : v; render(); },
        }));
      }
      wrap.appendChild(h('label', { class: 'seg-label' }, [h('span', { text: c.label }), boxSeg]));
    } else if (c.type === 'range') {
      const out = h('span', { class: 'rng-val', text: c.fmt(S[c.key]) });
      const r = h('input', {
        type: 'range', class: 'rng', min: String(c.min), max: String(c.max), step: String(c.step),
        'aria-label': c.label,
      });
      r.value = String(S[c.key]);
      // 拖动途中只改读数、不重绘：render() 会把整条控件行重建，滑块节点当场
      // 被换掉，手指还按着但拖的已经是个不存在的元素——表现为「拖一下就脱手」。
      // 松手（change）才重绘；键盘方向键两个事件都发，照样即时生效。
      r.addEventListener('input', () => { out.textContent = c.fmt(+r.value); });
      r.addEventListener('change', () => { S[c.key] = +r.value; render(); });
      wrap.appendChild(h('label', { class: 'rng-label' }, [h('span', { text: c.label }), r, out]));
    } else if (c.type === 'toggle') {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = !!S[c.key];
      cb.addEventListener('change', () => { S[c.key] = cb.checked; render(); });
      wrap.appendChild(h('label', {}, [cb, h('span', { text: c.label })]));
    } else if (c.type === 'multi') {
      const box = h('div', { class: 'fgroup' }, [h('span', { class: 'flabel', text: c.label })]);
      for (const [v, lab] of c.options) {
        const on = S[c.key].includes(v);
        box.appendChild(chip(lab, on, () => {
          const arr = S[c.key];
          const i = arr.indexOf(v);
          // min0：允许全取掉（大事记档位「全关＝无大事记」）；不带此旗的照旧至少留一项
          if (i >= 0) { if (c.min0 || arr.length > 1) arr.splice(i, 1); } else arr.push(v);
          render();
        }));
      }
      wrap.appendChild(box);
    } else if (c.type === 'search') {
      const inp = h('input', { type: 'search', placeholder: '姓名 / 庙号 / 朝代 / 备注', style: 'width:240px' });
      inp.value = S[c.key];
      inp.addEventListener('input', () => { S[c.key] = inp.value; renderOne(sec); });
      wrap.appendChild(h('label', {}, [h('span', { text: c.label }), inp]));
    }
  }
  return wrap;
}

// ── 概览统计 ─────────────────────────────────────────────────────────────
function renderHero(host, list) {
  host.innerHTML = '';
  const ages = list.map((e) => e.lifespan).filter((v) => v !== null);
  const st = describe(ages);
  const withCause = list.filter((e) => e.violent !== null);
  const vio = withCause.filter((e) => e.violent === 1).length;
  const reigns = list.map((e) => e.reignYears).filter((v) => v !== null && isFinite(v));
  const rst = describe(reigns);
  const oldest = list.filter((e) => e.lifespan !== null).sort((a, b) => b.lifespan - a.lifespan)[0];
  const stats = [
    { v: String(list.length), l: '收录君主', s: `其中 ${ages.length} 位生卒年可考` },
    { v: st.n ? st.mean.toFixed(1) : '—', l: '平均享年（岁）', s: st.n ? `中位数 ${st.median.toFixed(0)}` : '' },
    { v: withCause.length ? `${((vio / withCause.length) * 100).toFixed(0)}%` : '—', l: '非正常死亡比例', s: `${vio} / ${withCause.length} 位死因可判` },
    { v: rst.n ? rst.median.toFixed(1) : '—', l: '中位在位年数', s: rst.n ? `均值 ${rst.mean.toFixed(1)}` : '' },
    { v: oldest ? String(Math.floor(oldest.lifespan)) : '—', l: '最长寿（岁）', s: oldest ? oldest.temple : '' },
  ];
  for (const s of stats) {
    host.appendChild(h('div', { class: 'stat' }, [
      h('div', { class: 'value', text: s.v }),
      h('div', { class: 'label', text: s.l }),
      h('div', { class: 'sub', text: s.s }),
    ]));
  }
}

// ── 上下节导航条 ─────────────────────────────────────────────────────────
/**
 * 窄屏上的顶／底两条固定条。它们身兼二职：
 *
 *   1. **上下节跳转。** 手机一屏只有 812px，而竖向河流整节上万像素、跨文明比较 2.8 屏。
 *      读者若对当前一节不感兴趣，不该只能一路划过去；目录能跳，但要先滑回页首才够得着。
 *   2. **保证能起滑的安全区。** 河流铺满整屏，屏上到处都是可点的君主段，
 *      手指没有一处「一定不会点中什么」的地方可落。这两条固定区就是那块地方——
 *      除箭头外一律留空，不放任何其他功能，正是为了让它们始终可以安全地起滑。
 *
 * 只在「本节超过 1.5 屏、且还剩不止一屏没读」时出现，否则就是两块常驻挡板。
 * 首节没有「上一节」，此时上行退回页首。
 */
function setupSectionNav() {
  const mk = (cls) => {
    const btn = h('button', { class: 'sn-btn', type: 'button' });
    const bar = h('div', { class: `sec-nav ${cls}` }, [btn]);
    document.body.appendChild(bar);
    return { bar, btn, label: null };
  };
  const up = mk('up'), down = mk('down');
  const ids = PAGE_SECTIONS.map((s) => s.id);
  const narrow = matchMedia('(max-width: 720px)');
  let raf = null;

  // 窄屏「设置」入口（库主 2026-09-03：把设置放在这条上，好让人在河中间也够得到）：
  // 钉在「回到页首」右侧的齿轮，点开把**当前节**的控件簇整块浮成弹层（section.lc-open，
  // 窄屏样式见 styles.css 719px 段；宽屏本来就有同名规则）。簇里的「设置」折叠组在弹层内
  // 走 static 内层体，不会再被视口边裁掉。点弹层外任意处、或黑条收起时，弹层随之收。
  let curSec = null;
  const closeLc = () => { for (const s of document.querySelectorAll('section.lc-open')) s.classList.remove('lc-open'); };
  const gear = h('button', { class: 'sn-gear', type: 'button', text: '⚙', title: '本节设置', 'aria-label': '本节设置' });
  gear.onclick = (e) => {
    // 不让这一下冒到 document：页上另有「点空处收起」一族的全局监听，会把刚开的弹层当场关掉
    e.stopPropagation();
    if (!curSec) return;
    const on = curSec.classList.contains('lc-open');
    closeLc();
    if (!on) curSec.classList.add('lc-open');
  };
  up.bar.appendChild(gear);
  document.addEventListener('click', (e) => {
    if (!document.querySelector('section.lc-open')) return;
    if (e.target instanceof Element && (e.target.closest('.sn-gear') || e.target.closest('.local-controls'))) return;
    closeLc();
  });

  const set = (o, text, go) => {
    if (o.label !== text) { o.label = text; o.btn.textContent = text; o.btn.onclick = go; }
    o.bar.classList.add('on');
  };
  const hide = (o) => { o.bar.classList.remove('on'); o.label = null; if (o === up) closeLc(); };
  const jump = (id) => () => (id
    ? document.getElementById(id).scrollIntoView({ block: 'start' })
    : scrollTo({ top: 0, behavior: 'smooth' }));

  const update = () => {
    raf = null;
    // 宽屏直接退出：这个判定要对每一节做 getBoundingClientRect，
    // 挂在滚动上逐帧跑会白白引发布局计算，而按钮在宽屏本来就被 CSS 隐藏
    if (!narrow.matches) { hide(up); hide(down); return; }
    const vh = window.innerHeight;
    let idx = -1;
    // 「当前这一节」＝跨过视口中线的那一节，比用 top 判断稳定得多
    for (let i = 0; i < ids.length; i++) {
      const r = document.getElementById(ids[i]).getBoundingClientRect();
      if (r.top < vh * 0.5 && r.bottom > vh * 0.5) { idx = i; break; }
    }
    const r = idx >= 0 ? document.getElementById(ids[idx]).getBoundingClientRect() : null;
    if (!r || r.height <= vh * 1.5) { hide(up); hide(down); return; }
    // 齿轮只在当前节真有控件簇时现身；换了节就把上一节的弹层收掉
    const sec = document.getElementById(ids[idx]);
    if (sec !== curSec) { closeLc(); curSec = sec; }
    gear.style.display = sec.querySelector('.local-controls') ? '' : 'none';

    const short = (i) => PAGE_SECTIONS[i].title.split('：')[0];
    if (r.top < -vh * 0.4) {
      set(up, idx > 0 ? `↑ 上一节 · ${short(idx - 1)}` : '↑ 回到页首', jump(idx > 0 ? ids[idx - 1] : null));
    } else hide(up);
    if (idx + 1 < ids.length && r.bottom > vh * 1.4) {
      set(down, `↓ 跳过本节 · ${short(idx + 1)}`, jump(ids[idx + 1]));
    } else hide(down);
  };
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
  addEventListener('resize', update);
  update();
  return update;
}

let HERO = null;

// ── 渲染 ─────────────────────────────────────────────────────────────────
let hostMap = new Map();
function renderOne(sec) {
  const list = filtered();
  // setOpt 让视图能提供「一键修正」（例如风险集退化时把条件起点设回 15 岁）
  const opts = { ...S, looseUnified: S.looseUnified, setOpt: (k, v) => { S[k] = v; render(); } };
  const host = hostMap.get(sec.id);
  try {
    sec.render(host.chart, list, opts);
  } catch (err) {
    host.chart.innerHTML = '';
    host.chart.appendChild(h('p', { class: 'muted', text: `该图在当前筛选下无法绘制：${err.message}` }));
    console.error(sec.id, err);
    (window.__RENDER_ERRS__ = window.__RENDER_ERRS__ || []).push(sec.id + ' :: ' + err.stack);
  }
}
// 本次渲染是否发生在后台页签:隐藏页签里的布局测量不可靠(实测出过 207px
// 的挤扁渲染),回到前台时按此标记决定要不要整页重绘
let renderedWhileHidden = false;
function render() {
  renderedWhileHidden = document.visibilityState === 'hidden';
  const list = filtered();
  const fHost = document.getElementById('filters');
  if (fHost) {
    buildFilters(fHost);
    document.getElementById('filter-count').textContent = `当前样本 ${list.length} 位`;
  }
  if (HERO) renderHero(document.getElementById('hero'), list);
  for (const sec of PAGE_SECTIONS) {
    const host = hostMap.get(sec.id);
    host.ctrl.innerHTML = '';
    host.ctrl.appendChild(buildControls(sec));
    renderOne(sec);
  }
}

let PAGE_SECTIONS = [];

/**
 * 挂载一张页面。`sections` 为该页自己的章节表;`hero` 为可选的页首统计条。
 */
export function mountApp({ sections, hero }) {
  PAGE_SECTIONS = sections;
  HERO = hero || null;
  // 全宽出血的安全宽度要在首次 render 之前写好：河流按 .chart-host 的实测宽度画布，
  // 若此时 --vw-safe 还是 100vw 回退值（含滚动条宽度），首屏就会画宽 8px
  document.documentElement.style
    .setProperty('--vw-safe', `${document.documentElement.clientWidth}px`);
  const main = document.getElementById('sections');
  const toc = document.getElementById('toc');
  // 只有一节的页面（全景页）不要目录：一个条目的目录跳不到别处，
  // 它只是把版块标题原样复述一遍，还在页首与正文之间垫出一行
  const wantToc = PAGE_SECTIONS.length > 1;
  if (!wantToc) toc.remove();
  // 目录点击后收起筛选面板：面板是覆盖式浮层，不收起会正好盖住刚跳到的标题
  else toc.addEventListener('click', () => { if (S.filtersOpen) { S.filtersOpen = false; render(); } });
  for (const sec of PAGE_SECTIONS) {
    if (wantToc) toc.appendChild(h('a', { href: `#${sec.id}`, text: sec.title.split('：')[0] }));
    const card = h('section', { class: 'card', id: sec.id });
    // 需求编号属于交付追溯，写在 README 的对照表里，不占版面
    const head = h('div', { class: 'head' }, [h('h2', { text: sec.title })]);
    card.appendChild(head);
    // 说明段可整段留空（全景页的介绍已并入页首 lede，框内只剩名称——用户定的版式）
    if (sec.desc) card.appendChild(h('p', { class: 'desc', text: sec.desc }));
    // 说明段可收起。窄一点的屏上,原先是**先牺牲知识卡**(角卡在 1199/999px
    // 以下一律隐藏),可那几段说明读过一遍就不必再占着地方,而卡是随时在用的。
    // 收起说明即把那片横向空间让给卡,于是卡的断点能往下挪三百多像素。
    // 只给带角卡的那一节加(全景页),统计页的说明没有卡跟它争地方。
    if (sec.id === 'panorama' && sec.desc) {
      const key = `il.desc.${sec.id}`;
      const btn = h('button', { class: 'chip desc-toggle', type: 'button' });
      const sync = () => {
        const full = card.classList.contains('desc-full');
        btn.textContent = full ? '收起说明' : '展开说明';
        btn.setAttribute('aria-expanded', String(full));
      };
      btn.addEventListener('click', () => {
        card.classList.toggle('desc-full');
        try { localStorage.setItem(key, card.classList.contains('desc-full') ? '1' : '0'); } catch { /* 隐私模式 */ }
        sync();
        dispatchEvent(new Event('resize'));   // 让角卡与图重新量宽
      });
      let saved = null;
      try { saved = localStorage.getItem(key); } catch { /* 同上 */ }
      if (saved === '1') card.classList.add('desc-full');
      sync();
      head.appendChild(btn);
    }
    const ctrl = h('div', { class: 'sec-ctrls' });   // 有名字才能在 CSS 里给角卡让位
    const chart = h('div', { class: 'chart-host' });
    // 全景节：控制列与知识卡区并排一行**同在文档流**——卡从浮层降为排版元素，
    // 结构上不可能遮任何控件（用户定案：与其追补让位断点，不如消除遮蔽本身）
    if (sec.id === 'panorama') {
      card.appendChild(h('div', { class: 'ctrl-row' }, [ctrl, h('div', { class: 'kp-zone' })]));
    } else card.appendChild(ctrl);
    card.appendChild(chart);
    main.appendChild(card);
    hostMap.set(sec.id, { ctrl, chart });
  }
  render();

  // 锚点让位高度跟着吸顶过滤器的真实高度走。展开的面板是绝对定位的浮层，
  // 不撑高 .filters，因此这个值在展开/收起之间保持恒定——正是要的效果。
  const filters = document.getElementById('filters');
  const syncFiltersH = () => {
    if (!filters) {
      // 无筛选器的页面(全景页):锚点让位只需一点顶部余量
      document.documentElement.style.setProperty('--filters-h', '8px');
      document.documentElement.style
        .setProperty('--vw-safe', `${document.documentElement.clientWidth}px`);
      return;
    }
    document.documentElement.style
      .setProperty('--filters-h', `${Math.round(filters.getBoundingClientRect().height)}px`);
    // 全宽出血的安全宽度＝视口减竖向滚动条。100vw 含滚动条宽度，直接用会挤出横滚
    document.documentElement.style
      .setProperty('--vw-safe', `${document.documentElement.clientWidth}px`);
  };
  if (filters) new ResizeObserver(syncFiltersH).observe(filters);
  else addEventListener('resize', syncFiltersH);
  syncFiltersH();

  // 面板外轻点即收起（浮层盖住的是正文，用户下一步多半是想读正文）
  document.addEventListener('pointerdown', (e) => {
    if (!S.filtersOpen) return;
    if (e.target instanceof Element && e.target.closest('.filters')) return;
    S.filtersOpen = false; render();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.filtersOpen) { S.filtersOpen = false; render(); }
  });

  const refreshNav = setupSectionNav();

  // 视口宽度变了要重绘：Frame 是按宿主实测宽度布局的，不重绘就停在旧尺寸。
  // 只认宽度——手机上地址栏伸缩会不停触发 resize，但那只改高度，不该重画整页。
  let lastW = window.innerWidth, rzTimer = null;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(rzTimer);
    rzTimer = setTimeout(() => { render(); refreshNav(); }, 180);
  });

  // 后台页签回来时的自愈。切去别的页签再回来,页面常显得「卡住」:浏览器
  // 节流后台页签的定时器、停掉 rAF,页签冻结后滚动联动的 UI(标签吸附、
  // 纪年滑杆、知识卡)停在旧态;更糟的是在后台发生的渲染可能量错宽度。
  // 回到前台:若上次渲染发生在后台,整页重绘;若河流图的逻辑宽度与容器
  // 实测宽度对不上(挤扁渲染的指纹),同样重绘;否则只踢一下 scroll/resize,
  // 让各处监听器就地醒来——resize 踢不动整页重绘,宽度门控会拦住它
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const chart = document.querySelector('#panorama .chart-host');
    const riverSvg = chart && chart.querySelector('.river-svg');
    const hostW = chart ? chart.getBoundingClientRect().width : 0;
    const squeezed = riverSvg && hostW > 0
      && Math.abs(riverSvg.viewBox.baseVal.width - hostW) > 48;
    if (renderedWhileHidden || squeezed) {
      render();
      refreshNav();
    } else {
      dispatchEvent(new Event('resize'));
      dispatchEvent(new Event('scroll'));
    }
  });

  // 主题切换（节点引用存模块级 themeBtnRef——重建筛选条/设置块时靠它搬回，见 buildControls/buildFilters）
  const tt = document.getElementById('theme-toggle');
  themeBtnRef = tt;
  // 偏好持久化（2026-09-04，与故事线页共用 localStorage 'il-theme'）：有存值就套上，按钮字随之
  try {
    const saved = localStorage.getItem('il-theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  } catch { /* 隐私模式 */ }
  {
    const cur0 = document.documentElement.getAttribute('data-theme');
    const dark0 = cur0 === 'dark' || (!cur0 && matchMedia('(prefers-color-scheme: dark)').matches);
    tt.textContent = dark0 ? '☀ 浅色' : '🌙 深色';
  }
  // 首屏收编：绑定晚于首次建块，此刻主动搬家一次（此后每次重建由建块方接手）
  const home = document.querySelector('.pl-settings .lc-set-body') || document.getElementById('filters-panel');
  if (home) home.appendChild(tt);
  tt.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark' : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('il-theme', next); } catch { /* 隐私模式 */ }
    tt.textContent = next === 'dark' ? '☀ 浅色' : '🌙 深色';
    render();
  });
}

export { S, filtered, render, sel, seg, rng, tog, grp };
window.__DB__ = { EMPERORS, DYNASTIES, DYN_STATS, S, filtered };
