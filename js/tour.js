// tour.js — 入门导览：七站，每站教一件这张图会做的事
//
// 长卷图有个共同的毛病:一屏两千年、六百多个点、十个类别、两种视图，
// 读者落地时无从下手,于是随手滑两下就走了。本库的东西不少,但没有一个
// 「从这儿开始」。这条导览就是那个入口。
//
// 选站的原则是**每站换一件事教**,而不是把重要事件排个名次讲一遍:
//
//   五代十国   → 承继关系(全图最挤的一段,细丝才看得出谁承谁)
//   南宋 / 元   → 泳道重叠(改朝换代有交接期,不是一刀两断)
//   段正严     → 知识卡(顺带告诉读者段誉真有其人)
//   隋末民变   → 视频按钮(B 站这一类的讲解视频质量很高)
//   七女为父报仇 → 类别筛选 + 词条本身值得读
//   先秦上游    → 低置信年份的读法（斜纹）+ 前770 分汊
//   搜索       → 交还控制权
//   秦始皇     → 引向另一张页面(寿命数据库)
//
// 两件贯穿全程的事:
//
//   **熄灯打光。**整屏压暗,只在讲的那一处开洞。洞不是一个——年份带与
//   正在演示的那个控件同时亮,读者才知道「刚才那下是这个开关做的」。
//   多个洞用 SVG mask 挖(box-shadow 的老办法只挖得动一个)。整层
//   pointer-events:none:熄灯是为了聚焦,不是为了把人关住——词条链接、
//   搜索框、视频按钮在灯下照样点得动。
//
//   **走过去,不是瞬移。**跨越三百年该比挪五十年花更久,这段时间本身
//   就是尺度感(见 charts.js 的 glide)。
import { h, el, glide } from './charts.js';
import { S, render } from './shell.js';
import { eventLegend } from './views-lanes.js';
import { EMPERORS } from './data.js';
import { EVENTS } from './events.js';

const SEEN_KEY = 'il.tour.seen';
// 走到第几站也要记:面板右上角就是个 ✕,误触一下就没了,
// 再从第一站走一遍是惩罚读者手滑
const AT_KEY = 'il.tour.at';
const memo = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 隐私模式 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 同上 */ } },
};

// 按名字找,不按下标:两者都会随数据增补而移位,名字至少改动时会被 lint 拦下
const empId = (name) => (EMPERORS.find((e) => e.name === name || e.temple === name) || {}).id;
const evIdx = (name) => EVENTS.findIndex((e) => e.n === name);

// 只留「文化·科技」与「文物」两类时要关掉的其余各类
const CULTURE_ONLY = ['war', 'gov', 'rev', 'out', 'dis', 'era', 'inst', 'her', 'fig'];   // fig 不关的话「只剩两类」就是空话

/**
 * 每一站:
 *   set   要改的状态(经 shell 的 S + render,与用户手动点控件走同一条路)
 *   go    怎么去(loc 是当前视图的 __locate)
 *   holes 要开的洞,依次为 [年份带, 控件选择器…]
 *   t/b   标题与正文;cta 是那句「你来试试」
 */
