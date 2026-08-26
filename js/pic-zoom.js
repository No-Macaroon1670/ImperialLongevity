// pic-zoom.js — 条卡图的点开放大（2026-08-25 用户令：条卡与故事线讲解卡同待遇）。
// 灯箱复用 tour.js 那套 .tour-zoom 样式现件（styles.css「讲解卡里的图点开放大」段），
// 但各建各的节点、互不认识——导览未开时条卡也要能放大。页面级单例，首次点击才建。
// 只挂本地手选图（自摄 pics-own-cards.js／馆方开放图 pics-museum-cards.js，长边 1600px
// 经得起放）；维基 REST 缩略图不挂——三百来像素放大只会糊。开关在 fillCard 的
// dataset.zoomcap 上，这里只管开箱关箱。
let box = null;
let img = null;
let cap = null;

function ensure() {
  if (box) return;
  img = document.createElement('img');
  img.className = 'tour-zoom-img';
  img.alt = '';
  cap = document.createElement('div');
  cap.className = 'tour-zoom-cap';
  const x = document.createElement('button');
  x.className = 'tour-zoom-x';
  x.type = 'button';
  x.setAttribute('aria-label', '关闭');
  x.textContent = '✕';
  box = document.createElement('div');
  box.className = 'tour-zoom';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.append(x, img, cap);
  document.body.appendChild(box);
  const close = () => box.classList.remove('on');
  box.addEventListener('click', (e) => {
    if (e.target === box || e.target === x) close();
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

export function openPicZoom(src, caption) {
  if (!src) return;
  ensure();
  img.src = src;
  cap.textContent = caption || '';
  box.classList.add('on');
}
