// 统计核心页(index.html)的章节表：时间轴、生存分析、比较与数据库。
//
// desc 的口径（2026-09-08 去 clutter 案 §二.A）：只写「不看就会误读」的那一句，
// 一句一节、二三十字。从前 desc 里还写着口径、设计理由与和折叠说明逐字重复的
// 半段，读者要越过一堵字墙才看得见图。三类去处——口径挂到它说明的那个控件
// （见下面 sel 的 title）、偏倚留在图下的 notes()、设计理由进 about.html。
// 控件 title 一律登记在本表里，不在 render 后摸 DOM：render() 每改一个开关
// 就把整条控件行重建，事后补的属性会丢（共用件卷 §9 的坑）。

// 条件起点年龄这颗 select 出现在 KM／CIF／Cox 三节，口径是同一句，写一处
const FROM_AGE_TIP = '襁褓即位者（如汉殇帝、周静帝）会让低龄段的风险集只剩一两人，一次死亡就把曲线打掉一半';
const FROM_AGE_OPTS = [[15, '满 15 岁'], [0, '不设条件'], [10, '满 10 岁'], [20, '满 20 岁']];
import { sel, tog } from './shell.js';
import { GROUPINGS, COVARIATES } from './data.js';
import { renderTimeline, renderHistoryScatter, renderHeatmap } from './views-time.js';
import { renderKM, renderCIF, renderCox } from './views-survival.js';
import { renderBox, renderDSI, renderHypotheses, renderDatabase, renderAudit } from './views-compare.js';
import { renderCiv } from './views-civ.js';

export const SECTIONS = [
  {
    id: 'timeline', title: '时间轴：每位皇帝的寿命与统治期',
    desc: '每行一位皇帝：细线＝寿命，粗块＝在位；蓝＝大一统，橙＝分裂。',
    controls: [
      sel('timelineMode', '显示', [['dual', '双层（寿命＋统治）'], ['life', '仅寿命时间轴'], ['reign', '仅统治时间轴']]),
      sel('timelineSort', '排序', [['birth', '按出生年'], ['life', '按寿命降序'], ['reign', '按在位年数降序']]),
    ],
    render: renderTimeline,
  },
  {
    id: 'scatter', title: '中国历史总时间轴：寿命的长期走势',
    desc: '每点一位皇帝：横轴出生年，纵轴享年；两条线＝大一统／分裂的移动平均，背景分带标时代。',
    controls: [sel('scatterX', '横轴', [['birth', '出生年'], ['acc', '登基年']])],
    render: renderHistoryScatter,
  },
  {
    id: 'km', title: 'Kaplan–Meier 生存曲线',
    desc: '本页的核心图。默认按登基后年数：每人从 t=0 进入，答「坐上龙椅之后还能活多久」。',
    controls: [
      sel('kmGroup', '分组变量', Object.entries(GROUPINGS).map(([k, v]) => [k, v.label])),
      sel('kmScale', '时间轴', [['reign', '登基后年数'], ['age', '年龄（左截断）']]),
      sel('kmFromAge', '条件起点年龄', FROM_AGE_OPTS, undefined, { title: FROM_AGE_TIP }),
      tog('kmCensorAbd', '退位时删失（仅在位尺度）'),
      tog('kmCI', '显示 95% 置信带'),
    ],
    render: renderKM,
  },
  {
    id: 'cif', title: '竞争风险：被杀 vs 病死的累积发生率',
    desc: '把死亡拆成被杀／病死两个竞争终点，各算累积发生率。',
    controls: [
      sel('cifScale', '时间轴', [['age', '年龄'], ['reign', '登基后年数']]),
      sel('kmFromAge', '条件起点年龄', FROM_AGE_OPTS, undefined, { title: FROM_AGE_TIP }),
    ],
    render: renderCIF,
  },
  {
    id: 'box', title: '箱线图：分组分布比较',
    desc: '分组分布的直接比较；只作描述，推断以生存曲线与 Cox 为准。',
    controls: [
      sel('boxGroup', '分组变量', Object.entries(GROUPINGS).map(([k, v]) => [k, v.label])),
      sel('boxMetric', '指标', [['lifespan', '享年'], ['accAge', '登基年龄'], ['reignYears', '在位年数']]),
    ],
    render: renderBox,
  },
  {
    id: 'dsi', title: 'DSI 散点图：王朝越稳定，皇帝越长寿？',
    desc: 'DSI＝国祚 ÷ 皇帝人数，平均每位皇帝「撑起」多少年（西汉 210/15≈14，北齐 28/6≈4.7）。',
    controls: [
      sel('dsiLevel', '分析层面', [['dynasty', '王朝层面（推荐）'], ['emperor', '个体层面（伪重复）']], undefined,
        { title: '默认王朝层面，以避免伪重复：同一王朝的皇帝共享同一个 DSI，按个体作图等于把它重复计入十几次' }),
      sel('dsiMinN', '最少皇帝数', [[2, '≥2 位'], [1, '≥1 位'], [4, '≥4 位']]),
    ],
    render: renderDSI,
  },
  {
    id: 'heat', title: '热力图：年代 × 寿命区间 × 人数密度',
    desc: '横轴出生年代（百年一格），纵轴享年区间，色深＝人数；两个分面共用比例尺，灰底＝无人。',
    controls: [tog('heatFacet', '按大一统 / 分裂分面')],
    render: renderHeatmap,
  },
  {
    id: 'cox', title: 'Cox 比例风险模型：哪些因素真正提高死亡风险',
    desc: '同时控制多个因素，输出风险比 HR：＞1 升险，＜1 保护。',
    controls: [
      sel('coxScale', '时间轴', [['age', '年龄（左截断）'], ['reign', '登基后年数']]),
      sel('kmFromAge', '条件起点年龄', FROM_AGE_OPTS, undefined, { title: FROM_AGE_TIP }),
      { type: 'multi', key: 'coxVars', label: '协变量', options: COVARIATES.map((c) => [c.key, c.label]) },
    ],
    render: renderCox,
  },
  {
    id: 'hyp', title: 'H1–H5：假说的即时检验',
    desc: '随上方筛选实时重算；每条假说都附自己的方法学软肋。',
    controls: [],
    render: renderHypotheses,
  },
  {
    id: 'civ', title: '跨文明比较：政治结构 → 统治风险',
    desc: '四个政体、五份名册，同一口径；主判据＝登基后生存与非正常死亡比例。',
    controls: [],
    render: renderCiv,
  },
  {
    id: 'audit', title: '空档审计：朝代长带上的每一处悬空',
    desc: '朝代带上没有在位君主记录的年份，逐条列出：已解释／真虚位／待核查。',
    controls: [],
    render: renderAudit,
  },
  {
    id: 'db', title: '数据库：全部记录',
    desc: '完整字段可查、可复制。',
    controls: [{ type: 'search', key: 'dbQuery', label: '检索' }],
    render: renderDatabase,
  },
];
