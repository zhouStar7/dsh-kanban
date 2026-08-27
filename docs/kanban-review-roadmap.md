# dsh-kanban 优化路线图（团队验证收敛版）

> 编制：architect（架构/路线图汇总）｜依据：t1（reviewer-core，P0 验证）、t2（reviewer-features，P1/P2 与工程质量）、t3（designer，样式/可访问性）｜规范仓库：**F:\workspace\project\dsh-k**（dsh-kanban-plugin 为旧副本，本次所有结论均基于 dsh-k 实测源码行号，未引入验证结果之外的新猜测）
> 分层规则：按「改动面」分层（纯前端/配置 → 主机端 lib/index.js → 架构级），时间为参考窗口。

## 0. 收敛统计与打分模型

- 三份验证报告原始条目：t1 = 6 条 P0（5 确认 / 1 部分成立）；t2 = 22 项核对（F1-F11、E1-E4、S1-S2：16 确认 / 1 部分）+ 3 条遗漏问题 + 2 条补充核查；t3 = 9 条样式/可访问性（7 确认 / 2 部分）+ 2 条补充 + 1 条新增严重发现（badge 对比度）。
- 合并去重后独立问题 **28 项**（§2-§4 表格即为去重结果）：同源问题归并（如「删除任务不清理 worktree/agent」= t1 P0-1 + t2 F8 + t2 遗漏① 三处合并为 1 项）。
- 交叉确认 4 组：删任务残留、重启不恢复、runTask/runContinuation 重复、branchCache 死代码/轮询 4s（双评审独立实锤，行号一致）。
- 打分模型：得分 = 影响(数据丢失/卡死/资源失控=3，体验/可访问性=2，整洁度=1) ÷ (成本 S=1/M=2/L=3 × 风险 低=1/中=2/高=3) × 10。各层内按得分降序排列。
- 工作量汇总（按各报告标注，去重后估算）：约 **16S + 10M + 3L**；单人全做约 4-5 周（不含人工复核 B 类项）。

---

## 1. 合并去重说明（重复项如何收敛）

| 合并后问题 | 来源条目（合并前） | 说明 |
|---|---|---|
| 删除任务不清理 worktree/不终止 agent | t1 P0-1 ＋ t2 F8(危险面) ＋ t2 遗漏① | 行号同为 lib/index.js:764-768，双评审确认 |
| 运行中任务收尾覆写状态 / 生命周期脱节 | t1 P0-2 ＋ t2 遗漏① | t1 详证 moveTask 路径，t2 同证 delete/move 共用收尾 |
| 重启后 running 不恢复（含过期任务滞留） | t1 P0-4（前提段）＋ t2 遗漏② | 同为 restoreScheduledTasks :819-828 |
| runTask/runContinuation ~90% 重复 | t1 附 ＋ t2 E1 | 双评审独立发现同一重复（:832-898 vs :900-965） |
| branchCache 死代码/分支无缓存 | t1 P0-6 ＋ t2 E2 ＋ t2 S2(功能) | t2 S2 指出 branchCache 本应是 NewTaskDialog 的分支缓存 |
| 轮询 4s + 失败 toast 风暴 | t1 P0-6(README 偏差) ＋ t2 F2 | 行为同源（BoardView.vue:30/82），README 矛盾并入 |
| 拖/点混合 + 无 hover + 标题不截断 | t2 F1 ＋ t3 S5 | 同文件同行号（TaskCard.vue），t3 修正标题结论 |
| SchedulePicker 24+60 项 | t2 S1(功能误判) ＋ t3 补充核查 | 前者是功能 bug，后者是 UX 冗长，分别保留 |

---

## 2. 第 1 层：快速见效（参考 1-2 天，纯前端/配置级，低风险）

**目标**：以最小改动消除宿主污染、外网请求、视觉/可访问性硬伤与高频交互痛点；不改动主机端逻辑，全部可独立上线、文件级回滚。

### Wave A（1-2 天，S 级低风险项，按得分排序）

