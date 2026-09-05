// events-ui.js — 事件类别图例＝筛选钮（泳道图下、竖河图下、导览副卡、地方页四家共用）
// -----------------------------------------------------------------------------
// 「哪几类事件画出来」这件事，此前有两份逐行誊抄的实现（`views-lanes.js` 与
// `app-place.js`）：模块级 lastChip 同名、350ms 同值、四句 title 同字、末钮两句
// 文案同字。2026-09-04 归一到这里（SSOT 卷 D11），差异全部化成参数：
// 计数源、状态载体、字形尺寸、要不要跳过某一类。
//
// 本模块只吐**芯片行**一个节点，抬头交给调用方——导览副卡本来就只要那一行
// （`tour.js` 一直写着 `const [, row] =` 把抬头丢掉），地方页则另有自己的小标题。
//
// 依赖压到最薄：只要 charts 的 h 与 events 的 EVENT_KINDS。色标形状（evMark）
// 由调用方以 `glyph` 回调交进来，故本模块不认得 views-lanes，字形尺寸也就
// 自然成了调用方的事（图下那排 14/7/5，地方页 13/6.5/4.6，画的本来就是同一个 evMark）。
// -----------------------------------------------------------------------------
import { h } from './charts.js';
import { EVENT_KINDS } from './events.js';

// 双击检测**不能**记在节点上：每次点击都整段重绘，原生 dblclick 在重建后的新
// 节点上永远凑不齐两击（这也是 2026-08-28 库主报「双击坏了」的由来）。
// 但也不能记在模块级——全景页的图下图例与导览副卡**同页并挂两排**，模块级
// 那份只按 k 记、不认是哪一排，于是两排里同名色标 350ms 内各点一次就被判成
// 「双击独看」。故按**这一排**记：owner 是调用方给的稳定标识，与节点无关，
// 整段重绘也不丢。（2026-09-04 解此串扰。）
const LAST = new Map();

/**
 * @param counts   {k: n} 计数表。调用方自备语料：图下那排数全库，地方页只数本地。
 * @param off      已关掉的类（Set）。
 * @param glyph    (k) => SVG 节点，画本类的色标。
 * @param skip     本视图根本不画的类——按不动的开关比没有开关更糟
 *                 （治世·中兴在泳道是皇帝格外的虚线外套，竖河没有这一层）。
 * @param onChange (nextOff: Set) => void，由调用方决定是写 evOff＋setOpt 还是自己 draw()。
 * @param owner    这一排的身份，双击窗口按它分账。同一处图例重绘前后须给同一个值。
 * @returns 芯片行节点（div.ev-legend）
 */
export function eventLegend({ counts, off, glyph, skip = [], onChange, owner = 'main' }) {
  const row = h('div', { class: 'ev-legend' });
  const kinds = Object.keys(EVENT_KINDS).filter((k) => counts[k] && !skip.includes(k));
  // 色标按词条数降序排（库主 2026-09-02：「王朝长河这些类型也应该按照词条数排列」），
  // 与首页/地图页同则；EVENT_KINDS 的定义序只管数据，不管图例——多的类在前，一眼看出库的体量分布
  const order = kinds.slice().sort((a, b) => counts[b] - counts[a]);
  for (const k of order) {
    const chip = h('button', {
      type: 'button', class: 'chip ev-chip' + (off.has(k) ? ' off' : ''),
      'aria-pressed': String(!off.has(k)),
      title: off.has(k) ? '点按显示这一类' : '点按隐藏这一类',
      onclick: () => {
        const last = LAST.get(owner) || { k: null, t: 0 };
        const now = Date.now();
        if (last.k === k && now - last.t < 350) {
          // 双击＝只看这一类(第一击已切过一次,这里直接以「独看」覆盖)
          LAST.set(owner, { k: null, t: 0 });
          onChange(new Set(kinds.filter((x) => x !== k)));
          return;
        }
        const next = new Set(off);
        if (next.has(k)) next.delete(k); else next.add(k);
        onChange(next);
        // 表在渲染**之后**才起（2026-08-28 库主报「双击坏了」）：onChange 同步整段重绘，
        // 库长到千余条后一绘三四百毫秒，第二击排队等它画完才派发——表起早了，
        // 350ms 窗口永远迟到，双击净效果归零。起表挪到绘完，量的是「画完到下一击」
        LAST.set(owner, { k, t: Date.now() });
      },
    }, [glyph(k), h('span', { text: `${(EVENT_KINDS[k] || {}).label || k} ${counts[k]}` })]);
    row.appendChild(chip);
  }
  // 类别多到十二种之后,一类类点回来太费手——全开一键复位(与地图页同名同位)。
  // 双态（2026-08-28 库主点子）：全亮时这颗钮变「全关」——先全关再点一类，
  // 即是「只看一类」的第二条路，与双击独看互为备份
  row.appendChild(h('button', {
    type: 'button', class: 'chip ev-chip',
    title: off.size ? '重新点亮全部类别' : '全部关掉，再点选一类即独看',
    text: off.size ? '全开' : '全关',
    onclick: () => onChange(off.size ? new Set() : new Set(kinds)),
  }));
  return row;
}
