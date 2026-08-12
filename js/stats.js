// stats.js — 生存分析与统计检验引擎（纯 JS，无外部依赖）
// 实现：Kaplan–Meier（支持左截断/延迟进入）、Greenwood 方差与 log-log 置信带、
//       Log-rank 检验（k 组）、Cox 比例风险回归（Efron 结法、(start, stop] 区间）、
//       Schoenfeld 残差 PH 诊断、竞争风险累积发病率（Aalen–Johansen）、
//       Mann–Whitney U、Spearman ρ、Welch t、自助法置信区间。

// ── 数值基础 ──────────────────────────────────────────────────────────────
// Abramowitz & Stegun 7.1.26
export function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
  return s * (1 - poly * Math.exp(-x * x));
}
export const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
export const twoSidedZ = (z) => 2 * (1 - normCdf(Math.abs(z)));

function gammaln(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
             -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function gser(a, x) {
  let ap = a, sum = 1 / a, del = sum;
  for (let n = 0; n < 300; n++) {
    ap++; del *= x / ap; sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - gammaln(a));
}
function gcf(a, x) {
  const FPMIN = 1e-300;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i <= 300; i++) {
    const an = -i * (i - a);
    b += 2; d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
}
/** 上不完全伽玛 Q(a,x) = 1 − P(a,x) */
export function gammaQ(a, x) {
  if (x <= 0) return 1;
  return x < a + 1 ? 1 - gser(a, x) : gcf(a, x);
}
/** 卡方分布上尾概率 */
export const chi2P = (x, df) => (x <= 0 || df <= 0 ? 1 : gammaQ(df / 2, x / 2));

/** t 分布双尾 p（用不完全贝塔的正态/卡方近似替代：df≥10 时误差可忽略；小样本给出保守值） */
export function tTestP(t, df) {
  if (!isFinite(t)) return 1;
  const x = df / (df + t * t);
  return betaInc(df / 2, 0.5, x);
}
function betaInc(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
function betacf(a, b, x) {
  const FPMIN = 1e-300, qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d; let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return h;
}

// ── 描述统计 ──────────────────────────────────────────────────────────────
export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const h = (sorted.length - 1) * q, lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}
export function describe(values) {
  const v = values.filter((x) => x !== null && isFinite(x)).slice().sort((a, b) => a - b);
  const n = v.length;
  if (!n) return { n: 0 };
  const mean = v.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  const q1 = quantile(v, 0.25), med = quantile(v, 0.5), q3 = quantile(v, 0.75);
  const iqr = q3 - q1;
  const loFence = q1 - 1.5 * iqr, hiFence = q3 + 1.5 * iqr;
  const inliers = v.filter((x) => x >= loFence && x <= hiFence);
  return {
    n, mean, sd, se: sd / Math.sqrt(n), min: v[0], max: v[n - 1], q1, median: med, q3, iqr,
    whiskerLo: inliers.length ? inliers[0] : v[0],
    whiskerHi: inliers.length ? inliers[inliers.length - 1] : v[n - 1],
    outliers: v.filter((x) => x < loFence || x > hiFence),
    values: v,
  };
}

/** Welch 两样本均值差检验 */
export function welch(a, b) {
  const A = describe(a), B = describe(b);
  if (!A.n || !B.n) return null;
  const diff = A.mean - B.mean;
  const se = Math.sqrt(A.sd ** 2 / A.n + B.sd ** 2 / B.n);
  const df = se === 0 ? 1 : (A.sd ** 2 / A.n + B.sd ** 2 / B.n) ** 2 /
    ((A.sd ** 2 / A.n) ** 2 / (A.n - 1) + (B.sd ** 2 / B.n) ** 2 / (B.n - 1));
  const t = se === 0 ? 0 : diff / se;
  return { diff, se, t, df, p: tTestP(t, df), ci: [diff - 1.96 * se, diff + 1.96 * se], A, B };
}

/** Mann–Whitney U（正态近似，含并列校正） */
export function mannWhitney(a, b) {
  const A = a.filter(isFinite), B = b.filter(isFinite);
  if (!A.length || !B.length) return null;
  const all = [...A.map((v) => ({ v, g: 0 })), ...B.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array(all.length);
  let tieSum = 0, i = 0;
  while (i < all.length) {
    let j = i; while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = r;
    const t = j - i + 1; if (t > 1) tieSum += t ** 3 - t;
    i = j + 1;
  }
  let R1 = 0; all.forEach((o, k) => { if (o.g === 0) R1 += ranks[k]; });
  const n1 = A.length, n2 = B.length, N = n1 + n2;
  const U1 = R1 - n1 * (n1 + 1) / 2;
  const mu = n1 * n2 / 2;
  const sd = Math.sqrt((n1 * n2 / 12) * ((N + 1) - tieSum / (N * (N - 1))));
  const z = sd === 0 ? 0 : (U1 - mu) / sd;
  return { U: U1, z, p: twoSidedZ(z), n1, n2 };
}

/** Spearman 秩相关 */
export function spearman(xs, ys) {
  const pairs = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => isFinite(x) && isFinite(y));
  const n = pairs.length;
  if (n < 3) return null;
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(arr.length);
    let i = 0;
    while (i < idx.length) {
      let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const rk = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = rk;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(pairs.map((p) => p[0])), ry = rank(pairs.map((p) => p[1]));
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  const rho = num / Math.sqrt(dx * dy);
  const t = rho * Math.sqrt((n - 2) / Math.max(1e-12, 1 - rho * rho));
  return { rho, n, p: tTestP(t, n - 2) };
}

/** Pearson 相关与最小二乘直线（用于 DSI 散点趋势线） */
export function linreg(xs, ys) {
  const pairs = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => isFinite(x) && isFinite(y));
  const n = pairs.length; if (n < 2) return null;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n, my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  const slope = sxy / sxx, intercept = my - slope * mx;
  const r = sxy / Math.sqrt(sxx * syy);
  const t = r * Math.sqrt((n - 2) / Math.max(1e-12, 1 - r * r));
  return { slope, intercept, r, r2: r * r, n, p: tTestP(t, n - 2) };
}

// 可复现自助法
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function bootstrapMeanCI(values, B = 2000, seed = 42) {
  const v = values.filter(isFinite); if (v.length < 3) return null;
  const rnd = mulberry32(seed), means = [];
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[(rnd() * v.length) | 0];
    means.push(s / v.length);
  }
  means.sort((a, b) => a - b);
  return [quantile(means, 0.025), quantile(means, 0.975)];
}

