// views-civ.js — 跨文明比较视图
import { el, h, linear, band, ticks, Frame, hoverable, legend, tableView, notes, fmt1, fmt2 } from './charts.js';
import { civRows, REALMS, reignSurvival, wilson } from './civ.js';
import { kaplanMeier, logRank, coxPH, fmtP, describe } from './stats.js';

const SLOT = { 中国: 'var(--s1)', 奥斯曼: 'var(--s2)' };
const MEASURES = [
  { key: 'violent', label: '非正常死亡', color: 'var(--s2)' },
  { key: 'deposed', label: '被废黜', color: 'var(--s1)' },
];

export function renderCiv(host, list, opts) {
  host.innerHTML = '';
  const rows = civRows(list);
  const byRealm = REALMS.map((r) => ({ realm: r, rows: rows.filter((x) => x.realm === r) })).filter((g) => g.rows.length);
  if (byRealm.length < 2) {
    host.appendChild(h('p', { class: 'muted', text: '当前筛选下不足两个文明，无法比较。' }));
    return;
  }

  // ── 1) 比例对比：非正常死亡 / 被废黜，附 Wilson 区间 ──────────────────
  const f = new Frame(host, { width: 1080, height: 190, m: { t: 30, r: 30, b: 46, l: 92 } });
  const x = linear([0, 1], [0, f.pw]);
  const lanes = byRealm.map((g) => g.realm);
  const y = band(lanes, [0, f.ph], 0.35);
  f.axes({
    x, y, xTicks: [0, 0.2, 0.4, 0.6, 0.8, 1], yTicks: [],
    xFmt: (v) => `${Math.round(v * 100)}%`, xLabel: '占该文明君主的比例', grid: 'x',
  });
  const tableRows = [];
  for (const g of byRealm) {
    const cy = y.center(g.realm);
    f.add(el('text', { x: -12, y: cy + 4, class: 'tick', 'text-anchor': 'end', 'font-size': 12.5, fill: 'var(--text-1)' }, g.realm));
    MEASURES.forEach((m, mi) => {
      const known = g.rows.filter((r) => r[m.key] !== null && r[m.key] !== undefined);
      const k = known.filter((r) => r[m.key] === 1).length;
      const ci = wilson(k, known.length);
      if (!ci) return;
      const yy = cy + (mi === 0 ? -9 : 9);
      f.add(el('line', { x1: x(ci.lo), x2: x(ci.hi), y1: yy, y2: yy, stroke: m.color, 'stroke-width': 2, 'stroke-linecap': 'round', opacity: .55 }));
      const dot = el('circle', { cx: x(ci.p), cy: yy, r: 5.5, fill: m.color, stroke: 'var(--surface-1)', 'stroke-width': 2, class: 'mark' });
      hoverable(dot, () => [
        { color: m.color, value: `${(ci.p * 100).toFixed(0)}%`, label: m.label },
        { label: '95% Wilson CI', value: `${(ci.lo * 100).toFixed(0)}–${(ci.hi * 100).toFixed(0)}%` },
        { label: '计数', value: `${k} / ${known.length}` },
      ], () => g.realm);
      f.add(dot);
      f.add(el('text', { x: x(ci.hi) + 8, y: yy + 4, class: 'tick', 'font-size': 11 }, `${(ci.p * 100).toFixed(0)}%`));
      tableRows.push([g.realm, m.label, k, known.length, `${(ci.p * 100).toFixed(1)}%`, `${(ci.lo * 100).toFixed(0)}–${(ci.hi * 100).toFixed(0)}%`]);
    });
  }
  host.appendChild(legend(MEASURES.map((m) => ({ color: m.color, label: m.label, shape: 'dot' }))));

  // 两两比较非正常死亡比例。除全时段外，另给「同期对照」——
  // 各文明的年代跨度差得很远（奥斯曼全在 1299–1922，中国横跨两千一百年），
  // 不做同期限定就分不清差异来自政治结构还是「近世普遍比上古安全」。
  const propTest = (a, b) => {
    const p1 = a.k / a.n, p2 = b.k / b.n;
    const pp = (a.k + b.k) / (a.n + b.n);
    const se = Math.sqrt(pp * (1 - pp) * (1 / a.n + 1 / b.n));
    const z = se ? (p1 - p2) / se : 0;
    return { p1, p2, z, pv: 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2))) };
  };
  const counts = (rs) => {
    const known = rs.filter((r) => r.violent !== null && r.violent !== undefined);
    return { k: known.filter((r) => r.violent === 1).length, n: known.length };
  };
  let matched = null;
  if (byRealm.length === 2) {
    const [ga, gb] = byRealm;
    const a = { realm: ga.realm, ...counts(ga.rows) };
    const b = { realm: gb.realm, ...counts(gb.rows) };
    const t = propTest(a, b);
    host.appendChild(h('div', { class: `result ${t.pv < 0.05 ? 'sig-up' : ''}` }, [
      h('strong', { text: '全时段：' }),
      document.createTextNode(`非正常死亡 ${a.realm} ${(t.p1 * 100).toFixed(0)}%（${a.k}/${a.n}） vs `
        + `${b.realm} ${(t.p2 * 100).toFixed(0)}%（${b.k}/${b.n}），z = ${fmt2(t.z)}，${fmtP(t.pv)}。`),
    ]));

    // 同期窗口 = 非中国各文明的登基年跨度
    const other = byRealm.filter((g) => g.realm !== '中国').flatMap((g) => g.rows.map((r) => r.acc));
    if (other.length && byRealm.some((g) => g.realm === '中国')) {
      const lo = Math.min(...other), hi = Math.max(...other);
      const win = byRealm.map((g) => ({ realm: g.realm, rows: g.rows.filter((r) => r.acc >= lo && r.acc <= hi) }));
      const a2 = { realm: win[0].realm, ...counts(win[0].rows) };
      const b2 = { realm: win[1].realm, ...counts(win[1].rows) };
      if (a2.n >= 5 && b2.n >= 5) {
        const t2 = propTest(a2, b2);
        const lr2 = logRank(win.map((g) => reignSurvival(g.rows)));
        matched = { lo, hi, win, t2, lr2 };
        const flip = (t.pv < 0.05) !== (t2.pv < 0.05);
        host.appendChild(h('div', { class: `result ${t2.pv < 0.05 ? 'sig-up' : ''}` }, [
          h('strong', { text: `同期对照（${Math.round(lo)}–${Math.round(hi)} 年）：` }),
          document.createTextNode(`非正常死亡 ${a2.realm} ${(t2.p1 * 100).toFixed(0)}%（${a2.k}/${a2.n}） vs `
            + `${b2.realm} ${(t2.p2 * 100).toFixed(0)}%（${b2.k}/${b2.n}），z = ${fmt2(t2.z)}，${fmtP(t2.pv)}`
            + (lr2 ? `；登基后生存 Log-rank ${fmtP(lr2.p)}` : '') + '。'),
        ]));
        if (flip) {
          host.appendChild(h('div', { class: 'notice warn' }, [
            h('strong', { text: '⚠ 年代混杂：结论在同期对照下翻转。' }),
            document.createTextNode(`把中国限定到与${byRealm.find((g) => g.realm !== '中国').realm}相同的年代窗口后，`
              + `原本显著的差异不再显著——中国自身的非正常死亡率也从全时段的 `
              + `${(t.p1 * 100).toFixed(0)}% 降到该窗口内的 ${(t2.p1 * 100).toFixed(0)}%。`
              + `这说明全时段的差距很大程度上是「近世普遍比上古安全」，而非政治结构之别。`
              + `以同期对照为准。`),
          ]));
        }
      }
    }
  }

  // ── 2) 登基后生存曲线 ────────────────────────────────────────────────
  host.appendChild(h('h4', { text: '登基后生存', class: 'small', style: 'margin:16px 0 4px;color:var(--text-2)' }));
  const groups = byRealm.map((g) => {
    const s = reignSurvival(g.rows);
    return { ...g, surv: s, km: s.length >= 5 ? kaplanMeier(s) : null };
  }).filter((g) => g.km);
  if (groups.length >= 1) {
    const plot = h('div');
    host.appendChild(plot);
    const f2 = new Frame(plot, { width: 1080, height: 380, m: { t: 30, r: 26, b: 52, l: 56 } });
    const tMax = Math.max(...groups.flatMap((g) => g.km.points.map((p) => p.t)));
    const x2 = linear([0, Math.ceil(tMax)], [0, f2.pw]);
    const y2 = linear([0, 1], [f2.ph, 0]);
    f2.axes({
      x: x2, y: y2, xTicks: ticks(0, tMax, 8), yTicks: [0, .25, .5, .75, 1],
      yFmt: (v) => `${Math.round(v * 100)}%`, xLabel: '登基后年数', yLabel: '生存概率',
    });
    for (const g of groups) {
      let d = '';
      g.km.points.forEach((p, i) => {
        const px = x2(p.t), py = y2(p.S);
        d += i === 0 ? `M${px.toFixed(1)},${py.toFixed(1)}` : `H${px.toFixed(1)}V${py.toFixed(1)}`;
      });
      f2.add(el('path', { d, class: 'serie-line', stroke: SLOT[g.realm] || 'var(--s3)' }));
      if (g.km.median !== null) {
        f2.add(el('text', { x: x2(g.km.median) + 5, y: y2(0.5) + 14, class: 'direct' }, `中位 ${fmt1(g.km.median)} 年`));
        f2.add(el('line', { x1: x2(g.km.median), x2: x2(g.km.median), y1: y2(0.5), y2: f2.ph, stroke: SLOT[g.realm], 'stroke-width': 1, opacity: .45 }));
      }
    }
    f2.add(el('line', { x1: 0, x2: f2.pw, y1: y2(0.5), y2: y2(0.5), class: 'ref-line', opacity: .6 }));
    host.appendChild(legend(groups.map((g) => ({ color: SLOT[g.realm], label: `${g.realm}（n=${g.surv.length}）`, shape: 'line' }))));

    if (groups.length === 2) {
      const lr = logRank(groups.map((g) => g.surv));
      if (lr) {
        host.appendChild(h('div', { class: `result ${lr.p < 0.05 ? 'sig-up' : ''}` }, [
          h('strong', { text: 'Log-rank：' }),
          document.createTextNode(` χ² = ${fmt2(lr.chi2)}，${fmtP(lr.p)}；中位存活 `
            + groups.map((g) => `${g.realm} ${g.km.median === null ? '未达到' : fmt1(g.km.median) + ' 年'}`).join('、') + '。'),
        ]));
      }
      // 控制登基年龄后的风险比（仅用生年可考者）
      const data = groups.flatMap((g, gi) => g.surv
        .filter((s) => s.e.birth !== null)
        .map((s) => ({ entry: 0, exit: s.exit, event: 1, x: [gi, (s.e.acc - s.e.birth) / 10] })));
      if (data.length > 30) {
        const fit = coxPH(data, [`${groups[1].realm}（对照：${groups[0].realm}）`, '登基年龄（每+10岁）']);
        if (fit) {
          const t = fit.terms[0];
          host.appendChild(h('div', { class: 'result' }, [
            h('strong', { text: '控制登基年龄后：' }),
            document.createTextNode(` ${groups[1].realm}相对${groups[0].realm}的登基后死亡风险 HR = ${fmt2(t.hr)}`
              + `（95% CI ${fmt2(t.lo)}–${fmt2(t.hi)}，${fmtP(t.p)}），n = ${fit.n}。`),
          ]));
        }
      }
    }
  }

  // ── 3) 描述表 ──────────────────────────────────────────────────────────
  const summary = byRealm.map((g) => {
    const life = describe(g.rows.filter((r) => r.birth !== null && r.death !== null).map((r) => r.death - r.birth));
    const reign = describe(g.rows.filter((r) => r.end !== null).map((r) => r.end - r.acc));
    const accAge = describe(g.rows.filter((r) => r.birth !== null).map((r) => r.acc - r.birth));
    return [g.realm, g.rows.length, life.n, life.n ? fmt1(life.mean) : '—',
      reign.n ? fmt1(reign.median) : '—', accAge.n ? fmt1(accAge.mean) : '—'];
  });
  host.appendChild(tableView(['文明', '君主数', '生卒可考', '平均享年', '在位中位数(年)', '平均登基年龄'], summary,
    { caption: '各文明描述统计' }));
  host.appendChild(tableView(['文明', '指标', '计数', '分母', '比例', '95% Wilson CI'], tableRows,
    { caption: '比例与置信区间' }));

  host.appendChild(notes([
    '口径：以「登基后生存」与「非正常死亡比例」为主，因为在位起讫与死亡方式各文明史料都记得牢，而生年普遍稀疏——本项目的主结论亦不依赖生年。生年缺失者照样进在位分析，只是不进寿命分析。',
    '奥斯曼骨架取自 Wikidata（CC0），每位锚定 QID 可核；死亡方式 Wikidata 仅覆盖 15/36，其余 21 位与全部「被废黜」判定为人工标注，见 data/ottoman-manual.json。',
    '名册经策展：Wikidata 的 P39 把王朝覆灭后的家族名誉族长也算作在位，按 end_year=1922 裁去两位后为 36 位，与传世谱系吻合。',
    '样本量悬殊（中国数百 vs 奥斯曼 36），故比例一律给 Wilson 区间而非 Wald——后者在小样本下会给出越界或过窄的区间。',
    '★ 年代混杂是这一比较目前最大的软肋：奥斯曼全部落在 1299–1922 年，而中国横跨两千一百年。'
      + '两者之差既可能来自政治结构，也可能来自「近世普遍比上古安全」。用上方的「登基年份」过滤器'
      + '把中国限定到 1300–1922 年再看，是最直接的稳健性检查。',
    '「被废黜」的判定口径也未必等价：奥斯曼的废立有乌理玛出具法特瓦的制度化程序，中国则多为政变或权臣所迫，'
      + '两者计为同一个 0/1 变量已是简化。',
    '这是跨文明扩展的第一步，仅两个文明尚不足以检验「政治结构 → 统治风险 → 寿命」；拜占庭（无继承法、风险最高）与日本（礼仪君主、风险最低）才是拉开对照的关键，尚待接入。',
  ]));
}

// 误差函数（stats.js 已有，此处避免循环依赖而内联）
function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  return s * (1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
}
