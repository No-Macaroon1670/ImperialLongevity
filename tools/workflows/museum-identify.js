export const meta = {
  name: 'museum-identify',
  description: '一站照片的既有识别管线：Sonnet 拼版闸1（每员 ≤24 张拼版）→ Opus 闸2（keep 者 36 张一员，同 schema）。args: { station, dir(暂存站夹), sheetsRel, thumbsRel }',
  whenToUse: '闸0 跑完、缩略图与拼版做好（prep 脚本）之后，对一站照片认名对库。产物落 dir/out/{gate1-*,o*}.json，随后跑 photo_ledger.py build/move 与 museum-associate。',
  phases: [{ title: '闸1 Sonnet', detail: '拼版逐格出类别／一句／keep／人脸' }, { title: '闸2 Opus', detail: 'keep 者认名、抄牌、对库' }],
}
const REPO = 'C:\\Users\\ziyi_\\Claude\\imperial-longevity'
const SP = 'C:\\Users\\ziyi_\\AppData\\Local\\Temp\\claude\\C--Users-ziyi--Claude-imperial-longevity\\48811d4a-955a-4472-b299-02c9390bb59c\\scratchpad\\photos'
const station = args.station, DIR = args.dir, sheetsRel = args.sheetsRel, thumbsRel = args.thumbsRel
const hint = args.hint || ''
const RULES = `铁律（违者作废）：①只读 ${REPO}\\${thumbsRel}\\ 与 ${REPO}\\${sheetsRel}\\ 下的图，**绝不打开 img/inbox/、img/originals/、img/own/、img/used/、img/awaiting/、img/processed/**；②Grep/Glob 只在仓库 js/、docs/ 与 ${SP} 内跑，绝不扫 C:\\Users\\ziyi_ 根／OneDrive／Desktop／Documents／Downloads；③不改仓库任何文件，不 commit；你只许写 ${DIR}\\out\\ 下自己那份 JSON；④人脸只记 faces=true，不描述人；⑤看不清就写看不清，不得编造说明牌文字；⑥每张都要出一行，不许跳过；⑦**结构化返回必须是完整结果**，不许用占位行指向文件。`
const EFF = `效率要求：Read 可以并发——**一轮一次读 12–16 张图**；对库只做一次（先攒齐名，再一次 Grep 批对）；结果 JSON 只在末尾写一次；看过的图不回头再 Read。目标 6–8 轮收工。`
const COMMON = `对库：${SP}\\lib-index.json 是库内大事记索引（n 条名、k 类、y 年、w 维基名、d 政权、p 落点、hint）——同物＝这就是那条讲的那件；同类＝同一类器物或同一遗址的另一件；同题＝库内条讲的事与此物有关。match_n 必须逐字取自索引的 n。${SP}\\state.json 的 own_keys 是已有自摄图的条名。new_candidate 只给「馆藏名品级」且库内无同物的展品（有牌、有名、有年代）。按拍摄时序看：**说明牌照片是钥匙**——相邻一两张里的牌就是这件的名字，把牌上名称、年代、出土地、藏馆编号抄进 label_text，并把它给邻近的展品照 name_src=旁牌；同一件多拍挑最佳一张，其余 dup_of 指向它。usable_q：3 可直接上站；2 裁一下可用；1 勉强；0 不可用。`
const GATE1 = { type: 'object', properties: { photos: { type: 'array', items: { type: 'object', properties: {
  idx: { type: 'integer' }, file: { type: 'string' }, cat: { type: 'string', description: '展品|说明牌|展板|展厅|建筑|人物|生活杂照|重复|看不清' }, what: { type: 'string', description: '一句 ≤30 字' }, keep: { type: 'boolean' }, faces: { type: 'boolean' } }, required: ['idx', 'file', 'cat', 'what', 'keep', 'faces'] } } }, required: ['photos'] }
const PHOTO = { type: 'object', properties: { chunk: { type: 'string' }, museum: { type: 'string' }, photos: { type: 'array', items: { type: 'object', properties: {
  file: { type: 'string' }, kind: { type: 'string' }, name: { type: 'string' }, name_src: { type: 'string' }, era: { type: 'string' }, label_text: { type: 'string' }, match_n: { type: 'string' }, match_how: { type: 'string' },
  new_candidate: { type: 'boolean' }, why: { type: 'string' }, usable_q: { type: 'integer' }, role: { type: 'string' }, faces: { type: 'boolean' }, crop_needed: { type: 'boolean' }, dup_of: { type: 'string' }, note: { type: 'string' } },
  required: ['file', 'kind', 'name', 'name_src', 'match_n', 'match_how', 'new_candidate', 'usable_q', 'faces'] } } }, required: ['chunk', 'museum', 'photos'] }
const nSheets = args.sheets
const halves = []
for (let a = 1; a <= nSheets; a += 24) halves.push([a, Math.min(a + 23, nSheets)])
const gate1 = await parallel(halves.map(([a, b], hi) => () => agent(`你是「王朝之河」库照片漏斗的闸1 初判员（缩略图粗筛）。先读 ${DIR}\\sheets.json：里面 ${nSheets} 张拼版（sheet 路径相对仓库 ${REPO}，每张 3×3 共九格，每格左上黄字是全局序号 idx，items 给了 idx→file）。你负责第 ${a}–${b} 张拼版。用 Read 逐张看拼版图（**一轮读 8 张**），对每一格出一行：idx、file、cat、what（一句 ≤30 字，说明牌请抄标题）、keep（展品／说明牌／展板且可辨→true；展厅空镜、生活照、纯人像、糊到认不出→false）、faces。
馆次提示：${station}。${hint}
只出判定，不做对库。结果 JSON 存到 ${DIR}\\out\\gate1-${hi + 1}.json 再返回（返回须含全部行）。${RULES}`, { label: `gate1:${hi + 1}`, phase: '闸1 Sonnet', model: 'sonnet', effort: 'medium', schema: GATE1 })))
const g1 = gate1.filter(Boolean).flatMap(g => g.photos).sort((x, y) => x.idx - y.idx)
const keep = g1.filter(p => p.keep)
log(`闸1 归：判 ${g1.length}，keep ${keep.length}`)
const thumbOf = f => `${REPO}\\${thumbsRel}\\` + f.replace(/\.[^.]+$/, '') + '.jpg'
const chunks = []
for (let i = 0; i < keep.length; i += 36) chunks.push({ id: 'o' + String(chunks.length + 1).padStart(2, '0'), items: keep.slice(i, i + 36) })
const outs = await parallel(chunks.map(c => () => agent(`你是「王朝之河」库的照片识别员（闸2）。任务：把识别包 ${c.id}（${c.items.length} 张，闸1 已判 keep）逐张认出来，一张不落。照片表（idx | file | 缩略图路径 | 闸1 一句，仅供参考）：
${c.items.map(it => `${it.idx} | ${it.file} | ${thumbOf(it.file)} | ${it.what}`).join('\n')}
馆次提示：${station}。${hint}
${COMMON}
${EFF}
写完把结果 JSON 存到 ${DIR}\\out\\${c.id}.json（与返回同内容）再返回。${RULES}`, { label: `opus:${c.id}`, phase: '闸2 Opus', model: 'opus', effort: 'medium', schema: PHOTO })))
const done = outs.filter(Boolean)
log(`闸2 归 ${done.length}/${chunks.length} 员 ${done.reduce((s, o) => s + o.photos.length, 0)} 行`)
return { gate1: g1.length, keep: keep.length, chunks: chunks.length, rows: done.reduce((s, o) => s + o.photos.length, 0), results: done }
