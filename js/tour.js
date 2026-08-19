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

// 走到第几站也要记:面板右上角就是个 ✕,误触一下就没了,
// 再从第一站走一遍是惩罚读者手滑
const memo = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 隐私模式 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 同上 */ } },
};

// 按名字找,不按下标:两者都会随数据增补而移位,名字至少改动时会被 lint 拦下
const empIdOf = (name) => (EMPERORS.find((e) => e.name === name || e.temple === name) || {}).id;
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
const DEFAULT_STOPS = [
  {
    // 头一站给**河**：手机的默认视图是河，页面也叫「王朝之河」，
    // 而此前导览开口就把人切到泳道、再没回来（用户实测指出）。
    // 先在读者已经在看的那张图上把核心变量讲清，再谈换一种读法
    t: '河宽就是那一年的天下',
    b: '一股满宽＝天下一统，裂成几股＝几家并立，重新统一时再合成一条。',
    b2: '这一段是三国：东汉的大河在建安末裂成魏蜀吴三股，各自着色并流六十年，二八〇年西晋灭吴，三股重新合成一条满宽的河。河宽恒定、只按当时并存的政权数均分——本库没有疆域与人口数据，若让分叉的宽窄去编码「谁更大」，那是在画我们并不掌握的东西。宽度只回答一个问题：那一年有几家。',
    cta: '这一节有两种读法，控件第一行随时可换：**竖向河流**顺着页面滚，读的是分合岔流；**横向泳道**并排铺开，读的是谁承谁。下一站换泳道看看。',
    set: { panoramaMode: 'river', laneEvents: true, evOff: [] },
    span: [220, 280],
    ctrl: '视图',
  },
  {
    t: '五代十国：全图最挤的一段',
    b: '七十二年里北方换了五姓十三君，南方十国并峙——这是整张图最挤的一段。',
    b2: '九〇七年朱温废唐，到九七九年北汉降宋。泳道被占满，河也分成最多股。',
    cta: '我把视图换成了**横向泳道**，并打开「全部承继关系」：粗实线＝法统相承，细实线＝亡入，虚线＝裂自。哪一国是从哪一国裂出来的，只有这些细丝说得出——这是河画不出来的一层。',
    set: { panoramaMode: 'lanes', laneStrands: true, laneEvents: true, evOff: [] },
    span: [907, 979],
    ctrl: '全部承继关系',
  },
  {
    t: '南宋与元：交接期有七十三年',
    b: '蒙古已立国，南宋还在临安——两条带子并排走了七十三年。',
    b2: '一二〇六年铁木真建大蒙古国，一二七一年忽必烈改国号为元，直到一二七九年南宋亡。',
    cta: '光只落在这两条泳道上：改朝换代不是一刀两断，明与清并立二十八年，陈与隋并立八年。泳道敢让它们重叠，正是因为那几十年里两边真的都还在。',
    set: { panoramaMode: 'lanes', laneStrands: true },
    span: [1206, 1279],
    bands: ['ssong', 'yuan'],
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
    cta: '点任一标记即开卡；导览另给了一排类别开关，可逐类筛。卡片里有 YouTube 与 B 站两个视频按钮——这一段在 B 站能找到几部讲得不错的。',
    ev: '隋末民变',
    card: true,
    links: 'vids',
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
    cta: '点任何一个斜纹格，能读到那段年份的依据；把图拖向更上游，看夏商的斜纹河源。',
    span: [-860, -640],
  },
  {
    t: '现在换你来找',
    b: '顶上那个搜索框：搜君主、搜政权、搜大事，也能直接输年份。',
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

/**
 * 挂载一条**逐站走的线**。导览是它的第一位客人，策展故事线是第二位——
 * 两者共用同一套打光、落位、清场与一屏预算（约定见 docs/idea-storylines.md
 * 「四之五」，改动前先读那一节）。
 *
 * @param opts.stops   站表；缺省即新手导览的 STOPS
 * @param opts.tag     面板左上角的小标签（「导览」／「故事线」）
 * @param opts.key     存档键前缀；不同的线各记各的进度
 * @param opts.launch  false＝不挂入口按钮（故事线由目录或深链拉起）
 */
export function mountTour(sectionEl, hostOf, opts = {}) {
  const STOPS = opts.stops || DEFAULT_STOPS;
  const TAG = opts.tag || '导览';
  const KEY = opts.key || 'il.tour';
  const SEEN_KEY = `${KEY}.seen`, AT_KEY = `${KEY}.at`;
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
  const body = h('div', { class: 'tour-body' });
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
  //   · 卡（若这一站开卡）≤ 27vh —— 缩略图与摘要都压一压；
  //   · 讲解面板：开卡的站 ≤ 28vh，不开卡的站 ≤ 38vh。
  // 派生出的两条做法：**同屏只有一个主讲人**（开卡即让位），
  // **文案分三级**——但切分轴是「史／法」而不是「概要／细节」：
  //   `b`   一句**史**：这地方为什么值得看（永远显示）
  //   `cta` 一句**法**：这一站教你图上的哪件事（永远显示）
  //   详解  其余（b2 补史、cta2 补法、宽窄屏差异说明）
  // 折进详解的只能是「补充」。**功能句绝不能折**——每一站的存在理由就是
  // 介绍一个读图的方法，把它折起来等于把这一站的意义折没了（用户实测指出）。
  const more = h('details', { class: 'tour-more' }, [
    h('summary', { class: 'tour-more-sum', text: '详解' }), body2, cta2, extra, mnote,
  ]);
  // 「读长文」：**只在读不到全文的屏上出现**。宽屏面板里整段散文已经在了，
  // 再挂一条去别处读的链接等于说「这儿的不算数」
  const readLink = h('a', { class: 'tour-read', href: '#', text: '读长文 →' });
  const panel = h('div', {
    class: 'tour-panel', role: 'dialog', 'aria-live': 'polite', 'aria-label': '导览',
  }, [
    h('div', { class: 'tour-head' }, [h('span', { class: 'tour-tag', text: TAG }), step, closeBtn]),
    title, body, cta, more,
    h('div', { class: 'tour-nav' }, [readLink, prev, next]),
  ]);
  // 讲解与副卡装在同一个坞里,由 flex 排上下——各自 position:fixed 的话
  // 两块会抢同一个角,还得手算偏移
  const dock = h('div', { class: 'tour-dock' }, [panel]);
  document.body.appendChild(dock);
  // ── 长文：直接写进面板 ────────────────────────────────────────────
  // 原先想在右侧另开一张读物卡，试下来是多此一举——讲解卡本来就在读者眼睛
  // 落的地方，右边再摆一张，等于要人左右横跳（用户实测：放这里也没事）。
  // 故长文取代 b/b2 长在面板里，坞自己会滚，读进度条已经在了。
  // 窄屏不给：一屏预算里塞不下六百字，手机仍读 b/b2 那两句。
  // `full` 的站（序、落点）例外：那两张本来就是拿来定调的，图上没有东西可打光，
  // 手机上索性给近乎满屏，全文照读
  const LONG_MIN_W = 1000;
  const wantLong = (st) => !!(st && st.long && st.long.length && (st.full || innerWidth > LONG_MIN_W));
  const fillLong = (st) => {
    body.innerHTML = '';
    for (const t of st.long) {
      // **粗体** 转 <strong>，与 cta 同一条路径（文案是本库里的字面量，非外来输入）。
      // 落点那段的「**或曰**」就靠它——那两个字是整条线的钥匙，不能让星号露出来
      const el = h('p', { class: 'tour-p' + (/^「/.test(t) ? ' tour-q' : '') });
      el.innerHTML = t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      body.appendChild(el);
    }
  };
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
    // 宽屏：**讲解坞去卡那一侧**。事件卡贴着它自己那条岸（左岸政事、右岸文教）
    // 是有意义的，不该为了排版把卡搬走；该动的是讲解——它跟卡一左一右分踞两端，
    // 读者的眼睛要横跨整屏才能把话和东西对上（用户实测截图）。
    if (innerWidth > 720) {
      const open = [...document.querySelectorAll('.kp.on')].map((c) => c.getBoundingClientRect())
        .filter((r) => r.width && r.height);
      if (open.length) {
        const cx = open.reduce((a, r) => a + r.left + r.width / 2, 0) / open.length;
        dock.classList.toggle('dock-right', cx > W * 0.55);
      }
    } else dock.classList.remove('dock-right');
    if (raw.length && innerWidth <= 720) {
      const c = raw.reduce((a, r) => a + r.y + r.h / 2, 0) / raw.length;
      const cardOn = !!document.querySelector('.kp-solo.on, .river-card.on');
      dock.classList.toggle('dock-bottom', !cardOn && c < H * 0.42);
    }
    syncSbar();
    // ── 活预算 ────────────────────────────────────────────────────────
    // 底线不是「图必须占 45%」，而是**这一站打光的目标看得见且有余裕**。
    // 段正严那格只有三十九像素高，却照样按 45% 给图留白，把讲解挤得露不全
    //（用户实测：这里其实有空间让导览卡全显示）。故按目标的实际身量算：
    // 需要给图的 = 目标高 + 上下各留一口气，夹在 25%–45% 之间；
    // 讲解坞拿走剩下的（22%–46%），卡不动。
    if (innerWidth <= 720 && STOPS[i] && STOPS[i].full) {
      dock.style.maxHeight = '';          // 定调卡：满屏由 CSS 给，不按留白算
    } else if (innerWidth <= 720) {
      const cardEl = document.querySelector('.kp-solo.on');
      const cardH = cardEl ? cardEl.getBoundingClientRect().height : 0;
      const solid = raw.filter((r) => !r.noClip);          // 卡上的洞不算「图」
      const tgtH = solid.length
        ? Math.max(...solid.map((r) => r.y + r.h)) - Math.min(...solid.map((r) => r.y)) : 0;
      const needMap = Math.min(H * 0.45, Math.max(H * 0.25, tgtH + 96));
      const maxDock = Math.max(H * 0.22, Math.min(H * 0.46, H - cardH - needMap));
      dock.style.maxHeight = `${Math.round(maxDock)}px`;
    } else dock.style.maxHeight = '';
    const band = visibleBand();
    // 一个 getter 可以给回多块(宽屏的知识卡是左右两张,该一起亮)
    for (let r of raw) {
      // 洞比屏还宽就等于没熄灯。七女为父报仇跨一百二十年,按 14px/年是 1680px——
      // 照原样挖,整屏全亮,读者不知道在看哪儿。超过屏宽七成即绕中心收窄:
      // 这是聚光灯,不是量尺,读者要的是「在这儿」而不是「有多长」
      // 收窄只对**按年份算出来的**洞：那种洞可以宽达一千七百像素，照原样挖
      // 就是整屏全亮。从 DOM 节点量来的洞（卡片、按钮、标签）本身就是一个
      // 具体的东西，宽一点也该照全——卡片 345px 被收成 285px 再居中，看着
      // 就是「框歪了」（用户实测）
      const cap = W * 0.76;
      if (!r.tight && r.w > cap) { r = { ...r, x: r.x + (r.w - cap) / 2, w: cap }; }
      // 留白按框的尺寸缩放：事件标记的命中区只有 14×18，一律加 6px 就会把
      // 相邻十四像素外的另一件事的圆点也圈进来，看着像「这个圈位置不对」
      // （用户实测）。小框收紧到 2–6px，大框照旧
      const pad = r.pad === undefined ? Math.max(2, Math.min(6, Math.min(r.w, r.h) / 5)) : r.pad;
      const box = { x: r.x - pad, y: r.y - pad, width: r.w + pad * 2, height: r.h + pad * 2, rx: 8 };
      // 与可见带、与视口求交；交完太薄就整块不画——宁可不打光，也不打在看不见的地方
      const x0 = Math.max(box.x, 0), x1 = Math.min(box.x + box.width, W);
      const yLo = r.noClip ? 0 : band.top, yHi = r.noClip ? H : band.bot;
      const y0 = Math.max(box.y, yLo), y1 = Math.min(box.y + box.height, yHi);
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
  const nodeHole = (sel, opts = {}) => () => {
    const ns = typeof sel === 'string' ? [...document.querySelectorAll(sel)]
      : [typeof sel === 'function' ? sel() : sel];
    return ns.filter((n) => n && n.isConnected).map((n) => {
      const r = n.getBoundingClientRect();
      // noClip：这个洞照的东西**本来就长在遮挡物里**（卡片，或卡片上的链接行）。
      // 可见带是拿来挡「被卡片盖住的图」的，若连卡片自己也一并裁掉，
      // 「照亮卡上的 YouTube 与 B 站按钮」这类站就一点光都没有（用户实测）
      return r.width && r.height
        ? { x: r.left, y: r.top, w: r.width, h: r.height, tight: 1, ...(opts.noClip ? { noClip: 1 } : {}) } : null;
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
    // 宽屏摆得下就**恢复原来的整段**：折叠是为手机的一屏预算而设，桌面
    // 没有这个约束，却因此把同一段叙述劈成两半——主旨在上、其余被功能句
    // 隔到下面（用户实测：桌面还是原来的全文更好读）。
    // 故宽屏合成一段、详解摊平（无折叠头），窄屏才走三级折叠
    const wideProse = innerWidth > 720;
    const longOn = wantLong(st);
    if (longOn) fillLong(st); else body.textContent = wideProse && st.b2 ? st.b + st.b2 : st.b;
    dock.classList.toggle('dock-long', longOn);
    const canRead = !!(st.read && st.long && !longOn);
    readLink.href = canRead ? st.read : '#';
    readLink.style.display = canRead ? '' : 'none';
    dock.classList.toggle('dock-full', !!st.full);
    body2.textContent = (wideProse || longOn) ? '' : (st.b2 || '');
    body2.style.display = (!wideProse && !longOn && st.b2) ? '' : 'none';
    more.classList.toggle('flat', wideProse);
    // 与 cta2 同一条路径：**粗体** 转 <strong>（文案是本文件的字面量，非外来输入）
    cta.innerHTML = (st.cta || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    cta.style.display = st.cta ? '' : 'none';
    // **粗体** 转 <strong>。文案是本文件里的字面量,不是外来输入
    cta2.innerHTML = (st.cta2 || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    cta2.style.display = st.cta2 ? '' : 'none';
    extra.innerHTML = '';
    if (st.go2) {
      extra.appendChild(h('a', { class: 'chip tour-go2', href: st.go2.href, text: st.go2.text }));
    }
    dock.scrollTop = 0;          // 每站从头讲起：上一站滚过的位置不该带到下一站
    // 背景卡：**只在 relevant 的时候开**（用户指出）。导览开着时自动跟随已关，
    // 这两格改由本站的事件决定——事件的 d 就是「这事发生在谁家」，那是归属审计
    // 一条条判过的（286 条补 d、165 条确认留空）；君主取那一年在位的那位。
    // 事件没有 d 的（两国之间的事、库外政权的器物，如龟兹的克孜尔石窟），
    // 背景卡就空着——本库判过它没有归属，卡片不该替它编一个
    {
      const kc = hostOf() && hostOf().__kp;
      if (kc && kc.setAuto) kc.setAuto(false);
    }
    // 详解的默认态每站重置：宽屏摆得下就直接摊开，手机收起（点开即看）。
    // 「这一站有没有藏着东西」交给 summary 的字样说，免得读者以为没了
    const hasMore = !!((st.b2 && !longOn) || st.cta || st.cta2 || st.go2);
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
    // 切站即清场：上一站开的卡不该跟到下一站——讲段正严，屏下却还挂着
    // 隋末民变的卡（用户实测）。用卡自己的关闭钮，与读者手动关一模一样；
    // 这一站若要开卡，navigate 稍后会开它自己那张
    for (const b of document.querySelectorAll('.kp.on .kp-close, .kp-solo.on .kp-close')) b.click();
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
    // span 兼两职：跳转的落点，以及「照这一段年份」的洞。点名了泳道就只留前者
    // ——否则整列连同无关政权一起被照亮（见 st.bands 的注）
    if (st.span && !st.bands) {
      // 优先 rectBody：泳道视图里它跳过顶上的事件轴，只照政权那一片——
      // 「这一段年份里有几家并立」问的是泳道，不是大事记（用户实测）
      holes.push(() => {
        const l = live();
        if (!l) return null;
        const f = l.rectBody || l.rect;
        return f ? f.call(l, st.span[0], st.span[1]) : null;
      });
    }
    if (st.ev) {
      const k = evIdx(st.ev);
      const e = k >= 0 ? EVENTS[k] : null;
      // **先照实际画出来的那个东西**：事件在图上只是一个标记＋一行字（命中区
      // 即 [data-evi]），而按年份区间画出来的框跨的是它「持续了多少年」——
      // 七女为父报仇横跨一百二十年，框宽得离谱，真正的标签反倒挤在框边上
      // （用户实测）。找得到节点就照节点，找不到（该事件在当前视图未画出、
      // 或被筛掉）才退回年份区间，至少还指得出「在这一段里」。
      if (k >= 0) {
        // 只照**画出来的墨**（标记与标签的字）：命中区为了好点做得比字高出
        // 一大截，照它就等于照了一片空白（用户实测）。墨找不到才退回命中区
        const inkSel = `[data-evi="${k}"]:not(.kp-hit)`;
        const byInk = nodeHole(inkSel);
        const byNode = nodeHole(`[data-evi="${k}"]`);
        holes.push(() => {
          const ink = byInk();
          if (ink.length) return ink;
          const hit = byNode();
          if (hit.length) return hit;
          const l = live();
          return e && l && l.rect ? l.rect(e.y, e.y2 || e.y + 1) : null;
        });
      }
    }
    // 只照点名的那几条泳道／河道。此前这类站按年份区间挖洞，整列从上到下
    // 都被罩进去，无关的政权与底下的空白一并「照亮」（用户实测：讲南宋与元，
    // 金、大理连同空白全在光里）。两个视图的带都带 data-dyn，可直接点名。
    if (st.bands) holes.push(nodeHole(st.bands.map((k) => `[data-dyn="${k}"]`).join(',')));
    if (st.dyn && !st.bands) holes.push(nodeHole(`[data-dyn="${st.dyn}"]`));
    if (st.emp) holes.push(nodeHole(() => empBox.node));

    // 三、走过去
    navigate(st, loc, { smooth: true });
    // 背景卡在这之后设：设早了会被随后的重绘与本站自己的事件卡冲掉
    setStopContext(st);
    await (loc.pending || Promise.resolve());
    if (me !== seq) return;

    // 四、到站,亮起要演示的那个控件
    // 控件也要每帧现找,不能扣住节点:读者一改选项,shell 就把整条控件行
    // (以及图例)重建一遍,扣住的那个节点当场脱离文档,洞随之消失——
    // 而消失的正好是第一站请他去点的那个开关
    const late = [], wantVisible = [];
    // **这一站真正指着的那个东西**必须看得见。泳道里 loc.emperor 只管横滚，
    // 而那条泳道可能整行落在视口下方；河流侧同理。此前 wantVisible 只收了
    // 控件，于是「讲段正严，屏上一个光框都没有」（用户实测）
    wantVisible.push(() => { const l = live(); return l ? targetRect(st, l) : null; });
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
      // links: 'vids' 只照两个视频按钮（卡上正有 .kp-vids 裹着它俩）；
      // links: true 照整行。此前一律照整行，连维基与百度也圈了进去，
      // 而这一站讲的是「B 站能找到几部讲得不错的」（用户实测）
      const part = st.links === 'vids' ? '.kp-vids' : '.kp-links';
      const sel = st.links ? base.split(', ').map((s) => `${s} ${part}`).join(', ') : base;
      cardGets.push(nodeHole(sel, { noClip: true }));
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
    // 到站自检。切换视图会整块重挂载（河两万八千像素 ↔ 泳道八百），页面滚动
    // 因此被浏览器夹紧，视图自己的落点恢复又在导览的跳转之后跑——结果是
    // 「讲的是三国，屏上停在夏初」「讲段正严，格子在屏外」（用户两度实测）。
    // 故隔几拍复查**这一站真正指着的那个东西**：还在视口外就地再跳一次
    //（不带缓动，这是纠偏不是旅程）
    for (const d of [180, 500, 1100, 1800]) setTimeout(() => {
      if (me !== seq || !on) return;
      kick();
      const kc2 = hostOf() && hostOf().__kp;
      if (kc2 && kc2.setAuto) kc2.setAuto(false);
      setStopContext(st);
      const l = live();
      if (!l) return;
      // 这一站要照卡上的链接行，就得先把卡滚到看得见它的地方——手机上卡被
      // 限在 27vh（一屏预算法则），内容 280、可视 217，链接行正好落在卡外，
      // 光框于是照在卡背后的东西上（用户实测：说好要高亮 B 站与 YouTube，
      // 那儿却什么也没有）
      if (st.links) {
        for (const c of document.querySelectorAll('.kp-solo.on, .kp.on')) {
          if (c.scrollHeight > c.clientHeight + 2) c.scrollTop = c.scrollHeight;
        }
      }
      const r = targetRect(st, l);
      // 解析不出也算「没到」：跳转发生在重排完成之前时，君主格还不在 empRefs
      // 里，loc.emperor 返回 false、empBox.node 留空，自检若就此放弃，这一站
      // 就永远没有光（用户实测：段正严那站一个光框都没有）
      const off = !r || r.y + r.h < 0 || r.y > innerHeight || r.x + r.w < 0 || r.x > innerWidth;
      if (off) navigate(st, l, {});
    }, d);
  }

  /**
   * 走到本站该在的位置。抽出来是为了**重画之后能再走一遍**:
   * 读者点一下「全部承继关系」或改一下时间缩放,整张图连同横向滚动位置一起重置,
   * 人就被扔回公元前——导览却还在讲五代十国。
   */
  /**
   * 这一站真正指着的那个东西的矩形——自检据此判断「到没到」。
   * 与 navigate 的分支一一对应：年份段看视图算出的区间，君主看他的格子，
   * 事件看它画出来的标记，搜索看那个框。
   */
  function targetRect(st, loc) {
    const one = (n) => {
      if (!n || !n.isConnected) return null;
      const b = n.getBoundingClientRect();
      return b.width && b.height ? { x: b.left, y: b.top, w: b.width, h: b.height } : null;
    };
    if (st.emp) return one(empBox.node);
    if (st.ev) {
      const k = evIdx(st.ev);
      return k >= 0 ? one(document.querySelector(`[data-evi="${k}"]`)) : null;
    }
    if (st.dyn) {
      const ns = [...document.querySelectorAll(`[data-dyn="${st.dyn}"]`)]
        .map(one).filter(Boolean);
      if (!ns.length) return null;
      return { x: Math.min(...ns.map((r) => r.x)), y: Math.min(...ns.map((r) => r.y)),
        w: Math.max(...ns.map((r) => r.x + r.w)) - Math.min(...ns.map((r) => r.x)),
        h: Math.max(...ns.map((r) => r.y + r.h)) - Math.min(...ns.map((r) => r.y)) };
    }
    if (st.search) return one(sectionEl.querySelector('.tl-search'));
    if (st.span && loc.rect) return loc.rect(st.span[0], st.span[1]);
    return null;
  }

  function navigate(st, loc, o) {
    if (st.span) {
      loc.year((st.span[0] + st.span[1]) / 2, o);
    } else if (st.emp) {
      const id = empIdOf(st.emp);
      // 节点存进盒子而不是扣进闭包:重画后旧节点作废,盒子里换成新树上的那一个,
      // 洞的取值函数不必跟着改
      empBox.node = (id && loc.emperor(id, o)) || null;
    } else if (st.ev) {
      const k = evIdx(st.ev);
      if (k >= 0) loc.event(k, o);
    } else if (st.dyn) {
      // 政权站：跳到那条政权带的中点。此前引擎从未调用过 loc.dynasty——
      // 新手导览没有这种站，故事线（石窟线的政权段、两岸故宫线的南迁）要用
      loc.dynasty(st.dyn, o);
    } else if (st.search) {
      // 卡已在切站时统一清掉（见 goto 的清场）。这一站尤其要干净：角卡是绝对
      // 定位、层级低于**吸顶后**的搜索框，而这一站要滚回页首，那时搜索框还没
      // 吸顶，卡片正好压在它上面（用户实测）
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

  /**
   * 把两翼的背景卡（朝代／君主）设成这一站该配的那一对。
   * 朝代取事件的 d；君主取该朝在事件那一年在位的那位——找不到就让它空着。
   */
  function setStopContext(st) {
    const kc = hostOf() && hostOf().__kp;
    if (!kc || !kc.setContext) return;
    const dynKey = st.dyn || (st.ev ? (EVENTS[evIdx(st.ev)] || {}).d : null) || null;
    let empId = null;
    if (dynKey && st.ev) {
      const y = (EVENTS[evIdx(st.ev)] || {}).y;
      const r = EMPERORS.filter((e) => e.dynKey === dynKey).find((e) => {
        const a = e.reigns[0] && e.reigns[0].s, z = e.reignEnd;
        return a && z && a.t <= y + 1 && z.t >= y;
      });
      empId = r ? r.id : null;
    }
    if (st.emp) empId = empIdOf(st.emp) || empId;   // 站自己点名的君主优先
    // 事件卡与朝代卡共用一格的视图（泳道）：这一站有事件时，那一格归事件，
    // 背景只设君主。否则背景会把本站真正要讲的那张卡顶掉（用户实测）
    const evOwnsDyn = st.ev && kc.eventSlot === 'dyn';
    kc.setContext({ dynKey: evOwnsDyn ? undefined : (dynKey || null), empId: empId || null });
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
    dock.classList.remove('dock-long');
    dock.classList.remove('dock-full');
    dock.classList.remove('dock-right');
    {   // 自动跟随还给读者：导览关掉它只为这一程，不该留下后遗症
      const kc = hostOf() && hostOf().__kp;
      if (kc && kc.setAuto) kc.setAuto(true);
    }
    document.body.classList.remove('tour-card-on');
    dock.classList.remove('dock-bottom');
    sbar.classList.remove('on');
    dock.style.maxHeight = '';
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
    if (opts.onStop) opts.onStop();      // 故事线借它把主题放回读者原来的样子
  }

  // 导览已结束就不再响应：面板收了，可导航钮还在 DOM 里，再点会把副卡与
  // 让位记号重新装出来，屏上于是留下一排没有讲解的类别开关（实测）
  // 宽窄档切换（转屏、拉窗）要重排文案：宽屏整段、窄屏三级折叠
  let proseWide = innerWidth > 720;
  addEventListener('resize', () => {
    const w = innerWidth > 720;
    if (on && w !== proseWide) { proseWide = w; goto(i); }
  });
  prev.addEventListener('click', () => { if (on) goto(i - 1); });
  next.addEventListener('click', () => {
    if (!on) return;
    if (i === STOPS.length - 1) stop(true); else goto(i + 1);
  });
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
  if (opts.launch !== false) (sectionEl.querySelector('.head') || sectionEl).appendChild(launch);
  return { start, stop, stops: STOPS };
}
