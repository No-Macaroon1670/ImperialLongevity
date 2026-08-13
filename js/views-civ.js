// views-civ.js — 跨文明比较视图
import { el, h, linear, band, ticks, Frame, hoverable, legend, tableView, notes, fmt1, fmt2 } from './charts.js';
import { civRows, REALMS, reignSurvival, wilson } from './civ.js';
import { kaplanMeier, logRank, coxPH, fmtP, describe, erf } from './stats.js';

const SLOT = { 中国: 'var(--s1)', 拜占庭: 'var(--s2)', 奥斯曼: 'var(--s3)', 日本: 'var(--s4)' };
const MEASURES = [
  { key: 'violent', label: '非正常死亡', color: 'var(--s2)' },
  { key: 'lost', label: '生前失位', color: 'var(--s1)' },
];
const REF = '中国';

const share = (rs, key) => {
  const known = rs.filter((r) => r[key] !== null && r[key] !== undefined);
  return { k: known.filter((r) => r[key] === 1).length, n: known.length };
};
const propTest = (a, b) => {
  const p1 = a.k / a.n, p2 = b.k / b.n;
  const pp = (a.k + b.k) / (a.n + b.n);
  const se = Math.sqrt(pp * (1 - pp) * (1 / a.n + 1 / b.n));
  const z = se ? (p1 - p2) / se : 0;
  return { p1, p2, z, pv: 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2))) };
};

