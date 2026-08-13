// app.js — 状态、一级过滤器、版块编排
import { h } from './charts.js';
import { EMPERORS, DYNASTIES, DYN_STATS, GROUPINGS, COVARIATES } from './data.js';
import { ERAS } from './dynasties.js';
import { describe, fmtP } from './stats.js';
import { renderTimeline, renderHistoryScatter, renderHeatmap } from './views-time.js';
import { renderLaneTimeline } from './views-lanes.js';
import { renderKM, renderCIF, renderCox } from './views-survival.js';
import { renderBox, renderDSI, renderHypotheses, renderDatabase, renderAudit } from './views-compare.js';
import { renderCiv } from './views-civ.js';

// ── 状态 ─────────────────────────────────────────────────────────────────
const S = {
  unified: new Set([1, 0]),                 // 大一统 / 分裂
  death: new Set(['normal', 'violent', 'unknown']),
  onlyFounder: false, onlyLast: false, onlyAlchemy: false,
  eras: new Set(ERAS.map((e) => e.key)),
  titles: new Set(['帝', '天王', '汗']),     // 默认不含仅称「王」者
  includeNominal: false,
  looseUnified: false,
  yearFrom: null, yearTo: null,

  timelineMode: 'dual', timelineSort: 'birth',
  lanePx: 10, laneColor: 'dynasty', laneViolent: true,
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
  if (dotColor) { const d = h('span', { class: 'dot' }); d.style.background = dotColor; b.appendChild(d); }
  if (active) b.appendChild(h('span', { class: 'check', text: '✓' }));
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
  if (S.titles.size !== 3 || !['帝', '天王', '汗'].every((t) => S.titles.has(t))) on.push('入库范围');
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
  row.appendChild(g4);

  const g5 = h('div', { class: 'fgroup' }, [h('span', { class: 'flabel', text: '入库范围' })]);
  for (const t of ['帝', '天王', '汗', '王']) {
    g5.appendChild(chip(t === '帝' ? '皇帝' : t === '王' ? '仅称王者' : t, S.titles.has(t), () => { toggleIn(S.titles, t); render(); }));
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
      S.eras = new Set(ERAS.map((e) => e.key)); S.titles = new Set(['帝', '天王', '汗']);
      S.includeNominal = false; S.looseUnified = false; S.yearFrom = S.yearTo = null;
      render();
    },
  }));
  const cnt = h('span', { class: 'filter-count', id: 'filter-count' });
  row.appendChild(cnt);
  host.appendChild(row);
  row.scrollTop = prevScroll;
}

// ── 版块定义 ─────────────────────────────────────────────────────────────
// when：可选谓词，仅在当前状态满足时才显示该控件（如泳道专属选项）
const sel = (key, label, options, when) => ({ type: 'select', key, label, options, when });
const tog = (key, label, when) => ({ type: 'toggle', key, label, when });

