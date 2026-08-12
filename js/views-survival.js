// views-survival.js — 生存分析视图：Kaplan–Meier、竞争风险累积发生率、Cox 森林图
import { el, h, linear, ticks, Frame, hoverable, legend, tableView, fmt1, fmt2, showTip, hideTip } from './charts.js';
import { survivalInput, GROUPINGS, COVARIATES } from './data.js';
import { kaplanMeier, logRank, coxPH, cumulativeIncidence, fmtP, rmst, riskSetDiagnostics } from './stats.js';

/**
 * 风险集塌陷时的警示条。左截断下低龄段可能只剩一两人在风险集里，
 * 一次死亡就把 S 打到 0，其后整段样本对曲线失去影响力——图还画得出来，但读不得。
 * 与其让它安静地误导，不如挡在图前说清楚，并给一个一键修复。
 */
function degeneracyBanner(diag, opts, scaleName) {
  if (!diag.degenerate) return null;
  const who = diag.collapseWho.map((e) => e.temple).join('、');
  const pct = Math.round(diag.eventsAfter / Math.max(1, diag.totalEvents) * 100);
  const box = h('div', { class: 'notice warn' });
  box.appendChild(h('strong', { text: '⚠ 当前设置下这张图不可读。' }));
  box.appendChild(document.createTextNode(
    ` 在${scaleName} ${diag.collapseTime.toFixed(1)} 处，风险集只剩 ${diag.minAtRisk} 人`
    + `${who ? `（${who}）` : ''}，其死亡把生存概率打到 0。此后的 ${diag.eventsAfter} 例死亡`
    + `（占全部 ${diag.totalEvents} 例的 ${pct}%）对曲线不再有任何贡献，`
    + `曲线被永久冻结在崩塌那一刻——末端数值只反映最早即位的那一两人，不是史实。`
    + `估计量本身没算错：这是「不设条件起点」在左截断下的必然退化。`));
  if (opts.setOpt) {
    box.appendChild(h('button', {
      class: 'linkish', text: '　→ 设回「满 15 岁」',
      onclick: () => opts.setOpt('kmFromAge', 15),
    }));
  }
  return box;
}

const SLOTS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
const scaleLabel = (s) => (s === 'age' ? '年龄（岁）' : '登基后年数');

/** 把 KM 折线转成阶梯路径 */
function stepPath(points, x, y, key = 'S') {
  let d = '';
  points.forEach((p, i) => {
    const px = x(p.t), py = y(p[key]);
    if (i === 0) d += `M${px.toFixed(1)},${py.toFixed(1)}`;
    else d += `H${px.toFixed(1)}V${py.toFixed(1)}`;
  });
  return d;
}
function stepArea(points, x, y, loKey, hiKey) {
  if (points.length < 2) return '';
  let up = '', down = '';
  points.forEach((p, i) => {
    const px = x(p.t);
    up += i === 0 ? `M${px.toFixed(1)},${y(p[hiKey]).toFixed(1)}` : `H${px.toFixed(1)}V${y(p[hiKey]).toFixed(1)}`;
  });
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i], px = x(p.t);
    down += i === points.length - 1 ? `L${px.toFixed(1)},${y(p[loKey]).toFixed(1)}` : `V${y(p[loKey]).toFixed(1)}H${px.toFixed(1)}`;
  }
  return `${up}${down}Z`;
}

