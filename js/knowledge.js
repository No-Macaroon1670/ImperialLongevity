// knowledge.js — 知识卡:实时维基摘要
//
// 三处挂载,共用一套填卡逻辑:
//   · 河流两翼(桌面):**左翼朝代、右翼皇帝**——左卡给时代背景(当前时段的
//     主导朝代),右卡给个人(视口中带的名君,或点选的任一君主)。点选君主时
//     两卡联动:右卡其人、左卡其朝,一并钉住。
//   · 泳道角卡(桌面):单卡皇帝,嵌在说明段右侧的空角。
// 摘要与头图**实时**拉取中文维基百科(REST summary,CORS 开放、自动跟随
// 重定向——刘彻→汉武帝),页面不预存词条内容。百度百科无 CORS 接口只给
// 直达链接;「相关视频」给 YouTube 搜索直链而非具体视频——不预存链接就
// 永远不会烂,搜索结果也天然比三年前存的某支视频新鲜。
import { h, fmtYearAxis } from './charts.js';
import { EVENT_KINDS } from './events.js';

/**
 * 值得自动弹卡的名君(姓名 → 权重 1–3):滚动经过时自动打开,权重高者优先。
 *
 * 初版只有 36 位,东汉中后期、唐中晚期、明中期、清中晚期各有近百年的空档
 *(视窗约百年,一段无人上榜就整屏没有皇帝卡)。现按时代补齐到 154 位:
 * 每个大一统王朝的在位长者与转折点人物、每个割据政权至少一位开国或代表君主,
 * 使全图任意百年视窗都至少有一位在榜。权重 3 家喻户晓、2 重要、1 补位。
 */
const NOTABLE = new Map(Object.entries({
  // 秦汉
  嬴政: 3, 胡亥: 2, 刘邦: 3, 刘恒: 2, 刘启: 2, 刘彻: 3, 刘弗陵: 1, 刘询: 2, 刘骜: 1,
  王莽: 3, 刘玄: 1, 刘秀: 3, 刘庄: 2, 刘肇: 1, 刘祜: 1, 刘保: 1, 刘志: 2, 刘宏: 2, 刘协: 3,
  // 三国两晋
  曹丕: 2, 曹叡: 2, 曹髦: 2, 刘备: 3, 刘禅: 3, 孙权: 3, 孙皓: 2,
  司马炎: 2, 司马衷: 3, 司马睿: 2, 司马曜: 1, 司马德宗: 1, 桓玄: 2,
  // 十六国
  李雄: 1, 刘渊: 2, 刘聪: 2, 石勒: 2, 石虎: 2, 冉闵: 2, 慕容皝: 1, 慕容儁: 1,
  苻坚: 3, 姚苌: 1, 姚兴: 1, 慕容垂: 2, 慕容德: 1, 冯跋: 1, 赫连勃勃: 1,
  沮渠蒙逊: 1, 吕光: 1, 张骏: 1,
  // 南北朝
  刘裕: 3, 刘义隆: 2, 刘骏: 1, 刘子业: 1, 萧道成: 1, 萧赜: 1, 萧宝卷: 1,
  萧衍: 3, 萧绎: 1, 萧岿: 1, 陈霸先: 2, 陈叔宝: 2,
  拓跋珪: 2, 拓跋焘: 2, 元宏: 3, 元诩: 1, 元善见: 1, 元宝炬: 1,
  高洋: 2, 高纬: 1, 宇文邕: 2,
  // 隋唐
  杨坚: 3, 杨广: 3, 李渊: 3, 李世民: 3, 李治: 2, 武曌: 3, 李隆基: 3,
  李豫: 1, 李适: 2, 李纯: 2, 李儇: 1, 李晔: 2,
  // 五代十国
  朱温: 3, 李存勖: 2, 李嗣源: 1, 石敬瑭: 3, 刘知远: 1, 郭威: 2, 柴荣: 3,
  杨行密: 1, 李昪: 1, 李璟: 1, 李煜: 3, 王建: 1, 孟昶: 2, 刘䶮: 1,
  王审知: 1, 马殷: 1, 钱镠: 2, 钱俶: 1, 高季兴: 1, 刘崇: 1,
  // 宋辽金夏与大理
  赵匡胤: 3, 赵光义: 2, 赵恒: 1, 赵祯: 3, 赵顼: 2, 赵佶: 3,
  赵构: 3, 赵昚: 2, 赵昀: 1, 赵㬎: 1,
  耶律阿保机: 2, 耶律德光: 2, 耶律隆绪: 2, 耶律洪基: 1, 耶律延禧: 1,
  李元昊: 2, 李乾顺: 1, 李仁孝: 1,
  完颜阿骨打: 2, 完颜亮: 2, 完颜雍: 2, 完颜守绪: 1,
  段思平: 1, 段正严: 1,
  // 元明清
  铁木真: 3, 窝阔台: 1, 蒙哥: 1, 忽必烈: 3, 妥懽帖睦尔: 2, 脱古思帖木儿: 1,
  朱元璋: 3, 朱棣: 3, 朱祁镇: 2, 朱见深: 1, 朱祐樘: 2, 朱厚熜: 2, 朱翊钧: 3, 朱由检: 3,
  朱由崧: 1, 朱由榔: 1,
  福临: 2, 玄烨: 3, 胤禛: 3, 弘历: 3, 颙琰: 1, 旻宁: 2, 载淳: 1, 载湉: 3, 溥仪: 3,
  洪秀全: 3, 袁世凯: 3,
}));