export function renderCiv(host, list, opts) {
  host.innerHTML = '';
  const rows = civRows(list);
  const groups = REALMS.map((r) => ({ realm: r, rows: rows.filter((x) => x.realm === r) })).filter((g) => g.rows.length);
  if (groups.length < 2) {
    host.appendChild(h('p', { class: 'muted', text: '当前筛选下不足两个文明，无法比较。' }));
    return;
  }

  // ── 1) 类型学散点：政体如何「卸下」君主 ────────────────────────────────
  // 两个比例合起来才说明问题：失位高而暴力低＝交班已制度化；两者俱高＝篡弑常态。
  host.appendChild(h('h4', { text: '政体如何卸下君主', class: 'small', style: 'margin:2px 0 6px;color:var(--text-2)' }));
  const f0 = new Frame(host, { width: 1080, height: 330, m: { t: 30, r: 40, b: 52, l: 60 } });
  const x0 = linear([0, 1], [0, f0.pw]);
  const y0 = linear([0, 0.6], [f0.ph, 0]);
  f0.axes({
    x: x0, y: y0, xTicks: [0, .2, .4, .6, .8, 1], yTicks: [0, .1, .2, .3, .4, .5, .6],
    xFmt: (v) => `${Math.round(v * 100)}%`, yFmt: (v) => `${Math.round(v * 100)}%`,
    xLabel: '生前失位率（王位终于身死之前）', yLabel: '非正常死亡率', grid: 'xy',
  });
  for (const g of groups) {
    const sv = share(g.rows, 'violent'), sl = share(g.rows, 'lost');
    if (!sv.n || !sl.n) continue;
    const cx = x0(sl.k / sl.n), cy = y0(sv.k / sv.n);
    const col = SLOT[g.realm] || 'var(--s5)';
    const r = Math.max(6, Math.min(20, Math.sqrt(g.rows.length) * 1.7));
    f0.add(el('circle', { cx, cy, r, fill: col, opacity: .8, stroke: 'var(--surface-1)', 'stroke-width': 2 }));
    f0.add(el('text', { x: cx, y: cy - r - 7, class: 'direct', 'text-anchor': 'middle' }, g.realm));
    f0.add(el('text', { x: cx, y: cy - r - 20, class: 'direct sub', 'text-anchor': 'middle', 'font-size': 10 }, `n=${g.rows.length}`));
    const hit = el('circle', { cx, cy, r: r + 8, fill: 'transparent', class: 'mark' });
    hoverable(hit, () => [
      { color: col, value: `${(sv.k / sv.n * 100).toFixed(0)}%`, label: '非正常死亡' },
      { color: col, value: `${(sl.k / sl.n * 100).toFixed(0)}%`, label: '生前失位' },
      { label: '君主数', value: String(g.rows.length) },
    ], () => g.realm);
    f0.add(hit);
  }
  host.appendChild(h('p', { class: 'muted small', text:
    '横轴越靠右＝君主越少死于任上；纵轴越靠上＝越多死于非命。右下角意味着「换人频繁但换得体面」——'
    + '交班已被制度吸收；左上／右上则是篡弑仍是主要退场方式。点面积正比于君主数。' }));

  // ── 2) 比例与置信区间 ────────────────────────────────────────────────
  const f = new Frame(host, { width: 1080, height: 60 + groups.length * 52, m: { t: 30, r: 40, b: 46, l: 92 } });
  const x = linear([0, 1], [0, f.pw]);
  const y = band(groups.map((g) => g.realm), [0, f.ph], 0.35);
  f.axes({ x, y, xTicks: [0, .2, .4, .6, .8, 1], yTicks: [], xFmt: (v) => `${Math.round(v * 100)}%`, xLabel: '占该文明君主的比例', grid: 'x' });
  const ciRows = [];
  for (const g of groups) {
    const cy = y.center(g.realm);
    f.add(el('text', { x: -12, y: cy + 4, class: 'tick', 'text-anchor': 'end', 'font-size': 12.5, fill: 'var(--text-1)' }, g.realm));
    MEASURES.forEach((m, mi) => {
      const s = share(g.rows, m.key);
      const ci = wilson(s.k, s.n);
      if (!ci) return;
      const yy = cy + (mi === 0 ? -9 : 9);
      f.add(el('line', { x1: x(ci.lo), x2: x(ci.hi), y1: yy, y2: yy, stroke: m.color, 'stroke-width': 2, 'stroke-linecap': 'round', opacity: .55 }));
      const dot = el('circle', { cx: x(ci.p), cy: yy, r: 5.5, fill: m.color, stroke: 'var(--surface-1)', 'stroke-width': 2, class: 'mark' });
      hoverable(dot, () => [
        { color: m.color, value: `${(ci.p * 100).toFixed(0)}%`, label: m.label },
        { label: '95% Wilson CI', value: `${(ci.lo * 100).toFixed(0)}–${(ci.hi * 100).toFixed(0)}%` },
        { label: '计数', value: `${s.k} / ${s.n}` },
      ], () => g.realm);
      f.add(dot);
      f.add(el('text', { x: x(ci.hi) + 8, y: yy + 4, class: 'tick', 'font-size': 11 }, `${(ci.p * 100).toFixed(0)}%`));
      ciRows.push([g.realm, m.label, s.k, s.n, `${(ci.p * 100).toFixed(1)}%`, `${(ci.lo * 100).toFixed(0)}–${(ci.hi * 100).toFixed(0)}%`]);
    });
  }
  host.appendChild(legend(MEASURES.map((m) => ({ color: m.color, label: m.label, shape: 'dot' }))));

  // ── 3) 以中国为参照的两两比较：全时段 vs 同期对照 ──────────────────────
  // 各文明年代跨度差得远（奥斯曼全在 1299 年后，中国横跨两千一百年），
  // 不做同期限定就分不清差异来自政治结构还是「近世普遍比上古安全」。
  const ref = groups.find((g) => g.realm === REF);
  if (ref) {
    let flipped = 0;
    for (const g of groups) {
      if (g === ref) continue;
      const a = share(ref.rows, 'violent'), b = share(g.rows, 'violent');
      if (!a.n || !b.n) continue;
      const t = propTest(a, b);
      const accs = g.rows.map((r) => r.acc);
      const lo = Math.min(...accs), hi = Math.max(...accs);
      const refWin = ref.rows.filter((r) => r.acc >= lo && r.acc <= hi);
      const a2 = share(refWin, 'violent');
      const t2 = a2.n >= 5 ? propTest(a2, b) : null;
      const flip = t2 && (t.pv < 0.05) !== (t2.pv < 0.05);
      if (flip) flipped++;
      host.appendChild(h('div', { class: `result ${(t2 || t).pv < 0.05 ? 'sig-up' : ''}` }, [
        h('strong', { text: `${REF} vs ${g.realm}　非正常死亡：` }),
        document.createTextNode(
          `全时段 ${(t.p1 * 100).toFixed(0)}% vs ${(t.p2 * 100).toFixed(0)}%，${fmtP(t.pv)}`
          + (t2 ? `；同期对照（${Math.round(lo)}–${Math.round(hi)} 年，${REF} n=${a2.n}）`
                 + ` ${(t2.p1 * 100).toFixed(0)}% vs ${(t2.p2 * 100).toFixed(0)}%，${fmtP(t2.pv)}`
                 + (flip ? '　← 结论在同期对照下翻转' : '') : '')
          + '。'),
      ]));
    }
    if (flipped) {
      host.appendChild(h('div', { class: 'notice warn' }, [
        h('strong', { text: `⚠ 年代混杂：${flipped} 组比较在同期对照下翻转。` }),
        document.createTextNode('中国横跨两千一百年，而其余文明各自集中在某几个世纪；'
          + '中国自身的非正常死亡率也随时代显著下降。凡标注「翻转」者，应以同期对照为准——'
          + '全时段的差距很大程度上是「近世普遍比上古安全」，而非政治结构之别。'),
      ]));
    }
  }

  // ── 4) 登基后生存 ────────────────────────────────────────────────────
  host.appendChild(h('h4', { text: '登基后生存', class: 'small', style: 'margin:16px 0 4px;color:var(--text-2)' }));
  const kms = groups.map((g) => {
    const s = reignSurvival(g.rows);
    return { ...g, surv: s, km: s.length >= 5 ? kaplanMeier(s) : null };
  }).filter((g) => g.km);
  if (kms.length) {
    const plot = h('div');
    host.appendChild(plot);
    const f2 = new Frame(plot, { width: 1080, height: 380, m: { t: 30, r: 26, b: 52, l: 56 } });
    const tMax = Math.max(...kms.flatMap((g) => g.km.points.map((p) => p.t)));
    const x2 = linear([0, Math.ceil(tMax)], [0, f2.pw]);
    const y2 = linear([0, 1], [f2.ph, 0]);
    f2.axes({
      x: x2, y: y2, xTicks: ticks(0, tMax, 8), yTicks: [0, .25, .5, .75, 1],
      yFmt: (v) => `${Math.round(v * 100)}%`, xLabel: '登基后年数', yLabel: '生存概率',
    });
    f2.add(el('line', { x1: 0, x2: f2.pw, y1: y2(0.5), y2: y2(0.5), class: 'ref-line', opacity: .6 }));
    for (const g of kms) {
      let d = '';
      g.km.points.forEach((p, i) => {
        const px = x2(p.t), py = y2(p.S);
        d += i === 0 ? `M${px.toFixed(1)},${py.toFixed(1)}` : `H${px.toFixed(1)}V${py.toFixed(1)}`;
      });
      f2.add(el('path', { d, class: 'serie-line', stroke: SLOT[g.realm] || 'var(--s5)' }));
    }
    host.appendChild(legend(kms.map((g) => ({
      color: SLOT[g.realm], shape: 'line',
      label: `${g.realm}（n=${g.surv.length}，中位 ${g.km.median === null ? '未达到' : fmt1(g.km.median) + ' 年'}）`,
    }))));
    const lr = logRank(kms.map((g) => g.surv));
    if (lr) {
      host.appendChild(h('div', { class: `result ${lr.p < 0.05 ? 'sig-up' : ''}` }, [
        h('strong', { text: '各文明登基后生存差异：' }),
        document.createTextNode(` Log-rank χ² = ${fmt2(lr.chi2)}，df = ${lr.df}，${fmtP(lr.p)}。`),
      ]));
    }
  }

  // ── 5) 描述表 ──────────────────────────────────────────────────────────
  host.appendChild(tableView(
    ['文明', '君主数', '生卒可考', '平均享年', '在位中位数(年)', '平均登基年龄'],
    groups.map((g) => {
      const life = describe(g.rows.filter((r) => r.birth !== null && r.death !== null).map((r) => r.death - r.birth));
      const reign = describe(g.rows.filter((r) => r.end !== null).map((r) => r.end - r.acc));
      const accAge = describe(g.rows.filter((r) => r.birth !== null).map((r) => r.acc - r.birth));
      return [g.realm, g.rows.length, life.n, life.n ? fmt1(life.mean) : '—',
        reign.n ? fmt1(reign.median) : '—', accAge.n ? fmt1(accAge.mean) : '—'];
    }), { caption: '各文明描述统计' }));
  host.appendChild(tableView(['文明', '指标', '计数', '分母', '比例', '95% Wilson CI'], ciRows, { caption: '比例与置信区间' }));

  host.appendChild(notes([
    '口径：以「登基后生存」与「非正常死亡比例」为主，因为在位起讫与死亡方式各文明史料都记得牢，而生年普遍稀疏——本项目的主结论亦不依赖生年。生年缺失者照样进在位分析，只是不进寿命分析。',
    '「生前失位」＝王位终于身死之前，不问自愿与否。之所以不用「被废黜」，是因为该概念跨文明不可比：日本的譲位是制度常态，奥斯曼的废立有乌理玛法特瓦的正式程序，中国则多为政变所迫。把三者压成同一个变量等于混淆「制度化交班」与「政变夺位」；自愿与被迫之别，交给它与非正常死亡率的组合去体现。仅精确到年且同年者无法区分「死于任上」与「当年被废后卒」，此时保守记 0，故该指标是下界。',
    '奥斯曼、拜占庭、日本的骨架取自 Wikidata（CC0），每位锚定 QID 可核。Wikidata 的死亡方式覆盖率仅约 40%，缺口由人工判定，见 data/*-manual.json。',
    '名册均经策展：拜占庭起点取 395 年东西罗马永久分治（Wikidata 自 337 年起算，会纳入仍统治全罗马者），并排除 23 位皇后配偶与共治幼帝——Wikidata 的 P39「拜占庭皇帝」把他们一并收入；日本剔除继体天皇（507）以前的传说时代 28 位，其纪年不可信；奥斯曼裁去 1922 年王朝覆灭后的两位家族名誉族长。',
    '拜占庭的非正常死亡率（26%）可能偏低：该朝惯用的政治惩罚是刺瞎与剃度出家而非处死，本库将「被废刺瞎、其后病殁」记为正常死亡。若把致残一并计入，比例会明显上升。',
    '样本量悬殊，故比例一律给 Wilson 区间而非 Wald——后者在小样本下会给出越界或过窄的区间。',
    '这仍是探索性比较：四个文明、且各自年代分布不同，不足以支撑「政治结构 → 统治风险 → 寿命」的因果推断。同期对照已能剔除一部分年代混杂，但地理、史料传统、王位继承法等仍未受控。',
  ]));
}
