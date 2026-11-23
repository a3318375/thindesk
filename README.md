# ThinDesk

运行在个人服务器上的 Agent Web 工作台：浏览器通过同源 HTTP API 和 SSE 连接 Node 服务，由独立运行器调用 Codex app-server 或 Pi RPC，Web 服务可重新接管运行中的任务。界面使用 React 19、assistant-ui、Radix、Lucide；构建使用 Vite，数据按会话和消息分别保存到 SQLite。

## 新会话从这里开始

1. [AGENTS.md](AGENTS.md)：产品边界、开发要求和重载注意事项。
2. [架构与代码地图](docs/architecture.md)：请求、队列、运行器、存储和界面的关系。
3. [接手状态与验证方法](docs/handoff.md)：真实能力、未完成项、运行和排障。
4. [代码审查记录](docs/review.md)：此次修复、验证依据与结构性风险。

ThinDesk 面向个人内网，没有登录或租户划分。本地默认入口为 `http://127.0.0.1:3781/`。

## 本地开发

要求 Node.js 24。首次安装：

```bash
npm ci
npm run build
npm start
```

默认监听 `127.0.0.1:3781`，数据目录为 `~/.local/share/thindesk/`。用 `HOST`、`PORT`、`THINDESK_DATA` 修改。开发用 `npm run dev` 启动 Vite；Vite 默认代理 `127.0.0.1:3781`，生产只绑定 LAN 地址时需另启本地后端。测试会启动独立临时后端，不需要生产 CLI 或真实机器人凭据。

```bash
npm test
npm run test:visual
```

视觉检查访问当前运行实例，支持 `THINDESK_URL`、`VISUAL_OUTPUT`。不要为测试重置生产数据库。不要在当前 Agent 属于生产服务 cgroup 时直接重启服务，详见 AGENTS.md。

## 能力概览

- Codex／Pi 实际发送、原生会话续聊、异步模型目录、停止、重试、继续、持久化追加问题队列。
- Codex 会话支持原生子代理委托，按子线程展示任务、状态和结果。网页和 IM 会话按创建来源显示图标。
- QuestionFlow 接收真实 Agent 提问；原生授权请求可允许或拒绝，刷新和 Web 服务重载后仍能回答。
- 输入框显示会话模型和思考强度，新聊天沿用上一次运行配置。分段按钮按模型实际支持的档位排列，配置随消息入队。
- 项目名称＋目录、最近会话、折叠分组、重命名、复制、归档、删除和跨标签页更新。
- Markdown、公式、代码、图片和文件附件；历史分页、日志与 diff 按需读取。
- 消息中的服务器文件链接在右侧抽屉阅读，支持 Markdown 文档相对链接、返回和代码预览；外部网址保持普通链接。
- 官方 RunActivity、ToolTimeline、TerminalBlock、AgentPlan、CodeDiff 等组件展示实际事件。
- 每轮原生文件差异汇总：Codex fileChange、Pi edit patch；多次修改按记录累计，不承诺覆盖 shell／write 改动，不提供撤销。
- 实际 Token 与缓存统计、逐日用量恢复、完整洞察页面；费用须手工配置价格，属于估算。
- 个人助手在「新聊天」和「设置」之间。QQ、微信 iLink、Telegram 和网页共享同一会话；网页显示全部，最终回答只投递到该轮提问的原聊天。

定时任务执行、真实项目文件浏览和 Git 操作尚未接通，当前不扩展 IDE 能力。右侧文件面板当前浏览上传附件。具体测试边界见接手文档。

## 目录

| 目录 | 用途 |
| --- | --- |
| `web/src/app/` | 应用装配、页面状态、语言 |
| `web/src/features/` | 项目、输入、对话、设置、面板与洞察 |
| `web/src/components/` | 共享控件、assistant-ui Elements、附件适配 |
| `server/` | HTTP／SSE、SQLite、持久队列和 CLI 适配 |
| `server/im/` | 官方消息渠道、扫码、去重和投递 |
| `shared/` | 浏览器／服务端模型和纯函数 |
| `tests/` | 本地协议替身、浏览器回归和视觉检查 |
| `docs/` | 架构、接手信息和审查结果 |
| `dist/`、`node_modules/` | 可重新生成的构建产物和依赖 |

渠道 SVG 来自 Simple Icons（CC0），许可在 `web/src/assets/channels/brands/LICENSE.md`；assistant-ui Elements 保留上游 MIT 许可。项目没有 DSH 或 Lobe UI 运行依赖。
