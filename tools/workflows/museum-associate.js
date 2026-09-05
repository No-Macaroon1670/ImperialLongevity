export const meta = {
  name: 'museum-associate',
  description: '一站照片识别完之后的「由此想到」：按展区聚簇→逐簇查库内骨干与缺口→提候立条（带锚年、一手线索、互见）→对抗过筛，出联想清单候库主圈',
  whenToUse: '某站照片经识别出榜（material.md：说明牌／展板抄录＋认出展品清单）之后，想知道这一站能让库里长出哪些新条时跑。args: { station, material, out }',
  phases: [
    { title: '聚簇', detail: '一员：按展区把说明牌／展板／展品聚成簇，每簇给证据与展品' },
    { title: '联想', detail: '每员三簇：查库内骨干、说缺口层级、提候立条（锚年／一手线索／互见）' },
    { title: '过筛', detail: '一员对抗：剔泛条、无锚年、库内已有；按读者发现价值排前十二' },
  ],
}
const REPO = 'C:\\Users\\ziyi_\\Claude\\imperial-longevity'
const LIB = REPO + '\\js\\events.js'
const RULES = `铁律：①Grep/Glob 只在仓库 ${REPO} 与 args 指定的原料目录内跑，绝不扫 C:\\Users\\ziyi_ 根／OneDrive／Desktop／Documents／Downloads；不读 img/ 下任何目录。②只读不改：不 Edit/Write 仓库文件，不 commit。③引文与数字须来自亲读的文件或 API 返回；查不到写「未查到」，不得编。④行文中文，多用表格，少空话。`
const station = args.station || '某站'
const material = args.material
const CLUSTERS = { type: 'object', properties: { clusters: { type: 'array', items: { type: 'object', properties: {
  name: { type: 'string', description: '簇名（展区／题材，如「文房石馆·端砚」）' },
  evidence: { type: 'array', items: { type: 'string' }, description: '支撑此簇的说明牌／展板抄录（原句，≤3 条）' },
  artifacts: { type: 'array', items: { type: 'string' }, description: '此簇里认出的展品名（≤12）' },
  matched: { type: 'array', items: { type: 'string' }, description: '员已对上的库内条名' },
  size: { type: 'integer', description: '此簇照片数' } }, required: ['name', 'evidence', 'artifacts', 'size'] } } }, required: ['clusters'] }
const IDEAS = { type: 'object', properties: { clusters: { type: 'array', items: { type: 'object', properties: {
  name: { type: 'string' },
  backbone: { type: 'array', items: { type: 'string' }, description: '库内已有的骨干条（grep events.js 的 n 实证）' },
  gap: { type: 'string', description: '缺口在哪一级：总条／代表器／人／事／制度／地方分支，一句' },
  candidates: { type: 'array', items: { type: 'object', properties: {
    n: { type: 'string', description: '拟条名' }, k: { type: 'string', description: 'art|her|cul|gov|liv|war|rev|out|sci|dis|inst|fig' },
    y: { type: 'integer', description: '锚年（天文纪年，前N年写 -(N-1)）' }, anchor_why: { type: 'string', description: '为什么锚这一年，一手线索是什么' },
    chain: { type: 'string', description: '触类旁通链：从这一站的哪件／哪块牌想到它，再连到库内哪条' },
    wiki: { type: 'string', description: '中文维基条目名（用 API 核过存在且非消歧义）或 en:… 或 无' },
    photo: { type: 'string', description: '本站可挂的照片 file（若有）' },
    value: { type: 'integer', description: '读者发现价值 1–3' } }, required: ['n', 'k', 'y', 'anchor_why', 'chain', 'wiki', 'value'] } },
  cross: { type: 'array', items: { type: 'string' }, description: '跨簇的链（如 广彩→十三行→一口通商）' } }, required: ['name', 'backbone', 'gap', 'candidates'] } } }, required: ['clusters'] }
const FINAL = { type: 'object', properties: {
  keep: { type: 'array', items: { type: 'object', properties: { n: { type: 'string' }, cluster: { type: 'string' }, k: { type: 'string' }, y: { type: 'integer' }, wiki: { type: 'string' }, chain: { type: 'string' }, why_keep: { type: 'string' }, rank: { type: 'integer' } }, required: ['n', 'cluster', 'k', 'y', 'chain', 'rank'] } },
  dropped: { type: 'array', items: { type: 'object', properties: { n: { type: 'string' }, why: { type: 'string' } }, required: ['n', 'why'] } },
  md: { type: 'string', description: '给库主看的联想清单 Markdown：按簇分节，每簇：库内骨干／缺口／候立条表（名·类·锚年·链·维基·价值）／跨簇链；末尾「首圈十二」' } }, required: ['keep', 'dropped', 'md'] }

