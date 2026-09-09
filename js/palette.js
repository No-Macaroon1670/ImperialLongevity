// palette.js — 全库分类色槽的唯一出处（零依赖叶子模块）
//
// styles.css 的 --s1…--s8 是一套已校验的 categorical 八色，浅／深两面各自「选定」步进
// （非自动反转）。此前这张表被抄在三处：泳道 8 槽（views-lanes）、箱线 6 槽
// （views-compare）、KM 4 槽（views-survival）。抄少了的两处出事：分组变量「时代」有
// 八级，KM 只四色时四对曲线同色（夏商西周≡隋唐、春秋战国≡五代十国、秦汉≡宋辽金夏、
// 三国两晋南北朝≡元明清），只靠图例分不开；箱线六色也有两对撞。故收成一处，谁要取色
// 都从这里拿八槽 —— 2026-09-09 D57。
//
// 两种取法各有用处：
//   SLOT_VARS/slotVar 出**变量名**（'--s3'），给需要再拼 `var(...)`、或要按变量名查
//     resolveInk 明暗表的调用方（泳道、河流、地方线）；
//   SLOTS 出**可直接写进 fill/stroke 的值**（'var(--s3)'），给图表视图。
// 两者同序同源，任何一处改色两处一起变。

export const SLOT_VARS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];

/** 色相用尽后的中性槽：泳道图里边缘割据政权、地方线里查不到朝代的段都落这里 */
export const OTHER_VAR = '--lane-other';

/** 槽位序号 → CSS 变量名；负号表示「没槽了」，退中性色 */
export const slotVar = (s) => (s < 0 ? OTHER_VAR : SLOT_VARS[s]);

/** 槽位序号 → 可直接用作 fill/stroke 的 var() 串 */
export const SLOTS = SLOT_VARS.map((v) => `var(${v})`);
