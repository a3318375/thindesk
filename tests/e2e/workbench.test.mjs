import { addDemo } from "../fixtures/demo.ts";
import { readStoredDesk } from "../../server/desk-store.ts";
import { openWorkbench } from "../navigation.mjs";
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { launchBrowser } from "../browser.mjs";
import { review } from "../fixtures/conversation.mjs";

let browser, server, root, url;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "thindesk-e2e-"));
  server = spawn(process.execPath, ["server/index.ts"], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", THINDESK_RUN_LAUNCHER: "process", CODEX_HOME: join(root,"codex-config"), PI_CODING_AGENT_DIR: join(root,"pi-config"), THINDESK_DATA: root, THINDESK_CODEX: resolve("tests/fixtures/codex.mjs"), THINDESK_PI: resolve("tests/fixtures/pi.mjs") },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [message] = await Promise.race([
    once(server.stdout, "data"),
    once(server, "exit").then(() => {
      throw Error("测试服务器启动失败");
    }),
  ]);
  url = String(message).trim();
  browser = await launchBrowser();
});
let initial;
beforeEach(async()=>{
  const db=new DatabaseSync(join(root,"workspace.sqlite"));
  try {
    initial??=JSON.stringify(addDemo(readStoredDesk(db)));
    db.prepare("UPDATE desks SET body=? WHERE id='personal'").run(initial);
  } finally {db.close();}
});
after(async () => {
  await browser?.close();
  if (server?.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  if (root) await rm(root, { recursive: true, force: true });
});

test("网页委托写入草稿，子代理结果独立展示，刷新保留来源和任务卡", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(url);
    await page.getByRole("button", { name: "创建项目", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "项目名称" }).fill("委托验证");
    await dialog.getByRole("textbox", { name: "服务器目录" }).fill(join(root, "delegation"));
    await dialog.getByRole("button", { name: "创建项目", exact: true }).click();
    const composer = page.getByRole("textbox", { name: "消息" });
    await composer.fill("/delegate");
    await composer.press("Enter");
    await dialog.getByRole("textbox", { name: "委托任务" }).fill("模拟子代理委托");
    await dialog.getByRole("button", { name: "放入输入框" }).click();
    assert.match(await composer.inputValue(), /模拟子代理委托/);
    assert.equal(await page.locator("[data-slot=task-card]").count(), 0);
    await page.getByRole("button", { name: "发送消息" }).click();
    for (const reload of [false, true]) {
      if (reload) await page.reload();
      await page.getByText("主线程汇总完毕", { exact: true }).waitFor();
      await page.locator('.sessionRow [data-channel="web"]').first().waitFor();
      const card = page.locator("[data-slot=task-card][data-state=done]");
      const toggle = card.getByRole("button");
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      await card.getByText("test-fast", { exact: true }).waitFor();
      await toggle.click();
      await card.getByText("子线程独立报告", { exact: true }).waitFor();
    }
  } finally {
    await ctx.close();
  }
});

test("创建目录和会话，中文输入，刷新恢复，另一标签页收到更新", async () => {
  const ctx = await browser.newContext({ locale: "zh-CN" });
  try {
    const p = await ctx.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(url);
    await p
      .getByRole("button", { name: "创建项目", exact: true })
      .first()
      .click();
    const dialog = p.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "项目名称" }).fill("测试项目");
    await dialog.getByRole("textbox", {name:"服务器目录"}).fill(join(root,"测试"));
    await dialog.getByRole("button", { name: "创建项目", exact: true }).click();
    const input = p.getByRole("textbox", { name: "消息" });
    await input.fill("第一行");
    await input.press("Shift+Enter");
    await input.pressSequentially("second");
    await input.dispatchEvent("keydown", {
      key: "Enter",
      code: "Enter",
      isComposing: true,
    });
    assert.equal(await input.inputValue(), "第一行\nsecond");
    await input.press("Enter");
    await p.locator(".bubble").waitFor();
    assert.equal(await p.locator(".bubble").innerText(), "第一行\nsecond");
    const href = p.url();
    await p.reload();
    await p.locator(".bubble").waitFor();
    assert.equal(p.url(), href);
    const second = await ctx.newPage();
    await second.goto(href);
    await second.locator(".bubble").waitFor();
    await p.getByRole("button", {name:"发送消息"}).waitFor();
    await p.getByRole("textbox", { name: "消息" }).fill("同步");
    await p.getByRole("button", { name: "发送消息" }).click();
    await second.locator(".bubble").filter({ hasText: "同步" }).waitFor();
    const contents = "第一段\nsecond line";
    await p.locator('input[type="file"]').setInputFiles({
      name: "记录.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(contents),
    });
    await p.getByRole("button", { name: "发送消息" }).click();
    const link = second.getByRole("link", { name: "下载 记录.txt" });
    await link.waitFor();
    const fileUrl = url + (await link.getAttribute("href"));
    const response = await ctx.request.get(fileUrl);
    assert.equal(await response.text(), contents);
    const other = await browser.newContext();
    try {
      assert.equal((await other.request.get(fileUrl)).status(), 200);
    } finally {
      await other.close();
    }
    await p.getByRole("button", { name: "打开右侧边栏" }).click();
    await p.getByRole("button", { name: /工作区文件/ }).click();
    const inspector = p.getByRole("complementary", { name: "右侧边栏" });
    await inspector
      .getByRole("button", { name: "记录.txt", exact: true })
      .click();
    await inspector.locator("pre").filter({ hasText: "second line" }).waitFor();
    assert.equal(await inspector.locator("pre").textContent(), contents);
    await p.getByRole("button", { name: "收起右侧边栏" }).click();
    assert.deepEqual(errors, []);
  } finally {
    await ctx.close();
  }
});

test("移动侧栏、主题、弹窗焦点和任务表单", async () => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "zh-CN",
  });
  try {
    const p = await ctx.newPage();
    await p.goto(url);
    await p
      .getByRole("button", { name: "打开侧边栏", exact: true })
      .last()
      .click();
    await p.getByRole("button", { name: "设置", exact: true }).click();
    await p.getByRole("button", { name: "深色", exact: true }).click();
    assert.equal(await p.locator("html").getAttribute("data-theme"), "dark");
    await p.keyboard.press("Escape");
    await openWorkbench(p, "自动化任务");
    await p.getByRole("button", { name: "新建自动化任务" }).click();
    const d = p.getByRole("dialog");
    await d.getByLabel("自动化任务名称").fill("检查");
    await d.getByLabel("自动化任务内容").fill("检查工作区");
    await d.getByRole("button", { name: "创建", exact: true }).click();
    await p.getByRole("button", { name: /检查/ }).click();
    await p.getByRole("button", { name: "暂停", exact: true }).click();
    await p.getByRole("button", { name: "已暂停", exact: true }).click();
    await p.getByRole("button", { name: /检查/ }).waitFor();
  } finally {
    await ctx.close();
  }
});

test("正式会话页显示推理、工具输出、代码与公式，拒绝审批和停止状态可恢复", async () => {
  const ctx = await browser.newContext();
  try {
    await ctx.request.get(url + "/api/desk");
    const db = new DatabaseSync(join(root, "workspace.sqlite"));
    try {
      db.prepare("UPDATE desks SET body=? WHERE id=?").run(
        JSON.stringify(review),
        "personal",
      );
    } finally {
      db.close();
    }
    const p = await ctx.newPage();
    await p.goto(url + "/#review");
    await p.getByText("检查结果").waitFor();
    await p.locator(".markdown table").waitFor();
    await p.locator(".katex").waitFor();
    await p.getByRole("button", { name: "复制代码", exact: true }).click();
    await p.getByRole("button", { name: "复制代码", exact: true }).filter({ hasText: "已复制" }).waitFor();
    assert.equal(await p.locator('[data-slot="run-activity"] > [data-slot="collapsible"] > button').getAttribute("data-state"), "closed");
    await p.locator('[data-slot="run-activity"] > [data-slot="collapsible"] > button').click();
    await p.locator(".activityReasoning").getByText("比较实现与接口约定。").waitFor();
    if (!(await p.locator(".commandRecord pre").isVisible()))
      await p.getByText("终端", { exact: true }).click();
    await p.locator(".commandRecord pre").waitFor();
    await p.getByRole("button", { name: "拒绝", exact: true }).click();
    await p.getByText("已拒绝").waitFor();
    await p.getByRole("button", { name: "停止生成" }).click();
    await p.getByRole("button", { name: "发送消息" }).waitFor();
    await p.reload();
    await p.getByText("已拒绝").waitFor();
  } finally {
    await ctx.close();
  }
});

