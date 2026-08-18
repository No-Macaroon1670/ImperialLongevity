// 统计核心页(index.html)的章节表：时间轴、生存分析、比较与数据库。
import { sel, tog } from './shell.js';
import { GROUPINGS, COVARIATES } from './data.js';
import { renderTimeline, renderHistoryScatter, renderHeatmap } from './views-time.js';
import { renderKM, renderCIF, renderCox } from './views-survival.js';
import { renderBox, renderDSI, renderHypotheses, renderDatabase, renderAudit } from './views-compare.js';
import { renderCiv } from './views-civ.js';

export const SECTIONS = [
  {
    id: 'timeline', title: '时间轴：每位皇帝的寿命与统治期',
    desc: '上一节看政权，这一节看个人：每行一位皇帝，细线＝出生到死亡的完整寿命，粗块＝在位期间，一眼读出登基年龄、在位长短、是否早逝。颜色沿用全局语义：蓝＝大一统，橙＝分裂。',
    controls: [
      sel('timelineMode', '显示', [['dual', '双层（寿命＋统治）'], ['life', '仅寿命时间轴'], ['reign', '仅统治时间轴']]),
      sel('timelineSort', '排序', [['birth', '按出生年'], ['life', '按寿命降序'], ['reign', '按在位年数降序']]),
    ],
    render: renderTimeline,
  },
  {
    id: 'scatter', title: '中国历史总时间轴：寿命的长期走势',
    desc: '横轴为出生年（出生队列），纵轴为享年，每点一位皇帝。两条移动平均线分别给出大一统与分裂时期的寿命趋势，背景分带标出时代。五代十国、南北朝、唐末等高风险时段的低寿命聚集在此一目了然。',
    controls: [sel('scatterX', '横轴', [['birth', '出生年'], ['acc', '登基年']])],
    render: renderHistoryScatter,
  },
  {
    id: 'km', title: 'Kaplan–Meier 生存曲线',
    desc: '本项目的核心图表。默认以「登基后年数」为时间轴——每位皇帝都从 t=0 进入，没有截断问题，直接回答「坐上龙椅之后还能活多久」。切到年龄尺度时采用左截断（自登基年龄进入风险集）并以满 15 岁为条件起点，否则襁褓即位者会让低龄段的风险集只剩一两人。',
    controls: [
      sel('kmGroup', '分组变量', Object.entries(GROUPINGS).map(([k, v]) => [k, v.label])),
      sel('kmScale', '时间轴', [['reign', '登基后年数'], ['age', '年龄（左截断）']]),
      sel('kmFromAge', '条件起点年龄', [[15, '满 15 岁'], [0, '不设条件'], [10, '满 10 岁'], [20, '满 20 岁']]),
      tog('kmCensorAbd', '退位时删失（仅在位尺度）'),
      tog('kmCI', '显示 95% 置信带'),
    ],
    render: renderKM,
  },
  {
    id: 'cif', title: '竞争风险：被杀 vs 病死的累积发生率',
    desc: '「皇帝短命，究竟源于健康问题还是政治风险？」——把死亡拆成两个互相竞争的终点，用 Aalen–Johansen 估计量分别给出累积发生率。把非正常死亡当作删失处理是常见错误，会系统性高估自然死亡风险。',
    controls: [
      sel('cifScale', '时间轴', [['age', '年龄'], ['reign', '登基后年数']]),
      sel('kmFromAge', '条件起点年龄', [[15, '满 15 岁'], [0, '不设条件'], [10, '满 10 岁'], [20, '满 20 岁']]),
    ],
    render: renderCIF,
  },
  {
    id: 'box', title: '箱线图：分组分布比较',
    desc: '均值、中位数、四分位与离群值的直接比较。箱线图刻画的是「死亡年龄的横截面分布」，不处理删失与左截断，因此它用于描述，正式推断以生存曲线与 Cox 模型为准。',
    controls: [
      sel('boxGroup', '分组变量', Object.entries(GROUPINGS).map(([k, v]) => [k, v.label])),
      sel('boxMetric', '指标', [['lifespan', '享年'], ['accAge', '登基年龄'], ['reignYears', '在位年数']]),
    ],
    render: renderBox,
  },
  {
    id: 'dsi', title: 'DSI 散点图：王朝越稳定，皇帝越长寿？',
    desc: 'DSI（Dynasty Stability Index）＝ 王朝总年数 ÷ 皇帝人数，衡量平均每位皇帝「撑起」多少年国祚。西汉 210/15 ≈ 14，北齐 28/6 ≈ 4.7。默认按王朝层面作图以避免伪重复。',
    controls: [
      sel('dsiLevel', '分析层面', [['dynasty', '王朝层面（推荐）'], ['emperor', '个体层面（伪重复）']]),
      sel('dsiMinN', '最少皇帝数', [[2, '≥2 位'], [1, '≥1 位'], [4, '≥4 位']]),
    ],
    render: renderDSI,
  },
  {
    id: 'heat', title: '热力图：年代 × 寿命区间 × 人数密度',
    desc: '横轴为出生年代（每百年一格），纵轴为享年区间，颜色深浅表示落入该格的皇帝人数。开启分面后，大一统与分裂两组各用一条单色相色阶（蓝／橙），共用同一比例尺，可直接比较密度分布的重心位置。',
    controls: [tog('heatFacet', '按大一统 / 分裂分面')],
    render: renderHeatmap,
  },
  {
    id: 'cox', title: 'Cox 比例风险模型：哪些因素真正提高死亡风险',
    desc: '同时控制多个因素，输出风险比 HR。HR＞1 表示提高死亡风险，＜1 表示保护作用。模型采用 Efron 结法处理同年死亡的并列，并以 (start, stop] 区间实现左截断。下方给出 Schoenfeld 残差对比例风险假定的诊断。',
    controls: [
      sel('coxScale', '时间轴', [['age', '年龄（左截断）'], ['reign', '登基后年数']]),
      sel('kmFromAge', '条件起点年龄', [[15, '满 15 岁'], [0, '不设条件'], [10, '满 10 岁'], [20, '满 20 岁']]),
      { type: 'multi', key: 'coxVars', label: '协变量', options: COVARIATES.map((c) => [c.key, c.label]) },
    ],
    render: renderCox,
  },
  {
    id: 'hyp', title: 'H1–H5：假说的即时检验',
    desc: '以下结论随上方筛选条件实时重算。每条假说都附上它自身的方法学软肋——数据能支持什么、不能支持什么，同样重要。',
    controls: [],
    render: renderHypotheses,
  },
  {
    id: 'civ', title: '跨文明比较：政治结构 → 统治风险',
    desc: '同一套口径下比较四个政体、五份名册。以「登基后生存」与「非正常死亡比例」为主判据——在位起讫与死亡方式各文明史料都记得牢，而生年普遍稀疏，本项目的主结论亦不依赖生年。域外骨架取自 Wikidata（CC0）并逐位锚定 QID，死亡方式的缺口人工补齐。日本单列天皇与幕府两份：天皇长期不掌实权，以其代表「日本君主的风险」有失真之虞，而将军才是 1185–1868 年间的实际执政者——两者同国同代、只差权力有无，构成本节最干净的一组对照。',
    controls: [],
    render: renderCiv,
  },
  {
    id: 'audit', title: '空档审计：朝代长带上的每一处悬空',
    desc: '横向泳道视图顺带提供了一个好用的质检信号：朝代长带上任何悬空的头、尾或中段，都意味着那段年份没有在位君主的记录。原因只有三种——该君主称帝前已掌权（本库记的是称帝日）、史上确实虚位、或漏收君主与日期有误。下表把三者逐条列清，使第三类不必靠肉眼在图上找。',
    controls: [],
    render: renderAudit,
  },
  {
    id: 'db', title: '数据库：全部记录',
    desc: '完整字段可查、可复制。0 值一律读作「无明确史料记载」，而非「确证不存在」。先秦君主的年代分三层：前841（共和）后为确切纪年；西周逐王与商后期五王取夏商周断代工程（教科书标准，学界有实质争议）；夏与商前期为传统系年等比铺入的低置信坐标（图上斜纹）。要整体摘出先秦，用上方时代筛选的「仅帝制时代」。',
    controls: [{ type: 'search', key: 'dbQuery', label: '检索' }],
    render: renderDatabase,
  },
];