const STOPS = [
  {
    t: '五代十国：全图最挤的一段',
    b: '七十二年里北方换了五姓十三君，南方十国并峙——这是整张图最挤的一段。',
    b2: '九〇七年朱温废唐，到九七九年北汉降宋。泳道被占满，河也分成最多股。',
    cta: '已替你打开下方的「全部承继关系」：粗实线＝法统相承，细实线＝亡入，虚线＝裂自。哪一国是从哪一国裂出来的，只有这些细丝说得出。',
    set: { panoramaMode: 'lanes', laneStrands: true, laneEvents: true, evOff: [] },
    span: [907, 979],
    ctrl: '全部承继关系',
  },
  {
    t: '南宋与元：交接期有七十三年',
    b: '蒙古已立国，南宋还在临安——两条带子并排走了七十三年。',
    b2: '一二〇六年铁木真建大蒙古国，一二七一年忽必烈改国号为元，直到一二七九年南宋亡。',
    cta: '看这段重叠：改朝换代不是一刀两断，明与清并立二十八年，陈与隋并立八年。泳道敢让它们重叠，正是因为那几十年里两边真的都还在。',
    set: { panoramaMode: 'lanes', laneStrands: true },
    span: [1206, 1279],
  },
  {
    t: '段正严：段誉真有其人',
    b: '金庸《天龙八部》里的段誉与段正淳，名字取自大理这一对真父子。',
    b2: '段正严又名段和誉，一一〇八年即位，在位三十九年后禅位为僧，享年九十三——本库六百八十九位君主里最长寿的一位，乾隆八十八还差他五岁。他的父亲便是段正淳。',
    cta: '卡片的摘要实时取自中文维基百科，每一位君主、每一个政权都有。',
    emp: '段正严',
    card: true,
  },
  {
    t: '隋末民变：事件轴怎么读',
    b: '十三年的乱局里群雄并起，李渊父子只是其中一支——最后赢的那一支。',
    b2: '六一一年王薄在长白山举旗，到六二四年江南辅公祏败亡。轴分两侧：线下是政事（战事、民变·政变、外患、制度、灾疫），线上是文教（文化科技、遗址、文物）。形状即类别，点的大小即分量——每件事都只画一个点，横贯的长条会互相撞成一片。',
    // 跨度不常显，故非说不可:不说的话读者根本不知道点一下还有这一层。
    // 两种线的分别也要在这里讲清——它是全图唯一一处「图形本身在讲不确定性」
    cta2: '这一条你点开时，轴上横拉出一条**实线**：它真的持续了十三年。另一种是**半透明的虚线**（多见于文物）——那不是「持续了这么久」，而是「只知道落在这段里」，两端的竖挡就是误差棒。跨度平时不画，点中才现形，免得几百条长条糊成一片。',
    cta: '点任一标记即开卡；旁边那排就是类别开关，可逐类开关。卡片底下的两个视频按钮，YouTube 与 B 站各一个——这一段在 B 站能找到几部讲得不错的。',
    ev: '隋末民变',
    card: true,
    links: true,
    legend: true,
  },
  {
    t: '七女为父报仇：一块石头上的连环画',
    b: '汉代画像石上的一个母题：七个女儿为父报仇。',
    b2: '它不是哪一场战争，也不是哪一位皇帝，却在石头上被反复刻了一百多年。',
    cta: '维基那篇写得相当好，值得点进去读——卡片里的「维基百科全文」就是。顺带：我把类别筛到只剩「文化·科技」与「文物」，旁边那排开关随时可以改回来。',
    set: { evOff: CULTURE_ONLY, laneEvents: true },
    ev: '七女为父报仇',
    card: true,
    legend: true,
  },
  {
    t: '上游：低置信的一千八百年',
    b: '秦始皇再往前，河还流了一千八百年——那一段的年份多半是推算出来的。',
    b2: '分水岭在共和元年（前841）：此后逐年可考，此前只有推算——夏与商前期的君主格铺的是传统系年，画成斜纹半透明；西周逐王取断代工程年，实心但整体存疑。前770 平王东迁，满河分汊成列国争流，晋线归魏、姜齐续田齐，直到秦并六国再合而为一。',
    cta: '悬停任何一个斜纹格，能读到那段年份的依据；把图拖向更上游，看夏商的斜纹河源。',
    span: [-860, -640],
  },
  {
    t: '现在换你来找',
    b: '右上角那个框：搜君主、搜政权、搜大事，也能直接输年份。',
    b2: '雅名也认——输「破釜沉舟」找得到巨鹿之战。',
    cta: '试试输「755」，或者随便一个你想得起来的名字。跳过去之后地址栏会变成那一屏的链接，可以直接发给别人。',
    set: { evOff: [] },
    search: true,
  },
  {
    t: '最后回到起点',
    b: '秦始皇是第一个用「皇帝」这两个字的人，也是帝王丹药史的开端。',
    b2: '晚年遣徐福、卢生入海求仙，服食丹药，五十岁崩于东巡途中的沙丘。',
    cta: '同一份数据还有另一种读法：六百八十九位君主的生卒、在位与死因，用生存分析问一句「帝王的寿命由什么决定」。那边有一组筛选就叫「丹药组」——秦始皇是它的第一个成员。',
    emp: '嬴政',
    card: true,
    go2: { href: 'index.html', text: '去中国帝王寿命数据库 →' },
  },
];