test("IM 配置在新入口中保存，Agent 信息可见，界面语言刷新后仍保留", async () => {
  const ctx = await browser.newContext({ locale: "zh-CN" });
  try {
    const page = await ctx.newPage();
    await page.goto(url);
    const channels = page.getByRole("navigation", { name: "主要导航" }).getByRole("button", {
      name: "IM机器人",
      exact: true,
    });
    await openWorkbench(page, "IM机器人");
    const dialog = page.getByRole("dialog", { name: "设置", exact: true });
    assert.equal(await channels.count(), 0);
    await dialog.getByRole("tab", { name: "Telegram" }).click();
    await dialog.getByLabel("Telegram 代理").fill("http://localhost:1");
    await dialog.getByRole("button", { name: "保存配置" }).click();
    await dialog.getByText("配置已保存", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await openWorkbench(page, "IM机器人");
    await dialog.getByRole("tab", { name: "Telegram" }).click();
    await dialog.getByLabel("Telegram 代理").waitFor();
    assert.equal(await dialog.getByLabel("Telegram 代理").inputValue(), "http://localhost:1");
    assert.equal(await dialog.getByRole("tab").count(), 3);
    assert.equal(
      await dialog.getByRole("button", { name: "模型", exact: true }).count(),
      0,
    );
    await dialog.getByRole("button", { name: "Agent 设置" }).click();
    await dialog.getByRole("heading", { name: "Codex CLI" }).waitFor();
    await dialog.getByRole("heading", { name: "Pi CLI" }).waitFor();
    await dialog
      .getByRole("button", { name: "通用设置", exact: true })
      .first()
      .click();
    await dialog.getByRole("button", { name: "中文", exact: true }).click();
    await page.getByRole("menuitem", { name: "English", exact: true }).click();
    await page.reload();
    await page.waitForFunction(() => document.documentElement.lang === "en");
    assert.equal(
      await page.getByRole("button", { name: "IM机器人", exact: true }).count(),
      0,
    );
  } finally {
    await ctx.close();
  }
});

test("项目示例展开五条、继续翻阅、打开旧会话、重新折叠；同一批数据进入洞察", async () => {
  const ctx = await browser.newContext({ locale: "zh-CN" });
  try {
    const p = await ctx.newPage();
    await p.goto(url);
    const project = p.getByRole("button", {
      name: "示例 · ThinDesk",
      exact: true,
    });
    await project.waitFor();
    const group = project.locator("../..");
    assert.equal(await group.locator(".sessionRow").count(), 5);
    await group.getByRole("button", { name: "展开其余 7 个会话" }).click();
    assert.equal(await group.locator(".sessionRow").count(), 10);
    await group.getByRole("button", { name: "展开其余 2 个会话" }).click();
    await group
      .getByRole("button", { name: "首次布局评审", exact: true })
      .click();
    await p
      .getByText("整理初版工作台的布局检查项。", { exact: true })
      .waitFor();
    await project.click();
    assert.equal(await group.locator(".sessionRow").count(), 0);
    await openWorkbench(p, "上下文洞察");
    await p.getByText("包含示例数据", { exact: true }).waitFor();
    const stats = p
      .getByText("全部会话", { exact: true })
      .locator("..")
      .locator("b");
    const all = await stats.textContent();
    await p.getByRole("button", { name: "今天", exact: true }).click();
    assert.ok(
      Number(await stats.textContent()) > 0 &&
        Number(await stats.textContent()) < Number(all),
    );
    await p.getByRole("button", { name: "全部", exact: true }).first().click();
    assert.equal(await stats.textContent(), "16");
    assert.ok(
      (await p
        .getByText("Token 消耗", { exact: true })
        .first()
        .locator("..")
        .locator("b")
        .innerText()) !== "—",
    );
    await p.reload();
    assert.equal(
      (await (await ctx.request.get(url + "/api/desk")).json()).sessions.filter(
        (s) => s.sampleUsage,
      ).length,
      16,
    );
  } finally {
    await ctx.close();
  }
});
test("设置移除工作台和插件管理；微信按钮悬停保持可读，弹窗和手机面板没有横向溢出", async () => {
  const ctx = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 900 },
  });
  try {
    const p = await ctx.newPage();
    await p.goto(url);
    await openWorkbench(p, "IM机器人");
    const dialog = p.getByRole("dialog", { name: "设置", exact: true });
    for (const name of ["工作台", "插件管理"])
      assert.equal(await dialog.getByRole("button", { name, exact: true }).count(), 0);
    const qr = dialog.getByRole("button", {
      name: "微信扫码登录",
      exact: true,
    });
    const contrast = () => qr.evaluate(element => {
      function luminance(color) {
        const [r,g,b] = color.match(/[0-9.]+/g).slice(0,3).map(Number).map(value => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126*r + 0.7152*g + 0.0722*b;
      }
      const style = getComputedStyle(element);
      const [low,high] = [style.color,style.backgroundColor].map(luminance).sort((a,b)=>a-b);
      return (high+0.05)/(low+0.05);
    });
    const initial = await qr.boundingBox();
    assert.ok(await contrast() >= 4.5);
    await qr.hover();
    await qr.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
    assert.ok(await contrast() >= 4.5);
    assert.equal((await qr.boundingBox()).width, initial.width);
    assert.equal(await qr.evaluate(e=>e.classList.contains("ui-button")), true);
    for (const width of [1440, 390]) {
      await p.setViewportSize({ width, height: 900 });
      const panel = dialog.getByRole("tabpanel", {
        name: "微信设置",
        exact: true,
      });
      assert.ok(
        await panel.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      );
      assert.ok(
        await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      );
      await dialog.getByRole("tab", { name: "Telegram", exact: true }).click();
      await dialog.getByLabel("Telegram Bot Token", { exact: true }).waitFor();
      await dialog.getByRole("tab", { name: "微信", exact: true }).click();
    }
  } finally {
    await ctx.close();
  }
});
test("参考视口下 IM 与洞察的布局，窄屏显示和时间范围偏好", async () => {
  const page = await browser.newPage({
    viewport: { width: 1912, height: 922 },
    locale: "zh-CN",
  });
  try {
    await page.goto(url);
    const button = (name) =>
      page.getByRole("button", { name, exact: true }).first();
    await openWorkbench(page, "IM机器人");
    const dialog = page.getByRole("dialog", { name: "设置" });
    const narrowCard = dialog.getByRole("tabpanel").locator("section").first();
    assert.ok((await narrowCard.boundingBox()).width >= 240);
    assert.equal(await dialog.getByRole("tab").count(), 3);
    await page.keyboard.press("Escape");
    await openWorkbench(page, "上下文洞察");
    const search = page.getByRole("textbox", { name: "搜索会话" });
    await search.scrollIntoViewIfNeeded();
    assert.ok(await search.isVisible());
    const entry = page
      .locator("main")
      .getByRole("button", { name: /复核微信按钮的悬停状态/ });
    assert.ok((await entry.boundingBox()).y > (await search.boundingBox()).y);
    await button("全部").click();
    await page.getByRole("combobox", { name: /归档筛选/ }).click();
    await page.getByRole("option",{name:"仅已归档",exact:true}).click();
    await page
      .locator("main")
      .getByRole("button", { name: /旧版图标核查/ })
      .click();
    await page.getByRole("dialog", { name: "旧版图标核查" }).waitFor();
    await page.keyboard.press("Escape");
    await button("统计设置").click();
    await page.getByRole("combobox", { name: /默认时间范围/ }).click();
    await page.getByRole("option",{name:"今天",exact:true}).click();
    await page.keyboard.press("Escape");
    await page.reload();
    await openWorkbench(page, "上下文洞察");
    assert.equal(await button("今天").getAttribute("aria-pressed"), "true");
    await page.setViewportSize({ width: 390, height: 844 });
    const dashboard = page.locator("main article");
    assert.ok(
      await dashboard.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    );
  } finally {
    await page.close();
  }
});
test("示例会话的时间、工作步骤、反馈和视图切换", async () => {
  const page = await browser.newPage({
    viewport: { width: 1912, height: 922 },
    locale: "zh-CN",
  });
  try {
    await page.goto(url);
    await page
      .getByRole("button", { name: "复核微信按钮的悬停状态", exact: true }).first()
      .click();
    const message = page.locator(".messages section").first();
    const frame = await message.boundingBox();
    assert.ok(frame.x > 280 && frame.width <= 980 && frame.width >= 800);
    assert.equal(await page.locator(".messages time").count(), 2);
    await page.locator('[data-slot="run-activity"] > [data-slot="collapsible"] > button').click();
    await page.getByText("终端", { exact: true }).click();
    await page.getByText("npm run build", { exact: true }).waitFor();
    const vote = page.getByRole("button", { name: "赞同回答", exact: true });
    await vote.click();
    await page.reload();
    assert.equal(await vote.getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "会话视图", exact: true }).click();
    await page.getByRole("menuitem", { name: "工具记录", exact: true }).click();
    assert.equal(await page.locator(".bubble").count(), 0);
    await page.getByRole("button", { name: "返回对话", exact: true }).click();
    await page.locator(".bubble").waitFor();
  } finally {
    await page.close();
  }
});

test("QQ 来源、统一活动折叠、指定轮次的上下文与分支", async () => {
  const page = await browser.newPage({
    viewport: { width: 1912, height: 922 },
    locale: "zh-CN",
  });
  try {
    await page.goto(url);
    const row = page.getByRole("button", {
      name: "确认是否为 Codex",
      exact: true,
    }).first();
    assert.equal(
      await row.locator(".sessionChannel").getAttribute("data-channel"),
      "QQ",
    );
    await row.click();
    await page
      .locator(".threadHead b")
      .filter({ hasText: "QQ · 确认是否为 Codex" })
      .waitFor();
    const summary = page.locator('[data-slot="run-activity"] > [data-slot="collapsible"] > button');
    assert.match(await summary.innerText(), /已完成.*7 秒/);
    assert.equal(await page.locator(".activityReasoning").count(), 0);
    await summary.click();
    await page.locator(".activityReasoning").getByText(/消息来源：QQ/).waitFor();
    assert.equal(await page.locator(".runSummary, .thoughtPreview, .analysisMarker").count(), 0);
    await summary.click();
    await page.locator(".activityReasoning").waitFor({ state: "hidden" });
    await page.locator(".assistantMessage .markdown").getByText(/这里是 ThinDesk/).waitFor();
    await summary.click();
    await page.locator(".activityReasoning").waitFor();
    const turnUsage = page.locator(".turnUsage");
    await turnUsage.locator("summary").click();
    await turnUsage.getByText(/本轮用量/).waitFor();
    await turnUsage.locator("summary").click();
    await page.getByRole("textbox", { name: "消息" }).fill("后一轮消息");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.locator(".bubble").filter({ hasText: "后一轮消息" }).waitFor();
    await page.getByRole("button", { name: "在上下文视图中查看此轮" }).first().click();
    assert.equal(
      await page
        .locator(".messages")
        .getByText("后一轮消息", { exact: true })
        .count(),
      0,
    );
    await page
      .locator(".messages")
      .getByText(/你现在是 codex 吗/)
      .waitFor();
    await page.getByRole("button", { name: "返回对话", exact: true }).click();
    await page.getByRole("button", { name: "复制到新会话" }).first().click();
    await page
      .locator(".threadHead b")
      .filter({ hasText: "确认是否为 Codex · 副本" })
      .waitFor();
    assert.equal(
      await page.locator(".threadHead b").textContent(),
      "网页 · 确认是否为 Codex · 副本",
    );
    assert.equal(await page.locator(".bubble").count(), 1);
    await openWorkbench(page, "上下文洞察");
    const card = page.getByText("Token 统计", { exact: true }).locator("../..");
    assert.equal(
      await card.locator("header [data-icon]").getAttribute("data-icon"),
      "database",
    );
    assert.equal(await card.locator("circle[stroke-dasharray]").count(), 4);
  } finally {
    await page.close();
  }
});
test("清空示例后刷新工作台不会生成项目或聊天", async () => {
  const db = new DatabaseSync(join(root, "workspace.sqlite"));
  try {
    db.prepare("UPDATE desks SET body=? WHERE id='personal'").run(
      JSON.stringify({ folders: [], workspaces: [], sessions: [], jobs: [], hasDemo: true })
    );
  } finally { db.close(); }
  for (let read = 0; read < 2; read++) {
    const desk = await (await fetch(url + "/api/desk")).json();
    assert.deepEqual(desk.workspaces, []);
    assert.deepEqual(desk.sessions, []);
  }
});

test("会话指令面板与输入框对齐，可筛选、选择权限和下载日志", async () => {
  const page = await browser.newPage({ viewport: { width: 1912, height: 922 } });
  try {
    await page.goto(url);
    await page.getByRole("button", { name: "确认是否为 Codex", exact: true }).first().click();
    await page.locator(".messages .bubble").waitFor();
    const add = page.getByRole("button", { name: "添加文件或调用指令" });
    const input = page.getByRole("textbox", { name: "消息" });
    await input.fill("保留草稿");
    await add.click();
    const list = page.getByRole("listbox", { name: "触发候选建议" });
    const card = await page.locator("[data-composer]").boundingBox();
    await list.waitFor();
    const menu = await page.locator(".commandMenu").boundingBox();
    assert.ok(Math.abs(menu.x - card.x) <= 1);
    assert.equal(menu.width, card.width);
    assert.ok(Math.abs(card.y - menu.y - menu.height - 4) <= 2);
    assert.equal(await list.getByRole("option").count(), 9);
    await input.press("ArrowDown");
    await input.press("Enter");
    assert.equal(await input.inputValue(), "/goal 保留草稿");
    await input.fill("/per");
    assert.equal(await list.getByRole("option").count(), 1);
    await list.locator('[role="option"][data-selected="true"]').waitFor();
    await input.press("Enter");
    await page.getByRole("menuitem", { name: "仅可查看" }).click();
    const access = page.getByRole("button", { name: "访问模式，当前：仅可查看" });
    await access.click();
    assert.equal(await page.getByRole("menu").getByRole("menuitem").count(), 3);
    await page.keyboard.press("Escape");
    await input.fill("/exp");
    await list.locator('[role="option"][data-selected="true"]').waitFor();
    const waitDownload = page.waitForEvent("download");
    await input.press("Enter");
    const downloaded = await waitDownload;
    assert.match(downloaded.suggestedFilename(), /\.zip$/);
    const { unzipSync, strFromU8 } = await import("fflate");
    const { readFile } = await import("node:fs/promises");
    const archive = unzipSync(await readFile(await downloaded.path()));
    assert.equal(JSON.parse(strFromU8(archive["session.json"])).title, "确认是否为 Codex");
    await page.setViewportSize({width: 390, height: 700});
    await add.click();
    const narrow = await list.boundingBox();
    assert.ok(narrow.x >= 0 && narrow.x + narrow.width <= 390 && narrow.y >= 0);
    await input.press("Escape");
    assert.equal(await list.count(), 0);
  } finally {
    await page.close();
  }
});

test("Codex 会话可中断、刷新、续聊，另一浏览器能看到回复", async () => {
  const ctx=await browser.newContext();
  const other=await browser.newContext();
  try {
    const page=await ctx.newPage();
    await page.goto(url);
    await page.getByRole("button",{name:"创建项目",exact:true}).click();
    const dialog=page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "项目名称" }).fill("测试项目");
    await dialog.getByRole("textbox",{name:"服务器目录"}).fill(join(root,"cli"));
    await dialog.getByRole("button",{name:"创建项目",exact:true}).click();
    await page.getByRole("textbox",{name:"消息"}).fill("等待停止测试");
    await page.getByRole("button",{name:"发送消息"}).click();
    await page.getByRole("button",{name:"停止生成"}).waitFor();
    const link=page.url(),sid=new URL(link).hash.slice(1);
    const desk=async()=> (await (await ctx.request.get(url+"/api/desk")).json()).sessions.find(s=>s.id===sid);
    await page.getByRole("button",{name:"停止生成"}).waitFor();
    // The native thread ID must survive stopping, even across a browser reload.
    for(let i=0;i<100 && !(await desk())?.codexThread;i++) await new Promise(r=>setTimeout(r,20));
    const thread=(await desk()).codexThread;
    assert.ok(thread);
    const busy=await ctx.request.post(url+"/api/desk",{headers:{origin:url},data:{action:"message",session:sid,workspace:join(root,"cli"),text:"重复发送",attachments:[]}});
    assert.equal(busy.status(),200);
    const pending=(await desk()).queue;
    assert.equal(pending.length,1);
    await ctx.request.post(url+"/api/desk",{headers:{origin:url},data:{action:"queue-remove",session:sid,id:pending[0].id}});
    await page.getByRole("button",{name:"停止生成"}).click();
    await page.getByText("已停止生成。",{exact:true}).waitFor();
    await page.reload();
    await page.getByRole("textbox",{name:"消息"}).fill("继续");
    await page.getByRole("button",{name:"发送消息"}).click();
    const second=await other.newPage();
    await second.goto(link);
    await second.locator(".messages .markdown").filter({hasText:"测试回复"}).waitFor();
    assert.equal((await desk()).codexThread,thread);
    await second.locator(".threadUsage").getByText(/1.5.*tok/).waitFor();
    assert.equal((await desk()).tokenUsage.total.totalTokens, 1500);
    await second.reload();
    await second.locator(".threadUsage").getByText("15%", { exact: true }).waitFor();
  }finally{await other.close();await ctx.close();}
});

