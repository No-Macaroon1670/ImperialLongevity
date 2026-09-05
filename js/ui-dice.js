// ui-dice.js — 骰子「随手翻一处」的两件内核（2026-09-04 归一，SSOT 卷 D24）。
//
// 时间轴（`search.js`）与舆图（`app-map.js`）各有一颗骰子，取样与动画重启逐字
// 相同——作者自陈「骰子照搬时间轴」「（时间轴同注）」，连重试上限 8 与三段式
// 回流都同。**池子与落点不进来**：时间轴取君主＋大事（政权跨几百年，落点等于
// 没落点）、舆图取 shown() 全套开关下的全库（图上政权有都城点，落点不虚），
// 落点一边是 go()、一边是 locate()。按钮 DOM 也一概不碰（`.tl-dice-face`
// 两段 vs 裸 emoji，`pl-dice` 类还被地球钮共用）。

/**
 * 取一个与上次不同的：**按引用比，不按 id 比**。两页的池元素形状不同
 * （时间轴是索引项 `{kind,id,label}`，舆图是数据行 `{n,k,层}`），改成按 id
 * 比会当场炸掉一边。重试至多 8 次即认命——池小到几乎摇不出别的时，与其
 * 空转不如给个重复的（`pool.length < 2` 的早退留在调用点，两页池子不同）。
 */
export function pickDifferent(pool, last) {
  let pick = null;
  for (let a = 0; a < 8 && (!pick || pick === last); a += 1) {
    pick = pool[Math.floor(Math.random() * pool.length)];
  }
  return pick;
}

/** 重启滚动动画：不强制一次回流的话，连按第二下不动。 */
export function restartRoll(btn) {
  btn.classList.remove('rolling');
  void btn.offsetWidth;
  btn.classList.add('rolling');
}
