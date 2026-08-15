// knowledge.js — 桌面侧栏知识卡
//
// 桌面上河流限宽 640px 居中,两翼是整片留白。点选君主、或滚动经过名君时,
// 在左右翼弹出知识面板式的卡片:**实时**拉取中文维基百科的词条摘要
// (REST summary 接口,CORS 开放、自动跟随重定向——刘彻→汉武帝),
// 页面里不预存任何词条内容。百度百科没有 CORS 接口,只给直达链接;
// 名君另配「相关视频」——给 YouTube 搜索直链而非具体视频:
// 不预存链接就永远不会烂,搜索结果也天然比三年前存的某支视频新鲜。
//
// 侧别规则:君主的河道中心在左半幅→左卡,右半幅→右卡(与画面同侧,
// 视线不用横穿河流)。点选的卡钉住(✕ 解除),滚动自动卡随视口换人;
// 手动关掉的君主记入黑名单,不会在原地立刻重弹。
import { h } from './charts.js';

/** 值得自动弹卡的名君(姓名 → 权重 1–3):滚动经过时自动打开,权重高者优先。
 *  同屏多位时取权重最高的两位,各占一翼。 */
const NOTABLE = new Map(Object.entries({
  嬴政: 3, 刘邦: 3, 刘彻: 3, 王莽: 3, 刘秀: 2, 曹丕: 2, 刘备: 2, 孙权: 2,
  司马炎: 2, 苻坚: 3, 冉闵: 2, 慕容垂: 2, 赫连勃勃: 1, 刘子业: 1, 萧衍: 3,
  元宏: 2, 高纬: 1, 杨坚: 3, 杨广: 3, 李世民: 3, 武曌: 3, 李隆基: 3,
  赵匡胤: 3, 赵佶: 2, 耶律阿保机: 2, 李元昊: 2, 铁木真: 3, 忽必烈: 3,
  朱元璋: 3, 朱棣: 3, 朱翊钧: 2, 朱由检: 2, 玄烨: 3, 胤禛: 2, 弘历: 3, 溥仪: 3,
}));

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

/** 共用的填卡逻辑:写入词条链接、实时拉取维基摘要。河流两翼卡与泳道角卡同用 */
async function fillCard(card, item) {
  const e = item.e, dyn = item.band.d;
  if (card.el.dataset.key === e.id) { card.el.classList.add('on'); return; }
  const title = e.name || `${dyn.name}${e.temple}`;
  card.el.dataset.key = e.id;
  card.head.textContent = `${dyn.name} · ${e.temple}`;
  card.title.textContent = title;
  card.ext.textContent = '…';
  card.img.style.display = 'none';
  card.wiki.href = `https://zh.wikipedia.org/wiki/${encodeURIComponent(title)}`;
  card.baidu.href = `https://baike.baidu.com/item/${encodeURIComponent(title)}`;
  card.yt.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${dyn.name} ${title} 历史`)}`;
  card.yt.style.display = NOTABLE.has(e.name) ? '' : 'none';
  card.el.classList.add('on');
  const s = await fetchSummary(title);
  if (card.el.dataset.key !== e.id) return;              // 等待期间已换人
  if (s && s.extract) {
    card.title.textContent = s.title || title;
    card.ext.textContent = s.extract;
    if (s.thumbnail && s.thumbnail.source) { card.img.src = s.thumbnail.source; card.img.style.display = ''; }
    if (s.content_urls && s.content_urls.desktop) card.wiki.href = s.content_urls.desktop.page;
  } else {
    card.ext.textContent = '未能实时拉取维基摘要(可能无词条或网络受限),下方链接仍可直达。';
  }
}

export function mountKnowledge(empNodes, wrap, W) {
  const mq = matchMedia('(min-width: 1100px)');
  // 1100–1279px 的次宽屏:左翼被滑杆走廊挤得放不下可读的卡(CSS 同步隐藏),
  // 一切选人路由到右卡
  const mqLeft = matchMedia('(min-width: 1280px)');
  const cards = { left: mkCard('kp-left'), right: mkCard('kp-right') };
  document.body.appendChild(cards.left.el);
  document.body.appendChild(cards.right.el);
  let pinned = { left: null, right: null };   // 侧 → e.id(点选钉住)
  const dismissed = new Set();                // 手动关掉的,不自动重弹

  const fill = (side, item) => fillCard(cards[side], item);
  const hide = (side) => {
    cards[side].el.classList.remove('on');
    cards[side].el.dataset.key = '';
  };

  for (const side of ['left', 'right']) {
    cards[side].close.addEventListener('click', () => {
      if (cards[side].el.dataset.key) dismissed.add(cards[side].el.dataset.key);
      pinned[side] = null;
      hide(side);
    });
  }

  // 点选:与河流的选中高亮同一手势,卡开在河道同侧并钉住
  const sideOf = (item) => (mqLeft.matches && item.cx < W / 2 ? 'left' : 'right');
  for (const n of empNodes) {
    n.node.addEventListener('click', () => {
      if (!mq.matches) return;
      const side = sideOf(n);
      pinned[side] = n.e.id;
      dismissed.delete(n.e.id);
      fill(side, n);
    });
  }

  // 滚动:视口中带里的名君自动开卡。220ms 落定再拉,一路快滚不发一次请求
  let timer = null;
  const update = () => {
    timer = null;
    if (!mq.matches) { hide('left'); hide('right'); return; }
    const r = wrap.getBoundingClientRect();
    if (!(r.top < innerHeight * 0.5 && r.bottom > innerHeight * 0.5)) {
      if (!pinned.left) hide('left');
      if (!pinned.right) hide('right');
      return;
    }
    const y0 = -r.top + innerHeight * 0.2, y1 = -r.top + innerHeight * 0.8;
    const cands = empNodes
      .filter((n) => NOTABLE.has(n.e.name) && !dismissed.has(n.e.id) && n.y1 > y0 && n.y0 < y1)
      .sort((a, b) => (NOTABLE.get(b.e.name) - NOTABLE.get(a.e.name)) || ((b.y1 - b.y0) - (a.y1 - a.y0)));
    const picks = [];
    for (const c of cands) {
      if (picks.length >= 2) break;
      if (!picks.some((p) => p.e.id === c.e.id)) picks.push(c);
    }
    const want = { left: null, right: null };
    for (const p of picks) {
      const s = sideOf(p);
      const o = s === 'left' ? 'right' : 'left';
      if (!want[s]) want[s] = p;
      else if ((o !== 'left' || mqLeft.matches) && !want[o]) want[o] = p;  // 左翼关闭时不外溢
    }
    for (const side of ['left', 'right']) {
      if (pinned[side]) continue;                        // 钉住的卡不被滚动换掉
      if (want[side]) fill(side, want[side]);
      else hide(side);
    }
  };
  const onScroll = () => { if (timer) clearTimeout(timer); timer = setTimeout(update, 220); };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  update();

  return () => {
    removeEventListener('scroll', onScroll);
    removeEventListener('resize', onScroll);
    if (timer) clearTimeout(timer);
    cards.left.el.remove();
    cards.right.el.remove();
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
      pinnedId = it.e.id;
      dismissed.delete(it.e.id);
      fillCard(card, it);
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
    if (cands.length) { fillCard(card, cands[0]); setOn(true); }
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
