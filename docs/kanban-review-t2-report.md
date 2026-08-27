
# t2 验证报告：功能 P1/P2 与工程质量结论（reviewer-features）

规范仓库 F:/workspace/project/dsh-k，全部证据来自实读源码。核对项 F1–F11、E1–E4 及 2 个补充核查。

## 功能项

**F1 拖回同列也调 moveTask** — verdict: ✅ 确认
- KanbanColumn.vue:17-20 `onDrop` 只取 dataTransfer taskId 就 emit，**无同列判断**；BoardView.vue:60-67 `handleDrop` 无条件 `board.moveTask(taskId, to)` 并 toast.success('状态已更新')。
- 副作用坐实：lib/index.js:700 `patchTask(input.taskId, { status: to, message: '' })` 无条件**清空 message**（拖回同列也会抹掉暂停原因/状态说明）。
- 无 drop 目标高亮：KanbanColumn.vue:32-33 只有 `@dragover.prevent` + `@drop`，无 hover 态/高亮 class。
- drag 后 click 误开详情：TaskCard.vue:18-23 整卡 `draggable="true"` + `@click="emit('open', task)"`；全 src grep `dragend|dragged` **0 命中**，无任何抑制标志。
- 修复要点：handleDrop 先判 from===to 直接 return；拖回同列不清 message；dragover 维护 hover 态加高亮 class；TaskCard 加 dragend 标记并在 click 中抑制紧随的误触发。工作量：**S**

**F2 轮询失败每次弹 toast** — verdict: ✅ 确认
- BoardView.vue:32-38 `refresh()` 的 catch 里 `toast.error(e?.message || '加载看板失败')`，:30 POLL_INTERVAL_MS=4000，:82 `setInterval(refresh)` → 后端不可用时每 4 秒弹一条；无静默重试/退避/错误计数。
- 修复要点：连续 N 次失败才 toast（错误去重）；失败后指数退避暂停轮询。工作量：**S**

**F3 approve 的 toast 过早** — verdict: ✅ 确认
- BoardView.vue:94-105 `handleApprove` 在 `approveTask` resolve 后立刻 toast 「已审核，agent 正在合回基础分支」并 :99 关闭详情。
- lib/index.js:715-725 `approveTask` 仅置 approved + :723 `this.schedule(() => this.mergeTask(input.taskId))`（fire-and-forget）；真正的 mergeTask :969-1000（git merge :989 / 删 worktree :990 / 删分支 :991）。
- 失败路径 :978/:985 只 `patchTask→paused`（原因写进 message），**无任何主动通知**；用户此时已关详情，只能等下次轮询静默看到任务变 paused——失败后用户不知情，且**无法重试合并**（见「遗漏问题 3」）。
- 修复要点：approve 后保持详情打开并显示「合回中」；轮询检测 done/paused 转换后补 toast；后台任务失败走通知通道。工作量：**M**

**F4 项目选择无搜索、无分支显示** — verdict: ✅ 确认（一字之差修正）
- BoardView.vue:169-183 与 NewTaskDialog.vue:215-226 的项目选择都只渲染 `p.title`，无搜索输入。注意：用的是 reka-ui/shadcn Select（ui/select/Select.vue:12 SelectRoot），**不是原生 <select>**，但功能上同样无搜索/过滤。
- 分支未显示在项目项里（branch 由 NewTaskDialog 单独的「基础分支」Select 承载，默认值取 p.branch，NewTaskDialog.vue:148-149）。
- 修复要点：换 Combobox 支持搜索；选项加分支副标题/徽标；BoardView 顶部选择器同步。工作量：**M**

**F5 任务详情只读、无复制/打开/链接、长输出无折叠、changeLog 纯文本** — verdict: ✅ 确认
- 只读：TaskDetailSheet.vue:128 描述仅 MarkdownPreview 渲染，无编辑入口（仅评论可写）。
- 无复制路径：:182-187 metaRows 里 worktreePath 为纯文本 truncate（:185），无 clipboard 按钮；无「打开目录」。
- commit 无链接：:153 `<span class="font-mono">{{ log.commit }}` 纯文本（TaskChangeLog 类型也无 repoUrl，types.ts:31-37）。
- 长输出无折叠：:136 message 与 :144-156 changeLog 全量渲染。
- :155 `<div class="whitespace-pre-wrap">{{ log.summary }}` —— 项目里已有 MarkdownPreview.vue（marked+DOMPurify）却未用于 changeLog。确认。
- 修复要点：worktreePath 加复制按钮；commit 渲染为仓库链接（后端补 repoUrl）；长文本折叠；changeLog summary 换 MarkdownPreview。工作量：**M**