// ── 6. Kaplan–Meier 生存曲线 ─────────────────────────────────────────────
export function renderKM(host, list, opts) {
  host.innerHTML = '';
  const gkey = opts.kmGroup || 'unified';
  const scale = opts.kmScale || 'reign';
  const censorAtAbd = opts.kmCensorAbd !== false;
  const fromAge = scale === 'age' ? (opts.kmFromAge ?? 15) : 0;
  const grouping = GROUPINGS[gkey];

  const groups = grouping.levels.map((lv, i) => {
    const sub = list.filter((e) => lv.test(e, opts));
    const { rows, dropped } = survivalInput(sub, { scale, censorAtAbd, fromAge });
    return { ...lv, color: SLOTS[i % SLOTS.length], rows, dropped: dropped.length, km: rows.length ? kaplanMeier(rows) : null };
  }).filter((g) => g.km && g.rows.length >= 3);

  if (groups.length < 1) { host.appendChild(h('p', { class: 'muted', text: '当前筛选下样本不足以估计生存曲线。' })); return; }

  let degenerate = false;
  for (const g of groups) {
    const banner = degeneracyBanner(riskSetDiagnostics(g.rows), opts, scale === 'age' ? '年龄' : '登基后年数');
    if (banner) {
      banner.insertBefore(h('span', { text: `【${g.label}】`, style: 'font-weight:600' }), banner.firstChild);
      host.appendChild(banner);
      degenerate = true;
    }
  }

  const tMax = Math.max(...groups.flatMap((g) => g.km.points.map((p) => p.t)));
  const tMin = scale === 'age' ? fromAge : 0;
  const plotHost = h('div');
  if (degenerate) plotHost.style.opacity = '0.4';
  host.appendChild(plotHost);
  const f = new Frame(plotHost, { width: 1080, height: 436, m: { t: 30, r: 26, b: 52, l: 56 } });
  const x = linear([Math.max(0, Math.floor(tMin)), Math.ceil(tMax)], [0, f.pw]);
  const y = linear([0, 1], [f.ph, 0]);
  const yt = [0, 0.2, 0.4, 0.6, 0.8, 1];
  f.axes({
    x, y, xTicks: ticks(x.domain[0], x.domain[1], 8), yTicks: yt,
    yFmt: (v) => `${Math.round(v * 100)}%`, xLabel: scaleLabel(scale),
    yLabel: fromAge > 0 ? `条件生存概率 S(t │ 活过 ${fromAge} 岁)` : '生存概率 S(t)',
  });

  if (opts.kmCI !== false) {
    for (const g of groups) {
      const d = stepArea(g.km.points, x, y, 'lo', 'hi');
      if (d) f.add(el('path', { d, fill: g.color, class: 'band' }));
    }
  }
  for (const g of groups) {
    f.add(el('path', { d: stepPath(g.km.points, x, y), class: 'serie-line', stroke: g.color }));
    const last = g.km.points[g.km.points.length - 1];
    f.add(el('circle', { cx: x(last.t), cy: y(last.S), r: 4, fill: g.color, stroke: 'var(--surface-1)', 'stroke-width': 2 }));
  }
  // 中位生存时间：直接标注（选择性标注，不是每点都标）
  for (const g of groups) {
    if (g.km.median === null) continue;
    f.add(el('line', { x1: x(g.km.median), x2: x(g.km.median), y1: y(0.5), y2: f.ph, stroke: g.color, 'stroke-width': 1, opacity: .45 }));
    f.add(el('text', { x: x(g.km.median) + 5, y: y(0.5) + 14, class: 'direct', fill: 'var(--text-1)' }, `中位 ${fmt1(g.km.median)}`));
  }
  f.add(el('line', { x1: 0, x2: f.pw, y1: y(0.5), y2: y(0.5), class: 'ref-line', opacity: .6 }));

  // 悬停：一次读出所有组在该 x 的生存率
  const overlay = el('rect', { x: 0, y: 0, width: f.pw, height: f.ph, fill: 'transparent', class: 'mark' });
  const cross = el('line', { y1: 0, y2: f.ph, class: 'ref-line', opacity: 0, 'stroke-width': 1 });
  f.add(overlay); f.add(cross);
  overlay.addEventListener('pointermove', (ev) => {
    const rect = f.svg.getBoundingClientRect();
    const px = (ev.clientX - rect.left) * (f.W / rect.width) - f.m.l;
    const t = Math.max(x.domain[0], Math.min(x.domain[1], x.invert(px)));
    cross.setAttribute('x1', x(t)); cross.setAttribute('x2', x(t)); cross.setAttribute('opacity', .8);
    showTip(ev, groups.map((g) => ({
      color: g.color, value: `${(g.km.at(t) * 100).toFixed(0)}%`, label: g.label,
    })), `${scaleLabel(scale)} ${t.toFixed(0)}`);
  });
  overlay.addEventListener('pointerleave', () => {
    cross.setAttribute('opacity', 0);
    hideTip();
  });

  host.appendChild(legend(groups.map((g) => ({ color: g.color, label: `${g.label}（n=${g.rows.length}，事件 ${g.km.events}）`, shape: 'line' }))));

  // 风险人数表
  const rtTicks = ticks(x.domain[0], x.domain[1], 8);
  const riskRows = groups.map((g) => [g.label, ...rtTicks.map((t) => g.rows.filter((r) => r.entry <= t && r.exit > t).length)]);
  host.appendChild(tableView(['风险集人数 →', ...rtTicks.map((t) => String(Math.round(t)))], riskRows,
    { caption: `各时点仍在风险集中的人数（${scaleLabel(scale)}）` }));

  // Log-rank
  const box = h('div');
  if (groups.length >= 2) {
    const lr = logRank(groups.map((g) => g.rows));
    if (lr) {
      const sig = lr.p < 0.05;
      box.appendChild(h('div', { class: `result ${sig ? 'sig-up' : ''}` }, [
        h('strong', { text: 'Log-rank 检验：' }),
        document.createTextNode(` χ² = ${fmt2(lr.chi2)}，df = ${lr.df}，${fmtP(lr.p)}。`),
        document.createTextNode(sig ? ' 各组生存曲线存在统计学显著差异。' : ' 尚不能认为各组生存曲线存在显著差异。'),
      ]));
    }
  }
  const tau = scale === 'age' ? 70 : 30;
  const rm = groups.map((g) => `${g.label} ${fmt1(rmst(g.km, tau))}`).join(' · ');
  box.appendChild(h('p', { class: 'muted small', text: `限制平均生存时间 RMST（截至 ${tau}${scale === 'age' ? ' 岁' : ' 年'}）：${rm}。RMST 在存在删失时比「平均寿命」更稳健。` }));
  const dropped = groups.reduce((s, g) => s + g.dropped, 0);
  if (dropped) box.appendChild(h('p', { class: 'muted small', text: `因生卒/登基日期不全被排除：${dropped} 位（已在上表中剔除，未作插补）。` }));
  if (scale === 'age') {
    box.appendChild(h('p', { class: 'muted small', text:
      `年龄尺度采用左截断（延迟进入）：每位皇帝自其登基年龄进入风险集，校正「必须活到即位才会进入样本」的选择偏倚。` +
      (fromAge > 0
        ? ` 并以满 ${fromAge} 岁为条件起点——襁褓即位者（如汉殇帝、周静帝）会使低龄段的风险集只剩一两人，一次死亡即把曲线打掉一半，那里的估计没有意义。设为「不设条件（0 岁）」可查看未加条件的原始曲线，但请勿解读其低龄段。`
        : ' 当前未设条件起点：低龄段风险集极小，曲线在那里不可解读。')
    }));
    box.appendChild(h('p', { class: 'muted small', text:
      '年龄尺度的边际解释还有一个前提：进入时间（登基年龄）需与其后的死亡时间「拟独立」（quasi-independent）。本样本并不满足——幼年即位者多出于外戚、宦官擅权之局，其后被弑概率本就更高，故 20–35 岁区间的风险集偏向高危人群，会把该段的生存曲线压低。因此本项目以「登基后年数」为主分析，年龄尺度作为参照。' }));
  } else {
    box.appendChild(h('p', { class: 'muted small', text: censorAtAbd
      ? '在位尺度：退位者在退位时刻删失，估计的是「在皇位上」的死亡风险。'
      : '在位尺度：退位后继续随访至死亡，估计的是自登基起的总生存。' }));
  }
  host.appendChild(box);
}

