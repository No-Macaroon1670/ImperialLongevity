// search.js — 文本搜索跳转与深链
//
// 两千年、387 位君主、三百条大事记的长卷，此前只能靠滚与拖去找——
// 想看「唐太宗」或「755 年」得自己滚到那里，看到了也没法把这一屏发给别人。
// 这个模块补上时间轴最基本的两件事：
//
//   1. **搜得到**：一个输入框，索引君主（姓名／庙号／朝代）、政权、大事记，
//      选中即跳到那一屏并点开卡片。
//   2. **发得出**：URL 带上 `#y=755`、`#e=李世民`、`#d=tang`、`#ev=安史之乱`，
//      打开即落到那里；反过来，用户点选谁，地址栏就跟着变成谁的链接
//      （用 replaceState，不往历史里塞垃圾）。
//
// 两个视图各自实现同名的 `host.__locate`（year/emperor/dynasty/event），
// 本模块只管说「去哪儿」，不必知道那一张是横滚还是竖滚。
import { h, fmtYearAxis } from './charts.js';
import { EMPERORS, DYNASTIES } from './data.js';
import { EVENTS, EVENT_KINDS } from './events.js';
import { norm, withPy, scoreKeys } from './search-core.js';
import { tlProbe } from './shell.js';

// 匹配核（norm/withPy/scoreKeys）在 search-core.js——地图搜索同用，只此一份。

/** 建索引：君主、政权、大事记各成一类，按名字的多种写法建关键词 */
function buildIndex() {
  const idx = [];
  for (const e of EMPERORS) {
    idx.push({
      kind: 'emp', id: e.id, label: `${e.dynasty}·${e.temple}`,
      sub: `${e.name || ''}${e.acc ? ` · ${fmtYearAxis(e.acc.year)} 年即位` : ''}`,
      keys: withPy([e.name, e.temple, e.posth, `${e.dynasty}${e.temple}`, e.dynasty].filter(Boolean).map(norm)),
      y: e.acc ? e.acc.t : 0,
    });
  }
  for (const d of DYNASTIES) {
    idx.push({
      kind: 'dyn', id: d.key, label: d.name,
      sub: `政权 · ${fmtYearAxis(d.s)}–${fmtYearAxis(d.e)}`,
      keys: withPy([d.name, d.key].map(norm)), y: d.s,
    });
  }
  EVENTS.forEach((ev, i) => {
    // 副行写类别与年代;**名人轶事另把主角写出来**——这一类的名字是成语
    // (孤注一掷),条目却挂在人身上(寇准),两者是不同的东西。搜「寇准」本来
    // 就命中得了(keys 里有 ev.w),可结果行只写「孤注一掷」,读者既不知道
    // 它为什么匹配,也不知道讲的是谁。其余各类的 n 与 w 说的是同一件事,不必赘写。
    const kind = (EVENT_KINDS[ev.k] || {}).label || '大事';
    const who = ev.k === 'fig' && ev.w && ev.w !== ev.n ? ` · ${ev.w}` : '';
    idx.push({
      kind: 'ev', id: i, k: ev.k, label: ev.ya ? `${ev.ya}（${ev.n}）` : ev.n,
      sub: `${kind} · ${fmtYearAxis(ev.y)}${ev.y2 ? `–${fmtYearAxis(ev.y2)}` : ''}${who}`,
      // 雅名也要能搜:图上写的是「破釜沉舟」,搜这四个字却找不到巨鹿之战,
      // 等于把刚教给读者的名字又藏起来
      keys: withPy([ev.n, ev.w, ev.ya].filter(Boolean).map(norm)), y: ev.y, raw: ev.n,
    });
  });
  return idx;
}