export function mountTour(sectionEl, hostOf) {
  // ── 熄灯层：全屏 SVG，用 mask 挖任意多个洞 ────────────────────────────
  const mask = el('mask', { id: 'tour-mask', maskUnits: 'userSpaceOnUse' });
  const base = el('rect', { fill: '#fff' });
  mask.appendChild(base);
  const dim = el('rect', { fill: 'var(--tour-dim)', mask: 'url(#tour-mask)' });
  const scrim = el('svg', { class: 'tour-scrim', 'aria-hidden': 'true' },
    [el('defs', {}, [mask]), dim]);
  const rings = el('g', { class: 'tour-rings' });
  scrim.appendChild(rings);
  document.body.appendChild(scrim);

  // ── 讲解面板 ─────────────────────────────────────────────────────────
  const step = h('span', { class: 'tour-step' });
  const closeBtn = h('button', { class: 'tour-x', type: 'button', 'aria-label': '结束导览', text: '✕' });
  const title = h('h3', { class: 'tour-title' });
  const body = h('p', { class: 'tour-body' });
  // b2＝主旨之后的其余交代。它属于详解的第一段：主旨永远看得见，细节点开才来
  const body2 = h('p', { class: 'tour-body2' });
  const cta = h('p', { class: 'tour-cta' });
  // 第二句提示:留给「这一站还藏着一层」的那类说明(如跨度要点开才现形)。
  // 与 cta 分开而不是接在后面,是因为两句话性质不同——cta 是「你来试试」,
  // 这一句是「这里还有你看不见的东西」
  const cta2 = h('p', { class: 'tour-cta tour-cta2' });
  const extra = h('div', { class: 'tour-extra' });
  const prev = h('button', { class: 'chip', type: 'button', text: '← 上一站' });
  const next = h('button', { class: 'chip tour-next', type: 'button', text: '下一站 →' });
  // 手机上的实话:这条导览讲的东西有一半靠两翼的知识卡与并排的泳道,
  // 而窄屏上卡只剩贴底一张、泳道要横滑着看。功能都在,观感是打折的,
  // 与其让读者自己觉得「怎么和说的不一样」,不如直说。窄屏才显示(CSS 控)
  const mnote = h('p', { class: 'tour-mnote', text: '这条导览在电脑上看得更完整：宽屏能同时摆下两翼的知识卡与并排的泳道，手机只剩贴底一张卡。' });
  // ── 一屏预算法则（导览与将来的故事线通用） ─────────────────────────
  // 手机上量过一次实况：讲解面板 40vh ＋ 贴底知识卡 42.7vh ＝ chrome 吃掉
  // 82.7%，留给图的只剩 17%（用户实测截图）。可导览的整个意思就是「看这里」，
  // 图小到看不见，打光就白打了。故立三条预算，往后每条故事线照此排版：
  //   · 图 ≥ 45vh —— 低于此数打光无意义，这是硬底线；
  //   · 卡（若这一站开卡）≤ 30vh —— 缩略图与摘要都压一压；
  //   · 讲解面板：开卡的站 ≤ 22vh（标题＋主旨＋导航），不开卡的站 ≤ 38vh。
  // 派生出的两条做法：**同屏只有一个主讲人**（开卡即让位），
  // **文案分三级**（标题／一句主旨／详解折叠）。
  const more = h('details', { class: 'tour-more' }, [
    h('summary', { class: 'tour-more-sum', text: '详解' }), body2, cta, cta2, extra, mnote,
  ]);
  const panel = h('div', {
    class: 'tour-panel', role: 'dialog', 'aria-live': 'polite', 'aria-label': '导览',
  }, [
    h('div', { class: 'tour-head' }, [h('span', { class: 'tour-tag', text: '导览' }), step, closeBtn]),
    title, body, more,
    h('div', { class: 'tour-nav' }, [prev, next]),
  ]);
  // 讲解与副卡装在同一个坞里,由 flex 排上下——各自 position:fixed 的话
  // 两块会抢同一个角,还得手算偏移
  const dock = h('div', { class: 'tour-dock' }, [panel]);
  document.body.appendChild(dock);
  // 常驻的读进度条。系统的浮动滚动条滚完就淡出，读者于是不知道「下面还有」
  // （用户实测：讲解被夹在坞里，右缘那道细线一闪就没了）。自绘一条：坞一旦
  // 装不下就现身，位置与高度逐帧跟着坞走（paint 本就在跑，不额外开循环）。
  // 故事线的站点卡沿用同一条。
  const sbarThumb = h('div', { class: 'tour-sbar-thumb' });
  const sbar = h('div', { class: 'tour-sbar' }, [sbarThumb]);
  document.body.appendChild(sbar);
  const syncSbar = () => {
    const sh = dock.scrollHeight, ch = dock.clientHeight;
    if (!on || sh <= ch + 2) { sbar.classList.remove('on'); return; }
    const r = dock.getBoundingClientRect();
    sbar.classList.add('on');
    sbar.style.left = `${Math.round(r.right - 5)}px`;
    sbar.style.top = `${Math.round(r.top + 6)}px`;
    sbar.style.height = `${Math.round(r.height - 12)}px`;
    const frac = ch / sh;
    const th = Math.max(18, (r.height - 12) * frac);
    const room = (r.height - 12) - th;
    const prog = sh - ch > 0 ? dock.scrollTop / (sh - ch) : 0;
    sbarThumb.style.height = `${Math.round(th)}px`;
    sbarThumb.style.transform = `translateY(${Math.round(room * prog)}px)`;
  };

  // ── 副卡：类别开关 ───────────────────────────────────────────────────
  // 真正的类别图例挂在图的**下方**,矮一点的窗口上它落在一屏之外——
  // 卡片 268 + 图 550 + 图例 58 一共八百多像素,滚过去就得把卡片顶出视野。
  // 与其两头落空,不如把那排开关搬到讲解旁边来。用的是 views-lanes 里
  // 同一个 eventLegend:开关只此一处实现,副卡与图下那排永远说的是同一件事
  const aside = h('div', { class: 'tour-aside' });
  dock.appendChild(aside);
  function buildAside(show) {
    aside.classList.toggle('on', !!show);
    aside.innerHTML = '';
    if (!show) return;
    const river = (hostOf() && hostOf().__locate || {}).view === 'river';
    const [, row] = eventLegend(
      { evOff: S.evOff, setOpt: (k, v) => { S[k] = v; render(); buildAside(true); } },
      { skip: river ? ['era'] : [] },
    );
    aside.appendChild(h('div', { class: 'tour-aside-h', text: '大事记类别 · 点一下开关' }));
    aside.appendChild(row);
  }

  // ── 打光：逐帧重算，洞才跟得住滚动 ───────────────────────────────────
  let holes = [], raf = null, on = false, curLoc = null;
  /**
   * 可见带：视口减去**全宽的遮挡物**（手机上的讲解坞、贴底卡、顶底导航条）。
   * 这是导览的**舞台**——打光只在带内发生，滚动定位也把内容送进带内。
   * 照亮一截被卡片盖住的东西，读者看到的只是「亮了一片，可什么也没有」
   * （用户实测：洞罩住整排图例还漏到卡片上）。
   * 只占一角的（宽屏 360px 的讲解坞、两翼卡）不算带：它们旁边还有大片图看得见。
   */
  const visibleBand = () => {
    const W = document.documentElement.clientWidth, H = innerHeight;
    const band = { top: 0, bot: H };
    for (const sel of ['.tour-dock', '.kp-solo.on', '.river-card.on', '.sec-nav.up.on', '.sec-nav.down.on']) {
      const oc = document.querySelector(sel);
      if (!oc) continue;
      const b = oc.getBoundingClientRect();
      if (b.height <= 0 || b.width < W * 0.7) continue;
      if ((b.top + b.bottom) / 2 < H / 2) band.top = Math.max(band.top, b.bottom);
      else band.bot = Math.min(band.bot, b.top);
    }
    if (band.bot - band.top < 120) return { top: 0, bot: H };   // 带子薄得没意义时退回整屏
    return band;
  };
  const paint = () => {
    if (!on) return;
    // clientWidth 而非 innerWidth:后者含竖向滚动条,矩形会溢出 svg 自身的盒子
    const W = document.documentElement.clientWidth, H = innerHeight;
    for (const r of [base, dim]) { r.setAttribute('width', W); r.setAttribute('height', H); }
    mask.setAttribute('width', W); mask.setAttribute('height', H);
    mask.setAttribute('x', 0); mask.setAttribute('y', 0);
    // 洞与描边逐帧重建:数量与位置都在变,复用节点省不下什么,却容易漏改属性
    for (const n of [...mask.children].slice(1)) n.remove();
    rings.innerHTML = '';
    // 舞台优先：**讲解站到内容的对面**。手机上讲解坞钉在顶部，可有的站要照的
    // 东西也在顶部（第 7 站的搜索框就在坞底下）——那就把坞挪到下缘去。
    // 贴底卡在场时下缘已被占，坞留在顶上（此时坞已收成一行，遮挡有限）。
    const raw = holes.flatMap((get) => [].concat(get() || [])).filter((r) => r && r.w > 0 && r.h > 0);
    if (raw.length && innerWidth <= 720) {
      const c = raw.reduce((a, r) => a + r.y + r.h / 2, 0) / raw.length;
      const cardOn = !!document.querySelector('.kp-solo.on, .river-card.on');
      dock.classList.toggle('dock-bottom', !cardOn && c < H * 0.42);
    }
    syncSbar();
    const band = visibleBand();
    // 一个 getter 可以给回多块(宽屏的知识卡是左右两张,该一起亮)
    for (let r of raw) {
      // 洞比屏还宽就等于没熄灯。七女为父报仇跨一百二十年,按 14px/年是 1680px——
      // 照原样挖,整屏全亮,读者不知道在看哪儿。超过屏宽七成即绕中心收窄:
      // 这是聚光灯,不是量尺,读者要的是「在这儿」而不是「有多长」
      const cap = W * 0.76;
      if (r.w > cap) { r = { ...r, x: r.x + (r.w - cap) / 2, w: cap }; }
      const pad = r.pad === undefined ? 6 : r.pad;
      const box = { x: r.x - pad, y: r.y - pad, width: r.w + pad * 2, height: r.h + pad * 2, rx: 8 };
      // 与可见带、与视口求交；交完太薄就整块不画——宁可不打光，也不打在看不见的地方
      const x0 = Math.max(box.x, 0), x1 = Math.min(box.x + box.width, W);
      const y0 = Math.max(box.y, band.top), y1 = Math.min(box.y + box.height, band.bot);
      if (x1 - x0 < 8 || y1 - y0 < 8) continue;
      box.x = x0; box.width = x1 - x0;
      box.y = y0; box.height = y1 - y0;
      mask.appendChild(el('rect', { ...box, fill: '#000' }));
      rings.appendChild(el('rect', { ...box, class: 'tour-ring' }));
    }
  };
  // 导览开着就逐帧跑:滚动、缩放、卡片异步到货、图被重绘——一律靠这一个循环兜住。
  // 挂 scroll/resize 监听兜不住最后一项,而那一项恰恰会发生:第一站就在请读者
  // 去点「全部承继关系」,一点就是整张图重画
  const kick = () => { if (!raf && on) raf = requestAnimationFrame(tick); };
  function tick() {
    raf = null;
    if (!on) return;
    // 图被重画过(读者点了控件,或窗口变了宽):旧的 __locate 连着一棵已经脱离
    // 文档的树,拿它算坐标会得到一片零。认出这件事,就地回到本站该在的位置
    const now = hostOf() && hostOf().__locate;
    if (now && now !== curLoc) { curLoc = now; reacquire(); }
    paint();
    raf = requestAnimationFrame(tick);
  }

  // 君主段的节点会随重画作废,故这里放的是个盒子,重画后由 navigate 换新
  const empBox = { node: null };

  // 选择器给回**全部**匹配:宽屏的知识卡是左右两张(朝代一张、君主一张),
  // 只亮第一张,读者看到的是被点名的那位君主还在灯外。
  // 传函数则每帧现取(君主段那种会被换掉的节点走这条路)
  const nodeHole = (sel) => () => {
    const ns = typeof sel === 'string' ? [...document.querySelectorAll(sel)]
      : [typeof sel === 'function' ? sel() : sel];
    return ns.filter((n) => n && n.isConnected).map((n) => {
      const r = n.getBoundingClientRect();
      return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
    }).filter(Boolean);
  };

  // ── 状态存档：导览会动筛选，结束时按原样放回 ─────────────────────────
  const TOUCHED = ['panoramaMode', 'laneStrands', 'laneEvents', 'evOff'];
  let saved = null;
  const afterRender = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  let i = 0, seq = 0;

  async function goto(n) {
    const me = ++seq;                       // 连点「下一站」时,只让最后一次的打光生效
    i = Math.max(0, Math.min(STOPS.length - 1, n));
    memo.set(AT_KEY, String(i));            // 关页面也算「走到一半」,回来接着走
    const st = STOPS[i];

    step.textContent = `${i + 1} / ${STOPS.length}`;
    title.textContent = st.t;
    body.textContent = st.b;
    body2.textContent = st.b2 || '';
    body2.style.display = st.b2 ? '' : 'none';
    cta.textContent = st.cta || '';
    cta.style.display = st.cta ? '' : 'none';
    // **粗体** 转 <strong>。文案是本文件里的字面量,不是外来输入
    cta2.innerHTML = (st.cta2 || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    cta2.style.display = st.cta2 ? '' : 'none';
    extra.innerHTML = '';
    if (st.go2) {
      extra.appendChild(h('a', { class: 'chip tour-go2', href: st.go2.href, text: st.go2.text }));
    }
    // 详解的默认态每站重置：宽屏摆得下就直接摊开，手机收起（点开即看）。
    // 「这一站有没有藏着东西」交给 summary 的字样说，免得读者以为没了
    const hasMore = !!(st.b2 || st.cta || st.cta2 || st.go2);
    more.style.display = hasMore ? '' : 'none';
    more.open = hasMore && innerWidth > 720;
    // 开卡的站，讲解让位给卡（同屏只有一个主讲人，见上方预算法则）。
    // 先按本站声明置位，稍后再按**屏上实况**复核一次——上一站开的卡会留到
    // 下一站，只认声明的话那一站就成了「面板照常摊开 ＋ 卡还赖在屏上」
    document.body.classList.toggle('tour-card-on', !!(st.card || st.links));
    syncCardYield();
    prev.disabled = i === 0;
    next.textContent = i === STOPS.length - 1 ? '结束导览' : '下一站 →';

    holes = [];
    scrim.classList.add('moving');           // 飞行途中减淡,好看得见掠过的两千年

    // 一、改状态。走 S + render 这条路,与用户自己点控件完全一致
    if (st.set && Object.keys(st.set).some((k) => JSON.stringify(S[k]) !== JSON.stringify(st.set[k]))) {
      Object.assign(S, st.set);
      render();
      await afterRender();
      if (me !== seq) return;
    }
    // 副卡要在改完状态之后再建:它照的是 S.evOff 当下的样子,
    // 建早了,读者看到的是十类全开,而图上分明只剩两类
    buildAside(st.legend);

    const loc = hostOf() && hostOf().__locate;
    if (!loc) return;
    curLoc = loc;
    on = true;
    kick();

    // 二、先把洞挂上再动身:洞每帧按实时坐标算,于是它会自己从屏外滑进来。
    // 注意取的是**当帧的** __locate,不是这里这一个:读者中途点了控件,
    // 图会整张重画,闭包里扣着的旧比例尺连的是一棵已经脱离文档的树
    const live = () => hostOf() && hostOf().__locate;
    if (st.span) holes.push(() => { const l = live(); return l && l.rect ? l.rect(st.span[0], st.span[1]) : null; });
    if (st.ev) {
      const k = evIdx(st.ev);
      const e = k >= 0 ? EVENTS[k] : null;
      // **先照实际画出来的那个东西**：事件在图上只是一个标记＋一行字（命中区
      // 即 [data-evi]），而按年份区间画出来的框跨的是它「持续了多少年」——
      // 七女为父报仇横跨一百二十年，框宽得离谱，真正的标签反倒挤在框边上
      // （用户实测）。找得到节点就照节点，找不到（该事件在当前视图未画出、
      // 或被筛掉）才退回年份区间，至少还指得出「在这一段里」。
      if (k >= 0) {
        const byNode = nodeHole(`[data-evi="${k}"]`);
        holes.push(() => {
          const hit = byNode();
          if (hit.length) return hit;
          const l = live();
          return e && l && l.rect ? l.rect(e.y, e.y2 || e.y + 1) : null;
        });
      }
    }
    if (st.emp) holes.push(nodeHole(() => empBox.node));

    // 三、走过去
    navigate(st, loc, { smooth: true });
    await (loc.pending || Promise.resolve());
    if (me !== seq) return;

    // 四、到站,亮起要演示的那个控件
    // 控件也要每帧现找,不能扣住节点:读者一改选项,shell 就把整条控件行
    // (以及图例)重建一遍,扣住的那个节点当场脱离文档,洞随之消失——
    // 而消失的正好是第一站请他去点的那个开关
    const late = [], wantVisible = [];
    if (st.ctrl) {
      const g = nodeHole(() => [...sectionEl.querySelectorAll('.local-controls label')]
        .find((l) => l.textContent.includes(st.ctrl)));
      late.push(g); wantVisible.push(g);
    }
    // 图例照亮但**不**为它滚动:那排开关已经搬到副卡上了(见 buildAside),
    // 图下这一排在不在视野里都无所谓,不值得为它把卡片顶出去
    if (st.legend) late.push(nodeHole(() => sectionEl.querySelector('.ev-legend')));
    // 卡片是异步取的维基摘要,晚一步才出现;等它一下再挖洞。
    // 宽屏一共四张角卡(朝代、君主、事件左右各一),这一站在讲谁就只亮谁——
    // 讲七女为父报仇时把旁边的朝代卡与君主卡一并点亮,等于告诉读者「都看」,
    // 那就没有指哪儿这回事了
    // 事件落在哪张卡上,两个视图并不一样:河流有专设的事件卡(.kp-ev),
    // 泳道则把事件写进**朝代卡**那一格(承继细丝与改朝换代本就同格)。
    // 只写 .kp-ev 的话,泳道视图里这一站会一张卡也不亮
    const cardGets = [];
    if (st.card || st.links) {
      const base = st.ev
        ? '.kp-ev.on, .kp-corner-dyn.on, .kp-solo.on'
        : '.kp.on:not(.kp-ev), .kp-solo.on';
      const sel = st.links ? base.split(', ').map((s) => `${s} .kp-links`).join(', ') : base;
      cardGets.push(nodeHole(sel));
    }
    holes.push(...late, ...cardGets);
    scrim.classList.remove('moving');
    kick();
    // 亮着却在屏外,等于没亮:类别图例挂在图的**下方**,一屏放不下时它就在视野外,
    // 而那一站正要读者去点它。故到站后再竖向补一段——但补的量受卡片牵制:
    // 图例在下、卡片在上,两者隔着五百多像素的图,一屏未必同时装得下。
    // 装不下时宁可少滚一点、图例仍在屏外:文案里本来就写着它在哪儿,
    // 而把卡片滚出视野会连这一站在讲的东西一起弄丢
    await ensureVisible(wantVisible, cardGets);
    if (me !== seq) return;
    // 卡片/图片回来后尺寸会变,再补几帧,免得洞停在旧尺寸上
    for (const d of [180, 500, 1100]) setTimeout(() => { if (me === seq) kick(); }, d);
  }

  /**
   * 走到本站该在的位置。抽出来是为了**重画之后能再走一遍**:
   * 读者点一下「全部承继关系」或改一下时间缩放,整张图连同横向滚动位置一起重置,
   * 人就被扔回公元前——导览却还在讲五代十国。
   */
  function navigate(st, loc, o) {
    if (st.span) {
      loc.year((st.span[0] + st.span[1]) / 2, o);
    } else if (st.emp) {
      const id = empId(st.emp);
      // 节点存进盒子而不是扣进闭包:重画后旧节点作废,盒子里换成新树上的那一个,
      // 洞的取值函数不必跟着改
      empBox.node = (id && loc.emperor(id, o)) || null;
    } else if (st.ev) {
      const k = evIdx(st.ev);
      if (k >= 0) loc.event(k, o);
    } else if (st.search) {
      // 角卡是绝对定位、层级低于**吸顶后**的搜索框;而这一站要滚回页首,
      // 那时搜索框还没吸顶,卡片正好压在它上面(用户实测)。这一站本就在交还
      // 控制权,顺手把卡收掉——用的是卡自己的关闭钮,和读者手动关一模一样
      for (const b of document.querySelectorAll('.kp.on .kp-close, .kp-solo.on .kp-close')) b.click();
      const box = sectionEl.querySelector('.tl-search');
      if (box) {
        box.scrollIntoView({ block: 'center', behavior: 'instant' });
        if (o.smooth) {
          holes.push(nodeHole(box));
          setTimeout(() => box.querySelector('input') && box.querySelector('input').focus(), 260);
        }
      }
    }
  }

  /**
   * 让位复核：屏上真有贴底卡就让位，没有就把整屏还给讲解。
   * 卡是异步开的（摘要要向维基取），故在几个时点各查一次而不是只查一次。
   */
  function syncCardYield() {
    const has = () => !!document.querySelector('.kp-solo.on, .river-card.on');
    document.body.classList.toggle('tour-card-on', has());
    for (const d of [120, 420, 900]) setTimeout(() => {
      if (on) document.body.classList.toggle('tour-card-on', has());
    }, d);
  }

  /** 图被重画后就地归位。不带缓动:这不是一段旅程,是把人放回他刚才站的地方 */
  function reacquire() {
    if (!on || !curLoc) return;
    navigate(STOPS[i], curLoc, {});
  }

  /**
   * 把 `gets` 里的洞往视野里带,但不让 `keep` 里的洞被滚出去。
   * 只往下补;`keep` 至少留 KEEP_MIN 像素在屏内。
   */
  async function ensureVisible(gets, keep = []) {
    const rs = gets.flatMap((g) => [].concat(g() || [])).filter(Boolean);
    if (!rs.length) return;
    const M = 22, KEEP_MIN = 130;
    // 目标是**可见带**的下缘而不是视口下缘：带外那一截被讲解坞与卡片盖着，
    // 送到那里等于没送（用户实测：洞落在卡片背后，打光看着像照了个空）
    const vb = visibleBand();
    const top = Math.min(...rs.map((r) => r.y));
    const bot = Math.max(...rs.map((r) => r.y + r.h));
    // 内容整个在带子上方（被坞挡住）——往回拉
    if (bot < vb.top + M) {
      const up = vb.top + M - bot;
      await glide(() => scrollY, (v) => scrollTo({ top: v, behavior: 'instant' }),
        Math.max(0, scrollY - up), { min: 240, max: 620 });
      return;
    }
    if (bot <= vb.bot - M) return;
    let dy = bot - (vb.bot - M);
    // 但别把它的头也推出带外：够不下时以「头留在带内」为先
    if (top - dy < vb.top + M) dy = Math.max(0, top - (vb.top + M));
    if (dy < 4) return;
    const ks = keep.flatMap((g) => [].concat(g() || [])).filter(Boolean);
    if (ks.length) {
      // 卡片下缘减去要留的那一截,就是还能往上推多少
      const room = Math.max(0, Math.min(...ks.map((r) => r.y + r.h)) - KEEP_MIN);
      // 够不着就干脆别动。卡片 268 + 图 550 + 图例 58 一共八百多像素,
      // 矮一点的窗口本来就装不下三者;此时挪一半是两头落空——
      // 卡片被推得只剩一条边,图例仍在屏外。宁可原地不动,让卡片完整,
      // 图例交给文案里那句「图例上再点一下就能改回来」
      if (dy > room) return;
    }
    if (dy < 4) return;
    await glide(() => scrollY, (v) => scrollTo({ top: v, behavior: 'instant' }),
      scrollY + dy, { min: 240, max: 620 });
  }

  function start(at) {
    if (on) return;
    saved = Object.fromEntries(TOUCHED.map((k) => [k, structuredClone(S[k])]));
    document.body.classList.add('tour-on');
    panel.classList.add('on');
    scrim.classList.add('on');
    memo.set(SEEN_KEY, '1');
    goto(at === undefined ? Number(memo.get(AT_KEY, 0)) || 0 : at);
  }
  function stop(done) {
    document.body.classList.remove('tour-card-on');
    dock.classList.remove('dock-bottom');
    sbar.classList.remove('on');
    on = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }   // 不清掉,下次 kick 会被它挡住
    holes = [];
    curLoc = null;
    empBox.node = null;
    if (done) memo.del(AT_KEY); else memo.set(AT_KEY, String(i));
    document.body.classList.remove('tour-on');
    panel.classList.remove('on');
    buildAside(false);
    scrim.classList.remove('on', 'moving');
    rings.innerHTML = '';
    syncLaunch();
    // 把筛选放回导览之前的样子:留着「只剩文化类」是个陷阱,
    // 读者过几分钟就不记得是导览关掉的,只会觉得图上东西怎么少了
    if (saved && TOUCHED.some((k) => JSON.stringify(S[k]) !== JSON.stringify(saved[k]))) {
      Object.assign(S, saved);
      render();
    }
    saved = null;
  }

  prev.addEventListener('click', () => goto(i - 1));
  next.addEventListener('click', () => (i === STOPS.length - 1 ? stop(true) : goto(i + 1)));
  closeBtn.addEventListener('click', () => stop(false));
  addEventListener('keydown', (e) => {
    if (!on) return;
    if (e.key === 'Escape') stop(false);
    else if (e.key === 'ArrowRight' && i < STOPS.length - 1) goto(i + 1);
    else if (e.key === 'ArrowLeft' && i > 0) goto(i - 1);
  });

  // ── 入口按钮 ─────────────────────────────────────────────────────────
  // 就搁在版块标题旁边。曾想过在目录行里也放一个,但全景页的目录只有一个条目
  // (本页只此一节),那一行本身就该撤掉——见 shell.js 里对单节页面的处理。
  //
  // 三种面孔:没来过的人看到一句邀请,走到一半退出的人看到「接着走」,
  // 走完的人看到一个不碍事的小按钮。
  const launch = h('button', {
    class: 'chip tour-launch tour-launch-head', type: 'button', onclick: () => start(),
  });
  function syncLaunch() {
    const seen = memo.get(SEEN_KEY, null);
    const at = Number(memo.get(AT_KEY, 0)) || 0;
    launch.classList.toggle('fresh', !seen || at > 0);
    launch.textContent = !seen ? '第一次来？跟着走一遍'
      : at > 0 ? `接着走 · 第 ${at + 1} 站` : '导览';
  }
  syncLaunch();
  (sectionEl.querySelector('.head') || sectionEl).appendChild(launch);
  return { start, stop };
}
