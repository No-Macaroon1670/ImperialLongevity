// counts.js — data-il-count 回填的唯一实现。
// 此前三页各写一遍同样的循环（app.js / app-timeline.js / app-map.js），
// 增一个计数就要改三处——正是「同一语义多处实现」的税（2026-08-21 架构盘点）。
// 文案里的数字由脚本按实际覆盖：写死的每次增补都会再错一次。
export function syncCounts(n) {
  for (const el of document.querySelectorAll('[data-il-count]')) {
    const v = n[el.dataset.ilCount];
    if (v !== undefined) el.textContent = String(v);
  }
}