// ── Kaplan–Meier（支持左截断） ────────────────────────────────────────────
/** rows: [{entry, exit, event}]，entry 为进入风险集的时间（左截断点） */
export function kaplanMeier(rows, { from = null } = {}) {
  const times = [...new Set(rows.filter((r) => r.event === 1).map((r) => r.exit))].sort((a, b) => a - b);
  let S = 1, cumVar = 0;
  const pts = [];
  const t0 = from === null ? Math.min(...rows.map((r) => r.entry)) : from;
  pts.push({ t: t0, S: 1, lo: 1, hi: 1, atRisk: rows.filter((r) => r.entry <= t0 && r.exit > t0).length, events: 0 });
  for (const t of times) {
    if (t <= t0) continue;
    const atRisk = rows.filter((r) => r.entry < t && r.exit >= t).length;
    const d = rows.filter((r) => r.exit === t && r.event === 1).length;
    if (atRisk === 0) continue;
    S *= 1 - d / atRisk;
    if (atRisk > d) cumVar += d / (atRisk * (atRisk - d));
    // log-log 置信区间
    let lo = S, hi = S;
    if (S > 0 && S < 1 && cumVar > 0) {
      const se = Math.sqrt(cumVar) / Math.abs(Math.log(S));
      const c = Math.exp(1.96 * se);
      lo = Math.pow(S, c); hi = Math.pow(S, 1 / c);
    }
    pts.push({ t, S, lo, hi, atRisk, events: d });
  }
  const medIdx = pts.findIndex((p) => p.S <= 0.5);
  return {
    points: pts,
    median: medIdx > 0 ? pts[medIdx].t : null,
    n: rows.length,
    events: rows.filter((r) => r.event === 1).length,
    at: (t) => { let s = 1; for (const p of pts) { if (p.t <= t) s = p.S; else break; } return s; },
  };
}

