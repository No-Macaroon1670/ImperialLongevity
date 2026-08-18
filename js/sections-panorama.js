// 王朝全景页(timeline.html)的章节表：竖向河流与横向泳道。
import { sel, seg, rng, tog } from './shell.js';
import { renderLaneTimeline } from './views-lanes.js';
import { renderRiver } from './views-river.js';

export const SECTIONS = [
  {
    // 全景图放在最前：先建立「谁在什么时候统治、天下有多分裂」的历史坐标，
    // 后面的生存曲线与回归才有可解读的背景。
    id: 'panorama', title: '王朝全景：分裂的形状',
    desc: '同一份数据的两种读法。竖向河流：时间自上而下流，河宽恒定、按当时并存的政权数均分——一股是天下一统，数股是分裂割据，重新统一时几股再合为一体；它顺着页面滚动，不套滚动容器。横向泳道：朝代做成横向长带、皇帝做成带内分段，泳道可回收，第一行为正统序列专用、第二行是与之并行的北方政权主线。大事记在宽屏画于两岸、窄屏直接画进河道（事件本就发生在这条河里）。知识卡宽屏是两翼四张、窄屏是贴底的单卡（一次只开一张），摘要实时取自中文维基百科，文物类条目另有「馆藏页」按钮直达持有机构的著录。先秦段的斜纹半透明格＝年代为传统系年推算铺入（共和前841以前无确切纪年），实心格＝断代工程逐王年或史源确年。',
    controls: [
      // 两个选项用分段器:下拉得先点开才知道有另一种读法,而「换个视角看同一份
      // 数据」正是这一节的主张,不该藏在收起的菜单里
      seg('panoramaMode', '视图', [['river', '竖向河流'], ['lanes', '横向泳道']]),
      // 缩放本是连续量，原先给三档预设，可「多宽算合适」取决于屏宽与正在看哪一段，
      // 三档常常没有一档正好。滑杆两端各留出比原预设更远的余地：
      // 拉到最紧能一屏望尽两千年，拉到最松够把五代十国那七十年铺开看。
      rng('riverPx', '时间缩放', { min: 3, max: 16, fmt: (v) => `${v} px/年` },
        (st) => st.panoramaMode === 'river'),
      rng('lanePx', '时间缩放', { min: 6, max: 30, fmt: (v) => `${v} px/年` },
        (st) => st.panoramaMode !== 'river'),
      seg('laneColor', '配色', [['dynasty', '按具体朝代'], ['unified', '按大一统 / 分裂']]),
      tog('laneViolent', '标记非正常死亡'),
      tog('laneStrands', '全部承继关系', (st) => st.panoramaMode !== 'river'),
      // 大事记开关此前只给泳道:河流的事件轨在两岸(宽屏)与河道里(窄屏),
      // 两处都吃这个开关,故两个视图都该给得出
      tog('laneEvents', '大事记'),
    ],
    render: (host, l, o) => {
      // 切换视图时先撤掉河流留在 body 上的固定卡片，否则它会挂在泳道图上
      if (host.__riverCleanup) { host.__riverCleanup(); host.__riverCleanup = null; }
      const river = o.panoramaMode === 'river';
      host.classList.toggle('full-bleed', river);
      // 河流模式卸掉卡片框：河流出血/居中铺开，边框既围不住图形元素，
      // 还在背景里留下一截截线条；泳道视图保留卡片框
      const card = host.closest('section.card');
      if (card) card.classList.toggle('river-mode', river);
      (river ? renderRiver : renderLaneTimeline)(host, l, o);
    },
  },
];