const SECTIONS = [
  {
    // 全景图放在最前：先建立「谁在什么时候统治、天下有多分裂」的历史坐标，
    // 后面的生存曲线与回归才有可解读的背景。
    id: 'panorama', title: '王朝全景：横向泳道时间轴',
    desc: '把朝代做成横向长带、皇帝做成带内分段，横向滚动即为时间流逝。泳道可回收——某朝终结后该行即被后来的政权接管，于是同一时刻占用的行数就是当时并存的政权数：大一统年代只有一两行有色块，五代十国、十六国则行行占满。第一行为正统序列专用，第二行是与之并行的北方政权主线。',
    controls: [
      sel('lanePx', '时间缩放', [[10, '标准 10 px/年'], [6, '紧凑 6 px/年'], [14, '舒展 14 px/年']]),
      sel('laneColor', '配色', [['dynasty', '按具体朝代'], ['unified', '按大一统 / 分裂']]),
      tog('laneViolent', '标记非正常死亡'),
    ],
    render: renderLaneTimeline,
  },
  {
    id: 'timeline', title: '时间轴：每位皇帝的寿命与统治期',
    desc: '上一节看政权，这一节看个人：每行一位皇帝，细线＝出生到死亡的完整寿命，粗块＝在位期间，一眼读出登基年龄、在位长短、是否早逝。颜色沿用全局语义：蓝＝大一统，橙＝分裂。',
    controls: [
      sel('timelineMode', '显示', [['dual', '双层（寿命＋统治）'], ['life', '仅寿命时间轴'], ['reign', '仅统治时间轴']]),
      sel('timelineSort', '排序', [['birth', '按出生年'], ['life', '按寿命降序'], ['reign', '按在位年数降序']]),
    ],
    render: renderTimeline,
  },
  {
    id: 'scatter', title: '中国历史总时间轴：寿命的长期走势',
    desc: '横轴为出生年（出生队列），纵轴为享年，每点一位皇帝。两条移动平均线分别给出大一统与分裂时期的寿命趋势，背景分带标出时代。五代十国、南北朝、唐末等高风险时段的低寿命聚集在此一目了然。',
    controls: [sel('scatterX', '横轴', [['birth', '出生年'], ['acc', '登基年']])],
    render: renderHistoryScatter,
  },
  {
    id: 'km', title: 'Kaplan–Meier 生存曲线',
    desc: '本项目的核心图表。默认以「登基后年数」为时间轴——每位皇帝都从 t=0 进入，没有截断问题，直接回答「坐上龙椅之后还能活多久」。切到年龄尺度时采用左截断（自登基年龄进入风险集）并以满 15 岁为条件起点，否则襁褓即位者会让低龄段的风险集只剩一两人。',
    controls: [
      sel('kmGroup', '分组变量', Object.entries(GROUPINGS).map(([k, v]) => [k, v.label])),
      sel('kmScale', '时间轴', [['reign', '登基后年数'], ['age', '年龄（左截断）']]),
      sel('kmFromAge', '条件起点年龄', [[15, '满 15 岁'], [0, '不设条件'], [10, '满 10 岁'], [20, '满 20 岁']]),
      tog('kmCensorAbd', '退位时删失（仅在位尺度）'),
      tog('kmCI', '显示 95% 置信带'),
    ],
    render: renderKM,
  },
  {
    id: 'cif', title: '竞争风险：被杀 vs 病死的累积发生率',
    desc: '「皇帝短命，究竟源于健康问题还是政治风险？」——把死亡拆成两个互相竞争的终点，用 Aalen–Johansen 估计量分别给出累积发生率。把非正常死亡当作删失处理是常见错误，会系统性高估自然死亡风险。',
    controls: [
      sel('cifScale', '时间轴', [['age', '年龄'], ['reign', '登基后年数']]),
      sel('kmFromAge', '条件起点年龄', [[15, '满 15 岁'], [0, '不设条件'], [10, '满 10 岁'], [20, '满 20 岁']]),
    ],
    render: renderCIF,
  },
  {
    id: 'box', title: '箱线图：分组分布比较',
    desc: '均值、中位数、四分位与离群值的直接比较。箱线图刻画的是「死亡年龄的横截面分布」，不处理删失与左截断，因此它用于描述，正式推断以生存曲线与 Cox 模型为准。',
    controls: [
      sel('boxGroup', '分组变量', Object.entries(GROUPINGS).map(([k, v]) => [k, v.label])),
      sel('boxMetric', '指标', [['lifespan', '享年'], ['accAge', '登基年龄'], ['reignYears', '在位年数']]),
    ],
    render: renderBox,
  },
  {
    id: 'dsi', title: 'DSI 散点图：王朝越稳定，皇帝越长寿？',
    desc: 'DSI（Dynasty Stability Index）＝ 王朝总年数 ÷ 皇帝人数，衡量平均每位皇帝「撑起」多少年国祚。西汉 210/15 ≈ 14，北齐 28/6 ≈ 4.7。默认按王朝层面作图以避免伪重复。',
    controls: [
      sel('dsiLevel', '分析层面', [['dynasty', '王朝层面（推荐）'], ['emperor', '个体层面（伪重复）']]),
      sel('dsiMinN', '最少皇帝数', [[2, '≥2 位'], [1, '≥1 位'], [4, '≥4 位']]),
    ],
    render: renderDSI,
  },
  {
    id: 'heat', title: '热力图：年代 × 寿命区间 × 人数密度',
    desc: '横轴为出生年代（每百年一格），纵轴为享年区间，颜色深浅表示落入该格的皇帝人数。开启分面后，大一统与分裂两组各用一条单色相色阶（蓝／橙），共用同一比例尺，可直接比较密度分布的重心位置。',
    controls: [tog('heatFacet', '按大一统 / 分裂分面')],
    render: renderHeatmap,
  },
  {
    id: 'cox', title: 'Cox 比例风险模型：哪些因素真正提高死亡风险',
    desc: '同时控制多个因素，输出风险比 HR。HR＞1 表示提高死亡风险，＜1 表示保护作用。模型采用 Efron 结法处理同年死亡的并列，并以 (start, stop] 区间实现左截断。下方给出 Schoenfeld 残差对比例风险假定的诊断。',
    controls: [
      sel('coxScale', '时间轴', [['age', '年龄（左截断）'], ['reign', '登基后年数']]),
      sel('kmFromAge', '条件起点年龄', [[15, '满 15 岁'], [0, '不设条件'], [10, '满 10 岁'], [20, '满 20 岁']]),
      { type: 'multi', key: 'coxVars', label: '协变量', options: COVARIATES.map((c) => [c.key, c.label]) },
    ],
    render: renderCox,
  },
  {
    id: 'hyp', title: 'H1–H5：假说的即时检验',
    desc: '以下结论随上方筛选条件实时重算。每条假说都附上它自身的方法学软肋——数据能支持什么、不能支持什么，同样重要。',
    controls: [],
    render: renderHypotheses,
  },
  {
    id: 'civ', title: '跨文明比较：政治结构 → 统治风险',
    desc: '同一套口径下比较四个政体、五份名册。以「登基后生存」与「非正常死亡比例」为主判据——在位起讫与死亡方式各文明史料都记得牢，而生年普遍稀疏，本项目的主结论亦不依赖生年。域外骨架取自 Wikidata（CC0）并逐位锚定 QID，死亡方式的缺口人工补齐。日本单列天皇与幕府两份：天皇长期不掌实权，以其代表「日本君主的风险」有失真之虞，而将军才是 1185–1868 年间的实际执政者——两者同国同代、只差权力有无，构成本节最干净的一组对照。',
    controls: [],
    render: renderCiv,
  },
  {
    id: 'audit', title: '空档审计：朝代长带上的每一处悬空',
    desc: '横向泳道视图顺带提供了一个好用的质检信号：朝代长带上任何悬空的头、尾或中段，都意味着那段年份没有在位君主的记录。原因只有三种——该君主称帝前已掌权（本库记的是称帝日）、史上确实虚位、或漏收君主与日期有误。下表把三者逐条列清，使第三类不必靠肉眼在图上找。',
    controls: [],
    render: renderAudit,
  },
  {
    id: 'db', title: '数据库：全部记录',
    desc: '完整字段可查、可复制。0 值一律读作「无明确史料记载」，而非「确证不存在」。',
    controls: [{ type: 'search', key: 'dbQuery', label: '检索' }],
    render: renderDatabase,
  },
];