/**
 * 朝代的词条标题——**两家各有一张表**:单字国号直接搜多半撞上消歧义页,
 * 而两家的正名并不相同,一张表管不了两家。表外的照用库内名。
 *
 * 维基:实测只有「吴越」是消歧义页(→吴越国);其余靠重定向都能落对
 *（玄汉→更始政權、陈朝→南陳、中华帝国→中華帝國）。
 *
 * 百度:没有 CORS 接口、链接是盲发的,实测撞了一串——
 *   陈朝 → 中国地质大学副教授;胡夏 → 内地男歌手;吴越 → 内地女演员;
 *   马楚、南梁、吴越国 → 多义词页;中华帝国 → 直接跳「中国」。
 * 故按百度自己的正名另立一表(逐条实测过):南朝陈、南朝梁、赫连夏（→大夏）、
 * 南楚（→楚国）、吴越国、洪宪帝制。人名类不必管:刘彻、石虎实测都落在
 * 帝王义项上——百度按知名度取义项,历史人物几乎总是压得住同名今人。
 */
const DYN_WIKI = {
  秦: '秦朝', 新: '新朝', 梁: '南梁', 陈: '陈朝', 隋: '隋朝', 唐: '唐朝',
  吴: '杨吴', 闽: '闽国', 楚: '马楚', 南平: '荆南', 辽: '辽朝', 金: '金朝',
  大理: '大理国', 元: '元朝', 明: '明朝', 清: '清朝', 吴越: '吴越国',
};
const DYN_BAIDU = {
  ...DYN_WIKI,
  梁: '南朝梁', 陈: '南朝陈', 楚: '南楚', 胡夏: '赫连夏', 中华帝国: '洪宪帝制',
};

// 词条标题 → Promise<summary|null>:会话内不重复拉取。
// **只缓存确定的结果**:404(确实没这个词条)值得记住,但网络抖动、离线、
// 429 限流这类暂时失败必须逐出缓存——否则一次抖动就把该词条钉死成
// 「未能拉取」直到刷新整页(fillCard 的同 key 早退让它连重试的机会都没有)
const CACHE = new Map();

// 会话之间也留着:内存 Map 一刷新就空,而这一页里滚一遍河就要拉近百个词条,
// 回访、刷新、在两个视图之间来回切都得重拉一遍。摘要几乎不变,存下来即可——
// 维基的 REST 接口对匿名请求限流并不宽松(本项目做批量校验时实测撞过 429),
// 能不发的请求就别发。
//
// 只存我们真正用到的四个字段(约半 KB 一条,四百条不到 200KB,localStorage
// 上限 5MB);失败**一律不落盘**,理由同上:一次网络抖动不该被记成永久结论。
const LS_KEY = 'il.kp.v1';
const LS_TTL = 7 * 24 * 3600 * 1000;
let disk = null;
function diskLoad() {
  if (disk) return disk;
  disk = {};
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    const now = Date.now();
    for (const [k, v] of Object.entries(raw)) if (v && now - v.t < LS_TTL) disk[k] = v;
  } catch { disk = {}; }
  return disk;
}
let flushTimer = null;
function diskSave(title, s) {
  const d = diskLoad();
  d[title] = { t: Date.now(), title: s.title, extract: s.extract,
    thumb: s.thumbnail && s.thumbnail.source,
    url: s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page };
  // 合并写:一屏可能连落几条,没必要每条都序列化整个库
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try { localStorage.setItem(LS_KEY, JSON.stringify(disk)); }
    catch { try { localStorage.removeItem(LS_KEY); } catch { /* 配额满或禁用,放弃落盘 */ } }
  }, 800);
}
const revive = (v) => ({ type: 'standard', title: v.title, extract: v.extract,
  thumbnail: v.thumb ? { source: v.thumb } : null,
  content_urls: v.url ? { desktop: { page: v.url } } : null });

