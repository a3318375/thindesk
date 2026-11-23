import { randomUUID } from "node:crypto";
import type { Desk, Session } from "../../shared/workspace.ts";

// All measurements belong to the scripted conversations below.
const projects = [
  {
    name: "示例 · ThinDesk",
    topics: [
      [
        "复核微信按钮的悬停状态",
        "选中微信渠道，把指针移到生成二维码按钮。",
        "按钮保持蓝底白字，移开后尺寸和位置不变。",
      ],
      [
        "侧栏在手机上的展开与关闭",
        "检查窄屏下工作区抽屉的操作顺序。",
        "从左上角打开侧栏，选中会话后抽屉会收起。",
      ],
      [
        "检查会话搜索结果",
        "用标题中的一个词搜索历史讨论。",
        "搜索命中较早的会话，打开后能看到完整讨论。",
      ],
      [
        "整理插件管理入口",
        "精简插件管理，只保留能切换的项目。",
        "安装列表保留各项目的说明和独立开关。",
      ],
      [
        "核对最近活动排序",
        "记录点击文件夹后的会话顺序。",
        "最近更新的会话位于最上方，较早的会话可以继续展开。",
      ],
      [
        "附件预览回归",
        "校验上传的文本在右侧栏能否正常读取。",
        "预览换行与原文相同，下载文件能完整读回。",
      ],
      [
        "对齐暗色主题",
        "检查深色模式下输入框和提示文本的对比度。",
        "正文和辅助文字分别使用主题前景色，切换主题后均可读。",
      ],
      [
        "键盘操作检查",
        "验证 Escape 能否逐层关闭弹窗。",
        "内层弹窗先关闭，焦点返回打开它的控件。",
      ],
      [
        "中文输入法回归",
        "用输入法确认候选词，然后继续输入。",
        "确认候选时未提前发送；再次按 Enter 后消息正常出现。",
      ],
      [
        "整理首次部署记录",
        "记录从构建到打开工作台的步骤。",
        "已记下服务端口、启动方式与数据目录。",
      ],
      [
        "首次布局评审",
        "整理初版工作台的布局检查项。",
        "保留侧栏、主会话区和文件预览区的独立尺寸。",
      ],
      [
        "旧版图标核查",
        "保留一份图标对照记录供追溯。",
        "图标差异已复核，这段讨论可以归档。",
      ],
    ],
  },
  {
    name: "示例 · 项目文档",
    topics: [
      [
        "补齐快速开始",
        "首次打开项目最需要哪些说明？",
        "入口、目录结构和运行方法已整理到快速开始。",
      ],
      [
        "统一术语",
        "检查工作区和会话两个词的使用。",
        "工作区表示项目目录，会话表示该目录下的一段讨论。",
      ],
      [
        "准备发布清单",
        "列出发布前要看的几个画面。",
        "检查桌面、移动端、已展开的工作区和空列表状态。",
      ],
    ],
  },
];
function addProjects(desk: Desk, now: number) {
  for (const [projectIndex, project] of projects.entries()) {
    let path = "/" + project.name;
    while (desk.folders.includes(path) || desk.workspaces.includes(path))
      path += "（示例）";
    desk.folders.push(path);
    desk.workspaces.push(path);
    project.topics.forEach(([title, request, reply], i) => {
      const dayOffset = (
        projectIndex ? [0, 4, 9] : [0, 1, 2, 3, 4, 5, 6, 8, 12, 18, 41, 48]
      )[i];
      const updatedAt =
        now - dayOffset * 86400000 - (i + projectIndex * 3) * 60000;
      const command = ["npm run build", "npm test", "git diff --stat"][i % 3];
      const session: Session = {
        id: randomUUID(),
        workspace: path,
        title,
        updatedAt,
        archived: !projectIndex && i === 11,
        messages: [
          {
            id: randomUUID(),
            role: "user",
            createdAt: updatedAt - (20 + i * 5) * 1000,
            text: request,
          },
          {
            id: randomUUID(),
            role: "assistant",
            createdAt: updatedAt,
            reasoning: "先检查项目中与本次问题相关的文件和已有回归记录。",
            command,
            text: reply,
          },
        ],
        sampleUsage: {
          tokens: [
            410,
            55 + i * 3,
            92,
            160 + i * 35,
            160,
            48 + i * 41,
            60,
            115 + i * 13,
          ],
          seconds: [4 + i, 8 + i * 2, 3 + i, 2 + i, 1, 2],
          cached: 225 + i * 13,
          costUSD: (i + 2) * 0.0009,
          skill: i % 2 ? "界面复核" : "项目检查",
        },
      };
      desk.sessions.push(session);
    });
  }
}
function addChannelExample(desk: Desk, now: number) {
  const workspace = desk.sessions.find(
    (session) => session.sampleUsage,
  )?.workspace;
  if (workspace)
    desk.sessions.unshift({
      id: randomUUID(),
      workspace,
      title: "确认是否为 Codex",
      channel: "QQ",
      updatedAt: now,
      messages: [
        {
          id: randomUUID(),
          role: "user",
          createdAt: now - 7000,
          text: "你现在是 codex 吗",
        },
        {
          id: randomUUID(),
          role: "assistant",
          createdAt: now,
          reasoning:
            "消息来源：QQ。  \n会话标题：确认是否为 Codex。\n\n工作区记录：侧栏使用渠道图标，页头保留 QQ 前缀。  \n展示内容：链接、行内命令和用量均可在当前回答中查看。\n\n工具调用：无。",
          text: "这里是 ThinDesk 的 **QQ 渠道示例会话**。可以在 [ThinDesk 工作台](/) 查看项目，点开上方的工作步骤查看这次示例的分析记录。\n\nCodex CLI 是服务器上的独立程序。它的默认配置目录是 `~/.codex`，版本可以在「设置 → Agent 设置」中查看。",
        },
      ],
      sampleUsage: {
        tokens: [410, 50, 0, 160, 80, 20, 0, 120],
        seconds: [2, 3, 0, 2, 0, 0],
        cached: 225,
        costUSD: 0.001,
        skill: "",
      },
    });
}
const hoverNotes =
  "复核项目：微信接入按钮。\n\n在独立页面和设置弹窗内分别移入、移出按钮，观察背景色、文字颜色和按钮边界。\n\n对照记录：两处共用同一个按钮样式。";
const hoverReply =
  "在「IM 机器人 → 微信」中，移入**生成微信二维码**后，按钮保持蓝底白字，移开后尺寸和位置不变。示例中的蓝色为 `#1677ff`，文字颜色为 `#fff`。\n\n从[工作台](/)左下角打开设置，再进入「IM 机器人」也能看到同一个按钮。独立页与设置弹窗的可用宽度不同，按钮的 `hover` 状态和圆角一致。";

export function addDemo(desk: Desk, now = Date.now()): Desk {
  addProjects(desk, now);
  addChannelExample(desk, now);
  const [title, request, oldReply] = projects[0].topics[0];
  for (const session of desk.sessions) {
    if (
      !session.sampleUsage ||
      session.title !== title ||
      session.messages[0]?.text !== request
    )
      continue;
    const reply = session.messages[1];
    if (reply?.role === "assistant" && reply.text === oldReply) {
      reply.text = hoverReply;
      if (
        reply.reasoning === "先检查项目中与本次问题相关的文件和已有回归记录。"
      )
        reply.reasoning = hoverNotes;
    }
  }
  desk.revision = (desk.revision || 0) + 1;
  return desk;
}