test("粘贴截图后可只发图片，Codex 收到图片且刷新后附件保留", async () => {
  const page = await browser.newPage();
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  try {
    await page.goto(url);
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "项目名称" }).fill("测试项目");
    await dialog.getByRole("textbox", { name: "服务器目录" }).fill(join(root, "images"));
    await dialog.getByRole("button", { name: "创建项目", exact: true }).click();
    const input = page.getByRole("textbox", { name: "消息" });
    await input.evaluate((el, base64) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], "截图.png", { type: "image/png" }));
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, png);
    await page.getByRole("button", { name: "截图.png", exact: true }).waitFor();
    assert.equal(await input.inputValue(), "");
    await page.getByRole("button", { name: "发送消息" }).click();
    await page.getByText("已收到测试图片", { exact: true }).waitFor();
    await page.reload();
    const attachment = page.getByRole("link", { name: "下载 截图.png", exact: true });
    await attachment.waitFor();
    const response = await page.request.get(url + await attachment.getAttribute("href"));
    assert.deepEqual(await response.body(), Buffer.from(png, "base64"));
    await page.locator('[data-slot="message-attachments"]').getByRole("button").click();
    const preview = page.getByRole("dialog", { name: "预览 截图.png", exact: true });
    await preview.locator("img").waitFor();
    await page.waitForFunction(() => document.querySelector('[role="dialog"] img')?.naturalWidth === 1);
    await preview.getByRole("button", { name: "关闭预览", exact: true }).click();
  } finally {
    await page.close();
  }
});

test("长代码和终端输出限制在消息内，输入栏两端按钮居中对齐", async () => {
  const ctx = await browser.newContext();
  try {
    const fixture = structuredClone(review);
    fixture.sessions[0].messages[1].text += "\n\n```js\nconst long = '" + "x".repeat(3000) + "';\n```";
    fixture.sessions[0].messages[1].command += "\n" + "output".repeat(500);
    const db = new DatabaseSync(join(root, "workspace.sqlite"));
    try { db.prepare("UPDATE desks SET body=? WHERE id='personal'").run(JSON.stringify(fixture)); }
    finally { db.close(); }
    const page = await ctx.newPage();
    await page.goto(url + "/#review");
    await page.locator(".markdown pre").first().waitFor();
    assert.equal(await page.locator('[data-slot="run-activity"] > [data-slot="collapsible"] > button').getAttribute("data-state"), "closed");
    await page.locator('[data-slot="run-activity"] > [data-slot="collapsible"] > button').click();
    await page.getByText("终端", { exact: true }).click();
    await page.locator(".commandRecord pre").waitFor();
    for (const width of [1382, 390]) {
      await page.setViewportSize({ width, height: 790 });
      const dimensions = await page.evaluate(() => {
        const composer = document.querySelector("[data-composer]");
        const buttons = [...composer.querySelectorAll("button")];
        const first = buttons[0].getBoundingClientRect(), last = buttons.at(-1).getBoundingClientRect();
        const messages = document.querySelector(".messages");
        return { delta: Math.abs(first.y + first.height / 2 - last.y - last.height / 2),
          buttonWidthDelta: Math.abs(first.width - last.width),
          overflow: messages.scrollWidth - messages.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert.ok(dimensions.delta < 1, JSON.stringify(dimensions));
      assert.ok(dimensions.buttonWidthDelta < 1, JSON.stringify(dimensions));
      assert.ok(dimensions.overflow <= 1, JSON.stringify(dimensions));
      assert.ok(dimensions.pageOverflow <= 1, JSON.stringify(dimensions));
      const input = page.getByRole("textbox", { name: "消息" });
      for (const value of ["", "一行文字"]) {
        await input.fill(value);
        const size = await input.evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight }));
        assert.ok(size.content <= size.height + 1, JSON.stringify(size));
      }
      const shortHeight = await input.evaluate(el => el.clientHeight);
      await input.fill(Array(30).fill("多行文字").join("\n"));
      const longSize = await input.evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight }));
      assert.ok(longSize.height > shortHeight);
      assert.ok(longSize.content > longSize.height);
    }
  } finally { await ctx.close(); }
});


test("assistant-ui 发送失败后保留草稿和附件，可再次发送", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(url);
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page.getByRole("textbox", { name: "项目名称" }).fill("测试项目");
    await page.getByRole("textbox", { name: "服务器目录" }).fill(join(root, "retry"));
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page.route(/\/api\/desk(?:\?.*)?$/, async route => {
      if (route.request().method() === "POST" && route.request().postDataJSON().action === "message")
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "测试连接失败" }) });
      return route.continue();
    });
    const input = page.getByRole("textbox", { name: "消息" });
    await input.fill("需要保留的草稿");
    await page.locator('input[type="file"]').setInputFiles({ name: "待发送.txt", mimeType: "text/plain", buffer: Buffer.from("保留附件") });
    await page.getByRole("button", { name: "待发送.txt", exact: true }).waitFor();
    await page.getByRole("button", { name: "发送消息" }).click();
    await page.getByRole("status").filter({ hasText: "测试连接失败" }).waitFor();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="消息"]').value === "需要保留的草稿");
    await page.getByRole("button", { name: "待发送.txt", exact: true }).waitFor();
    await page.unroute(/\/api\/desk(?:\?.*)?$/);
    await page.getByRole("button", { name: "发送消息" }).click();
    await page.getByRole("link", { name: "下载 待发送.txt", exact: true }).waitFor();
    await page.getByText("测试回复", { exact: true }).waitFor();
  } finally { await ctx.close(); }
});


test("长会话只加载最近一页，终端按需请求，翻页与导出保留完整历史", async () => {
  const ctx = await browser.newContext();
  try {
    const fixture = structuredClone(review);
    const session = fixture.sessions[0];
    session.running = false;
    session.messages = Array.from({ length: 70 }, (_, index) => ({
      id: "history-" + index, role: index % 2 ? "assistant" : "user",
      text: "历史消息 " + index,
      ...(index % 2 ? { command: "npm run build\n" + "large output ".repeat(5000) } : {}),
    }));
    const db = new DatabaseSync(join(root, "workspace.sqlite"));
    try { db.prepare("UPDATE desks SET body=? WHERE id='personal'").run(JSON.stringify(fixture)); }
    finally { db.close(); }
    const page = await ctx.newPage();
    const requests = [];
    page.on("request", request => requests.push(request.url()));
    await page.goto(url + "/#review");
    await page.locator(".bubble").filter({ hasText: "历史消息 68" }).waitFor();
    assert.equal(await page.locator(".messages section").count(), 20);
    assert.equal(await page.locator(".commandRecord pre").count(), 0);
    const response = await ctx.request.get(url + "/api/desk?view=workspace&session=review");
    const projected = await response.json();
    const current = projected.sessions.find(item => item.id === "review");
    assert.equal(current.messageCount, 70);
    assert.equal(current.messageOffset, 50);
    assert.equal(current.messages.length, 20);
    assert.ok(current.messages.every(message => message.command === undefined));
    assert.ok(projected.sessions.filter(item => item.id !== "review").every(item => item.messages.length === 0));
    assert.ok((await response.body()).length < 30000);
    const before = requests.filter(path => /\/messages\//.test(path)).length;
    await page.getByRole("textbox", { name: "消息" }).fill("继续输入不重绘历史");
    assert.equal(requests.filter(path => /\/messages\//.test(path)).length, before);
    await page.locator(".messages").evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
    await page.getByRole("button", { name: "回到最新消息", exact: true }).click();
    await page.waitForFunction(() => { const element = document.querySelector(".messages"); return element.scrollHeight - element.scrollTop - element.clientHeight < 48; });
    const latest = page.locator(".messages section").last();
    await latest.locator('[data-slot="run-activity"] > [data-slot="collapsible"] > button').click();
    await latest.getByText("终端", { exact: true }).click();
    await latest.locator(".commandRecord pre").waitFor();
    assert.equal(requests.filter(path => /\/messages\//.test(path)).length, before + 1);
    let releaseHistory;
    const historyPending = new Promise(resolve => {
      void page.route(/\/api\/sessions\/review\?before=/, async route => {
        await new Promise(release => { releaseHistory = release; resolve(); });
        await route.continue();
      });
    });
    await page.getByRole("button", { name: "加载更早消息", exact: true }).click();
    await historyPending;
    const dbLive = new DatabaseSync(join(root, "workspace.sqlite"));
    try {
      const latest = JSON.parse(JSON.stringify(readStoredDesk(dbLive)));
      latest.sessions.find(item => item.id === "review").messages.push(
        { id: "history-70", role: "user", text: "翻页时的新消息" },
        { id: "history-71", role: "assistant", text: "翻页时的新回复" },
      );
      dbLive.prepare("UPDATE desks SET body=? WHERE id='personal'").run(JSON.stringify(latest));
    } finally { dbLive.close(); }
    const renamed = await ctx.request.post(url + "/api/desk", { headers: { origin: url }, data: { action: "rename", session: "review", name: "历史仍然保留" } });
    assert.equal(renamed.status(), 200);
    await page.locator(".threadHead b").filter({ hasText: "历史仍然保留" }).waitFor();
    releaseHistory();
    await page.locator(".bubble").filter({ hasText: "历史消息 30" }).waitFor();
    assert.equal(await page.locator(".messages section").count(), 42);
    await page.getByText("翻页时的新回复", { exact: true }).waitFor();
    const input = page.getByRole("textbox", { name: "消息" });
    await input.fill("/exp");
    const download = page.waitForEvent("download");
    await page.getByRole("option").filter({ hasText: "下载日志" }).click();
    const file = await download;
    const { readFile } = await import("node:fs/promises");
    const { unzipSync, strFromU8 } = await import("fflate");
    assert.equal(JSON.parse(strFromU8(unzipSync(await readFile(await file.path()))["session.json"])).messages.length, 72);
    await page.reload();
    await page.locator(".bubble").filter({ hasText: "翻页时的新消息" }).waitFor();
    assert.equal(await page.locator(".messages section").count(), 20);
  } finally { await ctx.close(); }
});

test("官方式附件缩略图可预览和单独删除，新聊天使用简洁导航", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(url);
    await page.getByRole("button", { name: "确认是否为 Codex", exact: true }).first().click();
    await page.locator(".bubble").waitFor();
    const border = await page.locator(".newChat").evaluate(element => ({ width: getComputedStyle(element).borderTopWidth, color: getComputedStyle(element).borderTopColor }));
    assert.equal(border.width, "0px");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    await page.locator('input[type="file"]').setInputFiles([{ name: "缩略图.png", mimeType: "image/png", buffer: png }, { name: "文档.txt", mimeType: "text/plain", buffer: Buffer.from("文字附件") }]);
    const tile = page.getByRole("button", { name: "缩略图.png", exact: true });
    await tile.locator("img").waitFor();
    assert.equal(Math.round((await tile.boundingBox()).width), 56);
    await tile.click();
    await page.getByRole("dialog", { name: "预览 缩略图.png" }).waitFor();
    await page.getByRole("button", { name: "关闭预览", exact: true }).click();
    await page.getByRole("button", { name: "移除 缩略图.png", exact: true }).click();
    assert.equal(await tile.count(), 0);
    await page.getByRole("button", { name: "文档.txt", exact: true }).waitFor();
    await page.getByRole("button", { name: "移除 文档.txt", exact: true }).click();
    assert.equal(await page.locator(".aui-attachment-root").count(), 0);
  } finally { await ctx.close(); }
});


test("两级模型菜单将选择传给 CLI，Codex 与 Pi 切换、续聊和停止均可用", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(url);
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page.getByRole("textbox", { name: "项目名称" }).fill("测试项目");
    await page.getByRole("textbox", { name: "服务器目录" }).fill(join(root, "models"));
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    async function choose(agent, model) {
      await page.getByRole("button", { name: /^选择运行器和模型/ }).click();
      await page.getByRole("menuitem", { name: agent, exact: true }).click();
      await page.getByRole("textbox", { name: "搜索 " + agent + " 模型" }).fill(model);
      await page.getByRole("menuitem", { name: model, exact: true }).click();
    }
    await choose("Codex", "test-fast");
    const input = page.getByRole("textbox", { name: "消息" });
    await input.fill("模型选择测试");
    await page.getByRole("button", { name: "发送消息" }).click();
    await page.getByText("测试回复 · test-fast", { exact: true }).waitFor();
    const id = new URL(page.url()).hash.slice(1);
    const state = async () => (await (await ctx.request.get(url + "/api/desk")).json()).sessions.find(item => item.id === id);
    assert.equal((await state()).model, "test-fast");
    const codexThread = (await state()).codexThread;
    assert.ok(codexThread);
    await choose("Pi", "test/pi-fast");
    await input.fill("切换 Pi 接着聊");
    await page.getByRole("button", { name: "发送消息" }).click();
    await page.getByText("Pi 测试回复 · test/pi-fast · 已带入历史", { exact: true }).waitFor();
    const piSession = (await state()).piSession;
    assert.ok(piSession);
    assert.equal((await state()).codexThread, undefined);
    await page.reload();
    await page.getByRole("button", { name: /选择运行器和模型，当前：Pi/ }).waitFor();
    await page.getByRole("textbox", { name: "消息" }).fill("继续 Pi");
    await page.getByRole("button", { name: "发送消息" }).click();
    await page.getByText("Pi 测试回复 · test/pi-fast · effort:low", { exact: true }).waitFor();
    assert.equal((await state()).piSession, piSession);
    assert.equal((await state()).tokenUsage.total.totalTokens, 350);
    await page.locator('input[type="file"]').setInputFiles({ name: "pi图片.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") });
    await page.getByRole("button", { name: "pi图片.png", exact: true }).waitFor();
    await page.getByRole("button", { name: "发送消息" }).click();
    await page.getByText("Pi 测试回复 · test/pi-fast · effort:low · 已收到图片", { exact: true }).waitFor();
    await page.getByRole("textbox", { name: "消息" }).fill("等待停止测试");
    await page.getByRole("button", { name: "发送消息" }).click();
    await page.getByRole("button", { name: "停止生成" }).click();
    await page.getByText("已停止生成。", { exact: true }).waitFor();
    await choose("Codex", "test-fast");
    await page.getByRole("textbox", { name: "消息" }).fill("回到 Codex");
    await page.getByRole("button", { name: "发送消息" }).click();
    await page.getByText("测试回复 · test-fast · 已带入 Pi 历史", { exact: true }).waitFor();
    assert.notEqual((await state()).codexThread, codexThread);
    assert.equal((await state()).piSession, undefined);
  } finally { await ctx.close(); }
});


