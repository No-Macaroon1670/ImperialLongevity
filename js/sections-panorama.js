// 王朝全景页(timeline.html)的章节表：竖向河流与横向泳道。
import { sel, tog } from './shell.js';
import { renderLaneTimeline } from './views-lanes.js';
import { renderRiver } from './views-river.js';

export const SECTIONS = [
  {
    // 全景图放在最前：先建立「谁在什么时候统治、天下有多分裂」的历史坐标，
    // 后面的生存曲线与回归才有可解读的背景。
    id: 'panorama', title: '王朝全景：分裂的形状',
    desc: '同一份数据的两种读法。竖向河流：时间自上而下流，河宽恒定、按当时并存的政权数均分——一股是天下一统，数股是分裂割据，重新统一时几股再合为一体；它顺着页面滚动，不套滚动容器。横向泳道：朝代做成横向长带、皇帝做成带内分段，泳道可回收，第一行为正统序列专用、第二行是与之并行的北方政权主线。大事记在宽屏画于两岸、窄屏直接画进河道（事件本就发生在这条河里）。知识卡宽屏是两翼四张、窄屏是贴底的单卡（一次只开一张），摘要实时取自中文维基百科。',
    controls: [
      sel('panoramaMode', '视图', [['river', '竖向河流'], ['lanes', '横向泳道']]),
      sel('riverPx', '时间缩放', [[7, '标准 7 px/年'], [4, '紧凑 4 px/年'], [11, '舒展 11 px/年']],
        (st) => st.panoramaMode === 'river'),
      sel('lanePx', '时间缩放', [[14, '标准 14 px/年'], [10, '紧凑 10 px/年'], [20, '舒展 20 px/年']],
        (st) => st.panoramaMode !== 'river'),
      sel('laneColor', '配色', [['dynasty', '按具体朝代'], ['unified', '按大一统 / 分裂']]),
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