**F6 无 agent 并发上限、whenIdle 无超时** — verdict: ✅ 确认
- lib/index.js:685 `this.schedule(() => this.runTask(id))` 每个 todo 任务直接起跑；guard :778-786 **仅按 taskId 防重入**，无全局信号量/队列上限。
- spawnAgent :1004-1047，:1039 followup 后 :1040 `await handle.agent.whenIdle()` 无超时无取消；runTask 全程无 deadline（agent 挂死 → 任务永远 running）。
- 修复要点：全局并发上限（1-2 个 agent 排队）；whenIdle 套超时（项目已有 withTimeout 先例 usePathAutocomplete.ts:117-125）；超时后 dispose + paused 保留可恢复会话。工作量：**M**

**F7 无搜索/筛选/归档/排序** — verdict: ✅ 确认
- 全 src 无任何搜索/筛选控件（grep `search|filter|搜索|筛选` 仅命中内部状态分组 .filter 调用）；useBoard.ts:20-24 selectedTasks 只按 projectId 过滤、:26-31 columns 按 status 分组。
- done 不归档：listTasks（lib/index.js:556-564）全量返回，done 永远留在列上。
- 无 order 字段：types.ts:39-57 Task 无 order/priority；列内顺序=服务端 createdAt 倒序（lib/index.js:563），不支持手动排序。
- 修复要点：标题/分支搜索框 + done 归档折叠；Task 加 order 字段并持久化拖拽排序。工作量：**M**

**F8 删除无确认** — verdict: ✅ 确认
- TaskDetailSheet.vue:259-267 删除按钮直接 `emit('remove', task.id)`，无 confirm；BoardView.vue:133-144 直接 deleteTask。
- 更危险：lib/index.js:764-768 deleteTask 只删记录+取消定时器，**不终止在跑的 agent、不清理 worktree**（removeTaskWorktree 仅在 mergeTask :990 调用）→ 删除运行中任务产生孤儿 agent + 残留目录。
- 修复要点：删除前确认弹窗；running 任务删除需先终止会话；deleteTask 增加 worktree 清理。工作量：**S（确认弹窗）+ M（终止逻辑）**

**F9 Ctrl+K 全局 capture** — verdict: ✅ 确认（行号有偏差）
- 实际在 src/client.ts:113-127：setupToggleHotkey :115-127；:125 `window.addEventListener('keydown', onKeydown, true)` 捕获阶段全局监听，:121-123 `e.preventDefault(); e.stopPropagation();` 拦截一切 Ctrl/Cmd+K（仅排除 alt/shift），宿主若有同键位命令面板会被吞掉。潜在冲突成立。
- 修复要点：与宿主快捷键协商/白名单开关；输入态或非看板 focus 时放行。工作量：**S**

**F10 pathsCache 永不淘汰** — verdict: ✅ 确认（影响有限）
- usePathAutocomplete.ts:39 `const pathsCache = new Map` 模块级；:98-114 loadEntry 只写不删（仅 pendingLoads :109-111 清理）；无 TTL/上限。key 为 projectId → 条目数受项目数约束，但**文件树变更后缓存不失效**（新建文件不出现，须刷新页面）。
- 修复要点：TTL/LRU 淘汰或失效钩子。工作量：**S**

**F11 文案全中文硬编码、无 i18n** — verdict: ✅ 确认
- types.ts:3-15 STATUS_LABEL、BoardView/NewTaskDialog/TaskDetailSheet 全部模板、client.ts:272-340 侧边栏文案均为硬编码中文；package.json 无 i18n 依赖。
- 重要线索：package.json:36 client inject 里**已含** `@deepseek-ai/dsh-client-locale`（宿主 locale 能力），插件完全没用。
- 修复要点：引入 vue-i18n 或复用宿主 locale 服务，抽出文案表。工作量：**L**

## 工程质量项

**E1 runTask/runContinuation 重复** — ✅ 确认。lib/index.js:832-898 vs :900-965 骨架完全相同（guard/状态检查/gitBlockReason/worktree 确保/git add+commit/changeLog/patchTask→review），仅 agent 调用（:862 spawnAgent vs :928 continueAgent）与 commit message（:869/:935）不同。修复：抽取公共 runAgentCycle。工作量 **S**

**E2 死代码** — ✅ 确认（两处）
- branchCache：lib/index.js:384 初始化、:544 invalidateBranch 只 delete；**全仓 grep 仅此两处引用**，从未写入/读取，mergeTask :995 调用的也是无效 delete。
- useBoard 的 busy：useBoard.ts:14 定义、:66-118 置位/清除、:130 导出；grep 全 src 无任何组件消费（BoardView 用的是本地 detailBusy，BoardView.vue:27/:230）→ 拖拽无任何忙碌态反馈。修复：删除或接入 UI。工作量 **S**

