// line-catalog.js — 故事线目录浮层：时间轴原件抽出的**共用件**（2026-08-26 周一单3落地）。
// 书的按钮开的是**目录**而不是某一条线：线会越来越多，而「有哪些线可走」本身就是
// 读者要先看见的东西（用户 2026-08-22 指出，原注随件搬家）。目录只列名字、一句话与
// 站数，点一条才进去——选择在读者手里，不在按钮上。
// 两页各开各的池子：河页全量，图页只列带 geo 的线；卡列＝线名＋站数＋lede＋
// 读长文/资料两链。浮层零位移——图页此前用 details 原地展开，会把整条类别轴
// 顶下去（本件立案的病根）。样式沿用 styles.css 的 .line-catalog 族，两页同源。
const REPO = 'https://github.com/No-Macaroon1670/ImperialLongevity';

export function buildLineCatalog({ lines, onPick }) {
  const catalog = document.createElement('div');
  catalog.className = 'line-catalog';
  catalog.setAttribute('role', 'dialog');
  catalog.setAttribute('aria-label', '故事线目录');
  const close = () => { catalog.classList.remove('on'); document.body.classList.remove('line-catalog-on'); };
  const open = () => {
    catalog.classList.add('on');
    document.body.classList.add('line-catalog-on');
    const first = catalog.querySelector('.lc-row');
    if (first) first.focus();
  };
  const sheet = document.createElement('div');
  sheet.className = 'lc-sheet';
  const head = document.createElement('div');
  head.className = 'lc-head';
  const h = document.createElement('h3');
  h.textContent = '故事线';
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'kp-close'; x.textContent = '✕';
  x.setAttribute('aria-label', '关闭');
  x.addEventListener('click', close);
  head.append(h, x);
  const intro = document.createElement('p');
  intro.className = 'lc-intro';
  intro.textContent = '一条线是穿过这张图的一种读法：跨越时代的一串站点，逐站打光、逐站讲。';
  sheet.append(head, intro);
  for (const line of lines) {
    const row = document.createElement('button');
    row.type = 'button'; row.className = 'lc-row';
    const nm = document.createElement('div');
    nm.className = 'lc-name';
    nm.textContent = line.name;
    const cnt = document.createElement('span');
    cnt.className = 'lc-count';
    cnt.textContent = `${line.stops.length} 站`;
    nm.appendChild(cnt);
    const sub = document.createElement('div');
    sub.className = 'lc-sub';
    sub.textContent = line.lede;
    row.append(nm, sub);
    row.addEventListener('click', () => { close(); onPick(line); });
    sheet.appendChild(row);
    // 出处链接单挂一行，不进站点卡：走线时不该被脚注打断，
    // 但「这些数字哪来的」必须随时查得到（用户：链接到某处就行）
    if (line.doc) {
      const row2 = document.createElement('div');
      row2.className = 'lc-links';
      // 两种读法并排：走图在上面那颗大按钮，读文在这儿。
      // 长文页是同一份数据的另一个出口（story/<key>.html，深色）
      const rd = document.createElement('a');
      rd.className = 'lc-doc';
      rd.href = `story/${line.key}.html`;
      rd.textContent = '读长文 →';
      const a = document.createElement('a');
      a.className = 'lc-doc';
      a.href = `${REPO}/blob/main/docs/${line.doc}.md`;
      a.target = '_blank'; a.rel = 'noopener';
      a.textContent = '资料与出处 ↗';
      row2.append(rd, a);
      sheet.appendChild(row2);
    }
  }
  catalog.appendChild(sheet);
  catalog.addEventListener('click', (e) => { if (e.target === catalog) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.body.appendChild(catalog);
  return { el: catalog, open, close };
}