test("追加问题刷新保留、跨标签页同步，原生补充不打断当前回复", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(url);
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page.getByRole("textbox", { name: "项目名称" }).fill("测试项目");
    await page.getByRole("textbox", { name: "服务器目录" }).fill(join(root, "queue"));
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    const input = page.getByRole("textbox", { name: "消息" });
    await input.fill("等待停止测试");
    await input.press("Enter");
    await page.getByRole("button", { name: "停止生成" }).waitFor();
    const href = page.url();
    await input.fill("排队第一问");
    await input.press("Enter");
    const queue = page.getByRole("region", { name: "待发送的追加问题" });
    await queue.getByText("排队第一问", { exact: true }).waitFor();
    await input.fill("排队第二问");
    await page.getByRole("button", { name: "追加提问", exact: true }).click();
    await queue.getByText("排队第二问", { exact: true }).waitFor();
    await page.reload();
    await queue.getByText("排队第二问", { exact: true }).waitFor();
    const second = await ctx.newPage();
    await second.goto(href);
    await second.getByText("排队第一问", { exact: true }).waitFor();
    await queue.getByRole("listitem").filter({ hasText: "排队第一问" }).getByRole("button", { name: "取消这条追加问题" }).click();
    await second.getByText("排队第一问", { exact: true }).waitFor({ state: "detached" });
    await queue.getByRole("button", { name: "补充到本轮" }).click();
    await page.locator(".bubble").filter({ hasText: "排队第二问" }).waitFor();
    await page.locator(".messages .markdown").filter({ hasText: "测试回复" }).waitFor();
    await queue.waitFor({ state: "detached" });
    assert.equal(await page.locator(".bubble").count(), 2);
  } finally { await ctx.close(); }
});

for (const agent of ["codex", "pi"]) test(`${agent} 停止暂停队列，继续发送按顺序执行并保留附件与模型`, async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(url);
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    const workspace = join(root, "queue-resume-" + agent);
    await page.getByRole("textbox", { name: "项目名称" }).fill("测试项目");
    await page.getByRole("textbox", { name: "服务器目录" }).fill(workspace);
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    const input = page.getByRole("textbox", { name: "消息" });
    await input.fill("等待停止测试"); await input.press("Enter");
    await page.getByRole("button", { name: "停止生成" }).waitFor();
    const sid = new URL(page.url()).hash.slice(1);
    const post = data => ctx.request.post(url + "/api/desk", { headers: { origin: url }, data: { session: sid, workspace, agent, ...data } });
    await post({ action: "message", text: "先执行", model: "test-fast", attachments: [{ name: "排队.txt", base64: Buffer.from("queued file").toString("base64") }] });
    await post({ action: "message", text: "再执行", model: "test-deep", attachments: [] });
    await page.getByText("再执行", { exact: true }).waitFor();
    await page.getByRole("button", { name: "停止生成" }).click();
    await page.getByRole("button", { name: "继续发送", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "继续发送", exact: true }).click();
    await page.locator(".messages .markdown").filter({ hasText: agent === "pi" ? "Pi 测试回复" : "测试回复 · test-deep" }).waitFor();
    assert.deepEqual(await page.locator(".bubble").allTextContents(), ["等待停止测试", "先执行", "再执行"]);
    const file = page.getByRole("link", { name: "下载 排队.txt", exact: true });
    assert.equal(await (await ctx.request.get(url + await file.getAttribute("href"))).text(), "queued file");
    await page.getByRole("region", { name: "待发送的追加问题" }).waitFor({ state: "detached" });
  } finally { await ctx.close(); }
});

test("创建项目分别保存名称和目录，刷新及另一浏览器显示名称", async () => {
  const ctx = await browser.newContext();
  const other = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(url);
    const primary = page.getByRole("navigation", { name: "主要导航" });
    assert.deepEqual(await primary.getByRole("button").allTextContents(), ["新聊天", "个人助手", "设置"]);
    assert.equal(await page.getByRole("button", { name: "搜索会话", exact: true }).count(), 0);
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "创建项目", exact: true });
    const create = dialog.getByRole("button", { name: "创建项目", exact: true });
    assert.equal(await create.isEnabled(), false);
    const directory = join(root, "different-directory-name");
    await dialog.getByRole("textbox", { name: "项目名称" }).fill("我的代码库");
    await dialog.getByRole("textbox", { name: "服务器目录" }).fill(directory);
    await create.click();
    const project = page.getByRole("region", { name: "项目列表" }).getByRole("button", { name: "我的代码库", exact: true });
    await project.waitFor();
    await page.getByRole("textbox", { name: "消息" }).fill("验证项目目录");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.locator(".messages .markdown").filter({ hasText: "测试回复" }).waitFor();
    const sid = new URL(page.url()).hash.slice(1);
    const desk = await (await ctx.request.get(url + "/api/desk")).json();
    assert.equal(desk.workspaceNames[directory], "我的代码库");
    assert.equal(desk.sessions.find(session => session.id === sid).workspace, directory);
    await page.reload();
    await project.waitFor();
    const second = await other.newPage();
    await second.goto(page.url());
    await second.getByRole("button", { name: "我的代码库", exact: true }).waitFor();
    // Starting another conversation by path keeps the project's display name.
    await ctx.request.post(url + "/api/desk", { headers: { origin: url }, data: { action: "workspace", path: directory } });
    assert.equal((await (await ctx.request.get(url + "/api/desk")).json()).workspaceNames[directory], "我的代码库");
  } finally { await ctx.close(); await other.close(); }
});

test("输入框与正文同宽，权限在左模型在右；侧栏二级整理排序持久保存", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1912, height: 922 } });
  try {
    const page = await ctx.newPage();
    await page.goto(url);
    await page.getByRole("button", { name: "确认是否为 Codex", exact: true }).first().click();
    await page.locator(".bubble").waitFor();
    for (const width of [1912, 1280, 390, 320]) {
      await page.setViewportSize({ width, height: 922 });
      const composer = await page.locator("[data-composer]").boundingBox();
      const body = await page.locator(".messages > section").first().boundingBox();
      assert.ok(Math.abs(composer.x - body.x) < 1 && Math.abs(composer.width - body.width) < 1);
      const permission = await page.getByRole("button", { name: /^访问模式，当前/ }).boundingBox();
      const model = await page.getByRole("button", { name: /^选择运行器和模型/ }).boundingBox();
      const send = await page.getByRole("button", { name: "发送消息", exact: true }).boundingBox();
      assert.ok(permission.x + permission.width <= model.x + 1);
      assert.ok(model.x + model.width <= send.x);
      assert.ok(Math.abs(permission.y + permission.height / 2 - send.y - send.height / 2) < 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.setViewportSize({ width: 1912, height: 922 });
    const views = page.getByRole("button", { name: "整理与排序", exact: true });
    await views.click();
    await page.getByRole("menuitem", { name: "整理侧边栏", exact: true }).hover();
    await page.getByRole("menuitem", { name: "合并显示", exact: true }).click();
    assert.equal(await page.locator(".projectList").count(), 0);
    await views.click();
    await page.getByRole("menuitem", { name: "聊天排序方式", exact: true }).hover();
    await page.getByRole("menuitem", { name: "手动排序", exact: true }).click();
    const rows = page.locator(".recentList .sessionLine");
    const secondTitle = await rows.nth(1).locator(".sessionRow").innerText();
    await rows.nth(1).dragTo(rows.nth(0));
    assert.equal(await rows.nth(0).locator(".sessionRow").innerText(), secondTitle);
    await page.reload();
    await rows.first().waitFor();
    assert.equal(await page.locator(".projectList").count(), 0);
    assert.equal(await rows.nth(0).locator(".sessionRow").innerText(), secondTitle);
    assert.equal(await rows.first().getAttribute("draggable"), "true");
    await views.click();
    await page.getByRole("menuitem", { name: "整理侧边栏", exact: true }).hover();
    await page.getByRole("menuitem", { name: "分项目显示", exact: true }).click();
    await page.getByRole("region", { name: "项目列表" }).waitFor();
  } finally { await ctx.close(); }
});

test("文件变更树按项目相对目录分组，同名文件分别打开各自的 diff", async () => {
  const db = new DatabaseSync(join(root, "workspace.sqlite"));
  const workspace = "/data/projects/tree-example";
  const paths = ["core/src/index.ts", "ui/src/index.ts", "core/src/test.ts", "README.md"];
  try {
    const desk = readStoredDesk(db);
    const changes = paths.map(path => ({ path: workspace + "/" + path, diff: "@@ -0,0 +1 @@\n+" + path }));
    desk.sessions.unshift({ id: "tree", title: "文件树", workspace, messages: [
      { id: "user", role: "user", text: "查看修改" },
      { id: "reply", role: "assistant", text: "修改完成", runStatus: "complete", activity: [{
        id: "edit", kind: "tool", label: "修改文件", toolType: "diff", status: "complete",
        files: changes.map(({ path }) => ({ path, added: 1, removed: 0 })), output: JSON.stringify(changes),
      }] },
    ] });
    db.prepare("UPDATE desks SET body=? WHERE id='personal'").run(JSON.stringify(desk));
  } finally { db.close(); }
  const page = await browser.newPage();
  try {
    await page.goto(url + "/#tree");
    const tree = page.getByRole("region", { name: "本轮原生文件变更" });
    await tree.getByText("已更改 4 个文件").waitFor();
    await tree.locator("header").getByText("+4", { exact: true }).waitFor();
    await tree.getByRole("button", { name: "core/src", exact: true }).click();
    assert.equal(await tree.getByText("test.ts", { exact: true }).count(), 0);
    assert.equal(await tree.getByText("index.ts", { exact: true }).count(), 1);
    await tree.getByText("README.md", { exact: true }).waitFor();
    await tree.getByText("index.ts", { exact: true }).click();
    await page.getByRole("dialog").locator('[data-slot="code-diff"]').getByText("ui/src/index.ts", { exact: true }).waitFor();
  } finally { await page.close(); }
});