// ── 竞争风险：非正常死亡 vs 正常死亡的累积发生率 ──────────────────────────
export function renderCIF(host, list, opts) {
  host.innerHTML = '';
  const scale = opts.cifScale || 'age';
  const fromAge = scale === 'age' ? (opts.kmFromAge ?? 15) : 0;
  const facets = [
    { key: 1, name: '大一统王朝', test: (e) => (opts.looseUnified ? e.unifiedLoose : e.unified) === 1 },
    { key: 0, name: '分裂时期', test: (e) => (opts.looseUnified ? e.unifiedLoose : e.unified) === 0 },
  ];
  const causeDefs = [
    { key: 'violent', label: '非正常死亡（被杀/战死/自杀）', color: 'var(--s2)' },
    { key: 'natural', label: '正常死亡（自然/疾病/意外）', color: 'var(--s1)' },
  ];
  const wrap = h('div', { class: 'grid2' });
  const tableRows = [];
  const banners = h('div');
  host.appendChild(banners);
  for (const fc of facets) {
    const sub = list.filter(fc.test);
    const { rows } = survivalInput(sub, { scale, censorAtAbd: false, fromAge });
    const withCause = rows.map((r) => ({
      ...r,
      cause: r.e.violent === 1 ? 'violent' : r.e.violent === 0 ? 'natural' : 'unknown',
    }));
    const box = h('div');
    box.appendChild(h('h4', { text: `${fc.name}（n=${withCause.length}）`, class: 'small', style: 'margin:2px 0 6px;color:var(--text-2)' }));
    if (withCause.length < 5) { box.appendChild(h('p', { class: 'muted small', text: '样本不足。' })); wrap.appendChild(box); continue; }
    const diag = riskSetDiagnostics(withCause);
    const banner = degeneracyBanner(diag, opts, scale === 'age' ? '年龄' : '登基后年数');
    if (banner) {
      banner.insertBefore(h('span', { text: `【${fc.name}】`, style: 'font-weight:600' }), banner.firstChild);
      banners.appendChild(banner);
    }
    const cif = cumulativeIncidence(withCause, ['violent', 'natural', 'unknown']);
    const plot = h('div');                       // Frame 会清空宿主，故另开一层承载
    if (banner) plot.style.opacity = '0.4';      // 退化的图降透明度，不让它看起来像正常结果
    box.appendChild(plot);
    const f = new Frame(plot, { width: 520, height: 316, m: { t: 28, r: 16, b: 46, l: 48 } });
    const tMax = Math.max(...withCause.map((r) => r.exit));
    const x = linear([fromAge, Math.ceil(tMax)], [0, f.pw]);
    const y = linear([0, 1], [f.ph, 0]);
    f.axes({ x, y, xTicks: ticks(fromAge, tMax, 6), yTicks: [0, .25, .5, .75, 1], yFmt: (v) => `${Math.round(v * 100)}%`, xLabel: scaleLabel(scale), yLabel: '累积发生率' });
    for (const c of causeDefs) {
      const pts = cif[c.key];
      if (!pts || pts.length < 2) continue;
      f.add(el('path', { d: stepPath(pts, x, y, 'F'), class: 'serie-line', stroke: c.color }));
      const last = pts[pts.length - 1];
      f.add(el('circle', { cx: x(last.t), cy: y(last.F), r: 4, fill: c.color, stroke: 'var(--surface-1)', 'stroke-width': 2 }));
      f.add(el('text', { x: x(last.t) - 6, y: y(last.F) - 9, class: 'direct', 'text-anchor': 'end' }, `${(last.F * 100).toFixed(0)}%`));
      tableRows.push([fc.name, c.label, `${(last.F * 100).toFixed(1)}%`]);
    }
    wrap.appendChild(box);
  }
  host.appendChild(wrap);
  host.appendChild(legend(causeDefs.map((c) => ({ color: c.color, label: c.label, shape: 'line' }))));
  host.appendChild(h('p', { class: 'muted small', text: '两条曲线在同一分面内相加即为总死亡累积发生率。Aalen–Johansen 估计量正确处理竞争风险：把「被杀」当作删失会高估自然死亡风险。' }));
  host.appendChild(tableView(['分组', '死亡方式', '终点累积发生率'], tableRows, { caption: '竞争风险终点值' }));
}