/** 限制平均生存时间 RMST（截至 tau），对删失稳健的「平均」替代 */
export function rmst(km, tau) {
  let area = 0, prev = km.points[0].t, prevS = 1;
  for (const p of km.points) {
    if (p.t > tau) break;
    area += prevS * (p.t - prev); prev = p.t; prevS = p.S;
  }
  area += prevS * Math.max(0, tau - prev);
  return area;
}

// ── Log-rank 检验（k 组，支持左截断） ─────────────────────────────────────
export function logRank(groups) {
  const k = groups.length;
  if (k < 2) return null;
  const all = groups.flatMap((g, gi) => g.map((r) => ({ ...r, gi })));
  const times = [...new Set(all.filter((r) => r.event === 1).map((r) => r.exit))].sort((a, b) => a - b);
  const U = new Array(k - 1).fill(0);
  const V = Array.from({ length: k - 1 }, () => new Array(k - 1).fill(0));
  let obs = new Array(k).fill(0), exp = new Array(k).fill(0);
  for (const t of times) {
    const risk = all.filter((r) => r.entry < t && r.exit >= t);
    const n = risk.length; if (n === 0) continue;
    const d = all.filter((r) => r.exit === t && r.event === 1).length;
    const nj = new Array(k).fill(0);
    for (const r of risk) nj[r.gi]++;
    const dj = new Array(k).fill(0);
    for (const r of all) if (r.exit === t && r.event === 1) dj[r.gi]++;
    for (let j = 0; j < k; j++) { obs[j] += dj[j]; exp[j] += d * nj[j] / n; }
    if (n <= 1) continue;
    const f = d * (n - d) / (n - 1);
    for (let a = 0; a < k - 1; a++) {
      U[a] += dj[a] - d * nj[a] / n;
      for (let b = 0; b < k - 1; b++) {
        V[a][b] += f * ((a === b ? nj[a] / n : 0) - (nj[a] / n) * (nj[b] / n));
      }
    }
  }
  const Vi = invert(V);
  if (!Vi) return null;
  let chi2 = 0;
  for (let a = 0; a < k - 1; a++) for (let b = 0; b < k - 1; b++) chi2 += U[a] * Vi[a][b] * U[b];
  const df = k - 1;
  return { chi2, df, p: chi2P(chi2, df), observed: obs, expected: exp };
}

