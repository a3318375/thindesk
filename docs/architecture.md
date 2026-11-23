# 架构与代码地图

## 整体结构

一个仓库、一个 package.json、一个对外 Node 服务。Vite 生成静态资源；Node 同时提供资源、HTTP API、SSE 和后台执行。前端组件不理解原生 CLI 协议，也不持有运行任务。

```text
浏览器 → HTTP 操作 → SQLite 持久队列 → Codex / Pi
   ↑                      ↓             ↓
   └──── SSE 视图 ← 保存消息、活动和用量 ← 事件
                          ↓
                    IM 持久化投递队列
                          ↓
                    QQ / 微信 / Telegram
```

## 后端入口

| 文件 | 职责 |
| --- | --- |
| `server/index.ts` | SQLite 初始化、HTTP 操作、SSE、启动下一轮、原生事件落盘和故障恢复 |
| `server/messages.ts` | Web／IM 共用的会话查找和消息入队 |
| `server/queue.ts` | FIFO、调序、运行器切换、生成用户消息与助手占位 |
| `server/desk-store.ts` | 工作台元数据、会话和消息分表；缓存与脏消息增量保存；旧 JSON 自动迁移 |
| `server/managed-run.ts`、`turn-worker.ts` | 独立运行进程、原子快照、控制消息、Web 重载后重新接管 |
| `server/interactions.ts`、`pi-questions.ts` | 原生提问／授权归一化，Pi ask_user 工具 |
| `server/agent-turn.ts` | Codex／Pi 的统一参数与回调契约 |
| `server/codex.ts` | 单轮 app-server JSONL；续接原生 threadId |
| `server/pi.ts` | 单轮 Pi RPC 进程；续接原生 session 文件 |
| `server/models.ts`、`agents.ts` | 模型目录缓存、CLI 默认模型与安装探测 |
| `server/views.ts` | 侧栏摘要、当前会话最近 20 条、活动输出裁剪 |
| `server/insights.ts`、`native-usage.ts` | 用量聚合、Codex 原生日志的历史每日用量恢复 |
| `server/command-programs.ts` | 只解析命令名以生成统计，不执行命令 |
| `server/im/manager.ts`、`store.ts` | 渠道生命周期、入站去重、绑定和出站队列 |
| `server/im/{qq,weixin,telegram}.ts` | 三个官方协议适配 |
| `server/im/{api,login,http,text,types}.ts` | 配置／扫码 API、HTTP、分段和协议类型 |
| `tests/fixtures/demo.ts` | 浏览器回归使用的示例项目和会话；生产工作台从空数据开始 |

`shared/workspace.ts` 定义 Desk、Session、Message、ActivityEntry、QueuedMessage。`shared/activities.ts` 从原生 patch 统计增删。IM 和洞察有各自的共享类型文件。

## 一次发送的生命周期

1. Composer 读取草稿与附件；`api/desk.ts` 编码上传。
2. HTTP 保存附件和队列；IM 从另一入口调用相同 `enqueueMessage`，入站去重与入队原子持久化。
3. `startNext` 检查目录／附件，`beginQueuedTurn` 取出一条，保存用户消息、助手占位和 running 状态。
4. 运行器发送模型、权限、原生会话标识。跨运行器时清除旧标识，通过已保存的文字历史建立新原生会话；历史附件不会自动完整重放。
5. 事件约每 100ms 合并到运行器快照，Web 约每 120ms 读取变化、增量保存消息，SSE 下发每个浏览器所选的视图。结束时原子保存最终消息和 IM 投递任务，再启动下一条。
6. 停止会中断本轮并暂停队列。用户显式补充时，同一模型、权限等配置相容且 CLI 可接收的消息走原生 steer；worker 确认接收后才将它移出队列，拒收则保留到下一轮。
7. Web 重启后依据消息的 runId 重新订阅同一运行器快照，worker 启动中时会等待首份快照，继续原进程与待回答请求；如果运行器已结束，补写最后结果。旧版任务或运行器确实丢失时标记中断／错误、暂停队列，不自动重新执行。

原生进程按轮由独立 worker 启动，不是终端与 Web 同时操作同一原生进程。生产使用用户级 systemd transient service（THINDESK_RUN_LAUNCHER=systemd）；测试使用 detached 子进程。原子快照和控制消息保存在数据目录 runs/<runId>/；当前没有自动清理历史运行快照的策略，按轮保留以便恢复。JSONL 必须仅按 LF 分帧，不能使用会切分 U+2028／U+2029 的 readline。

## 前端边界