for (const agent of ["codex", "pi"]) test(`${agent} 活动动画、过程说明与最终回答分离，日志按需加载且刷新恢复`, async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(agent => localStorage.setItem("agent-selection", JSON.stringify({ agent, model: "" })), agent);
    await page.goto(url);
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page.getByRole("textbox", { name: "项目名称" }).fill("活动验证");
    await page.getByRole("textbox", { name: "服务器目录" }).fill(join(root, "activity-" + agent));
    await page.getByRole("dialog").getByRole("button", { name: "创建项目", exact: true }).click();
    await page.getByRole("textbox", { name: "消息" }).fill("活动记录测试");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const activity = page.locator('[data-slot="run-activity"]');
    const summary = activity.locator(':scope > [data-slot="collapsible"] > button');
    await activity.locator('[aria-busy="true"]').waitFor();
    assert.equal(await summary.getAttribute("data-state"), "closed");
    assert.equal(await activity.locator(".shimmer").evaluate(element => [getComputedStyle(element).animationName, getComputedStyle(element, "::before").animationName].some(name => name !== "none")), true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await activity.locator(".shimmer").evaluate(element => getComputedStyle(element, "::before").animationPlayState), "paused");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    assert.equal(await page.locator("[data-slot=terminal-block]").count(), 0);
    await page.getByRole("region", { name: "本轮原生文件变更" }).waitFor();
    assert.equal(await page.locator('[data-slot="code-diff"]').count(), 0);
    await page.locator(".assistantMessage .markdown").filter({ hasText: /测试回复/ }).waitFor();
    const sid = new URL(page.url()).hash.slice(1);
    const response = await ctx.request.get(url + "/api/desk?view=workspace&session=" + sid);
    const message = (await response.json()).sessions.find(session => session.id === sid).messages.at(-1);
    assert.ok(message.startedAt && message.finishedAt >= message.startedAt);
    assert.equal(message.runStatus, "complete");
    assert.ok(message.activity.some(entry => entry.kind === "commentary" && entry.text.includes("先检查项目")));
    assert.ok(message.activity.some(entry => entry.kind === "tool" && entry.status === "complete" && entry.output === undefined && entry.hasOutput));
    assert.ok(!message.text.includes("先检查项目"));
    const changes = page.getByRole("region", { name: "本轮原生文件变更" });
    await changes.waitFor();
    const path = agent === "codex" ? "/demo/example.ts" : "/demo/pi-example.ts";
    const folder = changes.getByRole("button", { name: "/demo", exact: true });
    const file = changes.getByRole("button", { name: "查看变更 " + path, exact: true });
    await changes.getByText("已更改 1 个文件", { exact: true }).waitFor();
    const count = agent === "pi" ? 2 : 1;
    const totals = changes.locator("header");
    await totals.getByText("+" + count, { exact: true }).waitFor();
    await totals.getByText("−" + count, { exact: true }).waitFor();
    await folder.click();
    assert.equal(await file.count(), 0);
    assert.equal(await folder.getAttribute("aria-expanded"), "false");
    await folder.click();
    assert.ok(!(await changes.innerText()).includes("no-patch.ts"));
    assert.equal(await page.locator('[data-slot="code-diff"]').count(), 0);
    await changes.getByRole("button", { name: new RegExp(path) }).click();
    const turnDialog = page.getByRole("dialog", { name: "本轮文件变更 " + path, exact: true });
    await turnDialog.locator('[data-slot="code-diff"]').first().waitFor();
    await turnDialog.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
    const box = await turnDialog.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(box.x > 0 && Math.abs(box.x + box.width - viewport.width) < 2 && box.height === viewport.height);
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileBox = await turnDialog.boundingBox();
    assert.ok(Math.abs(mobileBox.x) < 1 && mobileBox.width === 390);
    await page.setViewportSize(viewport);
    assert.equal(await turnDialog.locator('[data-slot="code-diff"]').count(), agent === "pi" ? 2 : 1);
    if (agent === "pi") {
      await turnDialog.getByText("const value = 1;", { exact: true }).first().waitFor();
      await turnDialog.getByText("const value = 2;", { exact: true }).waitFor();
    }
    await turnDialog.getByRole("button", { name: "关闭", exact: true }).click();
    await summary.click();
    assert.equal(await summary.getAttribute("data-state"), "open");
    await activity.getByText("我会先检查项目，再运行构建。", { exact: true }).waitFor();
    if (agent === "codex") {
      assert.equal(await activity.getByRole("progressbar", { name: "执行计划进度" }).getAttribute("aria-valuenow"), "100");
      const timeline = activity.locator('[data-slot="tool-timeline"]');
      assert.match(await timeline.innerText(), /3 步.*1 个文件变更/s);
      await timeline.getByRole("button", { name: "查看变更 /demo/example.ts", exact: true }).click();
      const fileDialog = page.getByRole("dialog", { name: "文件变更 /demo/example.ts", exact: true });
      await fileDialog.locator('[data-slot="code-diff"]').getByText("const ready = true;", { exact: true }).waitFor();
      await fileDialog.getByRole("button", { name: "关闭", exact: true }).click();
      const diff = activity.getByRole("button", { name: /修改文件/ }); await diff.click();
      await page.getByRole("dialog").locator('[data-slot="code-diff"]').getByText("const ready = true;", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.waitForFunction(el => document.activeElement === el, await diff.elementHandle());
    }
    await activity.getByRole("button", { name: agent === "codex" ? "npm run build" : /bash.*npm run build/ }).click();
    await activity.locator("[data-slot=terminal-block]").getByText(/build output/).waitFor();
    await activity.locator('[data-slot="terminal-block"]').getByText("exit 0", { exact: true }).waitFor();
    await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().iterations)).map(animation => animation.finished.catch(() => {}))));
    const panel = activity.locator(':scope > [data-slot="collapsible"] > [data-slot="collapsible-content"]');
    assert.ok(await panel.evaluate(element => element.scrollHeight <= element.clientHeight + 1));
    await summary.click();
    await page.locator(".commandRecord").waitFor({ state: "hidden" });
    await page.locator(".assistantMessage .markdown").filter({ hasText: /测试回复/ }).waitFor();
    await page.reload();
    await summary.waitFor();
    assert.equal(await summary.getAttribute("data-state"), "closed");
    await changes.waitFor();
    await file.waitFor();
    assert.equal(await folder.getAttribute("aria-expanded"), "true");
    assert.equal(await page.locator('[data-slot="code-diff"]').count(), 0);
    assert.equal(await page.locator("[data-slot=terminal-block]").count(), 0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await summary.click();
    assert.equal(await activity.locator('[data-slot="collapsible-content"]').first().evaluate(element => getComputedStyle(element).animationName), "none");
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test("服务恢复将未完成活动标为中断，保留并暂停追加问题", async () => {
  const directory = await mkdtemp(join(tmpdir(), "thindesk-recovery-"));
  let child;
  const start = async () => {
    child = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: "0", HOST: "127.0.0.1", THINDESK_DATA: directory, THINDESK_CODEX: resolve("tests/fixtures/codex.mjs"), THINDESK_PI: resolve("tests/fixtures/pi.mjs") }, stdio: ["ignore", "pipe", "inherit"] });
    const [data] = await once(child.stdout, "data"); return String(data).trim();
  };
  const stop = async () => { if (child?.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; } };
  try {
    const address = await start(); await (await fetch(address + "/api/desk")).json(); await stop();
    const db = new DatabaseSync(join(directory, "workspace.sqlite"));
    try {
      const desk = JSON.parse(JSON.stringify(readStoredDesk(db)));
      desk.sessions = [{ id: "recovery", workspace: directory, title: "中断恢复", running: true, messages: [{ id: "u", role: "user", text: "检查项目" }, { id: "a", role: "assistant", text: "", startedAt: 1000, activity: [{ id: "tool", kind: "tool", label: "构建", status: "running", output: "执行日志" }] }], queue: [{ id: "q", text: "继续检查", attachments: [], agent: "codex", model: "", mode: "标准模式", permission: "仅可查看", createdAt: 1001 }] }];
      db.prepare("UPDATE desks SET body=? WHERE id='personal'").run(JSON.stringify(desk));
    } finally { db.close(); }
    const restored = (await (await fetch(await start() + "/api/desk")).json()).sessions[0];
    assert.equal(restored.running, false); assert.equal(restored.queuePaused, true); assert.equal(restored.queue[0].id, "q");
    assert.equal(restored.messages.length, 2); assert.equal(restored.messages[1].runStatus, "cancelled");
    assert.equal(restored.messages[1].activity[0].status, "error"); assert.ok(restored.messages[1].finishedAt > 1000);
    assert.match(restored.messages[1].text, /上轮回答已中断/);
  } finally { await stop(); await rm(directory, { recursive: true, force: true }); }
});

test("错误卡重试与停止后继续接入 CLI，保留原始回答和输入草稿", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page.getByRole("textbox", { name: "项目名称" }).fill("恢复测试");
    await page.getByRole("textbox", { name: "服务器目录" }).fill(join(root, "recover-actions"));
    await page.getByRole("dialog").getByRole("button", { name: "创建项目", exact: true }).click();
    const input = page.getByRole("textbox", { name: "消息" });
    await input.fill("执行失败测试");
    await page.locator('input[type="file"]').setInputFiles({ name: "恢复附件.txt", mimeType: "text/plain", buffer: Buffer.from("需要重新传入CLI的文件") });
    await input.press("Enter");
    const error = page.locator('[data-slot="error-state"]');
    await error.getByText("构建命令失败", { exact: true }).waitFor();
    await page.locator(".markdown").getByText("先保留这一段回答。", { exact: true }).waitFor();
    await input.fill("保留这个草稿");
    await error.getByRole("button", { name: "重试", exact: true }).click();
    await page.locator(".markdown").getByText("测试回复 · effort:low", { exact: true }).waitFor();
    assert.equal(await input.inputValue(), "保留这个草稿");
    assert.equal(await page.getByRole("link", { name: "下载 恢复附件.txt", exact: true }).count(), 2);
    assert.equal(await page.locator(".bubble").filter({ hasText: "执行失败测试" }).count(), 2);
    assert.equal(await error.getByRole("button", { name: "重试", exact: true }).count(), 0);
    await input.fill("等待停止测试"); await input.press("Enter");
    await page.getByRole("button", { name: "停止生成", exact: true }).click();
    await page.locator('[data-slot="stopped-run"]').getByRole("button", { name: "继续回答", exact: true }).click();
    await page.locator(".bubble").getByText("请继续刚才未完成的工作。", { exact: true }).waitFor();
    await page.locator(".messages section").last().getByText("测试回复 · effort:low", { exact: true }).waitFor();
    const desk = await (await page.request.get(url + "/api/desk")).json();
    const session = desk.sessions.find(session => session.id === new URL(page.url()).hash.slice(1));
    assert.equal(session.messages[1].runStatus, "error");
    assert.equal(session.messages.at(-1).runStatus, "complete");
  } finally { await page.close(); }
});

for (const agent of ["codex", "pi"]) test(`${agent} 工具执行期间增量显示终端输出，不虚构退出码或计划`, async () => {
  const ctx = await browser.newContext();
  try {
    await ctx.addInitScript(agent => localStorage.setItem("agent-selection", JSON.stringify({ agent, model: "" })), agent);
    const page = await ctx.newPage();
    await page.goto(url);
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page.getByRole("textbox", { name: "项目名称" }).fill("流式执行");
    await page.getByRole("textbox", { name: "服务器目录" }).fill(join(root, "stream-tool-" + agent));
    await page.getByRole("dialog").getByRole("button", { name: "创建项目", exact: true }).click();
    await page.getByRole("textbox", { name: "消息" }).fill("活动记录测试");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const activity = page.locator('[data-slot="run-activity"]');
    await activity.locator(':scope > [data-slot="collapsible"] > button').click();
    await activity.getByRole("button", { name: agent === "codex" ? "npm run build" : /bash.*npm run build/ }).click();
    const terminal = activity.locator('[data-slot="terminal-block"]');
    await terminal.getByText("正在检查依赖…", { exact: true }).waitFor();
    assert.equal(await terminal.getByText(/^exit /).count(), 0);
    if (agent === "pi") assert.equal(await activity.locator('[data-slot="agent-plan"]').count(), 0);
    await terminal.getByText("exit 0", { exact: true }).waitFor();
    await page.locator(".markdown").filter({ hasText: /测试回复/ }).waitFor();
  } finally { await ctx.close(); }
});