const clus = await agent(`你是「王朝之河」库的展区聚簇员。读 ${material}（${station} 照片识别原料：说明牌／展板抄录按时序、认出展品清单）。把它按**展区／题材**聚成 6–10 簇：每簇给簇名、支撑它的牌／展板原句（≤3）、认出的展品（≤12）、已对上的库内条、照片数。展厅空镜、生活照、看不清者不入簇。只聚不评。${RULES}`, { label: '聚簇', phase: '聚簇', model: 'opus', effort: 'medium', schema: CLUSTERS })
const clusters = (clus && clus.clusters) || []
log(`聚成 ${clusters.length} 簇：${clusters.map(c => c.name).join('、')}`)
const groups = []
for (let i = 0; i < clusters.length; i += 3) groups.push(clusters.slice(i, i + 3))
const ideas = await parallel(groups.map((g, gi) => () => agent(`你是「王朝之河」库的联想员——库主说「博物馆图最宝贵的是触类旁通」：看到一件东西，想到库里该长出哪几条。你负责 ${station} 的 ${g.length} 簇：
${JSON.stringify(g, null, 1)}

对每簇做四步：①**查骨干**：用 Grep 在 ${LIB} 里按簇内关键词查 n 字段（如 端砚、砚、文房；潮州、木雕），列出库内已有的条（逐字实证，别凭记忆）；②**说缺口**：缺的是哪一级——总条（如「端砚」）、代表器、人、事、制度、地方分支；③**提候立条**：每簇 2–5 条，**每条必须有锚年**（天文纪年，前N年写 -(N-1)）与锚年的一手线索（正史／方志／碑铭／馆牌／非遗公布日期皆可，写明出处），写清「从这一站哪件／哪块牌想到它、再连到库内哪条」这条链，用 zh.wikipedia API（action=query&titles=…&redirects=1，UA 写 imperial-longevity-curation/1.0）核维基条目存在且非消歧义（没有中文条的写 en:… 或「无」，无维基者按库规原则上不收，除非有硬一手），给读者发现价值 1–3；④**跨簇链**：这簇的东西与别簇／库内别处的连线（如 广彩→十三行→一口通商）。
库规提醒（events.js 档头）：有年份、有词条、改变了后续、文学名篇可收、无从系年者不收；「泛条」（如「陶瓷」「玉器」）不算发现。
原料文件：${material}。${RULES}`, { label: `联想:${gi + 1}`, phase: '联想', model: 'opus', effort: 'high', schema: IDEAS })))
const all = ideas.filter(Boolean).flatMap(r => r.clusters)
const cands = all.flatMap(c => (c.candidates || []).map(x => ({ ...x, cluster: c.name })))
log(`候立条 ${cands.length} 条，来自 ${all.length} 簇`)
const fin = await agent(`你是「王朝之河」库的过筛员（对抗立场）。下面是 ${station} 联想员提的候立条与各簇骨干／缺口／跨簇链：
${JSON.stringify(all, null, 1)}

逐条审：①库内是否已有同物或近题条（Grep ${LIB} 的 n 字段实证；有则剔并写明撞哪条）；②锚年是否站得住（无锚年、锚年只是「大约」且无一手者剔）；③是不是泛条或工艺总名下的空壳（剔）；④读者发现价值——「这一站的东西让库长出这条」是否真成立（链断的剔）。留下的按价值与链的硬度排名，前十二为首圈。产出：keep（含 rank）、dropped（含理由）、md（给库主看的联想清单：按簇分节，每簇骨干／缺口／候立条表（名·类·锚年·链·维基·价值）／跨簇链；末尾「首圈十二」一表）。${RULES}`, { label: '过筛', phase: '过筛', model: 'opus', effort: 'high', schema: FINAL })
return { clusters: clusters.length, candidates: cands.length, keep: fin ? fin.keep.length : 0, dropped: fin ? fin.dropped.length : 0, md: fin ? fin.md : '', keepList: fin ? fin.keep : [], droppedList: fin ? fin.dropped : [], raw: all }
