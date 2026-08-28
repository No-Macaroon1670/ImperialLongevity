// 王朝全景页(timeline.html)的章节表：竖向河流与横向泳道。
import { sel, seg, rng, tog, grp } from './shell.js';
import { renderLaneTimeline } from './views-lanes.js';
import { renderRiver } from './views-river.js';

export const SECTIONS = [
  {
    // 全景图放在最前：先建立「谁在什么时候统治、天下有多分裂」的历史坐标，
    // 后面的生存曲线与回归才有可解读的背景。
    // 后缀改了三轮，每一轮都在补同一个缺口。①「分裂的形状」——只说分裂，等于把
    // 一半画面说没了：河宽讲的是分与合两面，一股满宽即天下一统，数股分叉才是割据，
    // 重新统一时再合流。②「分合的形状」——两面齐了，可「形状」是个几何词、现代腔，
    // 没有历史感（用户）。③「分合岔流」——「岔流」是河的语言，与页名「王朝之河」
    // 一脉，也正是这张图的动作；「分合」在前，则把只说分岔那半句补住。
    // （辫状河的岔流本就要重新汇合，但那得读者懂河才读得出，标题不赌这个。）
    id: 'panorama', title: '王朝全景：分合岔流',
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
      // 大事记与分量合并为一组独立档位（2026-08-28 库主令）：三档各自勾选，
      // 全取掉＝无大事记——读者可以只看三等（小众事件），不再被「档位只能
      // 从一等往下含」绑住。总开关不另设：全关就是关
      { type: 'multi', key: 'evRanks', label: '大事记',
        options: [[1, '一等'], [2, '二等'], [3, '三等']], min0: true },
      grp('设置', [
        tog('laneViolent', '标记非正常死亡'),
        tog('laneStrands', '全部承继关系', (st) => st.panoramaMode !== 'river'),
        // 配色档降级入设置、且只给泳道（库主 2026-08-28 裁）：河流里分合是几何
        // （一股满宽＝一统、数股＝割据），双色档在那儿是用颜色复述形状已说的话；
        // 泳道双色仍是「哪几段是一统」的最快读法，也是「大一统定义严格/宽松」
        // 筛选在本节唯一的视觉出口，降频不撤
        seg('laneColor', '配色', [['dynasty', '朝代'], ['unified', '分合']],
          (st) => st.panoramaMode !== 'river'),
        // 年号纪年线（idea-timeline-nianhao；2026-08-28 库主定三档）：
        // 全＝各带常显、选＝点选朝代才显、无＝关。两个视图共用一档：
        // 泳道线贴带缘（并立期上半轨翻上缘）、河流线贴各股左缘
        seg('laneNianhao', '纪年', [['all', '全'], ['sel', '选'], ['off', '无']]),
      ]),
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