test("新聊天同列居中，选择已有项目和项目内新聊天都不生成空白历史", async () => {
  const ctx = await browser.newContext({ viewport: { width: 3430, height: 1926 } });
  try {
    const page = await ctx.newPage(); await page.goto(url);
    const original = await (await ctx.request.get(url + "/api/desk")).json();
    await page.getByRole("button", { name: "选择项目", exact: true }).first().click();
    const chooser = page.getByRole("menu");
    assert.equal(await chooser.getByRole("textbox").count(), 0);
    await chooser.getByRole("menuitem", { name: "示例 · ThinDesk", exact: true }).click();
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    for (const width of [3430, 1912, 1024, 390]) {
      await page.setViewportSize({ width, height: 922 });
      const card = await page.locator("[data-composer]").boundingBox();
      const recent = await page.locator(".recentSessions").boundingBox();
      assert.ok(Math.abs(card.x - recent.x) < 1 && Math.abs(card.width - recent.width) < 1, JSON.stringify({ width, card, recent }));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.setViewportSize({ width: 1912, height: 922 });
    await page.locator(".projectList").getByRole("button", { name: "示例 · ThinDesk", exact: true }).hover();
    await page.getByRole("button", { name: "在 /示例 · ThinDesk 中新建会话", exact: true }).click();
    await page.reload(); await page.locator(".recentSessions").waitFor();
    const after = await (await ctx.request.get(url + "/api/desk")).json();
    assert.equal(after.sessions.length, original.sessions.length);
    assert.equal(after.sessions.filter(session => !session.messages.length).length, 0);
  } finally { await ctx.close(); }
});

test("项目和最近分别收起，刷新保留，展开后仍可打开会话", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage(); await page.goto(url);
    const projects = page.getByRole("button", { name: "项目", exact: true });
    const recent = page.getByRole("button", { name: "最近", exact: true });
    for (const control of [projects, recent, page.getByRole("button", { name: "整理与排序", exact: true }),
      page.getByRole("button", { name: "创建项目", exact: true })]) {
      await control.hover();
      await page.waitForFunction(el => getComputedStyle(el).backgroundColor === "rgba(0, 0, 0, 0)", await control.elementHandle());
    }
    await projects.click(); await recent.click();
    assert.equal(await page.locator(".projectList").count(), 0);
    assert.equal(await page.locator(".recentList .sessionRow").count(), 0);
    await page.reload(); await projects.waitFor();
    assert.equal(await projects.getAttribute("aria-expanded"), "false");
    assert.equal(await recent.getAttribute("aria-expanded"), "false");
    await recent.click();
    await page.locator(".recentList .sessionRow").first().click();
    await page.locator(".bubble").waitFor();
    assert.equal(await projects.getAttribute("aria-expanded"), "false");
    await projects.click(); await page.locator(".projectList").waitFor();
  } finally { await ctx.close(); }
});

test("已有会话恢复实际模型，新会话沿用上次模型，菜单只有列表滚动", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage(); await page.goto(url);
    const choose = page.getByRole("button", { name: /^选择运行器和模型/ });
    await choose.filter({ hasText: "Test Default" }).waitFor();
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page.getByRole("textbox", { name: "项目名称" }).fill("模型记忆");
    await page.getByRole("textbox", { name: "服务器目录" }).fill(join(root, "remember-model"));
    await page.getByRole("dialog").getByRole("button", { name: "创建项目", exact: true }).click();
    await choose.click(); await page.getByRole("menuitem", { name: "Codex", exact: true }).click();
    const menu = page.locator(".modelPicker");
    const scroll = await menu.evaluate(element => ({ outer: getComputedStyle(element).overflowY, inner: getComputedStyle(element.querySelector(".modelChoices")).overflowY }));
    assert.equal(scroll.outer, "hidden"); assert.equal(scroll.inner, "auto");
    await page.getByRole("menuitem", { name: "test-deep", exact: true }).click();
    await page.getByRole("textbox", { name: "消息" }).fill("保留模型");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.locator(".markdown").getByText("测试回复 · test-deep", { exact: true }).waitFor();
    const savedUrl = page.url();
    const other = await browser.newContext();
    try {
      const fresh = await other.newPage();
      await fresh.goto(url);
      await fresh.getByRole("button", { name: /^选择运行器和模型/ }).filter({ hasText: "Test Deep" }).waitFor();
      await fresh.getByRole("button", { name: "配置思考强度" }).click();
      await fresh.getByRole("menuitemradio", { name: "高", exact: true, checked: true }).waitFor();
    } finally { await other.close(); }
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    await choose.filter({ hasText: "Test Deep" }).waitFor();
    await page.reload(); await choose.filter({ hasText: "Test Deep" }).waitFor();
    await choose.click(); await page.getByRole("menuitem", { name: "Codex", exact: true }).click();
    await page.getByRole("menuitem", { name: "test-fast", exact: true }).click();
    await page.goto(savedUrl); await page.locator(".bubble").waitFor();
    await choose.filter({ hasText: "Test Deep" }).waitFor();
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    // An unsent picker change does not replace the last model used for a run.
    await choose.filter({ hasText: "Test Deep" }).waitFor();
  } finally { await ctx.close(); }
});

test("删除会话跨标签同步，副本独立，附件在最后一个引用删除后清理", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage(); await page.goto(url);
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page.getByRole("textbox", { name: "项目名称" }).fill("删除测试");
    await page.getByRole("textbox", { name: "服务器目录" }).fill(join(root, "delete-session"));
    await page.getByRole("dialog").getByRole("button", { name: "创建项目", exact: true }).click();
    await page.getByRole("textbox", { name: "消息" }).fill("可删除的聊天");
    await page.locator('input[type="file"]').setInputFiles({ name: "引用.txt", mimeType: "text/plain", buffer: Buffer.from("共享附件") });
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.locator(".markdown").getByText("测试回复", { exact: true }).waitFor();
    const sid = new URL(page.url()).hash.slice(1);
    const file = await page.getByRole("link", { name: "下载 引用.txt", exact: true }).getAttribute("href");
    const second = await ctx.newPage(); await second.goto(page.url()); await second.locator(".bubble").waitFor();
    await page.getByRole("button", { name: "可删除的聊天 的菜单", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "复制为新会话", exact: true }).click();
    await page.locator(".threadHead b").filter({ hasText: "可删除的聊天 · 副本" }).waitFor();
    const copyId = new URL(page.url()).hash.slice(1);
    await page.getByRole("button", { name: "可删除的聊天 的菜单", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "删除会话", exact: true }).click();
    await second.waitForFunction(() => !location.hash);
    assert.equal((await ctx.request.get(url + file)).status(), 200);
    assert.ok(!(await (await ctx.request.get(url + "/api/desk")).json()).sessions.some(session => session.id === sid));
    await page.getByRole("button", { name: "可删除的聊天 · 副本 的菜单", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "删除会话", exact: true }).click();
    await page.waitForFunction(() => !location.hash);
    assert.equal((await ctx.request.get(url + file)).status(), 404);
    await page.reload();
    const desk = await (await ctx.request.get(url + "/api/desk")).json();
    assert.ok(!desk.sessions.some(session => [sid, copyId].includes(session.id)));
  } finally { await ctx.close(); }
});

test("项目菜单仅含删除，删除项目保留已有聊天", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage(); await page.goto(url);
    const before = await (await ctx.request.get(url + "/api/desk")).json();
    const path = before.workspaces[0];
    const group = page.locator(".projectGroup").first();
    await group.locator(".folderHeading").hover();
    await group.getByRole("button", { name: /的项目菜单$/ }).click();
    assert.equal(await page.getByRole("menuitem").count(), 1);
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
    await page.waitForFunction((removed) => !Array.from(document.querySelectorAll(".folderHeading > button[aria-expanded]")).some(button => button.title === removed), path);
    const after = await (await ctx.request.get(url + "/api/desk")).json();
    assert.equal(after.workspaces.includes(path), false);
    assert.deepEqual(after.sessions.map(s => s.id), before.sessions.map(s => s.id));
  } finally { await ctx.close(); }
});

test("刷新和重新打开长会话定位末尾，手动上翻不被内容变化拉回", async () => {
  const db = new DatabaseSync(join(root, "workspace.sqlite"));
  const state = JSON.parse(JSON.stringify(readStoredDesk(db)));
  const session = state.sessions[0];
  const messages = session.messages;
  session.messages = Array.from({ length: 50 }, (_, index) => ({
    ...messages[index % messages.length], id: "scroll-" + index,
    text: ("这是用于验证长会话定位的正文。\n\n").repeat(8),
  }));
  db.prepare("UPDATE desks SET body=? WHERE id='personal'").run(JSON.stringify(state)); db.close();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.goto(url + "/#" + session.id);
    const atBottom = () => page.waitForFunction(() => {
      const el = document.querySelector(".messages");
      return el && el.scrollHeight > el.clientHeight && el.scrollHeight - el.clientHeight - el.scrollTop < 3;
    });
    await atBottom(); await page.reload(); await atBottom();
    await page.locator(".messages").evaluate(el => { el.scrollTop = 0; });
    await page.waitForFunction(() => document.querySelector(".messages")?.scrollTop === 0);
    await page.locator(".messages section").last().evaluate(el => { el.style.paddingBottom = "180px"; });
    await page.waitForTimeout(100);
    assert.equal(await page.locator(".messages").evaluate(el => el.scrollTop), 0);
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    await page.getByRole("button", { name: session.title, exact: true }).first().click();
    await atBottom();
  } finally { await page.close(); }
});

