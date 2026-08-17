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
  titles: new Set(['帝', '天王', '汗']),     // 默认不含仅称「王」者
  includeNominal: false,
  looseUnified: false,
  yearFrom: null, yearTo: null,

  timelineMode: 'dual', timelineSort: 'birth',
  // 全景视图的两种读法：竖向河流（顺着页面滚，看分裂的形状）与横向泳道（看谁在何时统治）。
  // 默认按屏宽选：手机竖屏顺着拇指的方向读河流；宽屏一屏并列看得到更多政权，泳道更强。
  panoramaMode: matchMedia('(max-width: 720px)').matches ? 'river' : 'lanes',
  riverPx: 7,
  lanePx: 14, laneColor: 'dynasty', laneViolent: true, laneStrands: false, laneEvents: true, evOff: [],
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
  if (dotColor) { const d = h('span', { class: 'il-dot' }); d.style.background = dotColor; b.appendChild(d); }
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

  const set = (o, text, go) => {
    if (o.label !== text) { o.label = text; o.btn.textContent = text; o.btn.onclick = go; }
    o.bar.classList.add('on');
  };
  const hide = (o) => { o.bar.classList.remove('on'); o.label = null; };
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
  // 目录点击后收起筛选面板：面板是覆盖式浮层，不收起会正好盖住刚跳到的标题
  toc.addEventListener('click', () => { if (S.filtersOpen) { S.filtersOpen = false; render(); } });
  for (const sec of PAGE_SECTIONS) {
    toc.appendChild(h('a', { href: `#${sec.id}`, text: sec.title.split('：')[0] }));
    const card = h('section', { class: 'card', id: sec.id });
    // 需求编号属于交付追溯，写在 README 的对照表里，不占版面
    const head = h('div', { class: 'head' }, [h('h2', { text: sec.title })]);
    card.appendChild(head);
    const desc = h('p', { class: 'desc', text: sec.desc });
    card.appendChild(desc);
    // 说明段可收起。窄一点的屏上,原先是**先牺牲知识卡**(角卡在 1199/999px
    // 以下一律隐藏),可那几段说明读过一遍就不必再占着地方,而卡是随时在用的。
    // 收起说明即把那片横向空间让给卡,于是卡的断点能往下挪三百多像素。
    // 只给带角卡的那一节加(全景页),统计页的说明没有卡跟它争地方。
    if (sec.id === 'panorama') {
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

export { S, filtered, render, sel, tog };
window.__DB__ = { EMPERORS, DYNASTIES, DYN_STATS, S, filtered };
