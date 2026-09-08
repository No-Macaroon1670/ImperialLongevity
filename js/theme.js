// theme.js — 日夜模式开关，给不走 shell.js 渲染循环的页面（舆图、地方线）共用。
//
// 为什么要它：四页的 HTML 都把 #theme-toggle 写在页首那段 lede 里，而 styles.css 有一条
// 「.lede .theme-toggle { display: none }」——那是为了刷新瞬间开关不在段末闪现，前提是
// 脚本随后会把它搬进「设置」或筛选条。shell.js 管的页（寿命库、王朝之河）搬了；舆图与
// 地方线各自抄了八行只绑点击、没搬家，于是按钮一直藏着——库主 2026-09-07 实测舆图
// 「设置」里缺日夜切换，即此。此外那八行也没读写 localStorage 'il-theme'，跨页不记偏好。
// 三件事收进一处：读存值、贴标签、搬进指定的家；点按后持久化并回调（舆图要重描底图）。
export function mountThemeToggle(home, { onChange } = {}) {
  const tt = document.getElementById('theme-toggle');
  if (!tt) return null;
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem('il-theme');
    if (saved) root.setAttribute('data-theme', saved);
  } catch { /* 隐私模式 */ }
  const label = () => {
    const cur = root.getAttribute('data-theme');
    const dark = cur === 'dark' || (!cur && matchMedia('(prefers-color-scheme: dark)').matches);
    tt.textContent = dark ? '☀ 浅色' : '🌙 深色';
  };
  label();
  if (home) home.appendChild(tt);   // 离开 lede 即现身（那条 display:none 只管 lede 里的）
  tt.addEventListener('click', () => {
    const cur = root.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark'
      : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('il-theme', next); } catch { /* 隐私模式 */ }
    label();
    if (onChange) onChange(next);
  });
  return tt;
}
