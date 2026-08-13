// civ.js — 跨文明比较的公共口径
//
// 中国库有二十余个字段，其余文明只有骨架，无法逐一对齐。但真正驱动结论的只有四项：
// 登基年龄、在位时长、非正常死亡、政治结构。其中**在位起讫与死亡方式各文明史料都记得牢**，
// 生年才是普遍稀疏的那一项——而本项目的主结论（登基后死亡风险 HR=0.71、分因 HR=0.40）
// 恰恰不依赖生年。故跨文明比较以「登基后生存 + 非正常死亡比例」为主口径，
// 生年缺失者照样进在位分析，只是不进寿命分析。
import { parseDate } from './schema.js';
import { CIV_ROWS } from './civ-data.js';

const yr = (s) => { const d = parseDate(s); return d ? d.t : null; };

/** 把奥斯曼骨架与中国库投影到同一形状 */
export function civRows(chineseList) {
  const rows = [];

  for (const e of chineseList) {
    const acc = e.reigns[0].s;
    if (!acc) continue;
    const end = e.reignEnd ? e.reignEnd.t : null;
    const death = e.death ? e.death.t : null;
    rows.push({
      realm: '中国', name: e.temple, sub: e.dynasty,
      acc: acc.t, end, death,
      birth: e.birth ? e.birth.t : null,
      violent: e.violent,
      // 与其余文明同口径：王位终于身死之前即为「生前失位」，不问自愿与否
      lost: (end !== null && death !== null && death - end > 0.02) ? 1 : 0,
      ref: null,
    });
  }

  for (const r of CIV_ROWS) {
    const acc = yr(r.acc);
    if (acc === null) continue;
    rows.push({
      realm: r.realm, name: r.name, sub: null,
      acc, end: yr(r.end), death: yr(r.death), birth: yr(r.birth),
      violent: r.violent, lost: r.lost,
      ref: `https://www.wikidata.org/wiki/${r.qid}`,
    });
  }
  return rows;
}

// 顺序即叙事顺序：本库主角在前，其余按「暴力—失位」谱系排开
export const REALMS = ['中国', '拜占庭', '奥斯曼', '日本'];

/** 登基后生存：自即位随访至死亡，与本项目主分析同口径（不在退位处删失） */
export function reignSurvival(rows) {
  const out = [];
  for (const r of rows) {
    if (r.acc === null || r.death === null) continue;
    out.push({ e: r, entry: 0, exit: Math.max(1 / 365, r.death - r.acc), event: 1 });
  }
  return out;
}

/** Wilson 区间：比例的小样本置信区间，比 Wald 稳健（奥斯曼只有 36 人） */
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n);
  const s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return { p, lo: Math.max(0, (c - s) / d), hi: Math.min(1, (c + s) / d) };
}
