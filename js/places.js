// places.js — 地方线的**地方表**与**归地规则**（设计案见 docs/idea-placelines.md）。
//
// 唯一的 import 是收藏族那一个 Set（见文末 HOLD_ROLES），仍是叶子模块。
//
// 地方线的分工是硬的：这个文件与 app-place.js 只管**机器骨架**——按地抽条、
// 政权带轴、分档卡；`place-text-<key>.js` 管**人工插件**——换手表、总结卡、
// 精选、覆盖。两边文件分开、互不迁就（库主 2026-09-02 立的总原则）。故：
// 这里一个字的手写解说都没有，它只回答「哪些条属于这个地方」。
//
// 为什么归地要两条腿走路（族表 ∪ 半径），而不是只认地名：
//   库内多数条目的落点已由 tools/mining/build_geo_events.py 解析成坐标，
//   坐标才是「区域」意义上的归属——库主 2026-09-02 裁：「其实这个区域的都应该
//   入内，而并非仅仅是在 cluster 之内的。比如周口店也是背景」。周口店距天安门
//   45 公里、琉璃河 44 公里、八达岭 59 公里，靠地名一个个数是数不全的，
//   靠半径一罩就都在里面。族表则管另一头：**没坐标、只能靠名字挂的条**
//   （以及将来新写的条），是坐标的兜底而非主力。实测眼下北京 100 条成员
//   全部由半径命中，族表一条独立收获都没有——留着是为增补条与外地打样。
import { HOLD_ROLES } from './geo-roles.js';

export const PLACES = {
  beijing: {
    key: 'beijing',
    name: '北京',
    // **[经度, 纬度]**。与 geo-events.js 的「点」正好相反（那边是 [lat, lon]），
    // 两处口径不同是数据契约定死的，换算只在本文件 hitsOf 里拧这一次，别处不再拧
    center: [116.39, 39.91],
    // 80 公里罩住北京全市域（房山周口店、昌平十三陵、延庆八达岭、密云）。
    // 已知代价：河北涿州（58km）随之入内，雍熙北伐一条因此归了北京——
    // 那一仗打的正是幽州，收着不算离谱，但它是本半径最靠边的一条，
    // 库主若判不收，写进 exclude 即可，不必动半径
    radiusKm: 80,
    // 族表**按全名相等匹配，不做子串**。这不是洁癖：子串匹配会把
    // 「大都会艺术博物馆」当成元大都、「国立故宫博物院」与「沈阳故宫」当成
    // 北京故宫（实测各误收七条、两条），一个前缀就能把纽约的照夜白图搬进北京城。
    family: [
      // 库主原表里的历史地名。眼下库内一条都没有用到这几个名字（都写作「北京市」），
      // 留着是给增补条备位——全名相等匹配，留着不会误收任何东西
      '北京城', '大都', '中都', '燕京', '幽州', '蓟', '明十三陵', '居庸关', '卢沟桥',
      // 以下是 events.js 里**实有**的北京地名（逐条核过，见交卷报告的清单）
      '北京市', '北京', '东堂子胡同', '周口店遗址', '琉璃河遗址',
      '北京故宫', '紫禁城', '天安门', '天坛', '圆明园', '颐和园', '恭王府',
      '智化寺', '皇史宬', '北京孔庙', '北京国子监', '北京太庙', '北海公园', '明定陵', '金中都', '元大都', '北京社稷坛',
      '法源寺 (北京)', '同仁堂', '北京金代皇陵', '明定陵', '八达岭', '广渠门',
      '中南海', '南长街 (北京)', '西城区', '海淀区', '通州区',
      // 故宫博物院照库主原表留着。实际不起作用：它在库内只带收藏族角色
      // （现 19 条、摹 3 条），一律被 HOLD_ROLES 挡在门外——留一行在这儿
      // 是为了说明「藏馆入族表也没用」，省得下一个人再想一遍
      '故宫博物院',
    ],
    // 涿州（河北）在市域之外，归地按行政区域不按半径（库主 2026-09-02）——雍熙北伐的岐沟关
    // 在涿州，剔；半径不动，动了会丢八达岭（59km）的京张铁路
    exclude: ['雍熙北伐'],
    text: () => import('./place-text-beijing.js'),
  },
};

