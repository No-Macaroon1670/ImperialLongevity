// pics-own-cards.js — 条卡直挂自摄图的**手选表**（用户 2026-08-22 定）。
// 准入即判断：内库照片质量够硬才进——主体清晰、糊块不碍观、说明牌不喧宾。
// 宁缺勿滥；这张表永远手工维护，不自动生成。卡片优先用这里的图，
// 维基缩略图退居替补；无维基条目（绿松石龙一类）从此也能有脸。
// 图注一律「图为本库自摄」，署名规矩照旧只记年月（见本地账册 docs/holding/pics-own.md）。
//
// **路径一律 `img/used/`**（用户 2026-08-21 定四夹制）：成品出 crop.py 先落
// `img/own/` 本地成品库（不进 git），被这张表点名、真上了站，才晋升 `img/used/`
// 并入库推送——推上 GitHub 的只有真被用的那些，其余留在本机备用。
// 所以**往这张表加一行之前先把文件搬进 img/used/**，否则线上 404。
// **2026-09-03 schema 升级**：值除了旧式路径串，还可以是 { src, role, q } 或两张的数组——见文末 ownPics()/cardPics() 注。
import { MUSEUM_PIC } from './pics-museum-cards.js';

export const OWN_PIC = {
  秘色瓷: 'img/used/famensi-mise-kuikou-pan.jpg',
  越王勾践剑: 'img/used/hubei-goujianjian.jpg',
  天坛: 'img/used/tiantan-danbiqiao.jpg',
  避暑山庄: 'img/used/chengde-puningsi-dachengzhige-fukan.jpg',
  唐三彩: 'img/used/bowuguan-tangdai-sancai-luotuo-yongju.jpg',
  龙门二十品: 'img/used/longmen-yangdayan-zaoxiangji-taben-01.jpg',
  独孤信之死: 'img/used/guobo-nzhou-duguxin-epitaph.jpg',
  景德镇瓷业: 'img/used/shoudu-qinghua-yuyaochang-tuciban.jpg',
  人面鱼纹彩陶盆: 'img/used/guobo-renmianyuwen-caitaopen.jpg',
  鹳鱼石斧图彩陶缸: 'img/used/guobo-guanyushifutu-taogang.jpg',
  红山文化玉龙: 'img/used/guobo-hongshan-yulong.jpg',
  舞蹈纹彩陶盆: 'img/used/guobo-wudaowen-caitaopen.jpg',
  华光礁一号: 'img/used/guobo-huaguangjiao-ciqi.jpg',
  南海一号: 'img/used/guobo-nanhaiyihao-ciqi.jpg',
  三道岗沉船: 'img/used/guobo-sandaogang-ciqi.jpg',
  天安门: 'img/used/tiananmen-chenglou.jpg',
  唐英款花觚: 'img/used/guobo-tangying-hugu.jpg',
  石犀: 'img/used/chengbo-shixi-quanshen.jpg',
  老官山织机模型: 'img/used/chengbo-laoguanshan-shangji-banban.jpg',
  皮影戏: 'img/used/chengbo-piying-qinshihuang-mengjiangnv.jpg',
  建窑: 'img/used/suining-songci-heiyou-tuhaowen-chazhan.jpg',
  吉州窑: 'img/used/suining-songci-jianyao-jizhouyao-banban.jpg',
  磁州窑: 'img/used/suining-songci-cizhouyao-banban.jpg',
  邛窑: 'img/used/suining-songci-qiongyao-banban.jpg',
  耀州窑: 'img/used/suining-songci-sanyao-duibi.jpg',
  金鱼村窖藏: 'img/used/suining-songci-qianyan-jinyucun-jiaocang.jpg',
  四般闲事: 'img/used/suining-songci-mengliang-chasi-banban.jpg',
  簪花: 'img/used/suining-songci-zanhua-xisu-banban.jpg',
  糖霜谱: 'img/used/suining-songci-tangshuangpu-banban.jpg',
  广德寺: 'img/used/suining-songci-guangdesi-banban.jpg',
  蜀语: 'img/used/suining-songci-lishi-fuzi-banban.jpg',
  大封天下城隍: 'img/used/shanghai-chenghuangmiao-shenkan.jpg',
  徽班进京: 'img/used/gugong-changyinge-zhengmian.jpg',
  石鼓: 'img/used/gugong-shiguguan-quanjing.jpg',
  八旗制度: 'img/used/baqi-mianjia-liezhuang.jpg',
  盐铁官营: 'img/used/guobo-yanchang-huaxiangzhuan.jpg',
  都江堰: 'img/used/dujiangyan-baopingkou-pano.jpg',
  开凿大运河: 'img/used/huaian-dayunhe-yehang.jpg',
  毛公鼎: 'img/used/taipei-maogongding.jpg',
  买地券: 'img/used/shangbo-yumaidiquan.jpg',
  桓温灭成汉: 'img/used/suining-songci-huanwen-pingshu-map.jpg',
  钧窑: 'img/used/guobo-junyao-tianlanyou-wan.jpg',
  龙泉窑: 'img/used/suining-songci-longquanyao-qingyou-ping.jpg',
  官窑: 'img/used/suining-songci-mingyao-jingchu-banban.jpg',
  圆明园: 'img/used/yuanmingyuan-dashuifa.jpg',
  颐和园: 'img/used/yiheyuan-foxiangge.jpg',
  乾隆石经: 'img/used/guozijian-qianlong-shijing-beilang.jpg',
  北京孔庙进士题名碑: 'img/used/guozijian-kongmiao-dachengmen.jpg',
  // 一条两张首例（2026-09-03）：主体＝神道石像生；语境＝昭陵祾恩门（1987–92 复原的那一座，库主 08-19 供图）
  明十三陵: [
    { src: 'img/used/shisanling-shendao.jpg', role: '主体', q: 3 },
    { src: 'img/used/zhaoling-gate.jpg', role: '语境', q: 2 },
  ],
  定陵发掘: 'img/used/dingling-wanli-baozuo.jpg',
  北海白塔: 'img/used/beihai-baita.jpg',
  北京国子监: 'img/used/guozijian-biyong-neijing.jpg',
};

