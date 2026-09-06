export const meta = {
  name: 'catalog-fill',
  description: '著录员：按馆次读 awaiting 夹照片的缩略图与账本行，按美国馆藏 tombstone 体例补 materials／color／dimensions／provenance／inscription 等栏。args: { batches: [{id, museum, thumbsRel, files:[...]}] }',
  whenToUse: '照片总账 build 之后，为有推荐的照片补著录栏（日后中华文物小图库用）。每员 ≤36 张。产物 scratchpad/photos/catalog/<id>.json，随后 photo_ledger.py patch 并入。',
  phases: [{ title: '著录', detail: 'Opus 一员 ≤36 张，只写看得见与牌上写的' }],
}
const REPO = 'C:\\Users\\ziyi_\\Claude\\imperial-longevity'
const SP = 'C:\\Users\\ziyi_\\AppData\\Local\\Temp\\claude\\C--Users-ziyi--Claude-imperial-longevity\\48811d4a-955a-4472-b299-02c9390bb59c\\scratchpad\\photos'
const OUT = SP + '\\catalog'
const SCHEMA = { type: 'object', properties: { batch: { type: 'string' }, rows: { type: 'array', items: { type: 'object', properties: {
  file: { type: 'string' }, title: { type: 'string', description: '规范题名：器名（含窑口／纹饰／器形），牌上有则照牌' }, object_type: { type: 'string', description: '器类：瓷器|青铜器|玉器|石雕|木雕|漆器|织绣|书画|碑拓|钱币|建筑构件|化石标本|矿物标本|模型|其他' },
  culture_period: { type: 'string', description: '文化／朝代（如 西周、北宋、大理国）' }, date: { type: 'string', description: '年代（年号纪年或世纪区间，牌上有则照牌）' }, materials: { type: 'string', description: '材质与工艺（如 青花瓷；木胎髹漆贴金；砂岩）' },
  color: { type: 'string', description: '主色／釉色（看得见的，如 青白釉、黑漆描金、青灰砂岩）' }, dimensions: { type: 'string', description: '尺寸，牌上有才写，否则空' },
  provenance: { type: 'string', description: '出土地／流传（牌上写的：某地某墓出土、某人捐赠、征集）' }, current_location: { type: 'string', description: '藏馆' }, accession_no: { type: 'string', description: '藏品号／编号，牌上有才写' },
  description: { type: 'string', description: '客观描述：器形、纹饰、款识位置、保存状况，≤120 字' }, inscription: { type: 'string', description: '器上或牌上转录的铭文／款识原文，没有则空' },
  confidence: { type: 'integer', description: '1–3：3 牌上明写；2 看得见能定；1 推测' } }, required: ['file', 'title', 'object_type', 'materials', 'color', 'description', 'confidence'] } } }, required: ['batch', 'rows'] }
const RULES = `铁律：①只读 ${REPO}\\<缩略图夹>\\ 下的缩略图（路径在表里），**绝不打开 img/inbox/、img/originals/、img/own/、img/used/、img/awaiting/、img/processed/**；②Grep/Glob 只在仓库与 ${SP} 内跑；③不改仓库任何文件，不 commit；只许写 ${OUT}\\<batch>.json；④只写看得见与牌上写的，推测的写进 confidence=1 而不是当事实；⑤人脸照不描述人；⑥每张一行，不跳过。`
const BATCHES = args.batchesFile || (SP + '\\catalog_batches.json')
const outs = await parallel(args.batches.map(b => () => agent(`你是「中华文物小图库」的著录员，按美国博物馆藏品页（tombstone）体例给照片里的文物著录。批 ${b.id}（${b.museum}，${b.n} 张）。
先读 ${BATCHES}，取 batches 里 id 为「${b.id}」的那一批：files 每项给了 file、已认名 name、年代 era、牌文抄录 label_text（识别员抄的，可信但不全）；缩略图路径＝${REPO}\\${b.thumbsRel}\\<file 去扩展名>.jpg。

做法：用 Read 看图（**一轮读 12–16 张**），结合牌文，填 title／object_type／culture_period／date／materials／color／dimensions／provenance／current_location／accession_no／description／inscription 与 confidence。看不见、牌上没写的栏留空，不要为了填满而猜；同一件多拍的照片著录相同、description 可注明「同物另一角度」。结果 JSON 存到 ${OUT}\\${b.id}.json（与返回同内容）再返回，返回须含全部行。${RULES}`, { label: `著录:${b.id}`, phase: '著录', model: 'opus', effort: 'medium', schema: SCHEMA })))
const done = outs.filter(Boolean)
log(`著录归 ${done.length}/${args.batches.length} 员，${done.reduce((s, o) => s + o.rows.length, 0)} 行`)
return { batches: done.length, rows: done.reduce((s, o) => s + o.rows.length, 0), results: done }