**E3 测试仅 smoke-host happy path** — ✅ 确认。package.json:22 唯一 `test:smoke` → scripts/smoke-host.mjs：仅 create→review→comment→review→approve→done 直线（:69-92），agents.create 用恒真 fake（:54-63，whenIdle 立即返回）；**无** merge 冲突、resumeTask、moveTask、删除运行中任务、定时执行/取消、git 失败、agent error 分支用例；无任何前端测试（devDependencies 无测试框架）。修复：补状态机关键用例（冲突/删除运行中/恢复）+ vitest 组件测试。工作量 **L**

**E4 双仓库并存** — ✅ 确认。F:/workspace/project 下 dsh-k 与 dsh-kanban-plugin 各带 .git（43 vs 39 commits）；关键文件字节级相同（diff -q lib/index.js、BoardView.vue 均零差异）。修复：旧目录已删除（dsh-k 为唯一 canonical 仓库）。工作量 **S**

## 补充核查

**S1 SchedulePicker keyForValue 误判** — verdict: ⚠️ 部分成立（机制成立、触发有条件）
- SchedulePicker.vue:123-132 `<1000ms` 容差对比「当前时刻+30m/1h/明天9点」；:206-223 watch(modelValue, immediate) 每次值变化/重挂载都重算。
- 触发路径：NewTaskDialog 关闭弹窗时**不重置 executeAt**（:98-112 只清 description）；DialogContent 用 reka-ui Portal（node_modules/reka-ui DialogContent.js:46-48 Presence，关闭动画后卸载）→ **取消后重开**弹窗时组件重挂载，用陈旧值对「新的当前时刻+30m」求差，>1 秒即落入 custom（:130 若落在空闲窗口则误显为 idle）。submit 会重置 executeAt（NewTaskDialog.vue:192）故「提交后重开」不触发。
- 修复要点：选择 preset 时持久化 key（而非仅 ISO 值）或放宽容差/记录生成时刻。工作量 **S**

**S2 NewTaskDialog 分支每次重拉无缓存** — ✅ 确认。NewTaskDialog.vue:145-155 selectProject → :157-171 loadBranches 每次切项目都调 api.listBranches（后端实时 git branch --list，lib/index.js:495-505），切回同一项目也重拉。有趣的是 branchCache（E2 死代码）本应是这里的缓存——「想缓存但代码坏死」。修复：按 projectId 缓存 + 合回后失效。工作量 **S**

## 修订后优先级排序（P1 → P2）

**P1（会丢数据/卡死/资源失控）**
1. **F3 合回反馈闭环**：approve 后异步 merge 失败无通知、且 paused 后 resume 是重新跑 agent 而非重试合并（resumeTask :727-739 置 running+spawnAgent）——行为错位，用户以为合回了实际没有。M
2. **[遗漏] 删除/移动运行中任务不协调 agent 生命周期**：deleteTask/moveTask 不终止在跑 agent，runTask 收尾仍会覆盖状态为 review（:889-894），产生孤儿 agent + 残留 worktree + 状态与执行脱节。M
3. **[遗漏] 宿主重启后 running 任务永不恢复**：restoreScheduledTasks（:819-828）只恢复 todo+executeAt；重启前 running 的任务永久卡死（叠加 whenIdle 无超时）。M
4. **F6 并发上限 + whenIdle 超时**：多任务同时 spawnAgent 资源失控、单任务无限挂起。M
5. **E3 补关键用例**：冲突/删除运行中/恢复/定时取消（先于功能扩展）。L

**P2（体验与整洁度）**
6. **F1 拖拽细节**（同列 drop、高亮、click 误开）。S
7. **F8 删除确认**（含 running 终止提示）。S
8. **F2 轮询静默失败**。S
9. **E1/E2 去重与删死代码**。S
10. **F10 pathsCache 淘汰**。S
11. **S2 分支缓存 + 激活 branchCache**。S
12. **S1 SchedulePicker 误判**。S
13. **F9 Ctrl+K 冲突收敛**。S
14. **F7 搜索/排序/归档**。M
15. **F5 详情可用性**（复制/折叠/changeLog Markdown）。M
16. **F4 项目选择 Combobox**。M
17. **F11 i18n**（复用宿主 dsh-client-locale）。L
18. **E4 双目录清理**。S

**遗漏的更严重问题**（原清单未覆盖，建议升级）：
- 删除/移动运行中任务的 agent 生命周期不一致（见 P1-2）——语义上比 F8 的「无确认」严重得多；
- 宿主重启后 running 任务无恢复（见 P1-3）；
- approve→merge 失败后「继续执行」语义错位（重跑 agent 而非重试合并，见 P1-1 内）；
- 轮询失败场景下 toast 风暴会反向掩盖状态变化（F2 与 F3 叠加：失败信息被淹没）。

行号均经实读核对，未编造。