/** 2026-09-03 schema 升级（库主裁「以后入库本库照片加个 rating 好对比质量」）。OWN_PIC 的值三种形皆可：
 *   'img/used/x.jpg'                         旧式：一张主图（视作 role 主体、q 未评＝0）
 *   { src, role, q }                         一张；role ∈ 主体／语境／细节，q ∈ 1–3（3 最好）
 *   [ { src, role, q }, { src, role, q } ]   两张：一主体＋一语境或细节，**不做画廊**
 * role 的意思：主体＝器物或建筑本身正面清晰；语境＝同柜同殿还有什么、展陈环境、角度独特；
 * 细节＝馆方常不给的特写。q 是准入判断的量化：主体清晰、糊块不碍观、说明牌不喧宾。
 * **取图规则**（库主：谨慎地说，大部分文物的照片应该是本馆的比较好，但国内很多馆不开放）：
 * 有开放许可的馆方图（pics-museum-cards.js）当主体，自摄补语境／细节；馆方图没有的，自摄里
 * role 主体、q 最高者当主体，余下一张作第二图。消费处一律走 cardPics()，别自己读 OWN_PIC。 */
export function ownPics(n) {
  const v = OWN_PIC[n];
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => (typeof x === 'string' ? { src: x, role: '主体', q: 0 } : { role: '主体', q: 0, ...x }));
}
export function cardPics(n) {
  const own = ownPics(n).slice().sort((a, b) => ((b.role === '主体') - (a.role === '主体')) || (b.q - a.q));
  const mus = MUSEUM_PIC[n] || null;
  const note = (x) => (x.role && x.role !== '主体' ? `${x.role}·图为本库自摄` : '图为本库自摄');
  let main = null, extra = [];
  if (mus) {
    main = { src: mus.src, note: mus.credit };
    extra = own.filter((x) => x.role !== '主体').slice(0, 1).map((x) => ({ src: x.src, note: note(x), role: x.role }));
  } else if (own.length) {
    main = { src: own[0].src, note: note(own[0]) };
    extra = own.slice(1, 2).map((x) => ({ src: x.src, note: note(x), role: x.role }));
  }
  return main ? { main, extra } : null;
}
