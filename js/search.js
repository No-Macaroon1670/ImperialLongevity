// search.js — 文本搜索跳转与深链
//
// 两千年、382 位君主、三百条大事记的长卷，此前只能靠滚与拖去找——
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
import { h } from './charts.js';
import { EMPERORS, DYNASTIES } from './data.js';
import { EVENTS } from './events.js';

const norm = (s) => (s || '').toLowerCase().replace(/[·・\s（）()]/g, '');

/** 建索引：君主、政权、大事记各成一类，按名字的多种写法建关键词 */
function buildIndex() {
  const idx = [];
  for (const e of EMPERORS) {
    idx.push({
      kind: 'emp', id: e.id, label: `${e.dynasty}·${e.temple}`,
      sub: `${e.name || ''}${e.acc ? ` · ${e.acc.year <= 0 ? `前${-e.acc.year + 1}` : e.acc.year} 年即位` : ''}`,
      keys: [e.name, e.temple, e.posth, `${e.dynasty}${e.temple}`, e.dynasty].filter(Boolean).map(norm),
      y: e.acc ? e.acc.t : 0,
    });
  }
  for (const d of DYNASTIES) {
    idx.push({
      kind: 'dyn', id: d.key, label: d.name,
      sub: `政权 · ${d.s <= 0 ? `前${-d.s + 1}` : d.s}–${d.e}`,
      keys: [d.name, d.key].map(norm), y: d.s,
    });
  }
  EVENTS.forEach((ev, i) => {
    idx.push({
      kind: 'ev', id: i, label: ev.n,
      sub: `大事 · ${ev.y < 0 ? `前${-ev.y}` : ev.y}${ev.y2 ? `–${ev.y2}` : ''}`,
      keys: [ev.n, ev.w].map(norm), y: ev.y,
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
    let best = 99;
    for (const k of it.keys) {
      if (k === n) best = Math.min(best, 0);
      else if (k.startsWith(n)) best = Math.min(best, 1);
      else if (k.includes(n)) best = Math.min(best, 2);
    }
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
        : `#ev=${encodeURIComponent(item.label)}`);

export function mountSearch(sectionEl, hostOf) {
  const idx = buildIndex();
  const box = h('div', { class: 'tl-search' });
  const input = h('input', { type: 'search', placeholder: '搜君主 / 政权 / 大事 / 年份…',
    'aria-label': '搜索并跳转', autocomplete: 'off' });
  const list = h('div', { class: 'ts-list', role: 'listbox' });
  box.appendChild(input); box.appendChild(list);
  (sectionEl.querySelector('.head') || sectionEl).appendChild(box);

  let items = [], cur = -1;
  const close = () => { list.classList.remove('on'); cur = -1; };
  const go = (item) => {
    const loc = hostOf() && hostOf().__locate;
    if (!loc || !item) return;
    if (item.kind === 'year') loc.year(item.id);
    else if (item.kind === 'emp') loc.emperor(item.id);
    else if (item.kind === 'dyn') loc.dynasty(item.id);
    else if (item.kind === 'ev') { if (!loc.event(item.id)) loc.year(item.y); }
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