// ── Cox 比例风险回归 + 森林图 ─────────────────────────────────────────────
export function renderCox(host, list, opts) {
  host.innerHTML = '';
  const scale = opts.coxScale || 'age';
  const chosen = (opts.coxVars && opts.coxVars.length)
    ? COVARIATES.filter((c) => opts.coxVars.includes(c.key))
    : COVARIATES.filter((c) => ['accAgeZ', 'unified', 'dsi', 'warfare', 'coup', 'alchemy'].includes(c.key));
  // 时间轴变量不得同时作为协变量
  const vars = chosen.filter((c) => !(c.timeAxis && c.timeAxis === scale));
  const fromAge = scale === 'age' ? (opts.kmFromAge ?? 15) : 0;
  const { rows } = survivalInput(list, { scale, censorAtAbd: scale === 'reign', fromAge });
  const data = [];
  let excluded = 0;
  for (const r of rows) {
    const x = vars.map((v) => v.get(r.e, opts));
    if (x.some((v) => v === null || v === undefined || !isFinite(v))) { excluded++; continue; }
    data.push({ entry: r.entry, exit: r.exit, event: r.event, x, e: r.e });
  }
  if (data.length < vars.length + 5) {
    host.appendChild(h('p', { class: 'muted', text: '当前筛选与变量组合下样本不足以拟合 Cox 模型。' }));
    return;
  }
  const fit = coxPH(data, vars.map((v) => v.label));
  if (!fit) { host.appendChild(h('p', { class: 'muted', text: 'Cox 模型未能收敛（信息矩阵奇异，通常因某协变量在本子集内无变异）。' })); return; }

  // 森林图
  const rowsN = fit.terms.length;
  const f = new Frame(host, { width: 1080, height: rowsN * 40 + 74, m: { t: 18, r: 150, b: 46, l: 250 } });
  const allLo = Math.min(...fit.terms.map((t) => t.lo).filter(isFinite), 0.5);
  const allHi = Math.max(...fit.terms.map((t) => t.hi).filter(isFinite), 2);
  const lo = Math.max(0.05, Math.min(allLo, 0.6)), hi = Math.min(30, Math.max(allHi, 1.8));
  const x = linear([Math.log(lo), Math.log(hi)], [0, f.pw]);
  const xtVals = [0.1, 0.25, 0.5, 1, 2, 4, 8, 16].filter((v) => v >= lo * 0.98 && v <= hi * 1.02);
  for (const v of xtVals) f.add(el('line', { x1: x(Math.log(v)), x2: x(Math.log(v)), y1: 0, y2: f.ph, class: 'grid' }));
  f.add(el('line', { x1: x(0), x2: x(0), y1: 0, y2: f.ph, class: 'axis-line' }));
  for (const v of xtVals) f.add(el('text', { x: x(Math.log(v)), y: f.ph + 18, class: 'tick', 'text-anchor': 'middle' }, String(v)));
  f.add(el('text', { x: f.pw / 2, y: f.ph + 38, class: 'axis-label', 'text-anchor': 'middle' }, '风险比 HR（对数刻度；1＝无影响）'));

  fit.terms.forEach((t, i) => {
    const y = i * 40 + 20;
    const sig = t.p < 0.05;
    const col = !sig ? 'var(--s1)' : t.hr > 1 ? 'var(--critical)' : 'var(--good)';
    const x0 = x(Math.log(Math.max(lo, t.lo))), x1 = x(Math.log(Math.min(hi, t.hi)));
    const g = el('g', { class: 'mark' });
    g.appendChild(el('line', { x1: x0, x2: x1, y1: y, y2: y, stroke: col, 'stroke-width': 2, 'stroke-linecap': 'round' }));
    g.appendChild(el('circle', { cx: x(Math.log(t.hr)), cy: y, r: 5, fill: col, stroke: 'var(--surface-1)', 'stroke-width': 2 }));
    f.add(el('text', { x: -12, y: y + 4, class: 'tick', 'text-anchor': 'end', 'font-size': 12, fill: 'var(--text-1)' }, t.name));
    f.add(el('text', { x: f.pw + 12, y: y + 4, class: 'tick', 'text-anchor': 'start', 'font-size': 11.5 },
      `${fmt2(t.hr)}（${fmt2(t.lo)}–${fmt2(t.hi)}）`));
    if (sig) f.add(el('text', { x: f.pw + 132, y: y + 4, class: 'tick', 'text-anchor': 'end', 'font-size': 11.5, fill: col }, '✱'));
    hoverable(g, () => [
      { color: col, value: fmt2(t.hr), label: 'HR' },
      { label: '95% CI', value: `${fmt2(t.lo)} – ${fmt2(t.hi)}` },
      { label: '系数 β', value: fmt2(t.beta) },
      { label: '', value: fmtP(t.p) },
    ], () => t.name);
    f.add(g);
  });

  const note = h('div');
  note.appendChild(h('div', { class: 'result' }, [
    h('strong', { text: '模型：' }),
    document.createTextNode(` Cox 比例风险（Efron 结法），时间轴＝${scale === 'age' ? '年龄（登基年龄处左截断）' : '登基后年数'}；n = ${fit.n}，死亡事件 ${fit.events}。`),
    document.createTextNode(` 整体似然比检验 χ² = ${fmt2(fit.lrt.chi2)}，df = ${fit.lrt.df}，${fmtP(fit.lrt.p)}。`),
    fit.converged ? document.createTextNode('') : h('span', { text: '（迭代未完全收敛，结果慎用）', class: 'muted' }),
  ]));
  note.appendChild(tableView(
    ['协变量', 'β', '标准误', 'HR', '95% CI 下限', '95% CI 上限', 'z', 'p 值'],
    fit.terms.map((t) => [t.name, fmt2(t.beta), fmt2(t.se), fmt2(t.hr), fmt2(t.lo), fmt2(t.hi), fmt2(t.z), fmtP(t.p).replace(/^p [=<] /, '')]),
    { caption: 'Cox 回归系数表' },
  ));
  note.appendChild(tableView(
    ['协变量', 'Schoenfeld 残差与时间的秩相关 ρ', 'p 值', '比例风险假定'],
    fit.ph.map((r) => [r.name, r.rho === null ? '—' : fmt2(r.rho), r.p === null ? '—' : fmtP(r.p).replace(/^p [=<] /, ''),
      r.p !== null && r.p < 0.05 ? '⚠ 可能违反' : '未见违反']),
    { caption: '比例风险假定诊断（Schoenfeld 残差近似检验）' },
  ));
  if (excluded) note.appendChild(h('p', { class: 'muted small', text: `因协变量缺失被排除：${excluded} 位。缺失以「整行剔除」处理，未作插补。` }));
  note.appendChild(h('p', { class: 'muted small', text: 'HR＞1 表示该因素提高死亡风险，＜1 表示具有保护作用；✱ 标记 p＜0.05。连续变量已按注明的单位缩放。' }));
  note.appendChild(h('p', { class: 'muted small', text:
    '两处必须提防的偏倚：（1）不朽时间偏倚——「亲历战争」「遭遇政变」「首都陷落」都发生在在位途中，本库按「一生中是否发生过」编码为时间固定变量，而必须先活得够久才有机会经历它们，因此这类变量的 HR 会被系统性拉低（甚至出现 HR＜1 的「保护作用」假象）。严格做法是改写为时变协变量，需要逐位皇帝的事件发生时点，本库尚未采集。（2）DSI 内生——DSI＝国祚÷皇帝人数，与在位时长在算术上同源，其 HR 不能读作独立的因果效应。' }));
  host.appendChild(note);
  host.appendChild(legend([
    { color: 'var(--critical)', label: '显著升高风险（p<0.05）', shape: 'dot' },
    { color: 'var(--good)', label: '显著降低风险（p<0.05）', shape: 'dot' },
    { color: 'var(--s1)', label: '不显著', shape: 'dot' },
  ]));
}
