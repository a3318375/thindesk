export const review = {
  folders: ["/example"],
  workspaces: ["/example"],
  jobs: [],
  sessions: [
    {
      id: "review",
      workspace: "/example",
      title: "检查变更",
      running: true,
      messages: [
        { id: "one", role: "user", text: "检查这段代码" },
        {
          id: "two",
          role: "assistant",
          text: "**检查结果**\n\n| 项目 | 状态 |\n| --- | --- |\n| 构建 | 通过 |\n\n```js\nconst ready = true;\n```\n\n$1 + 1 = 2$",
          reasoning: "比较实现与接口约定。",
          command: "git status --short",
          approval: "pending",
        },
      ],
    },
  ],
};