- `app/main.tsx`：页面／会话装配、请求和 SSE 状态合并。
- `features/workspace/`：Projects／Recent、现有项目选择、会话菜单。
- `features/composer/`：输入、权限、模型、命令和逐模型思考强度；`components/assistant-ui/elements/message-queue.tsx` 采用官方 Message Queue 的编号列表和队列原语，连接持久队列的补充、取消和恢复操作。
- `conversation/AssistantProvider.tsx`：ExternalStoreRuntime、草稿、附件、模型和队列适配。
- `Thread.tsx`：历史分页、上下文显示、自动滚动与手动上翻。
- `TranscriptMessage.tsx`：消息、操作、错误与恢复入口。`AgentRequests.tsx` 在折叠区外展示 QuestionFlow 和授权卡，向 respond 操作回传，完成回执由服务端请求状态决定。
- `Activity.tsx`：RunActivity 和执行时间线。`ToolOutput.tsx`：按需获取日志和 patch，复用 TerminalBlock／CodeDiff。
- `TurnChanges.tsx`：用 assistant-ui File Tree 按目录展示本轮有原生差异的文件，文件行与标题显示累计增删，目录可折叠，位于活动折叠区外。点击文件、时间线文件标签或修改工具记录后，DiffDrawer 在右侧用 CodeDiff 展示原生差异，手机上占满可用宽度。同一文件的多次修改按顺序保留。文档预览与差异共用 RightDrawer。
- `features/insights/`：摘要接口、图表、筛选、估算价格和单会话详情。
- `features/panels/`：附件预览、个人助手 IM、任务配置和实验界面。`DocumentPreview.tsx` 在应用顶层提供统一文件链接处理和右侧阅读抽屉；聊天正文、过程 Markdown 共用 FileLink，抽屉内相对链接以当前文件目录解析。

保持一份生产界面；测试数据从 API／运行器协议边界进入，不建立另一份展示页面。官方 Elements 位于 `components/assistant-ui/elements/`，共享 tokens 来自 surfaces.tsx，通用基础交互采用 Radix。

## 存储和 API

SQLite：`~/.local/share/thindesk/workspace.sqlite`。`desks` 的 `personal` 行保存小型元数据及会话顺序（storageVersion=2）；`desk_sessions` 保存不含消息的会话信息，`desk_messages` 保存带顺序的独立消息；`files` 保存上传 BLOB；IM 使用 `im_bots`、`im_routes`、`im_inbox`、`im_cursors`、`im_outbox`。

| 接口 | 用途 |
| --- | --- |
| `GET/POST /api/desk` | 工作台读写；浏览器附带 `view=workspace&session=<id>` |
| `GET /api/desk/events` | SSE；相同参数选择侧栏摘要和当前会话 |
| `GET /api/sessions/<id>?before=<message-id>` | 更早消息分页，每页 20 条 |
| `GET /api/sessions/<id>?view=full` | 完整会话，导出等显式操作使用 |
| `GET /api/sessions/<id>/messages/<message-id>` | 指定消息的日志和 diff 正文 |
| `GET /api/files/<id>` | 上传附件 |
| `GET /api/local-file?path=...&base=...` | 只读文本预览；可选 base 是当前文档完整路径，用于相对链接解析；支持路径行号后缀，不做源文件编辑 |
| `GET /api/models`、`/api/agents` | 运行器目录和安装信息 |
| `GET /api/model-capabilities?agent=...&model=...` | 当前模型支持的真实思考档位 |
| `GET /api/search` | 全文搜索匹配的会话 ID |
| `GET /api/insights` | 统计摘要，异步补充原生日志用量 |
| `/api/im` 及子路径 | 个人助手渠道配置、连接、扫码和原聊天投递重试 |

服务端会话和执行状态是事实来源；焦点、滚动、面板开合、草稿与部分偏好属于浏览器。侧栏和 SSE 不发送完整消息／日志。消息行增量保存，新增消息不重写旧正文。会话摘要按版本缓存。服务启动仍会将历史记录读入内存，初次迁移／统计／全文导出也可能处理完整历史；超大数据规模下一步应按数据库分页／检索继续下推，而不是承诺无限历史都无成本。


## 原生交互与配置

ThinDesk 启动 Codex app-server 的进程参数启用 `features.multi_agent_v2`。`server/codex-subagents.ts` 将父线程的 `collabAgentToolCall` 与 `subAgentActivity` 按子线程 ID 归并到本轮 activity，区分派发状态和子线程结果。模型和强度分别保留请求值与实际值。工作台流只发卡片摘要，展开时从单条消息接口读取完整委托和结果。重新打开会话沿用同一份持久化记录。

Codex 的 requestUserInput、命令／文件／权限审批请求映射到 AgentRequest。restricted 模式采用 on-request，完全权限保持 never；显式权限申请仍由协议决定。为使默认模式可主动提问，运行器启用本机 CLI 的 features.default_mode_request_user_input。Pi 加载项目内 ask_user 扩展，转发 select／input／editor／confirm；Pi 原生并无与 Codex 完全相同的沙箱审批体系，不模拟一个。

worker 持有请求响应回调；浏览器只提交请求 ID 与答案／决定，服务端检查请求仍 pending，取消或超时不再可答。原生提问与审批按 runId 和请求 ID 原子认领第一次答复，重复提交返回 409。worker 消费后清空答复文件，只留下认领标记；密码答案不写进回执。Web 关闭不取消请求。worker 本身被杀、机器重启、部署或数据库等外部副作用无法靠快照重放，系统保留历史并提示手动继续。

Codex 直接使用模型目录中的 supportedReasoningEfforts；Pi 在指定模型的无会话 RPC 查询 get_available_thinking_levels。界面不猜模型能力、不编造 Token 预算。Codex 的 config/read 与 model/list 提供默认设置和可选档位。Codex 会话响应以及 Pi get_state 提供本轮生效值，worker 快照将它们回传到会话。工作台 lastSelection 用 runId 关联最近一次启动，较早运行的迟到回执只更新其自身会话。用户在菜单中的临时选择只用于下一次发送。CLI 默认不发送强度覆盖值；显式选择在提交前校验并传入 Codex effort 或 Pi --thinking。新模型选择清除旧模型档位，队列保留各自的模型／档位配置。