/**
 * 收藏族角色：**藏品在此，事不在此**，一律不计入本地。族的正本已迁去
 * `js/geo-roles.js`（图页那两份同用一个 Set），此处原样 re-export，本文件
 * 内部照旧直呼其名，`地方线为什么不计`的理由留在这里：
 *
 * 库主 2026-09-02 定的是「现藏不计——否则国博所在地吞尽全国文物」。实测正是如此：
 * 半径 80 公里内单是「中国国家博物馆:现」就 23 条、故宫博物院 19 条、国图 5 条，
 * 全收进来，北京线的一半会是从别处挖出来、运进城的东西。
 *
 * `摹`（历史传本所在）与 `仿`（现代复制件所在）随 `现` 一并挡掉：geo-model.md
 * 给这两个角色的定性就是「渲染上与 `现` 同族：属收藏落点，不进因果走线」——
 * 故宫藏的《照夜白图》摹本不能让韩干在北京画马。三字之外一律计入
 * （造发址战行都迁灾显说，以及生卒葬贬立起颁陪）：库主给的族表里
 * 「东堂子胡同」正是靠 `立` 进来的总理衙门，只认那十个字会把它漏掉。
 */
export { HOLD_ROLES };

/** 地方线的下限：轴止于 1912，之后的事不入线（库主定）。 */
export const PLACE_END = 1912;

/** 索引页的开线门槛：成员 ≥ 30 条才列（设计案第 7 点）。 */
export const PLACE_MIN = 30;

// `地名:角色` 拆件。切在**最后一个冒号**上，与 build_geo_events.py 的
// TOKEN = ^(.+?):([^:]+)$ 同法：角色里不会有冒号，地名里将来可能有
const splitP = (s) => {
  const t = String(s);
  const i = t.lastIndexOf(':');
  return i < 0 ? { 名: t, 角: '' }
    : { 名: t.slice(0, i).trim(), 角: t.slice(i + 1).replace(/[*~]/g, '').trim() };
};

// 等距圆柱近似的球面距离。八十公里的尺度上与大圆距离差不到千分之一，
// 而这套判断本来就只是「在不在这座城附近」——没有必要为它引一个 haversine
const RAD = Math.PI / 180;
function distKm([lat1, lon1], [lat2, lon2]) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD * Math.cos(((lat1 + lat2) / 2) * RAD);
  return Math.sqrt(dLat * dLat + dLon * dLon) * 6371;
}

/**
 * 一条事件属不属于这个地方？属于则返回**命中理由**（给交卷核对与页面上的
 * 落点小字用），不属于返回 null。
 *
 * 判据（库主 2026-09-02 裁语，勿改）：
 *   ① `p` 里任一项地名 ∈ family，且角色不在收藏族；或
 *   ② GEO_EVENTS 里该条任一落点在 center 的 radiusKm 内，且角色不在收藏族。
 *   exclude 里的条目名一律剔除，一票否决在最前。
 */
export function hitsOf(ev, place, geoEvents) {
  if (place.exclude && place.exclude.includes(ev.n)) return null;
  const fam = place.family instanceof Set ? place.family : new Set(place.family || []);
  const hits = [];
  for (const item of ev.p || []) {
    const { 名, 角 } = splitP(item);
    if (fam.has(名) && !HOLD_ROLES.has(角)) hits.push({ 名, 角, 由: '族表' });
  }
  const g = geoEvents && geoEvents[ev.n];
  if (g && Array.isArray(g['链'])) {
    // center 是 [lon, lat]，geo 的点是 [lat, lon]——就在这里拧一次，别处不再拧
    const c = [place.center[1], place.center[0]];
    for (const nd of g['链']) {
      if (!nd['点'] || HOLD_ROLES.has(nd['角'])) continue;
      const d = distKm(c, nd['点']);
      if (d <= place.radiusKm) hits.push({ 名: nd['名'], 角: nd['角'], 由: '半径', km: Math.round(d) });
    }
  }
  if (!hits.length) return null;
  // 同一处地方可能既由族表又由半径命中（多数条如此），合成一行免得小字念两遍
  const seen = new Set();
  return hits.filter((x) => {
    const k = `${x.名}:${x.角}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 抽出这个地方的全部成员，按年升序。返回的每条是**事件的浅拷贝加一个 `hits`**：
 * 浅拷贝只为挂住命中理由，字段一个不挑、一个不改——事件层随时在长，
 * 在这里挑字段等于给自己埋一份会过期的副本。
 *
 * 排序不能靠 EVENTS 的原序——那份数组按补录批次堆叠，实测北京段里
 * 1753（豆汁）后面直接跟着 1644（圈地令）。
 */
export function membersOf(place, events, geoEvents) {
  const out = [];
  for (const ev of events) {
    if (ev.y > PLACE_END) continue;          // 轴止于 1912，之后的事不入线
    const hits = hitsOf(ev, place, geoEvents);
    if (hits) out.push({ ...ev, hits });
  }
  return out.sort((a, b) => a.y - b.y || String(a.n).localeCompare(String(b.n), 'zh'));
}
