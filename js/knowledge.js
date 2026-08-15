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

/** 值得自动弹卡的名君(姓名 → 权重 1–3):滚动经过时自动打开,权重高者优先 */
const NOTABLE = new Map(Object.entries({
  嬴政: 3, 刘邦: 3, 刘彻: 3, 王莽: 3, 刘秀: 2, 曹丕: 2, 刘备: 2, 孙权: 2,
  司马炎: 2, 苻坚: 3, 冉闵: 2, 慕容垂: 2, 赫连勃勃: 1, 刘子业: 1, 萧衍: 3,
  元宏: 2, 高纬: 1, 杨坚: 3, 杨广: 3, 李世民: 3, 武曌: 3, 李隆基: 3,
  赵匡胤: 3, 赵佶: 2, 耶律阿保机: 2, 李元昊: 2, 铁木真: 3, 忽必烈: 3,
  朱元璋: 3, 朱棣: 3, 朱翊钧: 2, 朱由检: 2, 玄烨: 3, 胤禛: 2, 弘历: 3, 溥仪: 3,
}));

/** 朝代的维基词条标题:单字国号直接搜多是消歧义页,按惯用全称改写;
 *  不在表内的照用库内名(西汉/北魏/后燕这类本就是词条名) */
const DYN_WIKI = {
  秦: '秦朝', 新: '新朝', 梁: '南梁', 陈: '陈朝', 隋: '隋朝', 唐: '唐朝',
  吴: '杨吴', 闽: '闽国', 楚: '马楚', 南平: '荆南', 辽: '辽朝', 金: '金朝',
  大理: '大理国', 元: '元朝', 明: '明朝', 清: '清朝',
};

