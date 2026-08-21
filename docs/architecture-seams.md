# 两页共享架构·接缝盘点（2026-08-21，用户提出）

起因：「双击只看一类＋全开」落在图页忘了河页——同一语义两套实现，是漂移的温床。

## 已共享（机制层，改一处两页生效）
- 数据与类目：events.js / EVENT_KINDS / dynasties.js
- 条卡：knowledge.js（河页弹卡、图页嵌入坞同一张卡——mountEmbedCard 复用样板）
- 故事线三件套：lines.js ＋ line-text-*.js ＋ geo.js（河页故事模式与图页走线共用）
- 计数回填：counts.js（本次归一，此前三页三套循环）
- 样式令牌：--ev-* 色票、.kp 卡族、.chip 族

## 仍在重复（同一语义多处实现——按代价排序，逐个吃掉）
1. **类别芯片手势**：图页 chip()（原生 dblclick）与河页 eventLegend（时间戳判双击）
   语义已对齐、实现仍两套。候选：抽 js/kind-chips.js 手势助手，两页共用。（代价小）
2. **设置折叠块**：图页是 map.html 静态 details，河页是 shell 的 grp() DSL。
   形态统一需图页接 DSL。（代价中）
3. **筛选状态与深链**：河页 S.evOff 与图页 state.off 同义不同名，跨页跳转不带筛选。
   候选：统一 URL 参数（#k=…），两页互认。（代价中，价值高——「在时间轴上看这一条」
   跳转可保持读者当下的筛选语境）
4. **故事引擎**：河页 tour.js 与图页走线 LN 共用 LINES 数据但引擎两套。（代价大，暂不动）

## 故意分开（版式层，不强合）
泳道/河流渲染 vs 地图投影绘制；两页各自的缩放、滑杆、命中交互。

## 原则
机制共享、版式各归；新功能落地前先问一句「另一页要不要」——要，就写进共享层。

## 统一地图模块（2026-08-21 用户定向，可行性在研）

**三个消费者，一台引擎**：①故事页大图（构建时静态）②时间轴走线小地图（运行时）
③地图页（运行时）。用户原话：prefer main map as base…plan for the fact that we'll
make more of these and they're going to be used in the same way——**新开一条线只准
带数据来，不准带新地图代码来**。
首选路线：plate.js 作唯一制图底座，故事页在构建时经 node 跑 plate.js 出静态 SVG；
备选：故事侧独立统一模块。build_line_page.py 里今晚现写的 map_svg（含标签避让）
是过渡件，方案落地后废弃——它与 plate.js 的标签排版器是重复发明，此债已认。
