import { openWorkbench } from "../navigation.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { launchBrowser } from "../browser.mjs";

const target = process.env.THINDESK_URL || "http://127.0.0.1:3781/";
const output =
  process.env.VISUAL_OUTPUT ||
  join(homedir(), ".local/state/thindesk/visual/assistant-ui");
await mkdir(output, { recursive: true });
const browser = await launchBrowser();
try {
  const page = await browser.newPage({
    viewport: { width: 1536, height: 864 },
    colorScheme: "light",
    locale: "zh-CN",
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  async function capture(name, ready) {
    await ready.waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      name + " 横向溢出",
    );
    await page.screenshot({
      path: join(output, name + ".png"),
      animations: "disabled",
    });
    console.log(name);
  }
  await page.goto(target);
  const recent = page.locator(".recentSessions");
  await capture("桌面工作台", recent);
  await recent.getByRole("button").first().click();
  await capture("会话", page.locator(".messages .bubble").first());
  await page.getByRole("button", { name: /访问模式，当前/ }).click();
  await capture("权限", page.getByRole("menuitem", { name: "仅可查看" }));
  await page.keyboard.press("Escape");
  await button("添加文件或调用指令").click();
  await capture(
    "会话指令",
    page.getByRole("listbox", { name: "触发候选建议" }),
  );
  await page.keyboard.press("Escape");
  await button("设置").click();
  await capture("设置", button("深色"));
  await page.getByRole("dialog").getByText("IM机器人", { exact: true }).click();
  await capture(
    "设置内IM",
    page.getByRole("dialog").getByRole("button", { name: "微信扫码登录" }),
  );
  await page.keyboard.press("Escape");
  await openWorkbench(page, "上下文洞察");
  await capture("上下文洞察", page.getByText("Token 统计", { exact: true }));
  await page.goto(target);
  await page.emulateMedia({ colorScheme: "dark" });
  await capture("深色工作台", recent);
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("手机工作台", recent);
  await button("打开侧边栏").last().click();
  await capture("手机侧栏", button("设置"));
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
