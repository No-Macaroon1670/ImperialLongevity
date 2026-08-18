// schema.js — 数据模式、编码表、日期解析
// -----------------------------------------------------------------------------
// 紧凑记录格式（data-*.js 中使用短键，以控制文件体积）：
//   n  姓名            t  庙号/通称        p  谥号
//   d  朝代 key        e  民族（默认「汉」）
//   b  出生日期        x  死亡日期         a  登基（即帝位）日期
//   r  实际掌权起始（若早于称帝，可选）      z  退位/失位日期（可选）
//   c  死因编码        o  political_order（缺省由朝代推导）
//   f  1=开国皇帝      l  1=亡国皇帝
//   F  标志位字符串（见 FLAGS）
//   cs 后妃数量        ch 子女人数         tc 称号类别
//   wk 维基词条覆盖（人名直搜落错时的核验正题，先秦批次全带）
//   no 备注
// -----------------------------------------------------------------------------

/** 死因编码。0–5 为需求文档所定义；6「意外/事故」为本库的显式扩展。 */
export const CAUSE = {
  0: { key: 'natural',  label: '自然死亡', short: '自然', violent: 0 },
  1: { key: 'illness',  label: '疾病死亡', short: '疾病', violent: 0 },
  2: { key: 'killed',   label: '被杀',     short: '被杀', violent: 1 },
  3: { key: 'battle',   label: '战死',     short: '战死', violent: 1 },
  4: { key: 'suicide',  label: '自杀',     short: '自杀', violent: 1 },
  5: { key: 'unknown',  label: '原因不明', short: '不明', violent: null },
  6: { key: 'accident', label: '意外事故', short: '意外', violent: 0 },
};

export const CAUSE_ORDER = [0, 1, 6, 2, 3, 4, 5];

/** political_order：0 分裂时代 / 1 统一稳定期 / 2 统一末期 */
export const ORDER_LABEL = { 0: '分裂时代', 1: '统一稳定期', 2: '统一末期' };

/** 标志位：F 字段中出现该字母即为 1，未出现即为 0（= 无明确史料记载）。 */
export const FLAGS = {
  w: 'civilWar',       // 是否经历内战
  u: 'coup',           // 是否遭遇政变
  p: 'deposed',        // 是否被废黜
  k: 'capitalFall',    // 是否经历首都陷落
  W: 'warfare',        // 是否亲历大规模对外战争
  A: 'alchemy',        // 是否服丹药（含五石散/寒食散、金石药、方士所进丹丸）
  i: 'chronicIllness', // 是否记载慢性疾病
  L: 'alcohol',        // 是否酗酒
  O: 'obesity',        // 是否肥胖
  D: 'disputed',       // 死因/死期史料存疑
  N: 'nominal',        // 名义/未正式即皇帝位（默认排除出主分析）
  G: 'female',         // 女性君主
  // 先秦扩张新增。共和（前841）之前没有任何史源确年，夏与商前期君主的
  // 起讫是「传统在位年数（今本竹书体系）等比铺入断代工程朝代窗口」构造出来的
  // ——是坐标，不是记载。带此旗者两个全景视图画成斜纹＋半透明，与实证段区分。
  // 不复用 D（disputed 说的是死因/死期的史料分歧，这里是整套年代的证据等级）。
  Y: 'yearsSurmised',  // 在位年代为传统系年/推算铺入，非史源确年
};

export const FLAG_LABEL = {
  civilWar: '内战', coup: '政变', deposed: '被废黜', capitalFall: '首都陷落',
  warfare: '对外战争', alchemy: '服丹药', chronicIllness: '慢性疾病',
  alcohol: '酗酒', obesity: '肥胖', disputed: '死因存疑',
  nominal: '名义君主', female: '女性', yearsSurmised: '年代拟测',
};

/** 称号类别：用于「入库标准」的透明化。公/侯为先秦诸侯（春秋战国的国君多数终身未称王）。 */
export const TITLE_CLASS = { 帝: '皇帝', 天王: '天王', 汗: '大汗', 王: '国王/藩王', 公: '诸侯（公）', 侯: '诸侯（侯）' };

// ---------------------------------------------------------------------------
// 日期解析
// ---------------------------------------------------------------------------
// 支持 "BC259" / "BC259-07" / "BC259-07-11" / "1799" / "1799-02" / "1799-02-07"
// 公元前年份换算为天文纪年（BC n → -(n-1)），因此跨越公元前后的年差直接可减。
// 精度缺失时以年中（0.5）填充：两端都只有年份时，年龄恰等于「卒年 − 生年」，
// 与中文史料「享年」的常见算法一致。

const CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export function parseDate(s) {
  if (s === undefined || s === null || s === '') return null;
  const bc = typeof s === 'string' && s.startsWith('BC');
  const core = bc ? s.slice(2) : String(s);
  const parts = core.split('-').map(Number);
  let year = parts[0];
  if (bc) year = -(year - 1);              // 天文纪年
  const m = parts.length > 1 ? parts[1] : null;
  const d = parts.length > 2 ? parts[2] : null;
  const precision = d ? 'day' : m ? 'month' : 'year';
  let frac;
  if (d) frac = (CUM_DAYS[m - 1] + d - 0.5) / 365.2425;
  else if (m) frac = (CUM_DAYS[m - 1] + 15) / 365.2425;
  else frac = 0.5;
  return { year, month: m, day: d, precision, t: year + frac, raw: s };
}

const CN_NUM = '零一二三四五六七八九';
export function fmtDate(dt, { yearOnly = false } = {}) {
  if (!dt) return '不详';
  const y = dt.year <= 0 ? `前${-dt.year + 1}年` : `${dt.year}年`;
  if (yearOnly || dt.precision === 'year') return y;
  if (dt.precision === 'month') return `${y}${dt.month}月`;
  return `${y}${dt.month}月${dt.day}日`;
}
export { CN_NUM };

/** 两个日期之间的精确年数（可为小数）。 */
export function yearsBetween(a, b) {
  if (!a || !b) return null;
  return b.t - a.t;
}

/** 精度等级：两端均为 day → 'exact'，含 year → 'year'，其余 'month'。 */
export function pairPrecision(a, b) {
  if (!a || !b) return null;
  const rank = { day: 2, month: 1, year: 0 };
  const lo = Math.min(rank[a.precision], rank[b.precision]);
  return lo === 2 ? 'exact' : lo === 1 ? 'month' : 'year';
}
