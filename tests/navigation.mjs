// Panel tools now live under Settings, leaving only projects and chats in the sidebar.
export async function openWorkbench(page, name) {
  const settings = page.getByRole("button", { name: "设置", exact: true });
  if (!(await settings.isVisible()))
    await page
      .getByRole("button", { name: "打开侧边栏", exact: true })
      .last()
      .click();
  await settings.click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await dialog.getByRole("button", { name, exact: true }).click();
}