// ── 矩阵工具 ──────────────────────────────────────────────────────────────
export function invert(M) {
  const n = M.length;
  const A = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    const pv = A[c][c];
    for (let j = 0; j < 2 * n; j++) A[c][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((row) => row.slice(n));
}

// ── Cox 比例风险回归（Efron 结法，(start, stop] 区间） ─────────────────────
/**
 * data: [{entry, exit, event, x:[...]}]
 * 返回 beta、标准误、HR、95%CI、Wald p、似然比检验、Schoenfeld PH 诊断
 */
export function coxPH(data, names, { maxIter = 40, tol = 1e-9 } = {}) {
  const p = names.length;
  if (!p || data.length < p + 2) return null;
  const eventTimes = [...new Set(data.filter((d) => d.event === 1).map((d) => d.exit))].sort((a, b) => a - b);
  if (!eventTimes.length) return null;

  const loglikAt = (beta, wantDeriv) => {
    let ll = 0;
    const U = new Array(p).fill(0);
    const I = Array.from({ length: p }, () => new Array(p).fill(0));
    for (const t of eventTimes) {
      const risk = data.filter((d) => d.entry < t && d.exit >= t);
      const die = data.filter((d) => d.exit === t && d.event === 1);
      const m = die.length; if (!m || !risk.length) continue;
      let s0 = 0; const s1 = new Array(p).fill(0);
      const s2 = Array.from({ length: p }, () => new Array(p).fill(0));
      for (const r of risk) {
        let eta = 0; for (let j = 0; j < p; j++) eta += beta[j] * r.x[j];
        const w = Math.exp(eta); s0 += w;
        for (let j = 0; j < p; j++) { s1[j] += w * r.x[j]; for (let l = 0; l < p; l++) s2[j][l] += w * r.x[j] * r.x[l]; }
      }
      let d0 = 0; const d1 = new Array(p).fill(0);
      const d2 = Array.from({ length: p }, () => new Array(p).fill(0));
      const xsum = new Array(p).fill(0);
      for (const r of die) {
        let eta = 0; for (let j = 0; j < p; j++) eta += beta[j] * r.x[j];
        const w = Math.exp(eta); d0 += w;
        for (let j = 0; j < p; j++) {
          xsum[j] += r.x[j]; d1[j] += w * r.x[j];
          for (let l = 0; l < p; l++) d2[j][l] += w * r.x[j] * r.x[l];
        }
      }
      for (let j = 0; j < p; j++) ll += beta[j] * xsum[j];
      if (wantDeriv) for (let j = 0; j < p; j++) U[j] += xsum[j];
      for (let l = 0; l < m; l++) {
        const f = l / m;
        const a0 = s0 - f * d0;
        if (a0 <= 0) continue;
        ll -= Math.log(a0);
        if (!wantDeriv) continue;
        const a1 = new Array(p);
        for (let j = 0; j < p; j++) a1[j] = s1[j] - f * d1[j];
        for (let j = 0; j < p; j++) U[j] -= a1[j] / a0;
        for (let j = 0; j < p; j++) for (let q = 0; q < p; q++) {
          const a2 = s2[j][q] - f * d2[j][q];
          I[j][q] += a2 / a0 - (a1[j] / a0) * (a1[q] / a0);
        }
      }
    }
    return { ll, U, I };
  };

  let beta = new Array(p).fill(0);
  const ll0 = loglikAt(beta, false).ll;
  let last = ll0, info = null, converged = false;
  for (let it = 0; it < maxIter; it++) {
    const { ll, U, I } = loglikAt(beta, true);
    info = I;
    const Iinv = invert(I);
    if (!Iinv) break;
    const step = new Array(p).fill(0);
    for (let j = 0; j < p; j++) for (let q = 0; q < p; q++) step[j] += Iinv[j][q] * U[q];
    // 步长折半保证似然上升
    let lambda = 1, ok = false, cand = beta;
    for (let h = 0; h < 12; h++) {
      cand = beta.map((b, j) => b + lambda * step[j]);
      const test = loglikAt(cand, false).ll;
      if (isFinite(test) && test >= ll - 1e-10) { ok = true; last = test; break; }
      lambda /= 2;
    }
    if (!ok) break;
    const delta = Math.max(...step.map((s, j) => Math.abs(lambda * s)));
    beta = cand;
    if (delta < tol) { converged = true; break; }
  }
  const { I: Ifin } = loglikAt(beta, true);
  const cov = invert(Ifin);
  if (!cov) return null;
  const se = beta.map((_, j) => Math.sqrt(Math.max(0, cov[j][j])));
  const terms = names.map((name, j) => {
    const z = se[j] > 0 ? beta[j] / se[j] : 0;
    return {
      name, beta: beta[j], se: se[j], hr: Math.exp(beta[j]),
      lo: Math.exp(beta[j] - 1.96 * se[j]), hi: Math.exp(beta[j] + 1.96 * se[j]),
      z, p: twoSidedZ(z),
    };
  });
  const lrt = 2 * (last - ll0);
  return {
    terms, loglik: last, loglikNull: ll0, converged,
    lrt: { chi2: lrt, df: p, p: chi2P(lrt, p) },
    n: data.length, events: data.filter((d) => d.event === 1).length,
    ph: schoenfeldPH(data, beta, names, eventTimes),
  };
}

/** Schoenfeld 残差与时间秩的相关性 → 比例风险假定的近似检验 */
function schoenfeldPH(data, beta, names, eventTimes) {
  const p = names.length;
  const res = Array.from({ length: p }, () => []);
  const tOrder = [];
  for (const t of eventTimes) {
    const risk = data.filter((d) => d.entry < t && d.exit >= t);
    const die = data.filter((d) => d.exit === t && d.event === 1);
    if (!risk.length || !die.length) continue;
    let s0 = 0; const s1 = new Array(p).fill(0);
    for (const r of risk) {
      let eta = 0; for (let j = 0; j < p; j++) eta += beta[j] * r.x[j];
      const w = Math.exp(eta); s0 += w;
      for (let j = 0; j < p; j++) s1[j] += w * r.x[j];
    }
    for (const d of die) {
      for (let j = 0; j < p; j++) res[j].push(d.x[j] - s1[j] / s0);
      tOrder.push(t);
    }
  }
  return names.map((name, j) => {
    const s = spearman(tOrder, res[j]);
    return { name, rho: s ? s.rho : null, p: s ? s.p : null };
  });
}

/**
 * 风险集退化诊断。
 * 左截断下若某个事件时点的风险集只剩一人，其死亡会把生存概率 S 直接打到 0；
 * 此后所有增量都是 S×d/n＝0，余下的样本对曲线不再有任何贡献——
 * KM 会平在 0，累积发生率会永久冻结在崩塌那一刻的取值。
 * 估计量本身没算错，但画出来的东西毫无意义，必须显式拦截而不是让它静静地误导人。
 */
export function riskSetDiagnostics(rows) {
  const times = [...new Set(rows.filter((r) => r.event === 1).map((r) => r.exit))].sort((a, b) => a - b);
  const totalEvents = rows.filter((r) => r.event === 1).length;
  let S = 1, minAtRisk = Infinity, collapseTime = null, collapseWho = [], eventsAfter = 0;
  for (const t of times) {
    const atRisk = rows.filter((r) => r.entry < t && r.exit >= t);
    if (!atRisk.length) continue;
    const dead = rows.filter((r) => r.exit === t && r.event === 1);
    minAtRisk = Math.min(minAtRisk, atRisk.length);
    if (S > 0) {
      S *= 1 - dead.length / atRisk.length;
      if (S <= 0 && collapseTime === null) { collapseTime = t; collapseWho = dead.map((r) => r.e).filter(Boolean); }
    } else {
      eventsAfter += dead.length;
    }
  }
  // S 在「最后一个事件」处归零是曲线的正常终点（最长寿者去世），不算退化：
  // 只有当归零之后仍有事件被吞掉（eventsAfter > 0）时，曲线才真的丢了数据。
  return {
    minAtRisk: isFinite(minAtRisk) ? minAtRisk : 0,
    collapseTime, collapseWho, eventsAfter, totalEvents,
    degenerate: collapseTime !== null && eventsAfter > 0,
  };
}

// ── 竞争风险：分因累积发病率（Aalen–Johansen） ────────────────────────────
/** rows: [{entry, exit, event, cause}]；event=1 表示发生事件，cause 为事件类型 key */
export function cumulativeIncidence(rows, causes) {
  const times = [...new Set(rows.filter((r) => r.event === 1).map((r) => r.exit))].sort((a, b) => a - b);
  let S = 1;
  const cif = Object.fromEntries(causes.map((c) => [c, [{ t: times.length ? times[0] : 0, F: 0 }]]));
  const acc = Object.fromEntries(causes.map((c) => [c, 0]));
  for (const t of times) {
    const atRisk = rows.filter((r) => r.entry < t && r.exit >= t).length;
    if (!atRisk) continue;
    const dTot = rows.filter((r) => r.exit === t && r.event === 1).length;
    for (const c of causes) {
      const dc = rows.filter((r) => r.exit === t && r.event === 1 && r.cause === c).length;
      if (dc) acc[c] += S * dc / atRisk;
      cif[c].push({ t, F: acc[c] });
    }
    S *= 1 - dTot / atRisk;
  }
  return cif;
}

export function fmtP(p) {
  if (p === null || p === undefined || !isFinite(p)) return '—';
  if (p < 0.0001) return 'p < 0.0001';
  if (p < 0.001) return `p = ${p.toFixed(4)}`;
  return `p = ${p.toFixed(3)}`;
}