function buildControls(sec) {
  const wrap = h('div', { class: 'local-controls' });
  for (const c of sec.controls) {
    if (c.when && !c.when(S)) continue;
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
          if (i >= 0) { if (arr.length > 1) arr.splice(i, 1); } else arr.push(v);
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

// ── 跳到下一节 ───────────────────────────────────────────────────────────
/**
 * 窄屏上的「跳过本节」浮动按钮。
 *
 * 手机一屏只有 812px，而跨文明比较一节 2.8 屏、H1–H5 2.4 屏——读者若对当前一节
 * 不感兴趣，只能一路划过去。目录能跳，但要先滑回页首才够得着。
 *
 * 只在「本节确实长（>1.5 屏）且还剩不止一屏没读」时出现：否则它就是块常驻的挡板。
 * 不出现的时候连 DOM 都在，但 display:none——按钮文案要随目标节变化，
 * 每次重建反而更贵。
 */
function setupSectionSkip() {
  const btn = h('button', { class: 'skip-next', type: 'button' });
  document.body.appendChild(btn);
  const ids = SECTIONS.map((s) => s.id);
  let raf = null, shownFor = null;

  const narrow = matchMedia('(max-width: 720px)');
  const update = () => {
    raf = null;
    // 宽屏直接退出：这个判定要对每一节做 getBoundingClientRect，
    // 挂在滚动上逐帧跑会白白引发布局计算，而按钮在宽屏本来就被 CSS 隐藏
    if (!narrow.matches) { btn.classList.remove('on'); shownFor = null; return; }
    const vh = window.innerHeight;
    let idx = -1;
    // 「当前这一节」＝跨过视口中线的那一节，比用 top 判断稳定得多
    for (let i = 0; i < ids.length; i++) {
      const r = document.getElementById(ids[i]).getBoundingClientRect();
      if (r.top < vh * 0.5 && r.bottom > vh * 0.5) { idx = i; break; }
    }
    const next = idx >= 0 ? ids[idx + 1] : null;
    const r = idx >= 0 ? document.getElementById(ids[idx]).getBoundingClientRect() : null;
    const worth = next && r && r.height > vh * 1.5 && r.bottom > vh * 1.4;
    if (!worth) { btn.classList.remove('on'); shownFor = null; return; }
    if (shownFor !== next) {
      shownFor = next;
      btn.textContent = `跳过本节 · ${SECTIONS[idx + 1].title.split('：')[0]} ↓`;
      btn.onclick = () => document.getElementById(next).scrollIntoView({ block: 'start' });
    }
    btn.classList.add('on');
  };
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
  addEventListener('resize', update);
  update();
  return update;
}

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
  }
}
function render() {
  const list = filtered();
  buildFilters(document.getElementById('filters'));
  document.getElementById('filter-count').textContent = `当前样本 ${list.length} 位`;
  renderHero(document.getElementById('hero'), list);
  for (const sec of SECTIONS) {
    const host = hostMap.get(sec.id);
    host.ctrl.innerHTML = '';
    host.ctrl.appendChild(buildControls(sec));
    renderOne(sec);
  }
}