function fetchSummary(title) {
  if (!CACHE.has(title)) {
    const hit = diskLoad()[title];
    if (hit && hit.extract) { CACHE.set(title, Promise.resolve(revive(hit))); return CACHE.get(title); }
    CACHE.set(title, fetch(`https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
      .then((r) => {
        if (!r.ok) { if (r.status !== 404) CACHE.delete(title); return null; }
        return r.json();
      })
      .then((j) => {
        if (j && j.extract && j.type !== 'disambiguation') diskSave(title, j);
        return j;
      })
      .catch(() => { CACHE.delete(title); return null; }));
  }
  return CACHE.get(title);
}

/** 大事记 → 卡片规格。点选与自动跟随共用,不再各写一份 */
export function evSpec(ev) {
  const span = ev.y2 ? `${fmtYearAxis(ev.y)}–${fmtYearAxis(ev.y2)}` : fmtYearAxis(ev.y);
  return {
    id: `evt:${ev.w}${ev.ws || ''}`, head: `${span} · ${(EVENT_KINDS[ev.k] || {}).label || '大事'}`,
    title: ev.w, sec: ev.ws, display: ev.ya ? `${ev.ya}（${ev.n}）` : ev.n,
    q: `${ev.n} 历史`, yt: true,
  };
}

function mkCard(sideClass) {
  const img = h('img', { class: 'kp-thumb', alt: '' });
  const head = h('div', { class: 'kp-sub' });
  const title = h('div', { class: 'kp-title' });
  const ext = h('p', { class: 'kp-ext' });
  const wiki = h('a', { class: 'kp-a', target: '_blank', rel: 'noopener', text: '维基百科全文 ↗' });
  const baidu = h('a', { class: 'kp-a', target: '_blank', rel: 'noopener', text: '百度百科 ↗' });
  const yt = h('a', { class: 'kp-a', target: '_blank', rel: 'noopener', text: '▶ 相关视频' });
  const close = h('button', { class: 'kp-close', type: 'button', text: '✕' });
  const src = h('div', { class: 'kp-src', text: '摘要实时取自中文维基百科' });
  const el = h('div', { class: `kp ${sideClass}` }, [
    close, img, head, title, ext, h('div', { class: 'kp-links' }, [wiki, baidu, yt]), src,
  ]);
  return { el, img, head, title, ext, wiki, baidu, yt, close };
}

/** 皇帝卡的取数说明书。库内 382 位君主全有姓名,故标题恒为人名 */
const empSpec = (item) => {
  const e = item.e, dyn = item.band.d;
  const nm = e.name || `${dyn.name}${e.temple}`;
  return {
    id: e.id,
    head: `${dyn.name} · ${e.temple}`,
    title: nm,
    baidu: nm,
    q: `${dyn.name} ${nm} 历史`,
    yt: NOTABLE.has(e.name),
  };
};
/** 朝代卡的取数说明书。维基与百度各取各的正名(见 DYN_WIKI / DYN_BAIDU) */
const dynSpec = (band) => {
  const d = band.d;
  const wk = DYN_WIKI[d.name] || d.name;
  return {
    id: `dyn:${d.key}`,
    head: `${fmtYearAxis(d.s)} – ${fmtYearAxis(d.e)} · 朝代`,
    title: wk,
    baidu: DYN_BAIDU[d.name] || d.name,
    q: `${wk} 历史 纪录片`,
    yt: true,
  };
};

/**
 * 改朝换代事件卡的取数说明书(泳道点丝时用)。
 * `TRANSITIONS` 里维基与百度的正名常不一致,故 `w`/`b` 分列(见 dynasties.js)
 */
export const eventSpec = (tr, fromName, toName) => ({
  id: `ev:${tr.w}|${fromName}|${toName}`,
  head: `${fromName} → ${toName} · 改朝换代`,
  title: tr.w,
  baidu: tr.b || tr.n,
  q: `${tr.n} 历史`,
  yt: true,
  display: tr.n,          // 卡面用简体常用名,链接才用各家的正名
});

/** 共用的填卡逻辑:写入词条链接、实时拉取维基摘要 */
async function fillCard(card, spec) {
  if (card.el.dataset.key === spec.id) { card.el.classList.add('on'); return; }
  card.el.dataset.key = spec.id;
  card.head.textContent = spec.head;
  card.title.textContent = spec.display || spec.title;
  card.ext.textContent = '…';
  card.img.style.display = 'none';
  // 有些事**没有独立条目**,只是某篇通史里的一节(东汉末那串大疫见《中國瘟疫史·漢朝》)。
  // 与其因此不收,不如链到那一节:摘要仍取母条目(泛些,但对得上题),链接直达段落。
  card.wiki.href = `https://zh.wikipedia.org/wiki/${encodeURIComponent(spec.title)}`
    + (spec.sec ? `#${encodeURIComponent(spec.sec)}` : '');
  card.baidu.href = `https://baike.baidu.com/item/${encodeURIComponent(spec.baidu || spec.title)}`;
  card.yt.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(spec.q)}`;
  card.yt.style.display = spec.yt ? '' : 'none';
  card.el.classList.add('on');
  const s = await fetchSummary(spec.title);
  if (card.el.dataset.key !== spec.id) return;             // 等待期间已换人
  if (s && s.extract && s.type !== 'disambiguation') {
    card.title.textContent = spec.display || s.title || spec.title;
    card.ext.textContent = s.extract;
    if (s.thumbnail && s.thumbnail.source) { card.img.src = s.thumbnail.source; card.img.style.display = ''; }
    if (s.content_urls && s.content_urls.desktop) {
      card.wiki.href = s.content_urls.desktop.page + (spec.sec ? `#${encodeURIComponent(spec.sec)}` : '');
    }
  } else {
    card.ext.textContent = '未能实时拉取维基摘要(可能无词条或网络受限),下方链接仍可直达。';
  }
}