| # | 改动点（文件级 + 证据行号） | 影响/成本/风险 | 得分 |
|---|---|---|---|
| A1 | 删除 index.css:176-183 全局 `*`/body 规则（与 :4-6 隔离声明、:121-165 :where(.dsh-kanban-root) 隔离矛盾；:167-174 已有根内等价规则） | 2/1/1 | 20 |
| A2 | 删除 index.css:2 Google Fonts @import（Inter 全仓仅此一处，字体栈实际走系统栈 :18/:117；省外网请求与离线挂起风险） | 2/1/1 | 20 |
| A3 | 样式懒注入：injectStyles 从 client.ts:390 (apply) 移到 mountKanban 挂载 effect（:368-377），dispose/unload 分支（:436-445）同时清理 style 标签 | 2/1/1 | 20 |
| A4 | 轮询失败去重+退避：BoardView.vue:32-38 catch 改为连续 N 次失败才 toast、失败后指数退避（过渡方案，第 3 层推送刷新落地后降级为纯兜底） | 2/1/1 | 20 |
| A5 | 删除确认弹窗：TaskDetailSheet.vue:259-267 → confirm 后 emit；BoardView.vue:133-144 同步（running 任务提示「将终止会话」，终止逻辑在第 2 层 H1） | 2/1/1 | 20 |
| A6 | 拖拽细节（前端部分）：KanbanColumn.vue:17-20 同列 from===to 直接 return；:32-33 dragover 维护 hover 高亮 class；TaskCard.vue:18-23 加 dragend 标记并在 click 中抑制紧随误触发（task 仍 draggable 整卡 vs 手柄分离见 B3） | 2/1/1 | 20 |
| A7 | 列头状态色锚点：KanbanColumn.vue:24-28 加 bg-status-{id}/10 左条/圆点（--status-* 已定义于 index.css:47-52/:107-112，目前仅 KanbanStatusBadge.vue:10-15 与 RoadmapView.vue:117-122 使用） | 1/1/1 | 10 |
| A8 | 工具栏 flex-wrap + Badge 截断：BoardView.vue:160/:173（w-64 固定 → w-full sm:w-64）；TaskDetailSheet.vue:113/115 Badge 加 min-w-0+truncate+title（ui/badge/index.ts:7 含 whitespace-nowrap overflow-hidden，当前硬裁剪） | 1/1/1 | 10 |
| A9 | patch-dsh-ui.mjs 路径/颜色回退改造：:14 硬编码路径降为最后手段（优先模块路径/env 推导）；:42/:44 颜色回退按宿主 isDark 分支（现为 var(--dsw-alias-*,#fff/#111/#666) 单回退，暗色宿主会错） | 1/1/1 | 10 |
| A10 | Ctrl+K 冲突收敛：src/client.ts:113-127 捕获阶段全局监听（:125，:121-123 preventDefault/stopPropagation，仅排除 alt/shift）→ 改为输入态/非看板 focus 放行 + 宿主键位协商白名单开关 | 2/1/2 | 10 |
| A11 | pathsCache 淘汰策略 + busy 死代码：usePathAutocomplete.ts:39 模块级 Map 加 TTL/LRU 或失效钩子（:98-114 只写不删）；useBoard.ts:14/:66-118/:130 的 busy 无任何组件消费 → 删除或接入拖拽忙碌态 UI | 1/1/1 | 10 |
| A12 | 小屏滚动修复：NewTaskDialog.vue:206 的 DialogContent 无 max-h（表单约 700px+）→ 换 DialogScrollContent（组件已存在但零使用）或加 max-h-[85dvh]+overflow-y-auto | 1/1/1 | 10 |
| A13 | 运维：双仓库清理 E4（dsh-k 与 dsh-kanban-plugin 字节级相同，43 vs 39 commits）→ 归档旧目录、README 标注 canonical | 1/1/1 | 10 |
| A14 | Roadmap 刻度与层级（S 部分）：RoadmapView.vue:223 今天线 z-[4] 压任务 z-[3] → pointer-events-none + z 降级；刻度 div（:204-209/:217-222）换 repeating-linear-gradient | 2/1/1 | 20 |

### Wave B（前端持续打磨，M 级，可与第 2 层并行，约 3-5 天）

| # | 改动点（文件级 + 证据行号） | 影响/成本/风险 | 得分 |
|---|---|---|---|
| B1 | 路线图对比度达标：RoadmapView.vue:225 text-white/90+opacity 0.78 配 :231 STATUS_BG；实算（纯白/white-90）：todo 5.04/4.40、running 4.25/3.72、paused 5.13/4.50、review 4.28/3.76、approved 4.21/3.70、done 5.72/4.99 → running/review/approved 纯白即 <4.5，white/90 仅 done 达标。改深色文字或调色板；任务条/左列行（:170-181/:225-238）加 role=button tabindex=0+Enter | 3/2/1 | 15 |
| B2 | Badge 对比度（新增严重项）：KanbanStatusBadge 明色 text-status-x@/15 底 todo 4.10/running 3.47/paused 4.21/review 3.52/approved 3.47/done 4.65（5/6 不达 AA），暗色全挂 2.56-3.38 → 明暗两套 text 色阶（明 oklch 0.4x / 暗 oklch 0.75+） | 3/2/1 | 15 |
| B3 | 卡片体验：TaskCard.vue:25 标题 line-clamp-1+:title（现完全不截断，超长换行撑高卡片）；:19-22 拖拽手柄（左条区 draggable）与点击区分离，Card hover 抬升/阴影 | 2/2/1 | 10 |
| B4 | 任务详情可用性：TaskDetailSheet.vue:185 worktreePath 加复制按钮；:136/:144-156 长输出折叠；:155 changeLog summary 换 MarkdownPreview（组件已存在未用）［commit 链接依赖第 2 层 H8 补 repoUrl，types.ts:31-37］ | 2/2/1 | 10 |
| B5 | 项目选择 Combobox 化：BoardView.vue:169-183 与 NewTaskDialog.vue:215-226 的 reka-ui Select（t2 F4 修正：非原生 select）→ Combobox + 搜索 + 分支副标题/徽标 | 2/2/1 | 10 |
| B6 | 搜索/筛选/归档：全 src 无搜索控件（useBoard.ts:20-24 仅按 projectId 过滤、:26-31 按 status 分组）→ 标题/分支搜索框 + done 归档折叠 | 2/2/1 | 10 |
| B7 | 跨列移动动画：useBoard.ts:66-75 数组替换后重过滤，全 src 无 TransitionGroup → TransitionGroup+FLIP（可延后） | 1/2/1 | 5 |
| B8 | SchedulePicker 误判修复：SchedulePicker.vue:123-132 <1000ms 容差对比 + :206-223 watch immediate；NewTaskDialog.vue:98-112 关闭不重置 executeAt（:192 submit 才重置）→ 预置项持久化 key 而非仅 ISO 值（或记录生成时刻）；可选：60 项分钟 SelectItem（:111-112 生成、:284-292/:306-314 渲染，SelectContent.vue:39 已有滚动）换原生 time 输入 | 2/1/1 | 20 |

**验收标准**：
- A1/A2：注入样式审查无全局选择器、无外网请求（DevTools Network 0 字体请求）；宿主为 shadcn/Tailwind 风格时 body/边框色不被覆盖。
- A3：看板未打开时无 plugin style 标签；dispose 后标签移除。
- A4：宿主停止服务 5 分钟内至多 1 条 toast；恢复后自动续拉。
- A5/A6：删除需二次确认；同列拖回不触发 toast 与 message 丢失；拖拽结束不误开详情；列 hover 有高亮。
- A10：宿主 Ctrl+K 命令面板可用；插件内 focus 时 Ctrl+K 仍有效。
- A14/B1/B2：关键路径对比度 ≥4.5:1（明暗两主题）；今天线可穿透点击；任务条可 Tab 聚焦回车操作。
- A12/B8：竖屏小屏（≤700px 高）新增任务表单 footer 可达；取消后重开弹窗预置项不误判 custom/idle。

**风险与回滚**：全部为文件级、无数据面改动；回滚 = git revert 对应组件/样式文件（可逐条撤）。A10 需与宿主确认键位（风险中，放行白名单先行）；A9 改构建脚本需本地起一次宿主验证 patch 生效。

---

## 3. 第 2 层：短期（参考 1-2 周，主机端 lib/index.js 逻辑修改）

**目标**：任务生命周期与数据安全闭环——删除/移动/重启/合并/创建五条路径上 agent、worktree、持久化状态三者一致；消除所有静默行为（静默 null、静默失败、无条件覆写）。

| # | 改动点（文件级 + 证据行号） | 影响/成本/风险 | 得分 |
|---|---|---|---|
| H1 | **删除任务治理**（t1 P0-1 ＋ t2 F8/遗漏①，双确认）：deleteTask（lib/index.js:764-768 只 cancelTaskTimer+tasks.delete）→ 复用 removeTaskWorktree（:314-318）+ branch -D（:991，目前仅 mergeTask 调用），best-effort 终止在跑 agent；init/启动时清扫孤儿 worktree（:819-828 区块） | 3/2/2 | 8 |
| H2 | **移动任务治理 + 收尾防覆写**（t1 P0-2 ＋ t2 E1 合并实现）：moveTask（:693-713 仅 patchTask）→ cancel 标记 + 中断 agent；runTask 收尾（:889-894 无条件改 status:'review'）改为收尾前对比持久化状态、被挪走则让位；**禁 running→approved 直达**（:702-703+:990 会强删正在写入的 worktree）；以抽公共 runWithAgent（:832-898 vs :900-965，约 27 行逐字重复）为载体顺带完成 E1 去重 | 3/2/2 | 8 |
| H3 | **重启恢复 + 过期任务**（t1 P0-4 ＋ t2 遗漏②）：restoreScheduledTasks（:819-828 只调度 executeAt>now）→ 过期任务 runTask 或置 paused 带提示；running 任务记录运行态并在重启后恢复/标记；whenIdle 无超时（spawnAgent :1040）→ 套超时（项目已有 withTimeout 先例：usePathAutocomplete.ts:117-125），超时 dispose+paused 保留可恢复会话（与第 3 层并发控制衔接） | 3/1/2 | 15 |
| H4 | **合回反馈闭环**（t2 F3 ＋ 遗漏③）：approve（:715-725 fire-and-forget schedule mergeTask :723；mergeTask :969-1000，失败路径 :978/:985 仅 patchTask→paused 无通知；BoardView.vue:94-105 提前 toast+关详情）→ approve 后保持「合回中」可见状态、失败走通知通道；resumeTask（:727-739 现在置 running+spawnAgent 重跑 agent）**区分「重试合并 vs 继续 agent」** | 3/2/2 | 8 |
| H5 | **合并路径统一**（t1 P0-3 ⚠️ 部分成立）：:320-329 主工作区 git merge --no-ff --autostash（current===baseBranch 时）→ 统一走 :331-346 临时 worktree + update-ref 路径；激活 hasUncommitted 护栏（:288-291 已写好但无调用），有未提交改动时拒绝合并 | 2/1/2 | 10 |
| H6 | **createTask 过去时间**（t1 P0-5）：:637-643 过去时间静默 null → 后端抛错/钳制；:685 立即 runTask 行为与 BoardView.vue:52 toast（按原始 input 提示「将在执行时间自动开始」）矛盾 → 前端按后端返回结果 toast + NewTaskDialog.vue:188 前端校验 | 2/1/1 | 20 |
| H7 | **getBoard 子进程收敛 + branchCache 激活**（t1 P0-6 ＋ t2 E2/S2）：projectView :481-493 每项目 currentBranch+isGitRepository 2 个 git 子进程（getBoard :613-626 → listProjects :608-611）→ 单次 git status 合并解析或缓存读路径；激活死代码 branchCache（:384 只写 :544 只删，全仓无读；mergeTask :995 调的是无效 delete）用作 NewTaskDialog loadBranches（:145-171 每次重拉，lib/index.js:495-505 实时 git branch --list）缓存，合回后失效 | 2/1/1 | 20 |
| H8 | **配套小改**：F1 后端半截——lib/index.js:700 patchTask 无条件清空 message → 仅跨列才清（拖回同列保留暂停原因/状态说明）；F5/B4 依赖——types.ts:31-37 补 repoUrl 字段供 commit 链接；F7b——types.ts:39-57 加 order 字段并持久化拖拽排序（listTasks :556-564 排序 :563 由 createdAt 改为 order） | 2/2/1 | 10 |

**验收标准**：
- H1：删除 running 任务 → agent 进程退出、worktree/分支清理、重启后无孤儿目录；删除 todo 任务无残留。
- H2：拖走任务后旧 agent 收尾不再把状态改回 review；running→approved 无法直接操作（按钮禁用/后端拒绝）；runTask/runContinuation 合并为单一实现且 smoke 全绿。
- H3：创建「未来 1 分钟」任务后立即重启 → 到点自动执行；过期任务有状态与提示；whenIdle 卡死任务在超时后转 paused 且可恢复。
- H4：approve 失败 → 用户可见通知、详情保持、可一键重试合并；resume 语义正确（合回失败=重试合并，不重跑 agent）。
- H5：current===baseBranch 合并不再触碰主工作区 stash/检出状态；有未提交改动时拒绝且有明确提示。
- H6：过去时间提交被拒绝并提示；toast 与实际行为一致。
- H7：getBoard 无每项目双 git 子进程；切换项目不重复拉分支（一次会话内）；合回后缓存失效。
- H8：拖回同列 message 保留；commit 可点击跳仓库；拖拽排序持久化，刷新后保持。

**风险与回滚**：
- 状态机改动回归面最大（H2/H3/H4 触及运行中任务）→ **前置**第 3 层 T1 测试用例（冲突/删除运行中/恢复/定时取消/git 失败），每项独立 commit。
- 回滚：lib/index.js 为单文件，git revert 即退回；不引入新存储字段要求（order/repoUrl 为可空新增，旧数据兼容，无迁移）。
- 行为变更（禁 running→approved、resume 语义）属产品行为调整，上线前需人工确认（见 §5-B/C）。
- README.zh.md:65「约 2s」与 :27「4s 自相矛盾」随本层统一修正，行为以 4000ms 为准。

---

## 4. 第 3 层：中期（参考 2 周以上，架构级）

**目标**：把看板从「轮询 + 单任务裸跑 + 全中文硬编码 + 无测试」升级为「事件驱动 + 受控并发 + 可国际化 + 可回归」的插件架构。四条主线（按依赖排序：测试先行）。

| # | 主线 | 改动点（文件级 + 证据行号） | 影响/成本/风险 | 得分 |
|---|---|---|---|---|
| T1 | **测试体系（先行，防 L2/L3 回归）** | E3：唯一测试 package.json:22 test:smoke → scripts/smoke-host.mjs:69-92 仅 create→review→comment→review→approve→done 直线，fake agent :54-63 恒真。补状态机关键用例：merge 冲突、deleteTask 运行中、resumeTask 重试合并、定时执行/取消、git 失败、agent error；devDependencies 引入 vitest 组件测试 | 3/3/1 | 10 |
| T2 | **推送刷新（根治轮询）** | 以事件通道/SSE 替代 BoardView.vue:30 POLL_INTERVAL_MS=4000 + :82 setInterval 轮询；保留轮询开关作断连兜底（L1 A4 退避逻辑随之降级） | 3/3/2 | 5 |
| T3 | **并发控制** | 全局 agent 信号量（t2 建议 1-2 个排队）+ 任务队列：lib/index.js:685 schedule→runTask 直接起跑、guard :778-786 仅按 taskId 防重入 → 全局上限；runTask 全程 deadline（挂死回收，与 L2 H3 whenIdle 超时、重启恢复状态机合并成一个「运行态生命周期模块」） | 3/2/2 | 8 |
| T4 | **i18n** | 复用以 @deepseek-ai/dsh-client-locale（package.json:36 已注入宿主 locale 能力，未被使用）或引入 vue-i18n：抽文案表覆盖 types.ts:3-15 STATUS_LABEL、BoardView/NewTaskDialog/TaskDetailSheet 全部模板、client.ts:272-340 侧边栏文案 | 2/3/2 | 3 |

**验收标准**：
- T1：smoke 扩展用例全绿；vitest 覆盖 BoardView 轮询/拖拽/删除确认与 useBoard 分组过滤；L2 H1-H4 改动均有对应用例。
- T2：状态变更 <500ms 感知；无轮询流量；断连自动重连，重连后状态一致。
- T3：同时只跑 ≤2 个 agent，其余排队；挂死任务超时回收为 paused 且会话可恢复；重启后队列/运行态恢复正确。
- T4：全仓库无硬编码中文文案；界面语言跟随宿主 locale；缺失词条回退中文不显示裸 key。

**风险与回滚**：架构级改动互相纠缠 → 每条主线独立 feature flag。T2 回滚=切回轮询开关；T3 信号量/队列参数可调、可整体关闭退化为现状；T4 保留硬编码兜底表。T1 全程先行，为其余三条提供回归网。

---

## 5. 评审结论可信度报告

### A. 高置信（多位评审独立确认，可直接实施）

| # | 结论 | 交叉证据 | 说明 |
|---|---|---|---|
| 1 | 删除任务不终止 agent、不清理 worktree/分支 | t1 P0-1（lib/index.js:764-768、:314-318、:991）＋ t2 F8/遗漏①（同 :764-768） | 行号一致、双来源 |
| 2 | 运行中任务收尾无条件覆写状态、agent 生命周期与 UI 脱节 | t1 P0-2（:889-894、:693-713）＋ t2 遗漏① | 同源双确认 |
| 3 | 宿主重启后 running 任务永不恢复 | t1 P0-4 关联段 ＋ t2 遗漏②（均 :819-828） | 双确认 |
| 4 | runTask/runContinuation 约 90% 结构重复 | t1 附 ＋ t2 E1（:832-898 vs :900-965，:868-894 vs :934-961 约 27 行逐字重复） | 双独立发现 |
| 5 | branchCache 死代码（全仓无读） | t1 P0-6（:384/:544）＋ t2 E2（同，:995 无效 delete） | 双确认 |
| 6 | 轮询实为 4000ms | t1 P0-6（BoardView.vue:30/82）＋ t2 F2（同文件同行） | 双确认 |
| 7 | 整卡 draggable + click 误开详情、无 hover/无 tooltip | t2 F1（TaskCard.vue:18-23）＋ t3 S5（L19-22） | 同文件同行双确认 |
| 8 | SchedulePicker 24+60 SelectItem | t2 补充核查 ＋ t3 补充核查（L111-112 生成、L284-292/L306-314 渲染） | 双确认 |
| 9 | 轮询失败每 4s 弹 toast、无退避 | t2 F2（BoardView.vue:32-38） | 单来源，但行为直观（t1 佐证轮询间隔） |
| 10 | 删除无确认弹窗 | t2 F8（TaskDetailSheet.vue:259-267、BoardView.vue:133-144） | 单来源，UI 层直观，人工复核成本低 |

### B. 被质疑或降级（需人工复核后再定方案）

| # | 原结论 | 验证修正 | 复核要点 |
|---|---|---|---|
| 1 | mergeTaskBranch 在主工作区 autostash 属 P0 最高危 | ⚠️ 部分成立（t1 #6）：机制真实（:320-329），但 --autostash 已覆盖普通场景、非「直接动到」；另有死代码护栏 hasUncommitted（:288-291）可补强 | 确认是否仍允许主区合并路径（建议统一走临时 worktree） |
| 2 | F4「原生 Select」 | 实为 reka-ui Select（t2 F4 修正，ui/select/Select.vue:12） | 仅是措辞修正，功能结论（无搜索/无分支显示）不变 |
| 3 | F9 Ctrl+K 全局冲突 | 行号/范围修正：client.ts:113-127，捕获阶段监听，仅排除 alt/shift（t2 F9） | 向宿主确认是否真有同键位命令，再定放行策略 |
| 4 | S5 标题「截断且无 title」 | 实为**完全不截断**换行撑高（t3 S5 修正，TaskCard.vue:25 无 truncate/line-clamp；:30 分支反而有 truncate） | 两种都是缺陷，修法不同（前者加截断即可，后者需 line-clamp+title），按修正后结论实施 |
| 5 | S8 行号 5-7、颜色 20-23 | 实际 L14、L42/44；机制=env 优先 + 硬编码最后回退（t3 S8 修正），仍含用户专属路径 | 复核构建环境是否常缺 DSH_DESKTOP_RESOURCES |
| 6 | README「约 2s」轮询 | README.zh.md:65 与 :27（4s）自相矛盾；实际 4000ms（t1 P0-6） | 文档修正即可，行为本就一致 |
| 7 | SchedulePicker 预置误判 | ⚠️ 条件触发（t2 S1）：取消后重开弹窗（组件重挂载）才落入 custom/idle；submit 会重置 executeAt（NewTaskDialog.vue:192），提交路径安全 | 若产品接受「重开即失效」可降级不做 |
| 8 | restoreScheduledTasks 过期卡死 | 有前提（t1 P0-4）：createTask:642 只存未来时间，场景=创建后重启 | 按前提写用例，勿扩大范围 |

### C. 新增问题（原评审未覆盖，验证中新增）

| # | 问题 | 来源 | 严重度 |
|---|---|---|---|
| 1 | 删除/移动运行中任务不协调 agent 生命周期（孤儿 agent + 残留 worktree + 状态与执行脱节） | t1 P0-1/P0-2 ＋ t2 遗漏①（双确认） | ★★★ 高于原「无确认弹窗」 |
| 2 | 宿主重启后 running 任务永久卡死（叠加 whenIdle 无超时） | t1 P0-4 关联 ＋ t2 遗漏②（双确认） | ★★★ |
| 3 | approve 合回失败后「继续执行」是重跑 agent 而非重试合并 | t2 遗漏③（resumeTask :727-739） | ★★★ 行为语义请产品确认 |
| 4 | running→approved 直达会强删正在写入的 worktree | t1 P0-2 附（:702-703 + :990） | ★★ |
| 5 | 轮询 toast 风暴会反向淹没状态变化（F2×F3 叠加） | t2 补充观察 | ★★ |
| 6 | KanbanStatusBadge 对比度：明色 5/6 不达 4.5、暗色全挂 2.56-3.38 | t3 S9 新增（实算） | ★★（可访问性） |
| 7 | NewTaskDialog 小屏滚动裁切；DialogScrollContent 零使用 | t3 补充 | ★ |
| 8 | hasUncommitted 死代码护栏（写好了但从不调用） | t1 P0-3 附（:288-291） | ★ |
| 9 | README.zh.md 自身矛盾（2s vs 4s） | t1 P0-6 | ★ |

---

## 6. 执行顺序与依赖建议

1. **先行**：L3-T1（补关键测试用例）→ 为 L2 状态机改动提供回归网（t2 明确要求「先于功能扩展」）。
2. **并行轨道 A**：L1 Wave A（1-2 天）＋ L2 H5/H6/H7（纯加固、低风险）同步进行。
3. **并行轨道 B**：L1 Wave B（前端 M 级）与 L2 H3/H4（运行态与合回闭环）并行；H3 依赖 T1 用例，H4 依赖 B4 的详情展示改动。
4. **依次推进**：L2 H1/H2（动状态机，需 E1 去重先行）→ H3 → H4 → H8 收尾。
5. **架构阶段**：T1 → T2（推送）→ T3（并发，与 L2-H3 合并成运行态生命周期模块）→ T4（i18n，可最后）。
6. **每条改动**：独立 commit；同步更新 README（消除 :65 矛盾）；CHANGELOG 记录行为变更（禁 running→approved、resume 语义、时间钳制）。

> 本路线图全部条目均可回溯到 t1/t2/t3 报告的实测文件:行号证据；A/B/C 三档分级用于决定「直接实施 / 人工复核后实施 / 升级处理」。