const CACHE = new Map();   // 词条标题 → Promise<summary|null>:会话内不重复拉取
function fetchSummary(title) {
  if (!CACHE.has(title)) {
    CACHE.set(title, fetch(`https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null));
  }
  return CACHE.get(title);
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

/** 皇帝卡的取数说明书 */
const empSpec = (item) => {
  const e = item.e, dyn = item.band.d;
  return {
    id: e.id,
    head: `${dyn.name} · ${e.temple}`,
    title: e.name || `${dyn.name}${e.temple}`,
    q: `${dyn.name} ${e.name || e.temple} 历史`,
    yt: NOTABLE.has(e.name),
  };
};
/** 朝代卡的取数说明书 */
const dynSpec = (band) => {
  const d = band.d;
  return {
    id: `dyn:${d.key}`,
    head: `${fmtYearAxis(d.s)} – ${fmtYearAxis(d.e)} · 朝代`,
    title: DYN_WIKI[d.name] || d.name,
    q: `${DYN_WIKI[d.name] || d.name} 历史 纪录片`,
    yt: true,
  };
};

/** 共用的填卡逻辑:写入词条链接、实时拉取维基摘要 */
async function fillCard(card, spec) {
  if (card.el.dataset.key === spec.id) { card.el.classList.add('on'); return; }
  card.el.dataset.key = spec.id;
  card.head.textContent = spec.head;
  card.title.textContent = spec.title;
  card.ext.textContent = '…';
  card.img.style.display = 'none';
  card.wiki.href = `https://zh.wikipedia.org/wiki/${encodeURIComponent(spec.title)}`;
  card.baidu.href = `https://baike.baidu.com/item/${encodeURIComponent(spec.title)}`;
  card.yt.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(spec.q)}`;
  card.yt.style.display = spec.yt ? '' : 'none';
  card.el.classList.add('on');
  const s = await fetchSummary(spec.title);
  if (card.el.dataset.key !== spec.id) return;             // 等待期间已换人
  if (s && s.extract && s.type !== 'disambiguation') {
    card.title.textContent = s.title || spec.title;
    card.ext.textContent = s.extract;
    if (s.thumbnail && s.thumbnail.source) { card.img.src = s.thumbnail.source; card.img.style.display = ''; }
    if (s.content_urls && s.content_urls.desktop) card.wiki.href = s.content_urls.desktop.page;
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
export function mountKnowledge(empNodes, wrap) {
  const mq = matchMedia('(min-width: 1100px)');
  const mqLeft = matchMedia('(min-width: 1280px)');
  const cards = { dyn: mkCard('kp-left'), emp: mkCard('kp-right') };
  document.body.appendChild(cards.dyn.el);
  document.body.appendChild(cards.emp.el);
  const pinned = { dyn: null, emp: null };
  const dismissed = { dyn: new Set(), emp: new Set() };

  const hide = (which) => {
    cards[which].el.classList.remove('on');
    cards[which].el.dataset.key = '';
  };
  for (const which of ['dyn', 'emp']) {
    cards[which].close.addEventListener('click', () => {
      if (cards[which].el.dataset.key) dismissed[which].add(cards[which].el.dataset.key);
      pinned[which] = null;
      hide(which);
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
    if (!mq.matches) { hide('dyn'); hide('emp'); return; }
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
    // 左翼:中带里可见时长最长的朝代——大一统时即那条大河,分裂期通常是
    // 贯穿最久的主线(十六国段多为东晋),恰是读者需要的时代锚
    if (!pinned.dyn && mqLeft.matches) {
      const span = new Map();
      let best = null;
      for (const n of empNodes) {
        const ov = Math.min(n.y1, y1) - Math.max(n.y0, y0);
        if (ov <= 0) continue;
        const key = n.band.d.key;
        if (dismissed.dyn.has(`dyn:${key}`)) continue;
        const v = (span.get(key) || 0) + ov;
        span.set(key, v);
        if (!best || v > span.get(best.band.d.key) || 0) best = n;
      }
      if (best) fillCard(cards.dyn, dynSpec(best.band));
      else hide('dyn');
    } else if (!pinned.dyn && !mqLeft.matches) hide('dyn');
  };
  const onScroll = () => { if (timer) clearTimeout(timer); timer = setTimeout(update, 220); };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  update();

  return () => {
    removeEventListener('scroll', onScroll);
    removeEventListener('resize', onScroll);
    if (timer) clearTimeout(timer);
    cards.dyn.el.remove();
    cards.emp.el.remove();
  };
}

/**
 * 泳道角卡:横向泳道没有两翼留白,但说明段右侧的版面角落是空的——
 * 单卡横排(图左文右)嵌在那里,说明文字给它让出右侧宽度(.has-kp)。
 * 横向滚动时视窗中带里的名君自动上卡(单卡,权重最高者),
 * 点选任一君主钉卡,✕ 关闭。<1000px 的窄屏整体隐藏。
 */
export function mountKnowledgeCorner(items, scroller, sectionEl) {
  const mq = matchMedia('(min-width: 1000px)');
  const card = mkCard('kp-corner');
  sectionEl.classList.add('kp-anchor');
  sectionEl.appendChild(card.el);
  let pinnedId = null;
  const dismissed = new Set();
  const setOn = (on) => sectionEl.classList.toggle('has-kp', on);
  const off = () => { card.el.classList.remove('on'); card.el.dataset.key = ''; setOn(false); };

  card.close.addEventListener('click', () => {
    if (card.el.dataset.key) dismissed.add(card.el.dataset.key);
    pinnedId = null;
    off();
  });
  for (const it of items) {
    it.node.addEventListener('click', () => {
      if (!mq.matches) return;
      const es = empSpec(it);
      pinnedId = es.id;
      dismissed.delete(es.id);
      fillCard(card, es);
      setOn(true);
    });
  }

  let timer = null;
  const update = () => {
    timer = null;
    if (!mq.matches) { off(); return; }
    if (pinnedId) return;
    const x0 = scroller.scrollLeft + scroller.clientWidth * 0.12;
    const x1 = scroller.scrollLeft + scroller.clientWidth * 0.88;
    const cands = items
      .filter((it) => NOTABLE.has(it.e.name) && !dismissed.has(it.e.id) && it.cx > x0 && it.cx < x1)
      .sort((a, b) => NOTABLE.get(b.e.name) - NOTABLE.get(a.e.name));
    if (cands.length) { fillCard(card, empSpec(cands[0])); setOn(true); }
    else off();
  };
  const onScroll = () => { if (timer) clearTimeout(timer); timer = setTimeout(update, 220); };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  update();

  return () => {
    scroller.removeEventListener('scroll', onScroll);
    removeEventListener('resize', onScroll);
    if (timer) clearTimeout(timer);
    card.el.remove();
    sectionEl.classList.remove('kp-anchor', 'has-kp');
  };
}