/**
 * 河流两翼卡。左翼**朝代**(时代背景):自动跟随视口中带里可见时长最长的
 * 朝代;右翼**皇帝**(个人):视口中带权重最高的名君。点选任一君主时两卡
 * 联动钉住——右卡其人、左卡其朝。✕ 各自关闭并拉黑,不在原地重弹。
 * 左翼 ≥1280px(CSS 同步),右翼 ≥1100px。
 */
export function mountKnowledge(empNodes, wrap, evNodes = []) {
  const mq = matchMedia('(min-width: 1100px)');
  const mqLeft = matchMedia('(min-width: 1280px)');
  // 四张卡,两栏两行:上行仍是「左朝代、右皇帝」,下行接住两岸的事件轨——
  // 左岸政事的落左栏,右岸文教的落右栏,卡片就在它那条轨的正下方,
  // 眼睛不必横跨整条河去找刚点的那件事。
  const cards = {
    dyn: mkCard('kp-left'), emp: mkCard('kp-right'),
    evL: mkCard('kp-left kp-ev kp-left-ev'), evR: mkCard('kp-right kp-ev kp-right-ev'),
  };
  const ALL = ['dyn', 'emp', 'evL', 'evR'];
  for (const k of ALL) document.body.appendChild(cards[k].el);
  const pinned = { dyn: null, emp: null, evL: null, evR: null };
  const dismissed = { dyn: new Set(), emp: new Set(), evL: new Set(), evR: new Set() };
  // 同侧两张都开着才叠成上下两行;只开一张时仍居中,免得半屏空着
  const syncStack = () => {
    const on = (k) => cards[k].el.classList.contains('on');
    document.body.classList.toggle('kp-stk-l', on('dyn') && on('evL'));
    document.body.classList.toggle('kp-stk-r', on('emp') && on('evR'));
  };

  const hide = (which) => {
    cards[which].el.classList.remove('on');
    cards[which].el.dataset.key = '';
  };
  for (const which of ALL) {
    cards[which].close.addEventListener('click', () => {
      if (cards[which].el.dataset.key) dismissed[which].add(cards[which].el.dataset.key);
      pinned[which] = null;
      hide(which);
      syncStack();
    });
  }

  // 点选联动:右卡其人、左卡其朝,一并钉住
  for (const n of empNodes) {
    n.node.addEventListener('click', () => {
      if (!mq.matches) return;
      const es = empSpec(n);
      pinned.emp = es.id;
      dismissed.emp.delete(es.id);
      fillCard(cards.emp, es);
      if (mqLeft.matches) {
        const ds = dynSpec(n.band);
        pinned.dyn = ds.id;
        dismissed.dyn.delete(ds.id);
        fillCard(cards.dyn, ds);
      }
    });
  }

  // 滚动:220ms 落定再拉,一路快滚不发一次请求
  let timer = null;
  const update = () => {
    timer = null;
    // 窄到放不下卡时四张全收——此前只收了朝代与皇帝两张,事件卡会赖在屏上
    if (!mq.matches) { for (const k of ALL) hide(k); syncStack(); return; }
    const r = wrap.getBoundingClientRect();
    if (!(r.top < innerHeight * 0.5 && r.bottom > innerHeight * 0.5)) {
      if (!pinned.dyn) hide('dyn');
      if (!pinned.emp) hide('emp');
      return;
    }
    const y0 = -r.top + innerHeight * 0.2, y1 = -r.top + innerHeight * 0.8;
    // 右翼:中带里权重最高的名君
    if (!pinned.emp) {
      const cand = empNodes
        .filter((n) => NOTABLE.has(n.e.name) && !dismissed.emp.has(n.e.id) && n.y1 > y0 && n.y0 < y1)
        .sort((a, b) => (NOTABLE.get(b.e.name) - NOTABLE.get(a.e.name)) || ((b.y1 - b.y0) - (a.y1 - a.y0)))[0];
      if (cand) fillCard(cards.emp, empSpec(cand));
      else hide('emp');
    }
    // 左翼:同朝优先——皇帝卡在场时给他的朝(两张卡是一对);皇帝卡空着时
    // 退回「中带里可见时长最长的朝代」作时代锚(大一统时即那条大河,
    // 分裂期通常是贯穿最久的主线)
    if (!pinned.dyn && mqLeft.matches) {
      const cur = empNodes.find((n) => n.e.id === cards.emp.el.dataset.key);
      let best = cur ? cur.band : null;
      if (!best || dismissed.dyn.has(`dyn:${best.d.key}`)) {
        const span = new Map();
        let bestV = 0;
        best = null;
        for (const n of empNodes) {
          const ov = Math.min(n.y1, y1) - Math.max(n.y0, y0);
          if (ov <= 0 || dismissed.dyn.has(`dyn:${n.band.d.key}`)) continue;
          const v = (span.get(n.band.d.key) || 0) + ov;
          span.set(n.band.d.key, v);
          if (v > bestV) { bestV = v; best = n.band; }
        }
      }
      if (best) fillCard(cards.dyn, dynSpec(best));
      else hide('dyn');
    } else if (!pinned.dyn && !mqLeft.matches) hide('dyn');

    // 事件卡跟随**锚点**(一等大事),不跟随全部三百条——后者滚一屏换三次,
    // 成了走马灯;锚点全程约五十个,几屏才换一次,正是「读到哪一段了」的答案。
    // 且**只在当前那个滚出视野后才换**:还看得见就不动,免得边缘处来回跳。
    for (const [which, side] of [['evL', true], ['evR', false]]) {
      if (pinned[which]) continue;
      if (which === 'evL' && !mqLeft.matches) { hide(which); continue; }
      const inBand = evNodes.filter((n) => n.left === side && (n.ev.r || 2) === 1
        && n.y > y0 && n.y < y1 && !dismissed[which].has(`evt:${n.ev.w}`));
      const curKey = cards[which].el.dataset.key;
      if (curKey && inBand.some((n) => `evt:${n.ev.w}` === curKey)) continue;
      const pick = inBand.sort((a, b) => Math.abs(a.y - (y0 + y1) / 2) - Math.abs(b.y - (y0 + y1) / 2))[0];
      if (pick) fillCard(cards[which], evSpec(pick.ev));
      else hide(which);
    }
    syncStack();
  };
  const onScroll = () => { if (timer) clearTimeout(timer); timer = setTimeout(update, 220); };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  update();

  const cleanup = () => {
    removeEventListener('scroll', onScroll);
    removeEventListener('resize', onScroll);
    if (timer) clearTimeout(timer);
    for (const k of ALL) cards[k].el.remove();
    document.body.classList.remove('kp-stk-l', 'kp-stk-r');
  };
  // 点两岸事件轨:哪岸点的就落哪栏,并钉住。事件卡不随滚动自动换——
  // 四张卡都自己动的话,滚一屏就成了走马灯。
  cleanup.showEvent = (spec, side) => {
    const which = side === 'left' ? 'evL' : 'evR';
    if (!mq.matches || (which === 'evL' && !mqLeft.matches)) return false;
    pinned[which] = spec.id;
    dismissed[which].delete(spec.id);
    fillCard(cards[which], spec);
    syncStack();
    return true;
  };
  return cleanup;
}

