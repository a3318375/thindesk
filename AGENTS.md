# ThinDesk 项目开发守则（Codex / Pi 共用）

ThinDesk 是**个人内网的 Agent 对话工作台**：用户在浏览器里围绕项目与 Codex 或 Pi 持续对话，查看真实执行过程和结果。开发这个仓库的 Agent 负责维护工作台；产品里的「个人助手」是另一个工作目录中的独立会话。本文件不是个人助手的人设，也不存放设备资料、个人偏好或账号配置。

先读 `README.md`，再读 `docs/architecture.md`、`docs/handoff.md`。最近一次审查记录见 `docs/review.md`。以代码和现场状态为准；不要把历史聊天中的“已完成”当作验证结果。

## 产品约定

- 围绕「发消息 → 执行 → 必要时提问或授权 → 看结果 → 续聊」设计。不加登录、多租户或访客隔离；保留文件预览和本轮 diff，不把工作台扩成文件编辑器、Git 客户端或通用运维面板。
- CLI 负责模型调用、工具执行、原生会话和上下文压缩；ThinDesk 负责选择运行器、持久排队、转交请求和展示真实回执。不要为了两个 CLI 看起来一致而虚构能力。
- 切换 Codex／Pi 按消息生效，不改变所在项目或网页会话。同一运行器续用原生会话；跨运行器用已保存的对话正文建立新的原生会话，不承诺转移工具状态或重放旧附件。
- 当前 UI 使用 assistant-ui + Radix + Lucide。DSH 模仿阶段已经结束，不再引入 DSH、Lobe UI 或其插件运行依赖。
- 保持目前项目／最近会话、输入框权限在左、模型在右的布局。优先复用现有官方 Elements 和主题 tokens。
- 只展示运行器实际提供的文件差异；Pi 不安装 diff 插件，不提供未经实现的撤销操作。
- 个人助手入口在「新聊天」下、「设置」上；专用工作目录不登记为编程项目。设置里的 IM 只服务个人助手。Web、QQ、微信和 Telegram 共用一份会话；Web 可见全部，IM 回复只投递给该轮提问的原聊天，网页提问不广播。
- 普通开发用本地渠道替身。QQ 联调暂停，微信暂不测试；未经用户明确要求，不连接、改绑或发送真实 IM 消息。

## 开发约定

- `server/` 是后台执行、持久化和平台适配；`web/src/features/` 按功能组织；`shared/` 保留通信模型和纯函数。
- CLI 由独立 worker 执行（managed-run.ts／turn-worker.ts），Web 重载应重新接管同一 runId；不要退回到杀任务再假恢复。
- 浏览器不能直接控制 CLI。Web 和 IM 必须共用 `enqueueMessage` 与服务端持久队列。
- 工作台已迁移到元数据／会话／消息分表（DeskStore）；禁止重新全量读写整个历史 JSON。DeskStore 返回变更跟踪代理，需要复制时使用 JSON 序列化，不对代理调用 structuredClone。旧版数据库由存储层迁移，升级前备份。
- 运行日志和 diff 继续按需读取；不得让输入框变更重新解析全部历史，不得在侧栏加载完整聊天。
- 不保留空目录、废弃组件、重复实现或没有后端能力的假成功提示。原生事件适配的修改应有协议测试。
- TypeScript 直接由 Node 24 运行，保持 erasable syntax（禁止构造函数参数属性等需要转译的语法）。
- 验证：`npm run build`；按改动运行 `node --test --test-name-pattern='…' tests/e2e/workbench.test.mjs` 或对应测试文件。跨运行器／队列／数据模型修改运行 `npm test`。
- 完成后更新受影响的文档，区分构建通过、本地替身通过、真实平台通过。

## 运行与数据

- 本机部署入口见本地 `.local/deployment.md`，服务 `thindesk.service`。数据在 `~/.local/share/thindesk/`，不在项目内。
- **当前开发 Agent 可能就在 thindesk.service 的 cgroup 中。重启会终止自己。** 先看 `/proc/self/cgroup`；如果属于该服务，使用独立 systemd transient worker，等当前回答及其他任务结束、可执行队列清空后再重载，并记录 HTTP 检查结果。不要用同一 cgroup 下的 nohup 代替。
- 常规检查只输出字段白名单，不打印机器人凭据、配置全文或 cc-connect 管理状态原文。
- 系统／设备运维先按本机运维手册的入口和对应页面核对；手册仓库未经用户授权不得修改、commit 或 push。
- Git 提交前检查暂存区，排除本机部署信息、运行记录和凭据。
