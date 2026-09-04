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
  天坛: { src: 'img/used/tiantan-qiniandian-roof.jpg', role: '主体', q: 3, cap: '祈年殿三重檐与匾额' },   // 09-04 替换现图（判官）
  避暑山庄: 'img/used/chengde-puningsi-dachengzhige-fukan.jpg',
  唐三彩: [
    { src: 'img/used/bowuguan-tangdai-sancai-luotuo-yongju.jpg', role: '主体', q: 0 },
    { src: 'img/used/npm-taipei-tang-sancai-tianwang.jpg', role: '语境', q: 3, cap: '唐三彩天王像，台北故宫' },
  ],
  龙门二十品: 'img/used/longmen-yangdayan-zaoxiangji-taben-01.jpg',
  独孤信之死: 'img/used/guobo-nzhou-duguxin-epitaph.jpg',
  景德镇瓷业: [
    { src: 'img/used/shoudu-qinghua-yuyaochang-tuciban.jpg', role: '主体', q: 0 },
    { src: 'img/used/shoudu-yuan-qingbaiyou-shuiyueguanyin.jpg', role: '语境', q: 3, cap: '景德镇窑青白釉水月观音像，元，北京西城出土，首都博物馆' },
  ],
  人面鱼纹彩陶盆: 'img/used/guobo-renmianyuwen-caitaopen.jpg',
  鹳鱼石斧图彩陶缸: 'img/used/guobo-guanyushifutu-taogang.jpg',
  红山文化玉龙: 'img/used/guobo-hongshan-yulong.jpg',
  舞蹈纹彩陶盆: 'img/used/guobo-wudaowen-caitaopen.jpg',
  华光礁一号: 'img/used/guobo-huaguangjiao-ciqi.jpg',
  南海一号: 'img/used/guobo-nanhaiyihao-ciqi.jpg',
  三道岗沉船: 'img/used/guobo-sandaogang-ciqi.jpg',
  天安门: 'img/used/tiananmen-chenglou.jpg',
  唐英款花觚: 'img/used/guobo-tangying-hugu.jpg',
  石犀: [
    { src: 'img/used/chengbo-shixi-quanshen.jpg', role: '主体', q: 0 },
    { src: 'img/used/chengbo-shixi-cemian.jpg', role: '语境', q: 3, cap: '石犀侧视，成都博物馆' },
  ],
  老官山织机模型: 'img/used/chengbo-laoguanshan-shangji-banban.jpg',
  皮影戏: 'img/used/chengbo-piying-qinshihuang-mengjiangnv.jpg',
  建窑: 'img/used/suining-songci-heiyou-tuhaowen-chazhan.jpg',
  吉州窑: 'img/used/suining-songci-jianyao-jizhouyao-banban.jpg',
  磁州窑: { src: 'img/used/guobo-yuan-cizhouyao-yingxitu-guan.jpg', role: '主体', q: 3, cap: '磁州窑白釉黑花婴戏图罐，元，辽宁绥中出土，国博' },   // 09-04 替换现图（判官）
  邛窑: 'img/used/suining-songci-qiongyao-banban.jpg',
  耀州窑: { src: 'img/used/guobo-yaozhouyao-qingyoukehua-laifuzun.jpg', role: '主体', q: 3, cap: '耀州窑青釉刻花莱菔尊，国博' },   // 09-04 替换现图（判官）
  金鱼村窖藏: 'img/used/suining-songci-qianyan-jinyucun-jiaocang.jpg',
  四般闲事: [
    { src: 'img/used/suining-songci-mengliang-chasi-banban.jpg', role: '主体', q: 0 },
    { src: 'img/used/suining-songci-chaju-tuzan.jpg', role: '语境', q: 3, cap: '《茶具图赞》十二先生展板，遂宁宋瓷博物馆' },
  ],
  簪花: 'img/used/suining-songci-zanhua-xisu-banban.jpg',
  糖霜谱: 'img/used/suining-songci-tangshuangpu-banban.jpg',
  广德寺: 'img/used/suining-songci-guangdesi-banban.jpg',
  蜀语: 'img/used/suining-songci-lishi-fuzi-banban.jpg',
  大封天下城隍: [
    { src: 'img/used/shanghai-chenghuangmiao-shenkan.jpg', role: '主体', q: 0 },
    { src: 'img/used/shanghai-chenghuangmiao-huoguangdian.jpg', role: '语境', q: 3, cap: '上海城隍庙霍光殿，牌位「金山神主漢博陸侯霍光大將軍」' },
  ],
  徽班进京: 'img/used/gugong-changyinge-zhengmian.jpg',
  石鼓: [
    { src: 'img/used/gugong-shiguguan-quanjing.jpg', role: '主体', q: 0 },
    { src: 'img/used/gugong-shigu-hall.jpg', role: '语境', q: 3, cap: '故宫石鼓馆展厅，十鼓各置独立柜' },
  ],
  八旗制度: 'img/used/baqi-mianjia-liezhuang.jpg',
  盐铁官营: 'img/used/guobo-yanchang-huaxiangzhuan.jpg',
  都江堰: 'img/used/dujiangyan-baopingkou-pano.jpg',
  开凿大运河: 'img/used/huaian-dayunhe-yehang.jpg',
  毛公鼎: 'img/used/taipei-maogongding.jpg',
  买地券: [
    { src: 'img/used/shangbo-yumaidiquan.jpg', role: '主体', q: 0 },
    { src: 'img/used/shangbo-maidiquan-zangyu-gui.jpg', role: '语境', q: 3, cap: '上海博物馆同柜：蝉形琀、玉买地券、猪形握' },
  ],
  桓温灭成汉: 'img/used/suining-songci-huanwen-pingshu-map.jpg',
  钧窑: [
    { src: 'img/used/guobo-junyao-tianlanyou-wan.jpg', role: '主体', q: 0 },
    { src: 'img/used/guobo-junyao-meiguiziyou-huapen.jpg', role: '主体', q: 3, cap: '钧窑玫瑰紫釉花盆，国博' },
  ],
  龙泉窑: [
    { src: 'img/used/suining-songci-longquanyao-qingyou-ping.jpg', role: '主体', q: 0 },
    { src: 'img/used/suining-songci-longquanyao-heye-gaiguan.jpg', role: '语境', q: 3, cap: '龙泉窑荷叶盖罐，元（晚于本条南宋窗口），遂宁宋瓷博物馆' },
  ],
  官窑: 'img/used/suining-songci-mingyao-jingchu-banban.jpg',
  圆明园: [
    { src: 'img/used/yuanmingyuan-dashuifa.jpg', role: '主体', q: 0 },
    { src: 'img/used/yuanmingyuan-yuanyingguan.jpg', role: '语境', q: 3, cap: '圆明园远瀛观遗址石柱' },
  ],
  颐和园: [
    { src: 'img/used/yiheyuan-foxiangge.jpg', role: '主体', q: 0 },
    { src: 'img/used/yiheyuan-shifang.jpg', role: '语境', q: 3, cap: '清晏舫（石舫）：1860 焚后光绪重建改为仿西洋舱楼' },
  ],
  乾隆石经: 'img/used/guozijian-qianlong-shijing-beilang.jpg',
  北京孔庙进士题名碑: 'img/used/guozijian-kongmiao-dachengmen.jpg',
  // 一条两张首例（2026-09-03）：主体＝神道石像生；语境＝昭陵祾恩门（1987–92 复原的那一座，库主 08-19 供图）
  明十三陵: [
    { src: 'img/used/shisanling-shendao.jpg', role: '主体', q: 3 },
    { src: 'img/used/zhaoling-gate.jpg', role: '语境', q: 2 },
  ],
  定陵发掘: 'img/used/dingling-wanli-baozuo.jpg',
  北海白塔: 'img/used/beihai-baita.jpg',
  北京国子监: [
    { src: 'img/used/guozijian-biyong-neijing.jpg', role: '主体', q: 0 },
    { src: 'img/used/guozijian-liuli-paifang.jpg', role: '语境', q: 3, cap: '国子监「圜橋教澤」琉璃牌坊' },
  ],
  // ── 2026-09-04 荐单晋升（Fable 判官卷 picsjudge-20260904，凭描述判；cap 为图注） ──
  翠玉白菜: { src: 'img/used/npm-taipei-cuiyu-baicai.jpg', role: '主体', q: 3, cap: '翠玉白菜，台北故宫' },
  肉形石: { src: 'img/used/npm-taipei-rouxingshi.jpg', role: '主体', q: 3, cap: '肉形石，台北故宫' },
  禅地玉册: { src: 'img/used/npm-taipei-shandi-yuce.jpg', role: '主体', q: 3, cap: '宋真宗禅地玉册，台北故宫' },
  黄帝内经: { src: 'img/used/npm-taipei-suwen-1550.jpg', role: '主体', q: 3, cap: '《重广补注黄帝内经素问》明嘉靖二十九年翻宋本，台北故宫' },
  快雪时晴帖: { src: 'img/used/npm-taipei-sanxi-yuban.jpg', role: '语境', q: 3, cap: '三希玉版（刻快雪时晴、中秋、伯远三帖），台北故宫；非帖本尊' },
  青花瓷: { src: 'img/used/npm-taipei-wanli-fanwen-pan.jpg', role: '细节', q: 3, cap: '明万历青花梵文莲花式盘，台北故宫（馆藏号 16012）' },
  秘密立储: { src: 'img/used/gugong-zhengdaguangming.jpg', role: '主体', q: 3, cap: '乾清宫「正大光明」匾，建储匣即藏其后' },
  珍妃井: { src: 'img/used/gugong-zhenfeijing-placard.jpg', role: '语境', q: 2, cap: '珍妃井故宫现场说明牌' },
  明清故宫: { src: 'img/used/gugong-taihedian-bian.jpg', role: '主体', q: 3, cap: '太和殿匾与重檐；今殿系康熙三十四年重建' },
  翠玉白菜: { src: 'img/used/gugong-cuidiao-baicai-huachai.jpg', role: '语境', q: 3, cap: '北京故宫翠雕白菜式花插（清）——与台北那棵各一件' },
  岳飞之死: { src: 'img/used/guobo-qinhui-tiegui-xiang.jpg', role: '主体', q: 3, cap: '秦桧跪像，中国国家博物馆陈列' },
  玄奘归国译经: { src: 'img/used/guobo-xuanzang-timing-shifozuo-tang.jpg', role: '主体', q: 3, cap: '玄奘题名石佛座，唐龙朔二年（662），铜川玉华宫遗址出土，国博' },
  西夏文创制: { src: 'img/used/guobo-xixiawen-chiranmapai-tongpai.jpg', role: '主体', q: 3, cap: '西夏文「敕燃马牌」青铜敕牌，国博' },
  潘季驯治河: { src: 'img/used/guobo-mingdai-hefangyilantu-fuzhipin.jpg', role: '主体', q: 3, cap: '《河防一览图》长卷（复制品），国博' },
  针灸铜人铸成: { src: 'img/used/guobo-zhenjiu-tongren.jpg', role: '语境', q: 2, cap: '针灸铜人（国博陈列，年代照牌）；1027 原铸已佚' },
  大秦景教碑: { src: 'img/used/guobo-daqin-jingjiaobei-taben-tang.jpg', role: '语境', q: 2, cap: '《大秦景教流行中国碑》拓本，国博；原碑在西安碑林' },
  孝文帝汉化·迁都洛阳: { src: 'img/used/guobo-bwei-yuanyu-epitaph.jpg', role: '主体', q: 3, cap: '元羽墓志，北魏景明二年（501），1918 洛阳出土，国博' },
  孝文帝汉化·迁都洛阳: { src: 'img/used/guobo-bdyn-gold-hat-ornament.jpg', role: '语境', q: 3, cap: '马头鹿角形金步摇，北朝，内蒙古达茂旗出土，国博' },
  青花瓷: { src: 'img/used/guobo-mingdai-qinghuaci-sanjian.jpg', role: '主体', q: 3, cap: '明青花四件与「青花瓷」主题板，国博' },
  苏轼谪儋州: { src: 'img/used/guobo-beisong-sushi-daxieminshitie.jpg', role: '语境', q: 3, cap: '苏轼《行书答谢民师帖卷》，元符三年（1100）北归途中书，国博' },
  灭东突厥·天可汗: { src: 'img/used/guobo-tujue-shiren-tang.jpg', role: '语境', q: 3, cap: '突厥石人，唐，新疆发现，国博' },
  丝绸之路: { src: 'img/used/guobo-silu-sanmei-qianbi-suimu.jpg', role: '语境', q: 2, cap: '拜占庭金币、萨珊银币、阿拉伯金币，隋墓出土，国博' },
  琉璃河遗址: { src: 'img/used/shoudu-xizhou-liulihe-tongding-zuhe.jpg', role: '主体', q: 3, cap: '琉璃河燕国墓地出土西周青铜礼器（圉方鼎等），首都博物馆' },
  房山金陵: { src: 'img/used/shoudu-jinling-longfengwen-shiguo.jpg', role: '主体', q: 2, cap: '房山金陵遗址出土龙纹椁、凤纹椁，首都博物馆' },
  庆寿寺双塔: { src: 'img/used/shoudu-jinyuan-haiyun-taming-zhanmao.jpg', role: '语境', q: 2, cap: '海云禅师塔铭残石，首都博物馆；双塔 1955 年拆平后仅存之物' },
  如意: { src: 'img/used/shoudu-qing-yuzitan-songlu-ruyi.jpg', role: '主体', q: 3, cap: '玉紫檀雕松鹿三镶如意，清，首都博物馆' },
  洛阳明堂: { src: 'img/used/luoyang-suitang-mingtang-tiantang.jpg', role: '主体', q: 3, cap: '隋唐洛阳城明堂（中）与天堂（左），今建筑系遗址上的现代保护展示建筑' },
  洛阳明堂: { src: 'img/used/luoyang-suitang-lifang-moxing.jpg', role: '语境', q: 3, cap: '隋唐洛阳城里坊格局模型（当代制作），洛阳博物馆' },
  武周革命: { src: 'img/used/luoyang-yingtianmen-hangtu-yizhi.jpg', role: '主体', q: 3, cap: '应天门遗址隋唐夯土墩台残段（原物），洛阳' },
  武周革命: { src: 'img/used/luoyang-yingtianmen-yizhi.jpg', role: '语境', q: 3, cap: '应天门复原城楼（2016 年新建），武则天登基大典所在则天门旧址' },
  二里头遗址: { src: 'img/used/luoyang-erlitou-zhongguodiyilong-taoqi-zhanban.jpg', role: '语境', q: 3, cap: '二里头文化陶盉、陶鬶（前）与《中国第一龙》展板（后，板上绿松石龙为馆方照片），洛阳博物馆' },
  汉魏洛阳故城: { src: 'img/used/luoyang-donghan-shendao-shishou.jpg', role: '语境', q: 3, cap: '东汉神道石兽（辟邪／天禄一类），洛阳博物馆' },
  楚子问鼎: { src: 'img/used/luoyang-zhanguo-qiequwen-tongding.jpg', role: '语境', q: 3, cap: '窃曲纹铜鼎，战国，洛阳金村东周王陵区出土，洛阳博物馆；非九鼎' },
  天龙山石窟: { src: 'img/used/nezu-tianlongshan-c16-buddha-head.jpg', role: '主体', q: 3, cap: '天龙山石窟第16窟如来坐像头部，北齐，东京根津美术馆藏' },
  天龙山石窟: { src: 'img/used/nezu-tianlongshan-pusa-zuoxiang-toubu.jpg', role: '细节', q: 3, cap: '天龙山石窟菩萨坐像头部，唐，东京根津美术馆藏' },
  北京中轴线: { src: 'img/used/jingshan-overlook-gugong.jpg', role: '主体', q: 3, cap: '自景山南望紫禁城屋顶群' },
  北京中轴线: { src: 'img/used/jingshan-zhongzhouxian-beiwang.jpg', role: '语境', q: 2, cap: '景山北望寿皇殿修缮中（2016），中轴线申遗腾退修缮期间' },
  曾侯乙编钟: { src: 'img/used/hubei-zenghouyi-bianzhong.jpg', role: '主体', q: 3, cap: '曾侯乙编钟，湖北省博物馆' },
  梁庄王墓: { src: 'img/used/hubei-liangzhuangwang-mianguan.jpg', role: '语境', q: 3, cap: '梁庄王墓冕冠（复原件，据出土金玉附件与鲁荒王冕冠复原），湖北省博物馆' },
  福泉山遗址: { src: 'img/used/shbo-liangzhu-yuyue.jpg', role: '主体', q: 2, cap: '良渚文化玉钺，1982 青浦福泉山遗址出土，上海博物馆' },
  兵马俑: { src: 'img/used/qinling-yihaokeng-quanjing.jpg', role: '主体', q: 3, cap: '秦始皇兵马俑一号坑' },
  广政石经: { src: 'img/used/houshu-guangzheng-shijing-01.jpg', role: '主体', q: 3, cap: '后蜀（广政）石经残石，传 1938 成都出土，国博' },
  晋祠: { src: 'img/used/jinci-shengmudian-bian.jpg', role: '细节', q: 3, cap: '晋祠圣母殿匾额与梁架' },
  大报恩寺琉璃塔: { src: 'img/used/dabaoensi-liulita-01.jpg', role: '语境', q: 3, cap: '今日大报恩塔（当代新建钢架玻璃塔），南京；原塔 1856 年毁' },
  青釉堆塑谷仓罐: { src: 'img/used/liuchao-qingci-guqiangguan-01.jpg', role: '语境', q: 2, cap: '青瓷堆塑楼阙魂瓶，南京上坊吴墓出土，六朝博物馆藏——与本条所记故宫藏品是同类不同件' },
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
  // cap（2026-09-04 判官荐）：图注写明复制品／当代新建／不是同一件等，无处落时挂在这里
  const note = (x) => (x.cap ? `${x.cap}（图为本库自摄）` : (x.role && x.role !== '主体' ? `${x.role}·图为本库自摄` : '图为本库自摄'));
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