/**
 * 泳道知识卡:横向泳道没有两翼留白,但说明段右侧本是一片空当(`.desc` 有
 * 76ch 上限,再宽也不会用掉)。填成三栏:**说明 | 朝代 | 皇帝**,与河流
 * 两翼同一分工。卡片横排(图左浮动、文右绕排),说明段按卡数让出右侧宽度。
 *
 * 朝代卡跟随视窗中带里**可见宽度最长**的朝代底带,皇帝卡跟随权重最高的名君;
 * 点选君主两卡联动(其人＋其朝),点选朝代底带则只钉朝代卡。
 * <1000px 全隐;1000–1199px 只留皇帝卡(放不下第二张)。
 */
export function mountKnowledgeCorner(items, bands, scroller, sectionEl) {
  const mq = matchMedia('(min-width: 1000px)');
  const mqBoth = matchMedia('(min-width: 1200px)');
  const cards = { dyn: mkCard('kp-corner kp-corner-dyn'), emp: mkCard('kp-corner kp-corner-emp') };
  sectionEl.classList.add('kp-anchor');
  sectionEl.appendChild(cards.dyn.el);
  sectionEl.appendChild(cards.emp.el);
  const pinned = { dyn: null, emp: null };
  const dismissed = { dyn: new Set(), emp: new Set() };
  // 让位按**最外侧被占的槽**算,不是按卡数:朝代卡的槽在右起 352–674px,
  // 皇帝卡在 16–338px。只剩朝代卡时(视窗里没有名君、或皇帝卡被关掉——
  // 唐中晚期、明中期、清中期这类长段常驻此态)若按「一张卡」只让 356px,
  // 那 318px 的差正好落在说明段与控件行上,而卡是不透明且 z-index:5,既遮字也吃点击
  const syncLayout = () => {
    const dynOn = cards.dyn.el.classList.contains('on') && mqBoth.matches;
    const empOn = cards.emp.el.classList.contains('on') && mq.matches;
    sectionEl.classList.toggle('has-kp', dynOn || empOn);
    sectionEl.classList.toggle('has-kp2', dynOn);
    // 纵向也要让:卡是 absolute,不占文档高度。说明段一短(单卡态说明拿回
    // 76ch 只排四行)卡的下缘就压住泳道图的吸顶年份标尺,故按实测把图顶下去。
    // 卡的高度随内容(有无头图、摘要长短)而变,所以按 getBoundingClientRect
    // 实测而非写死数字;摘要落地后 show() 会再同步一次
    const chartHost = scroller.closest('.chart-host');
    if (!chartHost) return;
    chartHost.style.paddingTop = '';
    if (!dynOn && !empOn) return;
    const bottom = Math.max(dynOn ? cards.dyn.el.getBoundingClientRect().bottom : 0,
      empOn ? cards.emp.el.getBoundingClientRect().bottom : 0);
    const need = bottom + 12 - chartHost.getBoundingClientRect().top;
    // 用 padding 而非 margin:相邻兄弟的外边距会合并,控件行本有 12px 下边距,
    // 给 margin-top 只会取两者较大值,实测净空因此少 12px、正好贴住卡的下缘
    if (need > 0) chartHost.style.paddingTop = `${Math.round(need)}px`;
  };
  const hide = (which) => {
    cards[which].el.classList.remove('on');
    cards[which].el.dataset.key = '';
    syncLayout();
  };
  // 同步两次:立刻(卡已显形、占位已定)与摘要落地后(卡随内容长高)
  const show = (which, spec) => { fillCard(cards[which], spec).then(syncLayout); syncLayout(); };

  for (const which of ['dyn', 'emp']) {
    cards[which].close.addEventListener('click', () => {
      if (cards[which].el.dataset.key) dismissed[which].add(cards[which].el.dataset.key);
      pinned[which] = null;
      hide(which);
    });
    // 头图比摘要晚落地,落地后卡还会再长高一截——纵向让位得跟着重算,
    // 否则按图前高度算出的 margin 会被吃掉大半(实测净空 12px 缩到 3px)
    cards[which].img.addEventListener('load', syncLayout);
  }
  // 点选君主:右卡其人、中卡其朝,一并钉住
  for (const it of items) {
    it.node.addEventListener('click', () => {
      if (!mq.matches) return;
      const es = empSpec(it);
      pinned.emp = es.id;
      dismissed.emp.delete(es.id);
      show('emp', es);
      if (mqBoth.matches) {
        const ds = dynSpec(it.band);
        pinned.dyn = ds.id;
        dismissed.dyn.delete(ds.id);
        show('dyn', ds);
      }
    });
  }
  // 点选朝代底带:只钉朝代卡——问的是朝代,答的就该是朝代
  for (const br of bands) {
    br.node.addEventListener('click', () => {
      if (!mqBoth.matches) return;
      const ds = dynSpec(br.band);
      pinned.dyn = ds.id;
      dismissed.dyn.delete(ds.id);
      show('dyn', ds);
    });
  }

  let timer = null;
  const update = () => {
    timer = null;
    if (!mq.matches) { hide('dyn'); hide('emp'); return; }
    const x0 = scroller.scrollLeft + scroller.clientWidth * 0.12;
    const x1 = scroller.scrollLeft + scroller.clientWidth * 0.88;
    if (!pinned.emp) {
      const cand = items
        .filter((it) => NOTABLE.has(it.e.name) && !dismissed.emp.has(it.e.id) && it.cx > x0 && it.cx < x1)
        .sort((a, b) => NOTABLE.get(b.e.name) - NOTABLE.get(a.e.name))[0];
      if (cand) show('emp', empSpec(cand));
      else hide('emp');
    }
    if (!pinned.dyn && mqBoth.matches) {
      // 同朝优先:皇帝卡在场时,朝代卡给他的朝——两张卡是一对(秦始皇配秦),
      // 而不是各说各话(旁边挂着按可见宽度最长算出的西汉)。
      // 皇帝卡空着时才退回「视窗里可见宽度最长的朝代」作时代锚
      const cur = items.find((it) => it.e.id === cards.emp.el.dataset.key);
      let best = cur ? cur.band : null;
      if (!best || dismissed.dyn.has(`dyn:${best.d.key}`)) {
        const seen = new Map();
        best = null;
        let bestW = 0;
        for (const br of bands) {
          const ov = Math.min(br.x1, x1) - Math.max(br.x0, x0);
          if (ov <= 0 || dismissed.dyn.has(`dyn:${br.band.d.key}`)) continue;
          const w = (seen.get(br.band.d.key) || 0) + ov;    // 一朝可能分成数段底带
          seen.set(br.band.d.key, w);
          if (w > bestW) { bestW = w; best = br.band; }
        }
      }
      if (best) show('dyn', dynSpec(best));
      else hide('dyn');
    } else if (!pinned.dyn) hide('dyn');
    // 断点变化时也要重算让位宽度:卡被钉住时上面两支都不走,
    // 窄到放不下朝代卡后 has-kp2 会赖着不走,说明段白白让出 330px
    syncLayout();
  };
  const onScroll = () => { if (timer) clearTimeout(timer); timer = setTimeout(update, 220); };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  update();

  const cleanup = () => {
    scroller.removeEventListener('scroll', onScroll);
    removeEventListener('resize', onScroll);
    if (timer) clearTimeout(timer);
    cards.dyn.el.remove();
    cards.emp.el.remove();
    const chartHost = scroller.closest('.chart-host');
    if (chartHost) chartHost.style.paddingTop = '';
    sectionEl.classList.remove('kp-anchor', 'has-kp', 'has-kp2');
  };
  // 点承继细丝时,朝代卡改讲那一场改朝换代(楚汉战争、靖康之变…)并钉住:
  // 关系问的是「谁承谁」,事件答的是「那是怎么发生的」,两者本就该在同一格里
  cleanup.showEvent = (spec) => {
    if (!mqBoth.matches) return false;
    pinned.dyn = spec.id;
    dismissed.dyn.delete(spec.id);
    show('dyn', spec);
    return true;
  };
  return cleanup;
}