/** 「755」「前221」「唐太宗」——查询先当年份解，再当名字解 */
function search(idx, q) {
  const n = norm(q);
  if (!n) return [];
  const yr = /^前?\d{1,4}$/.test(q.trim())
    ? (q.trim().startsWith('前') ? -parseInt(q.trim().slice(1), 10) + 1 : parseInt(q.trim(), 10))
    : null;
  const hits = [];
  if (yr !== null) hits.push({ kind: 'year', id: yr, label: `${q.trim()} 年`, sub: '跳到这一年', y: yr });
  const scored = [];
  for (const it of idx) {
    const best = scoreKeys(it.keys, n);
    if (best < 99) scored.push({ ...it, score: best });
  }
  // 同分时按「君主 → 政权 → 大事」排，再按年份
  const order = { emp: 0, dyn: 1, ev: 2 };
  scored.sort((a, b) => a.score - b.score || order[a.kind] - order[b.kind] || a.y - b.y);
  return hits.concat(scored.slice(0, 9));
}

const hashOf = (item) => (
  item.kind === 'year' ? `#y=${item.id}`
    : item.kind === 'emp' ? `#e=${encodeURIComponent(item.label.split('·').pop())}`
      : item.kind === 'dyn' ? `#d=${item.id}`
        // 深链用本名不用显示名:显示名带着雅名与括号(「破釜沉舟（巨鹿之战）」),
        // 拿它做链接,回来时按索引键一个也对不上
        : `#ev=${encodeURIComponent(item.raw || item.label)}`);

