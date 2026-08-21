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
  桓温灭成汉: 'img/used/suining-songci-huanwen-pingshu-map.jpg',
  钧窑: 'img/used/guobo-junyao-tianlanyou-wan.jpg',
  龙泉窑: 'img/used/suining-songci-longquanyao-qingyou-ping.jpg',
  官窑: 'img/used/suining-songci-mingyao-jingchu-banban.jpg',
};