test("底部统计打开完整洞察，按模型计价、筛选与返回保留草稿", async () => {
  const db = new DatabaseSync(join(root, "workspace.sqlite"));
  const state = JSON.parse(JSON.stringify(readStoredDesk(db)));
  const session = state.sessions[0];
  session.model = "test-default";
  session.tokenUsage = {
    total: { inputTokens: 12000, outputTokens: 3000, cachedInputTokens: 6000, reasoningOutputTokens: 500, totalTokens: 15000 },
    last: { inputTokens: 1200, outputTokens: 300, cachedInputTokens: 600, reasoningOutputTokens: 50, totalTokens: 1500 },
    modelContextWindow: 10000,
  };
  session.messages[1].tokenUsage = session.tokenUsage.last;
  session.messages[1].finishedAt = Date.now();
  session.messages[1].startedAt = Date.now() - 10000;
  session.messages[1].activity = [{ id: "command", kind: "tool", label: "exec_command", command: "npm run build", status: "complete", durationMs: 2000 }];
  db.prepare("UPDATE desks SET body=? WHERE id='personal'").run(JSON.stringify(state)); db.close();
  const page = await browser.newPage({ viewport: { width: 1912, height: 1100 } });
  try {
    await page.goto(url + "/#" + session.id);
    const input = page.getByRole("textbox", { name: "消息", exact: true });
    await input.fill("保留未发出的草稿");
    await page.locator('input[type="file"]').setInputFiles({ name: "草稿附件.txt", mimeType: "text/plain", buffer: Buffer.from("保留附件") });
    await page.getByRole("button", { name: "移除 草稿附件.txt", exact: true }).waitFor();
    const requests = [];
    page.on("request", request => { if (request.url().includes("/api/sessions/")) requests.push(request.url()); });
    await page.getByRole("button", { name: "查看上下文与用量", exact: true }).click();
    const insights = page.getByRole("article", { name: "上下文洞察", exact: true });
    await insights.getByText("Token 统计", { exact: true }).waitFor();
    const stats = await (await page.request.get(url + "/api/insights")).json();
    const actual = stats.sessions.find(item => item.id === session.id);
    assert.equal(actual.usage.totalTokens, 15000);
    assert.equal(actual.undatedTokens, 13500);
    assert.equal(actual.tools.exec_command, 1);
    assert.equal(actual.commands.npm, 1);
    assert.equal(actual.seconds, 10);
    assert.equal(actual.toolSeconds, 2);
    assert.equal(actual.days.find(day => day.tokens === 1500)?.tokens, 1500);
    assert.equal(actual.messages, undefined);
    assert.equal(requests.length, 0);
    await insights.getByRole("checkbox", { name: "包含示例数据" }).uncheck();
    await insights.getByRole("button", { name: "统计设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "统计设置", exact: true });
    await settings.getByRole("spinbutton", { name: "codex:test-default 非缓存输入", exact: true }).fill("2");
    await settings.getByRole("spinbutton", { name: "codex:test-default 缓存输入", exact: true }).fill("1");
    await settings.getByRole("spinbutton", { name: "codex:test-default 输出", exact: true }).fill("4");
    await settings.getByRole("button", { name: "关闭", exact: true }).click();
    await insights.getByRole("button", { name: new RegExp(session.title) }).click();
    const detail = page.getByRole("dialog", { name: session.title, exact: true });
    assert.equal(await detail.getByRole("meter").getAttribute("aria-valuenow"), "15");
    await detail.getByText("$0.0300", { exact: true }).waitFor();
    await detail.getByRole("button", { name: "关闭", exact: true }).click();
    await insights.evaluate(el => { el.scrollTop = 0; });
    const visualDir = process.env.VISUAL_OUTPUT || join(homedir(), ".local/state/thindesk/visual");
    await page.screenshot({ path: join(visualDir, "完整上下文洞察-桌面.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await insights.evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: join(visualDir, "完整上下文洞察-手机.png") });
    await insights.getByRole("button", { name: "返回会话", exact: true }).click();
    assert.equal(await input.inputValue(), "保留未发出的草稿");
    await page.getByRole("button", { name: "移除 草稿附件.txt", exact: true }).waitFor();
    await page.getByRole("button", { name: "上下文占用情况", exact: true }).click();
    await insights.getByText("Token 统计", { exact: true }).waitFor();
  } finally { await page.close(); }
});

for (const agent of ["codex", "pi"]) test(`${agent} 实际用量事件存入每轮记录并进入每日洞察`, async () => {
  const post = async (data) => {
    const response = await fetch(url + "/api/desk", { method: "POST", headers: { "Content-Type": "application/json", Origin: url }, body: JSON.stringify(data) });
    assert.equal(response.status, 200);
    return response.json();
  };
  const workspace = join(root, "daily-" + agent);
  await post({ action: "workspace", path: workspace, name: "每日统计" });
  const submitted = await post({ action: "message", workspace, text: "检查每日用量", attachments: [], agent, permission: "完全权限", model: "" });
  const id = submitted.sessions[0].id;
  let session;
  for (let attempt = 0; attempt < 100; attempt++) {
    session = (await (await fetch(url + "/api/desk")).json()).sessions.find(session => session.id === id);
    if (!session.running) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(session.running, false);
  assert.ok(session.messages.at(-1).tokenUsage.totalTokens > 0);
  const insight = (await (await fetch(url + "/api/insights")).json()).sessions.find(session => session.id === id);
  assert.equal(insight.undatedTokens, 0);
  assert.equal(insight.days.reduce((total, day) => total + day.tokens, 0), session.tokenUsage.total.totalTokens);
});


test("Codex JSONL 保留 Unicode 分隔符；正文不决定执行状态", async () => {
  const ctx = await browser.newContext();
  try {
    const desk = await (await ctx.request.get(url + "/api/desk")).json();
    for (const [prompt, expected] of [
      ["协议边界测试", "中文\u2028段落\u2029结束"],
      ["停止文本测试", "这是引用文本：已停止生成。"],
    ]) {
      const response = await ctx.request.post(url + "/api/desk", { headers: { Origin: url }, data: {
        action: "message", workspace: desk.workspaces[0], text: prompt,
        attachments: [], agent: "codex", permission: "完全权限", model: "",
      } });
      assert.equal(response.status(), 200);
      const created = (await response.json()).sessions.find(s => s.title === prompt);
      let reply;
      for (let i = 0; i < 100; i++) {
        const current = await (await ctx.request.get(url + "/api/desk")).json();
        const session = current.sessions.find(s => s.id === created.id);
        if (!session.running && session.messages.at(-1)?.runStatus) {
          reply = session.messages.at(-1); break;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(reply?.text, expected);
      assert.equal(reply?.runStatus, "complete");
    }
  } finally { await ctx.close(); }
});


test("消息文件链接右侧抽屉阅读，文档相对导航、错误和手机关闭保留草稿", async () => {
  const fixture = structuredClone(review);
  fixture.sessions[0].running = false;
  fixture.sessions[0].messages[1] = {
    id: "document-links", role: "assistant", text:
      `[接手入口](${resolve("AGENTS.md")}) · [项目说明](${resolve("README.md")}) · [代码位置](${resolve("server/codex.ts")}:119) · [缺失文件](${join(root, "missing.md")}) · [官网](https://www.assistant-ui.com/)`,
  };
  const db = new DatabaseSync(join(root, "workspace.sqlite"));
  try { db.prepare("UPDATE desks SET body=? WHERE id='personal'").run(JSON.stringify(fixture)); }
  finally { db.close(); }
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  try {
    const page = await ctx.newPage();
    await page.goto(url + "/#review");
    const input = page.getByRole("textbox", { name: "消息", exact: true });
    await input.fill("保留我的草稿");
    const originalUrl = page.url();
    await page.getByRole("link", { name: "接手入口", exact: true }).click();
    let drawer = page.getByRole("dialog");
    await drawer.getByRole("heading", { name: "ThinDesk 接手入口" }).waitFor();
    await drawer.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    let bounds = await drawer.boundingBox();
    assert.ok(bounds.x > 500 && Math.abs(bounds.x + bounds.width - 1400) < 2);
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    await page.getByRole("link", { name: "项目说明", exact: true }).click();
    await drawer.getByRole("link", { name: "架构与代码地图", exact: true }).click();
    await drawer.getByRole("heading", { name: "架构与代码地图", exact: true }).waitFor();
    assert.equal(await page.getByRole("dialog").count(), 1);
    await drawer.getByRole("button", { name: "返回上一份文档" }).click();
    await drawer.getByRole("heading", { name: "ThinDesk", exact: true }).waitFor();
    await drawer.getByRole("button", { name: "关闭文件预览" }).click();
    await page.getByRole("link", { name: "代码位置", exact: true }).click();
    await drawer.getByText(/第 119 行/).waitFor();
    await drawer.locator(".aui-code-content").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "缺失文件", exact: true }).click();
    await drawer.getByRole("alert").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(page.url(), originalUrl);
    assert.equal(await input.inputValue(), "保留我的草稿");
    assert.equal(await page.getByRole("link", { name: "官网", exact: true }).getAttribute("href"), "https://www.assistant-ui.com/");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("link", { name: "接手入口", exact: true }).click();
    await drawer.getByRole("heading", { name: "ThinDesk 接手入口" }).waitFor();
    await drawer.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    bounds = await drawer.boundingBox();
    assert.ok(Math.abs(bounds.x) < 2 && bounds.width <= 390);
    await drawer.getByRole("button", { name: "关闭文件预览" }).click();
    assert.equal(await input.inputValue(), "保留我的草稿");
  } finally { await ctx.close(); }
});

for (const agent of ["codex", "pi"]) test(`${agent} 原生提问刷新可恢复，回答回传并继续，审批允许和拒绝有效`, async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const state = await (await ctx.request.get(url + "/api/desk")).json();
    for (const approved of [null, true, false]) {
      const response = await ctx.request.post(url + "/api/desk", { headers: { Origin: url }, data: {
        action: "message", workspace: state.workspaces[0], text: approved === null ? "原生提问测试" : "原生审批测试",
        attachments: [], agent, permission: "仅可查看", model: "",
      } });
      assert.equal(response.status(), 200);
      const session = (await response.json()).sessions[0];
      await page.goto(url + "/#" + session.id);
      const request = page.locator(".agentRequest");
      await request.waitFor();
      await page.reload();
      await request.waitFor();
      if (approved === null) {
        await request.getByRole("button", { name: /SQLite/ }).click();
        if (agent === "codex") {
          await request.getByRole("button", { name: "下一题" }).click();
          await request.getByRole("textbox", { name: "补充回答" }).fill("ThinDesk");
        }
        await request.getByRole("button", { name: "提交回答" }).click();
      } else await request.getByRole("button", { name: approved ? "允许本次" : "拒绝", exact: true }).click();
      await page.locator(".assistantMessage .markdown").filter({ hasText: agent === "codex" ? "收到原生回答" : "收到 Pi 回答" }).waitFor();
      const current = await (await ctx.request.get(url + "/api/sessions/" + session.id + "?view=full")).json();
      const reply = current.messages.at(-1);
      assert.equal(reply.runStatus, "complete");
      assert.equal(reply.requests[0].status, "answered");
      if (approved === null) assert.match(reply.text, /SQLite/);
      else assert.ok(reply.text.includes(agent === "codex" ? (approved ? 'accept' : 'decline') : '"confirmed":' + approved));
      const stale = await ctx.request.post(url + "/api/desk", { headers: { Origin: url }, data: { action: "respond", session: session.id, message: reply.id, request: reply.requests[0].id, approved: true } });
      assert.equal(stale.status(), 409);
    }
  } finally { await ctx.close(); }
});

test("模型思考档位按原生能力切换，选择真正传给运行器，非法档位被拒绝", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(url);
    await page.getByRole("button", { name: "配置思考强度" }).click();
    await page.getByRole("menu", { name: "配置思考强度" }).getByRole("menuitemradio", { name: "高", exact: true }).click();
    await page.keyboard.press("Escape");
    const desk = await (await ctx.request.get(url + "/api/desk")).json();
    for (const [agent, model, effort, levels] of [
      ["codex", "test-deep", "max", ["high", "max"]],
      ["pi", "test/pi-fast", "low", ["off", "low"]],
    ]) {
      const result = await (await ctx.request.get(url + "/api/model-capabilities?" + new URLSearchParams({ agent, model }))).json();
      assert.deepEqual(result.levels, levels);
      const response = await ctx.request.post(url + "/api/desk", { headers: { Origin: url }, data: {
        action: "message", workspace: desk.workspaces[0], text: "档位测试", attachments: [], agent, model, effort, permission: "完全权限",
      } });
      assert.equal(response.status(), 200);
      const session = (await response.json()).sessions[0];
      await page.goto(url + "/#" + session.id);
      await page.locator(".assistantMessage .markdown").filter({ hasText: "effort:" + effort }).waitFor();
      await page.reload();
      const effortButton = page.getByRole("button", { name: "配置思考强度" });
      await effortButton.getByText(effort === "max" ? "最大" : "低", { exact: true }).waitFor();
      const invalid = await ctx.request.post(url + "/api/desk", { headers: { Origin: url }, data: {
        action: "message", workspace: desk.workspaces[0], text: "非法档位", attachments: [], agent, model, effort: "invented", permission: "完全权限",
      } });
      assert.equal(invalid.status(), 400);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "配置思考强度" }).click();
    const bounds = await page.getByRole("menu", { name: "配置思考强度" }).boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
    await page.keyboard.press("Escape");
    const sendBounds = await page.getByRole("button", { name: "发送消息", exact: true }).boundingBox();
    assert.ok(sendBounds.x + sendBounds.width <= 390);
  } finally { await ctx.close(); }
});

for (const agent of ["codex", "pi"]) test(`${agent} Web 服务重启重新接管待回答任务，不重复运行且可停止`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "thindesk-durable-"));
  const preload = join(directory, "hold-worker.mjs");
  const release = join(directory, "worker-ready");
  await writeFile(preload, `import { existsSync } from "node:fs";
    if (process.argv[1]?.endsWith("/turn-worker.ts")) {
      const until = Date.now() + 15000;
      while (!existsSync(${JSON.stringify(release)}) && Date.now() < until)
        await new Promise(resolve => setTimeout(resolve, 20));
    }`);
  let child, runId;
  async function start() {
    child = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, NODE_OPTIONS: "--import=" + preload, PORT: "0", HOST: "127.0.0.1", THINDESK_RUN_LAUNCHER: "process", THINDESK_DATA: directory, THINDESK_CODEX: resolve("tests/fixtures/codex.mjs"), THINDESK_PI: resolve("tests/fixtures/pi.mjs") }, stdio: ["ignore", "pipe", "inherit"] });
    const [data] = await once(child.stdout, "data"); return String(data).trim();
  }
  async function stop() { if (child?.exitCode === null) { const ended=once(child,"exit");child.kill();await ended; } }
  async function wait(address, predicate) {
    for(let i=0;i<150;i++) {
      const state=await(await fetch(address+'/api/desk')).json();
      const result=predicate(state);if(result)return result;
      await new Promise(r=>setTimeout(r,50));
    }
    throw Error('恢复状态等待超时');
  }
  try {
    let address=await start();
    const desk=await(await fetch(address+'/api/desk',{method:'POST',headers:{'Content-Type':'application/json',Origin:address},body:JSON.stringify({action:'workspace',path:directory,name:'恢复测试'})})).json();
    const response=await fetch(address+'/api/desk',{method:'POST',headers:{'Content-Type':'application/json',Origin:address},body:JSON.stringify({action:'message',workspace:desk.workspaces[0],text:'原生提问测试',attachments:[],agent,permission:'完全权限',model:''})});
    assert.equal(response.status,200);
    const session=(await response.json()).sessions[0];
    await stop();
    address = await start();
    await writeFile(release, "");
    const pending=await wait(address,s=>s.sessions.find(s=>s.id===session.id)?.messages.at(-1)?.requests?.find(r=>r.status==='pending'));
    const original=await(await fetch(address+'/api/sessions/'+session.id+'?view=full')).json();
    runId=original.messages.at(-1).runId;
    const {readRun}=await import('../../server/managed-run.ts');
    const pid=readRun(directory,runId).pid;
    await stop();address=await start();
    await wait(address,s=>s.sessions.find(s=>s.id===session.id)?.messages.at(-1)?.requests?.some(r=>r.id===pending.id&&r.status==='pending'));
    assert.equal(readRun(directory,runId).pid,pid);
    const answer = () => fetch(address+'/api/desk',{method:'POST',headers:{'Content-Type':'application/json',Origin:address},body:JSON.stringify({action:'respond',session:session.id,message:original.messages.at(-1).id,request:pending.id,answers:agent==='codex'?{database:'SQLite',name:'恢复测试'}:{value:'SQLite'}})});
    const receipts = await Promise.all([answer(), answer()]);
    assert.deepEqual(receipts.map(receipt => receipt.status).sort(), [200, 409]);
    const complete=await wait(address,s=>{const item=s.sessions.find(s=>s.id===session.id);return !item?.running&&item?.messages.at(-1)?.runStatus==='complete'&&item;});
    assert.equal(complete.messages.length,2);
    assert.match(complete.messages.at(-1).text,/SQLite/);
    const held = await fetch(address+'/api/desk',{method:'POST',headers:{'Content-Type':'application/json',Origin:address},body:JSON.stringify({action:'message',workspace:session.workspace,session:session.id,text:'等待停止测试',attachments:[],agent,permission:'完全权限',model:''})});
    assert.equal(held.status,200);
    await wait(address,s=>{const reply=s.sessions.find(s=>s.id===session.id)?.messages.at(-1);if(reply?.runId&&readRun(directory,reply.runId)?.pid){runId=reply.runId;return true;}});
    await stop();address=await start();
    const stopped=await fetch(address+'/api/desk',{method:'POST',headers:{'Content-Type':'application/json',Origin:address},body:JSON.stringify({action:'stop',session:session.id})});
    assert.equal(stopped.status,200);
    const cancelled=await wait(address,s=>{const item=s.sessions.find(s=>s.id===session.id);return item?.messages.at(-1)?.runStatus==='cancelled'&&item;});
    assert.equal(cancelled.messages.length,4);
  } finally {
    if(runId){const {controlRun}=await import('../../server/managed-run.ts');try{controlRun(directory,runId,{stop:true});}catch{}}
    await stop();await rm(directory,{recursive:true,force:true});
  }
});

