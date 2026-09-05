// nianhao.js — 年号细线图层里两视图共有的那几样（2026-09-04 归一，SSOT 卷 D16）。
//
// 年号跟政权挂钩（idea-timeline-nianhao 用户定案）：细线随带走，不另设全局带。
// 一段一色（`--nh-1..4` 中性四色轮换，与政权配色完全不同），改元即断点——
// 断点密度本身是信息：武周那几年闪成碎彩，康熙六十一年一色到底；先秦无年号，
// 线整段缺席，缺席同样是信息（年号是武帝创的制）。名字不上图（细线容不下字），
// 悬停读年号、起讫与在位君主。
//
// **只收「哪几段、什么颜色、悬停说什么」**。怎么画留在各视图：泳道是贴带缘的
// rect、竖河是 polyPath 垫带，`gNian` 的挂载与 `nhMode`（泳道还耦合行高）也
// 各留各的。`drawNianhao(filterKey)` 被点选手势复用，签名不动。
//
// **`nianhaoSegs` 是 band 的纯函数，绝不顺手统一 `band.s`**：两视图的 `b.s`
// 语义本就不同——竖河重算起点、剔掉称帝前掌权期（`views-river.js` 的 buildBands
// 后处理），泳道用 buildBands 原值。故元「中统」1260-1264 泳道从 1260 画起、
// 竖河被 1271 整段裁掉，吴「黄武」222-229 竖河只剩 229 一年碎线——这差异必须留住。

import { NIANHAO } from './data-nianhao.js';
import { fmtYearAxis } from './year.js';

/** 四色轮换。中性色，与政权配色完全不同（细线不该抢带的颜色）。 */
export const NH_VARS = ['--nh-1', '--nh-2', '--nh-3', '--nh-4'];

/**
 * 这条带上要画的年号段。
 *
 * 讫年含当年（建元讫 −134，翌年改元元光），故线画到 `e + 1`；带被筛选截短时
 * 随带裁。裁空的段跳过，但**色序按原表下标算**——跳过的那些照旧消耗一个色位，
 * 否则同一朝在不同筛选下会换一套配色。
 *
 * @param band 一条 band（要有 `.d.key` / `.s` / `.e`）
 * @returns [{ nh, i, s, e, colorVar }]
 */
export function nianhaoSegs(band) {
  const list = NIANHAO[band.d.key];
  if (!list) return [];
  const out = [];
  list.forEach((nh, i) => {
    const s = Math.max(nh.s, band.s);
    const e = Math.min(nh.e + 1, band.e);
    if (e - s <= 0) return;
    out.push({ nh, i, s, e, colorVar: NH_VARS[i % NH_VARS.length] });
  });
  return out;
}

/** 悬停卡的四行（含那句脚注）。两视图逐字同一份。 */
export const nianhaoTip = (nh, band, colorVar) => [
  { color: `var(${colorVar})`,
    value: `${fmtYearAxis(nh.s)}–${fmtYearAxis(nh.e)}`, label: '年号起讫' },
  { label: '历时', value: `${nh.e - nh.s + 1} 年` },
  ...(nh.emp ? [{ label: '改元之君', value: nh.emp }] : []),
  '年号起讫按年粒度；改元常在年中，同一年正月与腊月可分属两个年号。',
];

/** 悬停卡的抬头。 */
export const nianhaoTitle = (band, nh) => `${band.d.name}·${nh.n}`;