function boot() {
  const main = document.getElementById('sections');
  const toc = document.getElementById('toc');
  // 目录点击后收起筛选面板：面板是覆盖式浮层，不收起会正好盖住刚跳到的标题
  toc.addEventListener('click', () => { if (S.filtersOpen) { S.filtersOpen = false; render(); } });
  for (const sec of SECTIONS) {
    toc.appendChild(h('a', { href: `#${sec.id}`, text: sec.title.split('：')[0] }));
    const card = h('section', { class: 'card', id: sec.id });
    // 需求编号属于交付追溯，写在 README 的对照表里，不占版面
    card.appendChild(h('div', { class: 'head' }, [h('h2', { text: sec.title })]));
    card.appendChild(h('p', { class: 'desc', text: sec.desc }));
    const ctrl = h('div');
    const chart = h('div', { class: 'chart-host' });
    card.appendChild(ctrl); card.appendChild(chart);
    main.appendChild(card);
    hostMap.set(sec.id, { ctrl, chart });
  }
  render();

  // 锚点让位高度跟着吸顶过滤器的真实高度走。展开的面板是绝对定位的浮层，
  // 不撑高 .filters，因此这个值在展开/收起之间保持恒定——正是要的效果。
  const filters = document.getElementById('filters');
  const syncFiltersH = () => document.documentElement.style
    .setProperty('--filters-h', `${Math.round(filters.getBoundingClientRect().height)}px`);
  new ResizeObserver(syncFiltersH).observe(filters);
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

  const refreshSkip = setupSectionSkip();

  // 视口宽度变了要重绘：Frame 是按宿主实测宽度布局的，不重绘就停在旧尺寸。
  // 只认宽度——手机上地址栏伸缩会不停触发 resize，但那只改高度，不该重画整页。
  let lastW = window.innerWidth, rzTimer = null;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(rzTimer);
    rzTimer = setTimeout(() => { render(); refreshSkip(); }, 180);
  });

  // 主题切换
  const tt = document.getElementById('theme-toggle');
  tt.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark' : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', next);
    tt.textContent = next === 'dark' ? '☀ 浅色' : '🌙 深色';
    render();
  });
}

window.__DB__ = { EMPERORS, DYNASTIES, DYN_STATS, S, filtered };
boot();