test("插话后失败的轮次，重试发送原始任务", async () => {
  const db = new DatabaseSync(join(root, "workspace.sqlite"));
  let sessionId;
  try {
    const desk = readStoredDesk(db);
    const session = desk.sessions[0];
    sessionId = session.id;
    session.messages = [
      { id: "original", role: "user", text: "原始任务" },
      { id: "followup", role: "user", text: "补充说明", steered: true },
      { id: "failed", role: "assistant", text: "运行出错", runStatus: "error" },
    ];
    db.prepare("UPDATE desks SET body=? WHERE id='personal'").run(JSON.stringify(desk));
  } finally { db.close(); }
  const response = await fetch(url + "/api/desk", { method: "POST", headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "retry-turn", session: sessionId, message: "failed" }) });
  assert.equal(response.status, 200);
  for (let attempt = 0; attempt < 100; attempt++) {
    const session = await (await fetch(url + "/api/sessions/" + sessionId + "?view=full")).json();
    if (!session.running && session.messages.length === 5) {
      assert.equal(session.messages.at(-2).text, "原始任务");
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail("重试未完成");
});

for (const agent of ["codex", "pi"]) test(`${agent} 原生插话沿用同一轮；拒绝时保留下一轮队列`, async () => {
  const ctx=await browser.newContext();
  const state=()=>ctx.request.get(url+'/api/desk').then(r=>r.json());
  async function wait(predicate){for(let i=0;i<160;i++){const result=predicate(await state());if(result)return result;await new Promise(r=>setTimeout(r,50));}throw Error('等待插话超时');}
  const desk=await state();
  const post=data=>ctx.request.post(url+'/api/desk',{headers:{Origin:url},data:{workspace:desk.workspaces[0],attachments:[],agent,model:'',permission:'完全权限',...data}});
  try{
    for(const reject of [false,true]){
      const created=await post({action:'message',text:'等待停止测试'});assert.equal(created.status(),200);
      const id=(await created.json()).sessions[0].id;
      const original=await wait(s=>{const item=s.sessions.find(s=>s.id===id);return (item?.codexThread||item?.piSession)&&item;});
      const replyId=original.messages.at(-1).id,runId=original.messages.at(-1).runId;
      const response=await post({action:'message',session:id,immediate:true,text:reject?'不能插队':'先不要修改数据库'});
      assert.equal(response.status(),200);
      if(reject){
        const held=await wait(s=>{const item=s.sessions.find(s=>s.id===id);return item?.queue?.[0]?.steeringNote&&item;});
        assert.equal(held.running,true);assert.equal(held.messages.length,2);assert.equal(held.queue.length,1);
        await post({action:'stop',session:id});
        await wait(s=>s.sessions.find(s=>s.id===id)?.messages.at(-1)?.runStatus==='cancelled');
        await post({action:'queue-resume',session:id});
        const finished=await wait(s=>{const item=s.sessions.find(s=>s.id===id);return !item?.running&&!item?.queue?.length&&item?.messages.length===4&&item;});
        assert.equal(finished.messages.at(-1).runStatus,'complete');
      }else{
        const finished=await wait(s=>{const item=s.sessions.find(s=>s.id===id);return !item?.running&&item?.messages.some(m=>m.steered)&&item;});
        assert.equal(finished.messages.length,3);assert.equal(finished.messages.at(-1).id,replyId);
        assert.equal(finished.messages.at(-1).runId,runId);assert.equal(finished.messages.at(-1).runStatus,'complete');
        assert.match(finished.messages.at(-1).text,/本轮补充/);assert.equal(finished.queue.length,0);
        assert.ok(!finished.messages.some(m=>m.runStatus==='cancelled'));
      }
    }
  }finally{await ctx.close();}
});

for (const agent of ["codex", "pi"]) test(`${agent} CLI 自动压缩显示开始与完成，刷新保留原生状态`, async () => {
  const ctx=await browser.newContext();
  try{
    const desk=await(await ctx.request.get(url+'/api/desk')).json();
    const response=await ctx.request.post(url+'/api/desk',{headers:{Origin:url},data:{action:'message',workspace:desk.workspaces[0],text:'自动压缩测试',attachments:[],agent,permission:'完全权限',model:''}});
    const id=(await response.json()).sessions[0].id;
    const page=await ctx.newPage();await page.goto(url+'/#'+id);
    await page.locator('.compactionStatus[data-status=running]').waitFor();
    await page.locator('.compactionStatus[data-status=complete]').waitFor();
    await page.locator('.assistantMessage .markdown').filter({hasText:'压缩后继续回答'}).waitFor();
    await page.reload();await page.locator('.compactionStatus[data-status=complete]').waitFor();
    assert.equal(await page.getByRole('button',{name:/手动压缩/}).count(),0);
  }finally{await ctx.close();}
});

for (const agent of ["codex", "pi"]) test(`${agent} 技能和 MCP 使用 CLI 原生清单与配置，开关增删刷新有效`, async () => {
  const ctx=await browser.newContext();
  try{
    const page=await ctx.newPage();await page.goto(url);
    await page.getByRole('button',{name:'设置',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'设置',exact:true});
    await dialog.getByRole('button',{name:'Agent 设置',exact:true}).click();
    const panel=dialog.getByRole('region',{name:'CLI 技能和 MCP 管理'});
    await panel.getByRole('button',{name:agent==='pi'?'Pi':'Codex',exact:true}).click();
    const name=agent==='pi'?'pi-test':'test-skill';
    const skill=panel.getByRole('switch',{name:'启用技能 '+name});
    await skill.waitFor();await skill.click();await page.waitForFunction(()=>!document.querySelector('.cliResources button[disabled]'));
    await panel.getByRole('button',{name:'重新读取 CLI'}).click();
    await skill.waitFor();assert.equal(await skill.getAttribute('aria-checked'),'false');
    await skill.click();await page.waitForFunction(()=>!document.querySelector('.cliResources button[disabled]'));
    await panel.getByRole('button',{name:'添加 MCP',exact:true}).click();
    await panel.getByLabel('名称',{exact:true}).fill('native-test');
    await panel.getByLabel('HTTP 地址',{exact:true}).fill('https://example.invalid/mcp');
    await panel.getByRole('button',{name:'保存到 CLI',exact:true}).click();
    const server=panel.getByRole('switch',{name:'启用 MCP native-test'});await server.waitFor();
    assert.equal(await server.getAttribute('aria-checked'),'true');await server.click();
    await page.waitForFunction(()=>!document.querySelector('.cliResources button[disabled]'));
    await panel.getByRole('button',{name:'重新读取 CLI'}).click();await server.waitFor();assert.equal(await server.getAttribute('aria-checked'),'false');
    await panel.getByRole('button',{name:'移除配置',exact:true}).click();await server.waitFor({state:'detached'});
    await page.reload();await page.getByRole('button',{name:'设置',exact:true}).click();
    await dialog.getByRole('button',{name:'Agent 设置',exact:true}).click();
    await panel.getByRole('button',{name:agent==='pi'?'Pi':'Codex',exact:true}).click();
    await skill.waitFor();assert.equal(await skill.getAttribute('aria-checked'),'true');
    assert.equal(await panel.getByRole('switch',{name:'启用 MCP native-test'}).count(),0);
  }finally{await ctx.close();}
});

test("个人助手扫码登录可重新生成、确认配对码并完成，TG 使用 Token", async () => {
  const page = await browser.newPage();
  let generation = 0, verified = false;
  const make = state => ({ id: String(generation), channel: "微信", state });
  try {
    await page.route("**/api/im", async route => {
      if (route.request().method() === "GET") return route.continue();
      const op = route.request().postDataJSON();
      if (op.action === "qr") {
        assert.equal(op.connect, true);
        generation++;
        await route.fulfill({json: make("waiting")});
      } else if (op.action === "verify-qr") {
        assert.equal(op.code, "0012");
        verified = true;
        await route.fulfill({json: make("scanned")});
      } else await route.fulfill({json: {}});
    });
    await page.route("**/api/im/qr/*", route => route.fulfill({json: make(
      generation === 1 ? "expired" : verified ? "success" : "verify"
    )}));
    await page.goto(url);
    await openWorkbench(page, "IM机器人");
    await page.getByRole("button", {name: "微信扫码登录"}).click();
    const qr = page.getByRole("dialog", {name: "微信扫码登录"});
    await qr.getByRole("button", {name: "重新生成二维码"}).click();
    await qr.getByLabel("微信配对码").fill("0012");
    await qr.getByRole("button", {name: "确认配对码"}).click();
    await qr.getByRole("button", {name: "完成"}).click();
    await page.getByRole("tab", {name: "QQ", exact: true}).click();
    await page.getByRole("button", {name: "QQ扫码登录"}).waitFor();
    await page.getByRole("tab", {name: "Telegram"}).click();
    await page.getByLabel("Telegram Bot Token").waitFor();
    assert.equal(await page.getByRole("button", {name: /扫码登录/}).count(), 0);
  } finally { await page.close(); }
});