export function mountSearch(sectionEl, hostOf) {
  const idx = buildIndex();
  const box = h('div', { class: 'tl-search' });
  const input = h('input', { type: 'search', placeholder: '搜君主 / 政权 / 大事 / 年份…',
    'aria-label': '搜索并跳转', autocomplete: 'off' });
  const list = h('div', { class: 'ts-list', role: 'listbox' });
  box.appendChild(input); box.appendChild(list);

  /**
   * 随手翻一处。搜索要求读者**先想得起来一个名字**,可这张图最值钱的地方
   * 恰恰是那些想不起来的:七女为父报仇、王恭厂大爆炸、段正严。骰子解决的
   * 就是「不知道该搜什么」——按下去缓缓滚过去,顺带看见路上隔了多少年。
   *
   * 池子取君主与大事两类(政权不取:一个朝代跨几百年,落点等于没落点)。
   * 记住上一次的落点,免得连按两下停在原地——那看着像按钮坏了。
   */
  let lastPick = null;
  const dice = h('button', {
    class: 'chip tl-dice', type: 'button', title: '随机跳到一位君主或一件大事',
    onclick: () => {
      // 骰子只掷在正看着的宇宙里（用户票据 2026-08-21）：类别关了不摇进来；
      // 事件层全关时退到君主＋政权（政权平时不取——跨几百年落点等于没落点，
      // 但全关场景里它比「按了没反应」强）
      const evO = tlProbe.evOff();
      const evPool = idx.filter((it) => it.kind === 'ev' && !evO.has(it.k));
      const pool = evPool.length
        ? idx.filter((it) => it.kind === 'emp').concat(evPool)
        : idx.filter((it) => it.kind === 'emp' || it.kind === 'dyn');
      if (pool.length < 2) return;
      let pick = null;
      for (let a = 0; a < 8 && (!pick || pick === lastPick); a++) {
        pick = pool[Math.floor(Math.random() * pool.length)];
      }
      lastPick = pick;
      dice.classList.remove('rolling');
      void dice.offsetWidth;                 // 重启动画:不回流的话连按第二下不动
      dice.classList.add('rolling');
      go(pick, { smooth: true });
    },
  }, [h('span', { class: 'tl-dice-face', text: '🎲' }), h('span', { text: '随便看看' })]);
  (sectionEl.querySelector('.head') || sectionEl).appendChild(dice);
  (sectionEl.querySelector('.head') || sectionEl).appendChild(box);
  // 本节在视口里就把搜索框钉住。用 IntersectionObserver 而非 scroll 事件:
  // 后者在页面隐藏/后台标签页里不一定按时来(本项目已为此栽过一次),
  // 而「够不够得着搜索框」这件事不该受那些影响。
  const headEl = sectionEl.querySelector('.head') || sectionEl;
  let headGone = false, sectionHere = false;
  const sync = () => {
    const on = headGone && sectionHere;
    box.classList.toggle('pinned', on);
    dice.classList.toggle('pinned', on);    // 窄屏时骰子跟着钉进顶部黑条（CSS 侧只在窄屏生效）
    // 故事线入口同理：顶栏左边还空着一格，正好放它（用户实测指出）
    for (const b of document.querySelectorAll('.line-launch')) b.classList.toggle('pinned', on);
  };
  new IntersectionObserver(([e]) => {
    headGone = !e.isIntersecting && e.boundingClientRect.top < 0;   // 标题栏滚到上方去了
    sync();
  }, { threshold: 0 }).observe(headEl);
  new IntersectionObserver(([e]) => {
    sectionHere = e.isIntersecting;                                  // 本节还在视口里
    sync();
  }, { threshold: 0 }).observe(sectionEl);

  let items = [], cur = -1;
  const close = () => { list.classList.remove('on'); cur = -1; };
  const go = (item, o) => {
    const loc = hostOf() && hostOf().__locate;
    if (!loc || !item) return;
    input.blur();     // 先收软键盘：不收的话，落点按缩半的视口算，键盘一收就漂
    if (item.kind === 'year') loc.year(item.id, o);
    else if (item.kind === 'emp') loc.emperor(item.id, o);
    else if (item.kind === 'dyn') loc.dynasty(item.id, o);
    else if (item.kind === 'ev') { if (!loc.event(item.id, o)) loc.year(item.y, o); }
    history.replaceState(null, '', hashOf(item));
    input.value = '';
    close();
  };
  const paint = () => {
    list.innerHTML = '';
    items.forEach((it, i) => {
      const row = h('div', { class: 'ts-row' + (i === cur ? ' on' : ''), role: 'option' }, [
        h('span', { class: 'ts-label', text: it.label }),
        h('span', { class: 'ts-sub muted', text: it.sub }),
      ]);
      row.addEventListener('mousedown', (e) => { e.preventDefault(); go(it); });
      list.appendChild(row);
    });
    list.classList.toggle('on', items.length > 0);
  };
  input.addEventListener('input', () => { items = search(idx, input.value); cur = items.length ? 0 : -1; paint(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { cur = Math.min(cur + 1, items.length - 1); paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { cur = Math.max(cur - 1, 0); paint(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (items[cur]) go(items[cur]); }
    else if (e.key === 'Escape') { input.value = ''; close(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));

  // ── 深链 ────────────────────────────────────────────────────────────────
  const applyHash = () => {
    const m = new URLSearchParams(location.hash.replace(/^#/, ''));
    const loc = hostOf() && hostOf().__locate;
    if (!loc) return false;
    if (m.has('y')) { loc.year(Number(m.get('y'))); return true; }
    if (m.has('d')) return loc.dynasty(m.get('d'));
    if (m.has('e')) {
      const q = norm(m.get('e'));
      const hit = idx.find((it) => it.kind === 'emp' && it.keys.some((k) => k === q));
      return hit ? loc.emperor(hit.id) : false;
    }
    if (m.has('ev')) {
      const q = norm(m.get('ev'));
      const hit = idx.find((it) => it.kind === 'ev' && it.keys.some((k) => k === q));
      return hit ? (loc.event(hit.id) || loc.year(hit.y)) : false;
    }
    return false;
  };
  // 首帧布局尚未落定（河流按实测宽度画布），故等一帧再落位
  requestAnimationFrame(() => requestAnimationFrame(applyHash));
  addEventListener('hashchange', applyHash);
  return { applyHash };
}

/** 视图内点选谁，地址栏就变成谁的链接——用 replaceState，不往历史里塞垃圾 */
export function stampHash(kind, value) {
  const h2 = kind === 'e' ? `#e=${encodeURIComponent(value)}` : `#${kind}=${encodeURIComponent(value)}`;
  if (location.hash !== h2) history.replaceState(null, '', h2);
}
