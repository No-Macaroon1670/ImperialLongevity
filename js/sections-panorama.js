// 王朝全景页(timeline.html)的章节表：竖向河流与横向泳道。
import { sel, seg, rng, tog } from './shell.js';
import { renderLaneTimeline } from './views-lanes.js';
import { renderRiver } from './views-river.js';

export const SECTIONS = [
  {
    // 全景图放在最前：先建立「谁在什么时候统治、天下有多分裂」的历史坐标，
    // 后面的生存曲线与回归才有可解读的背景。
    id: 'panorama', title: '王朝全景：分裂的形状',
    desc: '',
    controls: [
      // 两个选项用分段器:下拉得先点开才知道有另一种读法,而「换个视角看同一份
      // 数据」正是这一节的主张,不该藏在收起的菜单里
      seg('panoramaMode', '视图', [['river', '竖向河流'], ['lanes', '横向泳道']]),
      // 缩放本是连续量，原先给三档预设，可「多宽算合适」取决于屏宽与正在看哪一段，
      // 三档常常没有一档正好。滑杆两端各留出比原预设更远的余地：
      // 拉到最紧能一屏望尽两千年，拉到最松够把五代十国那七十年铺开看。
      // 读数不写 px/年——像素是实现细节，读者关心的是「一屏能看多少年」
      //（用户点出的）。泳道按容器宽换算、河流按视口高，取整到 5
      rng('riverPx', '时间缩放', { min: 3, max: 16,
        fmt: (v) => `一屏 ≈ ${Math.max(5, Math.round(innerHeight / v / 5) * 5)} 年` },
        (st) => st.panoramaMode === 'river'),
      rng('lanePx', '时间缩放', { min: 6, max: 30,
        fmt: (v) => { const w = document.querySelector('.lane-scroll')?.clientWidth || (innerWidth - 80);
          return `一屏 ≈ ${Math.max(5, Math.round(w / v / 5) * 5)} 年`; } },
        (st) => st.panoramaMode !== 'river'),
      seg('laneColor', '配色', [['dynasty', '具体朝代'], ['unified', '大一统 / 分裂']]),
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
