// views-compare.js — 箱线图、DSI 散点、假说检验面板、数据库表
import { el, h, linear, band, ticks, Frame, hoverable, legend, tableView, notes, fmt1, fmt2 } from './charts.js';
import { GROUPINGS, DYN_STATS, survivalInput, EMPERORS, DYNASTIES } from './data.js';
import { describe, welch, mannWhitney, spearman, linreg, bootstrapMeanCI, kaplanMeier, logRank, coxPH, fmtP } from './stats.js';
import { fmtDate, FLAG_LABEL } from './schema.js';

const SLOTS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];

// ── 7. 箱线图 ────────────────────────────────────────────────────────────
export function renderBox(host, list, opts) {
  host.innerHTML = '';
  const gkey = opts.boxGroup || 'unified';
  const metric = opts.boxMetric || 'lifespan';
  const metricDef = {
    lifespan: { label: '享年（岁）', get: (e) => e.lifespan },
    accAge: { label: '登基年龄（岁）', get: (e) => e.accAge },
    reignYears: { label: '在位年数', get: (e) => e.reignYears },
  }[metric];
  const grouping = GROUPINGS[gkey];
  const groups = grouping.levels.map((lv, i) => {
    const vals = list.filter((e) => lv.test(e, opts)).map(metricDef.get).filter((v) => v !== null && isFinite(v));
    return { ...lv, color: SLOTS[i % SLOTS.length], st: describe(vals) };
  }).filter((g) => g.st.n > 0);
  if (!groups.length) { host.appendChild(h('p', { class: 'muted', text: '当前筛选无数据。' })); return; }

  const f = new Frame(host, { width: 1080, height: 394, m: { t: 30, r: 24, b: 58, l: 58 } });
  const maxV = Math.max(...groups.map((g) => g.st.max));
  const y = linear([0, Math.ceil(maxV / 10) * 10 + 4], [f.ph, 0]);
  const x = band(groups.map((g) => g.label), [0, f.pw], 0.55);
  f.axes({ x, y, xTicks: [], yTicks: ticks(0, y.domain[1], 6), yLabel: metricDef.label });

  const bw = Math.min(96, x.bandwidth);
  for (const g of groups) {
    const cx = x.center(g.label), s = g.st;
    const gEl = el('g', { class: 'mark' });
    // 须
    gEl.appendChild(el('line', { x1: cx, x2: cx, y1: y(s.whiskerLo), y2: y(s.q1), stroke: g.color, 'stroke-width': 1.5 }));
    gEl.appendChild(el('line', { x1: cx, x2: cx, y1: y(s.q3), y2: y(s.whiskerHi), stroke: g.color, 'stroke-width': 1.5 }));
    gEl.appendChild(el('line', { x1: cx - bw / 4, x2: cx + bw / 4, y1: y(s.whiskerLo), y2: y(s.whiskerLo), stroke: g.color, 'stroke-width': 1.5 }));
    gEl.appendChild(el('line', { x1: cx - bw / 4, x2: cx + bw / 4, y1: y(s.whiskerHi), y2: y(s.whiskerHi), stroke: g.color, 'stroke-width': 1.5 }));
    // 箱体（细描边 + 淡填充，避免大色块）
    gEl.appendChild(el('rect', {
      x: cx - bw / 2, y: y(s.q3), width: bw, height: Math.max(2, y(s.q1) - y(s.q3)), rx: 3,
      fill: g.color, opacity: .13,
    }));
    gEl.appendChild(el('rect', {
      x: cx - bw / 2, y: y(s.q3), width: bw, height: Math.max(2, y(s.q1) - y(s.q3)), rx: 3,
      fill: 'none', stroke: g.color, 'stroke-width': 1.5,
    }));
    // 中位数
    gEl.appendChild(el('line', { x1: cx - bw / 2, x2: cx + bw / 2, y1: y(s.median), y2: y(s.median), stroke: g.color, 'stroke-width': 3, 'stroke-linecap': 'round' }));
    // 均值（菱形）
    gEl.appendChild(el('path', {
      d: `M${cx},${y(s.mean) - 5}L${cx + 5},${y(s.mean)}L${cx},${y(s.mean) + 5}L${cx - 5},${y(s.mean)}Z`,
      fill: 'var(--surface-1)', stroke: g.color, 'stroke-width': 2,
    }));
    f.add(gEl);
    // 离群点
    for (const o of s.outliers) {
      const dot = el('circle', { cx: cx + (Math.random() - 0.5) * bw * 0.4, cy: y(o), r: 3.2, fill: 'none', stroke: g.color, 'stroke-width': 1.3, opacity: .8 });
      f.add(dot);
    }
    hoverable(gEl, () => [
      { color: g.color, value: `${fmt1(s.median)}`, label: '中位数' },
      { label: '均值', value: fmt1(s.mean) },
      { label: '四分位', value: `${fmt1(s.q1)} – ${fmt1(s.q3)}` },
      { label: '极值', value: `${fmt1(s.min)} – ${fmt1(s.max)}` },
      { label: '样本数', value: String(s.n) },
    ], () => g.label);
    // 直接标注：中位数与样本量
    f.add(el('text', { x: cx, y: f.ph + 20, class: 'tick', 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--text-1)' }, g.label));
    f.add(el('text', { x: cx, y: f.ph + 36, class: 'tick', 'text-anchor': 'middle' }, `n=${s.n} · 中位 ${fmt1(s.median)} · 均值 ${fmt1(s.mean)}`));
  }

  host.appendChild(h('p', { class: 'muted small', style: 'margin:10px 0 0',
    text: '箱＝四分位距（IQR）· 粗线＝中位数 · 菱形＝均值 · 须＝1.5×IQR 内的极值 · 空心点＝离群值' }));

  const rows = groups.map((g) => {
    const ci = bootstrapMeanCI(g.st.values);
    return [g.label, g.st.n, fmt1(g.st.mean), ci ? `${fmt1(ci[0])} – ${fmt1(ci[1])}` : '—',
      fmt1(g.st.median), fmt1(g.st.q1), fmt1(g.st.q3), fmt1(g.st.min), fmt1(g.st.max), fmt1(g.st.sd)];
  });
  host.appendChild(tableView(['分组', 'n', '均值', '均值 95% 自助 CI', '中位数', 'Q1', 'Q3', '最小', '最大', '标准差'], rows, { caption: `${metricDef.label} 分组描述统计` }));

  if (groups.length === 2) {
    const w = welch(groups[0].st.values, groups[1].st.values);
    const mw = mannWhitney(groups[0].st.values, groups[1].st.values);
    const box = h('div', { class: `result ${w && w.p < 0.05 ? 'sig-up' : ''}` });
    box.appendChild(h('strong', { text: '两组比较：' }));
    box.appendChild(document.createTextNode(
      ` 均值差（${groups[0].label} − ${groups[1].label}）= ${fmt1(w.diff)} 岁，95% CI ${fmt1(w.ci[0])} – ${fmt1(w.ci[1])}，Welch t = ${fmt2(w.t)}，${fmtP(w.p)}；` +
      ` Mann–Whitney U 检验 ${fmtP(mw.p)}。`));
    host.appendChild(box);
  }
  host.appendChild(notes(['本图为「死亡年龄的横截面分布」，不处理左截断与删失；正式推断请以生存曲线与 Cox 模型为准。']));
}

// ── 8. DSI 散点图 ────────────────────────────────────────────────────────
export function renderDSI(host, list, opts) {
  host.innerHTML = '';
  const level = opts.dsiLevel || 'dynasty';
  const f = new Frame(host, { width: 1080, height: 434, m: { t: 30, r: 130, b: 52, l: 58 } });

  let pts, xVals, yVals, note;
  if (level === 'dynasty') {
    const keys = [...new Set(list.map((e) => e.dynKey))];
    pts = keys.map((k) => {
      const st = DYN_STATS.get(k);
      const sub = list.filter((e) => e.dynKey === k && e.lifespan !== null);
      if (!sub.length || st.dsi === null) return null;
      const d = describe(sub.map((e) => e.lifespan));
      return { key: k, name: st.name, dsi: st.dsi, mean: d.mean, n: d.n, unified: st.u, uL: st.uL, span: st.span, nAll: st.n };
    }).filter(Boolean).filter((p) => p.n >= (opts.dsiMinN || 2));
    xVals = pts.map((p) => p.dsi); yVals = pts.map((p) => p.mean);
    note = `每点为一个王朝（n ≥ ${opts.dsiMinN || 2} 位有生卒记录的皇帝），纵轴为该朝皇帝平均享年，点面积正比于皇帝人数。`;
  } else {
    pts = list.filter((e) => e.lifespan !== null && e.dsi !== null)
      .map((e) => ({ key: e.id, name: e.temple, dsi: e.dsi, mean: e.lifespan, n: 1, unified: e.unified, uL: e.unifiedLoose, e }));
    xVals = pts.map((p) => p.dsi); yVals = pts.map((p) => p.mean);
    note = '每点为一位皇帝。同一王朝的皇帝共享同一个 DSI 值，因此个体层面的相关性存在「伪重复」，会人为夸大显著性——正式结论应以王朝层面为准。';
  }
  if (pts.length < 3) { host.appendChild(h('p', { class: 'muted', text: '当前筛选数据不足。' })); return; }

  const x = linear([0, Math.max(...xVals) * 1.08], [0, f.pw]);
  const y = linear([Math.max(0, Math.min(...yVals) - 6), Math.max(...yVals) + 6], [f.ph, 0]);
  f.axes({ x, y, xTicks: ticks(0, x.domain[1], 6), yTicks: ticks(y.domain[0], y.domain[1], 6), xLabel: '王朝稳定度 DSI（王朝总年数 ÷ 皇帝人数）', yLabel: level === 'dynasty' ? '该朝皇帝平均享年（岁）' : '享年（岁）' });

  const reg = linreg(xVals, yVals);
  if (reg) {
    const x0 = x.domain[0], x1 = x.domain[1];
    f.add(el('line', {
      x1: x(x0), y1: y(reg.intercept + reg.slope * x0), x2: x(x1), y2: y(reg.intercept + reg.slope * x1),
      stroke: 'var(--text-2)', 'stroke-width': 1.5, 'stroke-linecap': 'round', opacity: .7,
    }));
  }
  const labelled = pts.slice().sort((a, b) => b.n - a.n).slice(0, level === 'dynasty' ? 10 : 0);
  for (const p of pts) {
    const col = (opts.looseUnified ? p.uL : p.unified) ? 'var(--c-unified)' : 'var(--c-split)';
    const r = level === 'dynasty' ? Math.max(4, Math.min(16, Math.sqrt(p.n) * 2.6)) : 4;
    const node = el('circle', { cx: x(p.dsi), cy: y(p.mean), r, fill: col, opacity: .82, stroke: 'var(--surface-1)', 'stroke-width': 2 });
    const hit = el('circle', { cx: x(p.dsi), cy: y(p.mean), r: Math.max(12, r + 6), fill: 'transparent', class: 'mark' });
    hoverable(hit, () => (level === 'dynasty' ? [
      { color: col, value: fmt1(p.mean), label: '平均享年' },
      { label: 'DSI', value: `${fmt1(p.dsi)} 年/帝` },
      { label: '国祚', value: `${p.span} 年` },
      { label: '皇帝', value: `${p.nAll} 位（有生卒 ${p.n} 位）` },
    ] : [
      { color: col, value: `${Math.floor(p.mean)} 岁`, label: '享年' },
      { label: 'DSI', value: fmt1(p.dsi) },
      { label: '朝代', value: p.e.dynasty },
    ]), () => p.name);
    f.add(node); f.add(hit);
    if (labelled.includes(p)) {
      f.add(el('text', { x: x(p.dsi) + r + 4, y: y(p.mean) + 4, class: 'direct sub', 'font-size': 10.5 }, p.name));
    }
  }
  host.appendChild(legend([
    { color: 'var(--c-unified)', label: '大一统王朝', shape: 'dot' },
    { color: 'var(--c-split)', label: '分裂时期政权', shape: 'dot' },
    { color: 'var(--text-2)', label: '最小二乘趋势线', shape: 'line' },
  ]));

  const sp = spearman(xVals, yVals);
  const res = h('div', { class: `result ${sp && sp.p < 0.05 ? 'sig-down' : ''}` });
  res.appendChild(h('strong', { text: '相关性：' }));
  res.appendChild(document.createTextNode(
    ` Spearman ρ = ${fmt2(sp.rho)}（n = ${sp.n}，${fmtP(sp.p)}）；` +
    ` 线性回归斜率 = ${fmt2(reg.slope)} 岁 / 每增加 1 年·帝⁻¹ 的稳定度，R² = ${fmt2(reg.r2)}，${fmtP(reg.p)}。`));
  host.appendChild(res);
  host.appendChild(notes([note]));
  host.appendChild(tableView(
    level === 'dynasty' ? ['王朝', 'DSI（年/帝）', '国祚（年）', '皇帝人数', '有生卒记录', '平均享年'] : ['庙号', '朝代', 'DSI', '享年'],
    (level === 'dynasty'
      ? pts.slice().sort((a, b) => b.dsi - a.dsi).map((p) => [p.name, fmt1(p.dsi), p.span, p.nAll, p.n, fmt1(p.mean)])
      : pts.map((p) => [p.name, p.e.dynasty, fmt1(p.dsi), Math.floor(p.mean)])),
    { caption: 'DSI 数据表', max: 400 },
  ));
}

// ── 假说检验面板 ─────────────────────────────────────────────────────────
function verdict(kind, text) {
  const cls = kind === 'support' ? 'support' : kind === 'reject' ? 'reject' : 'mixed';
  const icon = kind === 'support' ? '✔' : kind === 'reject' ? '✘' : '≈';
  return h('span', { class: `verdict ${cls}` }, [h('span', { text: icon }), h('span', { text })]);
}
function hypCard(id, claim, bodyNodes, v) {
  const card = h('div', { class: 'hyp' });
  const head = h('div', { class: 'h-head' }, [
    h('span', { class: 'h-id', text: id }), h('span', { class: 'h-claim', text: claim }), v,
  ]);
  card.appendChild(head);
  const body = h('div', { class: 'h-body' });
  for (const n of bodyNodes) body.appendChild(typeof n === 'string' ? h('p', { text: n }) : n);
  card.appendChild(body);
  return card;
}

export function renderHypotheses(host, list, opts) {
  host.innerHTML = '';
  const uni = (e) => (opts.looseUnified ? e.unifiedLoose : e.unified);
  const U = list.filter((e) => uni(e) === 1), S = list.filter((e) => uni(e) === 0);

  // 过滤器可以把某一组清空（例如只看分裂时期，或只看丹药组）。
  // 每张卡片独立成块并各自兜底：一条假说无法检验时，其余四条照常给出结果。
  const na = (id, claim, why) => host.appendChild(hypCard(id, claim,
    [h('p', { class: 'muted', text: why })], verdict('mixed', '当前筛选下无法检验')));
  const card = (id, claim, fn) => {
    try { fn(); } catch (err) {
      console.error(id, err);
      na(id, claim, `当前筛选下样本不足以完成该检验（${err.message}）。放宽上方过滤器即可恢复。`);
    }
  };

  // —— H1 大一统 vs 分裂 ——
  card('H1', '大一统王朝皇帝寿命显著高于分裂时期皇帝。', () => {
    const a = U.map((e) => e.lifespan).filter((v) => v !== null);
    const b = S.map((e) => e.lifespan).filter((v) => v !== null);
    const w = welch(a, b), mw = mannWhitney(a, b);
    if (!w || !mw) {
      na('H1', '大一统王朝皇帝寿命显著高于分裂时期皇帝。',
        `本假说需要「大一统」与「分裂」两组同时有数据，当前分别为 ${a.length} 位和 ${b.length} 位（须各 ≥1）。请在上方「时期」中同时勾选两者。`);
      return;
    }
    const su = survivalInput(U, { scale: 'age', fromAge: 15 }), ss = survivalInput(S, { scale: 'age', fromAge: 15 });
    const lr = (su.rows.length > 3 && ss.rows.length > 3) ? logRank([su.rows, ss.rows]) : null;
    const kmU = su.rows.length ? kaplanMeier(su.rows) : null, kmS = ss.rows.length ? kaplanMeier(ss.rows) : null;
    const ru = survivalInput(U, { scale: 'reign', censorAtAbd: false });
    const rs = survivalInput(S, { scale: 'reign', censorAtAbd: false });
    const lrR = (ru.rows.length > 3 && rs.rows.length > 3) ? logRank([ru.rows, rs.rows]) : null;
    const kmRU = ru.rows.length ? kaplanMeier(ru.rows) : null, kmRS = rs.rows.length ? kaplanMeier(rs.rows) : null;
    // 主模型：登基后生存，控制登基年龄（两组的登基年龄结构本就不同）
    const adjRows = survivalInput(list, { scale: 'reign', censorAtAbd: false }).rows
      .map((r) => ({ ...r, x: [uni(r.e), r.e.accAge === null ? null : r.e.accAge / 10] }))
      .filter((r) => r.x.every((v) => v !== null && isFinite(v)));
    const adj = adjRows.length > 30 ? coxPH(adjRows, ['大一统王朝', '登基年龄（每+10岁）']) : null;
    const adjTerm = adj ? adj.terms[0] : null;
    const accU = describe(U.map((e) => e.accAge).filter((v) => v !== null));
    const accS = describe(S.map((e) => e.accAge).filter((v) => v !== null));
    const sig = w && w.p < 0.05;
    host.appendChild(hypCard('H1', '大一统王朝皇帝寿命显著高于分裂时期皇帝。',
      [
        h('p', {}, [document.createTextNode(`平均享年：大一统 ${fmt1(w.A.mean)} 岁（n=${w.A.n}） vs 分裂 ${fmt1(w.B.mean)} 岁（n=${w.B.n}），差值 `),
          h('strong', { text: `${fmt1(w.diff)} 岁` }),
          document.createTextNode(`（95% CI ${fmt1(w.ci[0])}–${fmt1(w.ci[1])}，Welch ${fmtP(w.p)}；Mann–Whitney ${fmtP(mw.p)}）。`)]),
        h('p', { text: lrR ? `登基后生存（自即位起随访至死亡，不存在左截断问题）：即位后中位存活 大一统 ${kmRU.median === null ? '未达到' : fmt1(kmRU.median) + ' 年'}、分裂 ${kmRS.median === null ? '未达到' : fmt1(kmRS.median) + ' 年'}；Log-rank χ² = ${fmt2(lrR.chi2)}，${fmtP(lrR.p)}。` : '' }),
        adjTerm ? h('p', {}, [
          document.createTextNode('主模型（登基后生存，控制登基年龄）：身处大一统王朝的死亡风险 HR = '),
          h('strong', { text: `${fmt2(adjTerm.hr)}（95% CI ${fmt2(adjTerm.lo)}–${fmt2(adjTerm.hi)}，${fmtP(adjTerm.p)}）` }),
          document.createTextNode(`。控制登基年龄是必要的：大一统皇帝平均 ${fmt1(accU.mean)} 岁即位，分裂时期为 ${fmt1(accS.mean)} 岁。`),
        ]) : null,
        h('p', { text: lr ? `年龄尺度（登基年龄处左截断，满 15 岁为条件起点）作为参照：Log-rank χ² = ${fmt2(lr.chi2)}，${fmtP(lr.p)}。该尺度的绝对水平受进入结构影响（见生存曲线一节的说明），只宜作组间比较。` : '' }),
        (!sig && adjTerm && adjTerm.p < 0.05) ? notes([
          '两种口径给出不同答案，这本身是结果的一部分：平均享年几乎没有差别，登基后的死亡风险却相差显著。原因在于「平均享年」把两件事混在一起——何时登上皇位，和登上之后面对多大风险。大一统皇帝即位更早（多为太子顺位继承），观察起点更靠前；分裂时期不少割据之主是中年武将出身，即位时已过半生，慕容垂、钱镠、马殷等更把均值拉高。剔除起点差异后，分裂时期的风险劣势才显露出来。此外，分裂时期生年失载的比例更高，而失载者多为短命幼主，均值因此被系统性抬高。'], { label: '为何两种口径不一致' }) : null,
      ].filter(Boolean),
      (() => {
        const primary = adjTerm && adjTerm.p < 0.05 ? (adjTerm.hr < 1 ? 'support' : 'reject') : null;
        if (primary === 'support') return verdict(sig ? 'support' : 'mixed', sig ? '数据支持' : '生存分析支持，均值差不显著');
        if (primary === 'reject') return verdict('reject', '与假说相反');
        if (lrR && lrR.p < 0.05) return verdict('mixed', '未调整的生存分析支持');
        return verdict('mixed', '证据不充分');
      })()));
  });

  // —— H2 非正常死亡的影响 ——
  card('H2', '非正常死亡是影响寿命的最强因素。', () => {
    const v1 = list.filter((e) => e.violent === 1), v0 = list.filter((e) => e.violent === 0);
    const a = v1.map((e) => e.lifespan).filter((v) => v !== null);
    const b = v0.map((e) => e.lifespan).filter((v) => v !== null);
    const w = welch(b, a);
    if (!w) {
      na('H2', '非正常死亡是影响寿命的最强因素。',
        `本假说需要「正常死亡」与「非正常死亡」两组同时有数据，当前分别为 ${b.length} 位和 ${a.length} 位。请在上方「死亡性质」中同时勾选两者。`);
      return;
    }
    const share = list.length ? (v1.length / list.filter((e) => e.violent !== null).length) * 100 : 0;
    // 与其他因素的效应量对比（单变量 Cox，年龄尺度）
    const factors = [
      { key: 'violent', label: '非正常死亡', get: (e) => (e.violent === null ? null : e.violent) },
      { key: 'unified', label: '大一统', get: (e) => uni(e) },
      { key: 'alchemy', label: '服丹药', get: (e) => e.alchemy },
      { key: 'coup', label: '遭遇政变', get: (e) => e.coup },
      { key: 'civilWar', label: '经历内战', get: (e) => e.civilWar },
      { key: 'founder', label: '开国皇帝', get: (e) => e.founder },
    ];
    const uniFits = [];
    for (const fdef of factors) {
      const { rows } = survivalInput(list, { scale: 'age', fromAge: 15 });
      const data = rows.map((r) => ({ ...r, x: [fdef.get(r.e)] })).filter((r) => r.x[0] !== null && isFinite(r.x[0]));
      const fit = data.length > 12 ? coxPH(data, [fdef.label]) : null;
      if (fit) uniFits.push({ ...fit.terms[0], key: fdef.key });
    }
    uniFits.sort((p, q) => Math.abs(Math.log(q.hr)) - Math.abs(Math.log(p.hr)));
    const top = uniFits[0];
    host.appendChild(hypCard('H2', '非正常死亡是影响寿命的最强因素。',
      [
        h('p', { text: `样本中非正常死亡（被杀/战死/自杀）占 ${share.toFixed(1)}%（${v1.length} 位）。非正常死亡者平均享年 ${fmt1(w.B.mean)} 岁，正常死亡者 ${fmt1(w.A.mean)} 岁，相差 ${fmt1(w.diff)} 岁（${fmtP(w.p)}）。` }),
        tableView(['单变量 Cox 因素（年龄尺度）', 'HR', '95% CI', 'p'],
          uniFits.map((t) => [t.name, fmt2(t.hr), `${fmt2(t.lo)} – ${fmt2(t.hi)}`, fmtP(t.p).replace(/^p [=<] /, '')]),
          { caption: '各风险因素效应量排序（按 |log HR| 降序）' }),
        notes(['把「是否非正常死亡」放进以死亡为终点的生存模型，本质上是用结局解释结局，HR 必然偏大，故此处仅作效应量的量级参照，不构成因果推断。真正可检验的形式见 H5 的分因分析。']),
      ],
      verdict(top && top.key === 'violent' ? 'support' : 'mixed',
        top && top.key === 'violent' ? '在本组因素中效应量最大' : `效应量最大者为「${top ? top.name : '—'}」`)));
  });

  // —— H3 DSI 与寿命 ——
  card('H3', '王朝稳定度（DSI）与寿命正相关。', () => {
    const keys = [...new Set(list.map((e) => e.dynKey))];
    const rows = keys.map((k) => {
      const st = DYN_STATS.get(k);
      const sub = list.filter((e) => e.dynKey === k && e.lifespan !== null);
      return sub.length >= 2 && st.dsi !== null ? { dsi: st.dsi, mean: describe(sub.map((e) => e.lifespan)).mean, name: st.name } : null;
    }).filter(Boolean);
    const sp = rows.length >= 4 ? spearman(rows.map((r) => r.dsi), rows.map((r) => r.mean)) : null;
    const rg = rows.length >= 4 ? linreg(rows.map((r) => r.dsi), rows.map((r) => r.mean)) : null;
    const sig = sp && sp.p < 0.05;
    host.appendChild(hypCard('H3', '王朝稳定度（DSI）与寿命正相关。',
      [
        h('p', { text: sp ? `王朝层面（n = ${sp.n} 个政权）：Spearman ρ = ${fmt2(sp.rho)}，${fmtP(sp.p)}；每提高 10 年/帝 的稳定度，平均享年变化 ${fmt1(rg.slope * 10)} 岁（R² = ${fmt2(rg.r2)}）。` : '可用王朝数不足。' }),
        notes(['DSI 与寿命互为因果的风险很高：皇帝越短命，同一时段内更替越快，DSI 就越低。这一相关性不能直接读作「稳定的王朝让皇帝更长寿」。']),
      ],
      verdict(sig && sp.rho > 0 ? 'support' : sig ? 'reject' : 'mixed',
        sig && sp.rho > 0 ? '数据支持（但存在内生性）' : sig ? '与假说相反' : '证据不充分')));
  });

  // —— H4 丹药 ——
  card('H4', '服丹药显著增加死亡风险。', () => {
    const g1 = list.filter((e) => e.alchemy === 1), g0 = list.filter((e) => e.alchemy === 0);
    const a = g1.map((e) => e.lifespan).filter((v) => v !== null);
    const b = g0.map((e) => e.lifespan).filter((v) => v !== null);
    const w = a.length >= 3 && b.length >= 3 ? welch(a, b) : null;
    // 调整模型：仅比较「正常死亡」以外的混杂需要控制 → 用 Cox 控制登基年龄与大一统
    const { rows } = survivalInput(list, { scale: 'age', fromAge: 15 });
    const data = rows.map((r) => ({ ...r, x: [r.e.alchemy, uni(r.e), r.e.accAge === null ? null : r.e.accAge / 10] }))
      .filter((r) => r.x.every((v) => v !== null && isFinite(v)));
    const fit = data.length > 20 ? coxPH(data, ['服丹药', '大一统王朝', '登基年龄（每+10岁）']) : null;
    const term = fit ? fit.terms[0] : null;
    const sig = term && term.p < 0.05;
    host.appendChild(hypCard('H4', '服丹药显著增加死亡风险。',
      [
        h('p', { text: w ? `有服丹药记载者 ${w.A.n} 位，平均享年 ${fmt1(w.A.mean)} 岁；无记载者 ${w.B.n} 位，平均 ${fmt1(w.B.mean)} 岁，差 ${fmt1(w.diff)} 岁（${fmtP(w.p)}）。` : '丹药组样本不足。' }),
        h('p', { text: term ? `控制大一统与登基年龄后的 Cox 模型：服丹药 HR = ${fmt2(term.hr)}（95% CI ${fmt2(term.lo)}–${fmt2(term.hi)}，${fmtP(term.p)}）。` : '调整模型样本不足。' }),
        notes(['丹药服食多见于长期在位、活到中老年的皇帝（唐宪宗、明世宗、清世宗等），且「服丹」本身常因暴卒才被史官记录——存在反向因果与记录偏倚。0 值应读作「无明确记载」，而非「确未服食」。']),
      ],
      verdict(sig && term.hr > 1 ? 'support' : sig ? 'reject' : 'mixed',
        sig && term.hr > 1 ? '调整后仍显著' : sig ? '与假说相反' : '证据不充分')));
  });

  // —— H5 政治风险 vs 医疗 ——
  card('H5', '统一时代的寿命优势主要来自政治风险下降，而非医疗改善。', () => {
    const Un = U.filter((e) => e.violent === 0), Sn = S.filter((e) => e.violent === 0);
    const nat = (Un.length >= 3 && Sn.length >= 3)
      ? welch(Un.map((e) => e.lifespan).filter((v) => v !== null), Sn.map((e) => e.lifespan).filter((v) => v !== null)) : null;
    const shareU = U.filter((e) => e.violent !== null).length ? U.filter((e) => e.violent === 1).length / U.filter((e) => e.violent !== null).length : null;
    const shareS = S.filter((e) => e.violent !== null).length ? S.filter((e) => e.violent === 1).length / S.filter((e) => e.violent !== null).length : null;

    // 分因风险模型：把另一类死亡按删失处理，分别估计「被杀」与「病死」的原因别风险
    const causeFit = (wantViolent) => {
      const rows = survivalInput(list, { scale: 'reign', censorAtAbd: false }).rows
        .filter((r) => r.e.violent !== null)
        .map((r) => ({
          entry: r.entry, exit: r.exit,
          event: (r.event === 1 && (r.e.violent === 1) === wantViolent) ? 1 : 0,
          x: [uni(r.e), r.e.accAge === null ? null : r.e.accAge / 10],
        }))
        .filter((r) => r.x.every((v) => v !== null && isFinite(v)));
      return rows.length > 30 ? coxPH(rows, ['大一统王朝', '登基年龄（每+10岁）']) : null;
    };
    const fv = causeFit(true), fn = causeFit(false);
    const hv = fv ? fv.terms[0] : null, hn = fn ? fn.terms[0] : null;
    const kind = (!hv || !hn) ? 'mixed'
      : (hv.hr < 1 && hv.p < 0.05 && !(hn.hr < 1 && hn.p < 0.05)) ? 'support'
      : (hv.hr < 1 && hv.p < 0.05 && hn.hr < 1 && hn.p < 0.05) ? 'mixed'
      : (hn.hr < 1 && hn.p < 0.05) ? 'reject' : 'mixed';
    host.appendChild(hypCard('H5', '统一时代的寿命优势主要来自政治风险下降，而非医疗改善。',
      [
        h('p', {}, [
          document.createTextNode('非正常死亡（被杀/战死/自杀）占比：大一统 '),
          h('strong', { text: shareU === null ? '—' : `${(shareU * 100).toFixed(1)}%` }),
          document.createTextNode(' vs 分裂 '),
          h('strong', { text: shareS === null ? '—' : `${(shareS * 100).toFixed(1)}%` }),
          document.createTextNode('。'),
        ]),
        h('p', { text: (hv && hn)
          ? `分因风险模型（登基后尺度，控制登基年龄，竞争事件按删失处理）：大一统皇帝的「非正常死亡」风险 HR = ${fmt2(hv.hr)}（${fmt2(hv.lo)}–${fmt2(hv.hi)}，${fmtP(hv.p)}）；「正常死亡」风险 HR = ${fmt2(hn.hr)}（${fmt2(hn.lo)}–${fmt2(hn.hi)}，${fmtP(hn.p)}）。`
          : '分因模型样本不足。' }),
        h('p', { text: nat ? `另以描述统计佐证：仅比较正常死亡者的享年，大一统 ${fmt1(nat.A.mean)} 岁 vs 分裂 ${fmt1(nat.B.mean)} 岁，差 ${fmt1(nat.diff)} 岁（${fmtP(nat.p)}）。` : '' }),
        notes(['判读逻辑：若统一的生存优势来自「更少被杀」，则非正常死亡的 HR 应显著小于 1，而正常死亡（病死）的 HR 应接近 1——因为统一并不会让人更不容易生病。反之，若病死风险也显著降低，才提示医疗、营养、居住条件等非暴力机制在起作用。原因别风险模型假定两类死亡在给定协变量下相互独立，这一假定不可检验，结论应与竞争风险累积发生率图相互参照。']),
      ],
      verdict(kind,
        kind === 'support' ? '支持：优势集中在暴力死亡一侧'
        : kind === 'reject' ? '不支持：病死风险同样显著降低'
        : (hv && hn) ? '证据混杂' : '证据不充分')));
  });
}

// ── 数据缺口审计 ─────────────────────────────────────────────────────────
// 横向泳道视图暴露出一个好用的数据质检信号：朝代长带上任何「悬空」的头、尾或中段，
// 都意味着那段年份该政权没有在位君主的记录。原因只有三种：
//   ① 该君主称帝前已掌权，本库记的是称帝日（可由 r 字段解释）；
//   ② 史上确实虚位（永嘉之乱、乃马真后称制…）；
//   ③ 漏收君主或日期有误 —— 需要回溯史料。
// 这一节把三者逐条列出，使第三类不必靠肉眼在图上找。
// 审计针对完整数据集，不受上方过滤器影响：缺口是数据问题，不是筛选结果。
const GAP_MIN = 1.0;
export function renderAudit(host) {
  host.innerHTML = '';
  const rows = [];
  let unresolved = 0;
  for (const d of DYNASTIES) {
    const emps = EMPERORS.filter((e) => e.dynKey === d.key);
    if (!emps.length) {
      rows.push([d.name, `${fmtY(d.s)}–${fmtY(d.e)}`, '整朝无记录', d.e - d.s + 1, '—', '待核查']);
      unresolved++;
      continue;
    }
    const segs = [];
    for (const e of emps) {
      for (const rg of e.reigns) {
        const s = rg.s, en = rg.e || e.death || e.censor;
        if (s && en) segs.push({ e, s: s.t, x: en.t });
      }
    }
    if (!segs.length) continue;
    segs.sort((a, b) => a.s - b.s);
    const first = segs[0];
    const last = segs.reduce((a, b) => (b.x > a.x ? b : a));
    const push = (kind, yrs, who, why) => {
      rows.push([d.name, `${fmtY(d.s)}–${fmtY(d.e)}`, kind, +yrs.toFixed(1), who, why]);
      if (why === '待核查') unresolved++;
    };
    // 带首
    const lead = first.s - d.s;
    if (lead >= GAP_MIN) {
      const ar = first.e.accRule;
      const explained = ar && ar.t - d.s < GAP_MIN;
      push('带首空悬', lead, first.e.temple,
        explained ? `已解释：${fmtDate(ar, { yearOnly: true })} 即掌权，${fmtDate(first.e.acc, { yearOnly: true })} 方称帝`
          : (d.gapNote || '待核查'));
    }
    // 中段
    let cover = -Infinity;
    for (const g of segs) {
      if (cover > -Infinity && g.s - cover >= GAP_MIN) {
        const ar = g.e.accRule;
        const explained = ar && ar.t - cover < GAP_MIN;
        push('中段空缺', g.s - cover, `${fmtY(cover)} → ${g.e.temple}`,
          explained ? `已解释：${fmtDate(ar, { yearOnly: true })} 即掌权，${fmtDate(g.e.acc, { yearOnly: true })} 方称帝`
            : (d.gapNote || '待核查'));
      }
      cover = Math.max(cover, g.x);
    }
    // 带尾
    const trail = d.e - last.x;
    if (trail >= GAP_MIN) push('带尾空悬', trail, last.e.temple, d.gapNote || '待核查');
  }
  const total = rows.length;
  host.appendChild(h('div', { class: `notice ${unresolved ? '' : ''}` }, [
    h('strong', { text: `${total} 处缺口，其中 ${unresolved} 处「待核查」。` }),
    document.createTextNode(' 缺口按年数降序排列。「已解释」指该君主称帝前已实际掌权（横向泳道中以半高浅色段画出）；'
      + '注明史实者为真实的虚位期；标为「待核查」的应回溯史料，可能是漏收君主或日期换算有误——'
      + '本库正是靠这张表发现唐敬宗卒年（宝历二年十二月换算公历应入 827 年）、前燕慕容皝、北凉段业、前凉张氏诸主的缺漏。'),
  ]));
  rows.sort((a, b) => (b[3] === '—' ? 0 : b[3]) - (a[3] === '—' ? 0 : a[3]));
  host.appendChild(tableView(['朝代', '国祚', '缺口类型', '年数', '相关君主', '判定'], rows,
    { caption: '朝代长带上的空档逐条核查（针对完整数据集，不受过滤器影响）' }));
  host.lastChild.setAttribute('open', '');
}
const fmtY = (y) => (y <= 0 ? `前${-Math.round(y) + 1}` : String(Math.round(y)));

// ── 数据库表 ─────────────────────────────────────────────────────────────
export function renderDatabase(host, list, opts) {
  host.innerHTML = '';
  const q = (opts.dbQuery || '').trim();
  const rows = list.filter((e) => !q || `${e.name}${e.temple}${e.dynasty}${e.posth}${e.note}`.includes(q));
  const flagsOf = (e) => Object.entries(FLAG_LABEL).filter(([k]) => e[k]).map(([, v]) => v).join('、');

  // 数据完整性：缺失并非随机，按时代披露缺失率是解读一切结果的前提
  const eras = [...new Set(list.map((e) => e.eraName))];
  const missRows = eras.map((name) => {
    const sub = list.filter((e) => e.eraName === name);
    const nb = sub.filter((e) => !e.birth).length;
    const nc = sub.filter((e) => e.violent === null).length;
    return [name, sub.length, nb, `${((nb / sub.length) * 100).toFixed(0)}%`, nc, `${((nc / sub.length) * 100).toFixed(0)}%`];
  });
  const allNb = list.filter((e) => !e.birth).length, allNc = list.filter((e) => e.violent === null).length;
  missRows.push(['合计', list.length, allNb, `${((allNb / list.length) * 100).toFixed(0)}%`, allNc, `${((allNc / list.length) * 100).toFixed(0)}%`]);
  host.appendChild(h('div', { class: 'notice' }, [
    h('strong', { text: '数据完整性（缺失并非随机）。' }),
    document.createTextNode(` 生年失载 ${allNb} 位（${((allNb / list.length) * 100).toFixed(0)}%），死因不明 ${allNc} 位。失载者以十六国、闽、南汉等割据政权的短祚之君居多，而这些人恰恰更可能早夭——因此凡以「平均享年」为指标的结论都会被系统性抬高。`),
  ]));
  host.appendChild(tableView(['时代', '君主数', '生年失载', '占比', '死因不明', '占比'], missRows,
    { caption: '按时代的缺失率' }));
  host.appendChild(tableView(
    ['庙号/通称', '姓名', '朝代', '民族', '称号', '生', '卒', '享年', '登基', '登基年龄', '在位(年)', '死因', '非正常', '开国', '亡国', '大一统', '秩序', 'DSI', '标志', '备注'],
    rows.map((e) => [
      e.temple, e.name, e.dynasty, e.ethnicity, e.titleClass,
      fmtDate(e.birth), e.death ? fmtDate(e.death) : (e.censor ? `${fmtDate(e.censor)}（失踪）` : '不详'),
      e.lifespan === null ? null : Math.floor(e.lifespan),
      fmtDate(e.acc), e.accAge === null ? null : Math.floor(e.accAge),
      e.reignYears === null ? null : e.reignYears.toFixed(1),
      e.causeLabel, e.violent === null ? '不明' : e.violent ? '是' : '否',
      e.founder ? '是' : '', e.lastRuler ? '是' : '',
      e.unified ? '是' : '否', ['分裂时代', '统一稳定期', '统一末期'][e.order],
      e.dsi === null ? null : e.dsi.toFixed(1), flagsOf(e), e.note,
    ]),
    { caption: `帝王记录（${rows.length} 条）`, max: 0 },
  ));
  host.lastChild.setAttribute('open', '');
}
