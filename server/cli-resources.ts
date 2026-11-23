import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { agents } from "./agents.ts";
import { cliCommand, cliRpc } from "./cli-rpc.ts";

type Skill = { name: string; description: string; path: string; enabled: boolean; scope: string };
function piDirectory() { return agents.find(a => a.name === "Pi CLI")!.directory; }
function nativeJson(file: string): any {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error: any) { if (error.code === "ENOENT") return {}; throw Error("CLI 配置不是有效 JSON，未做修改"); }
}
function updateNativeJson(file: string, change: (value: any) => void) {
  const value = nativeJson(file);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("CLI 配置格式无效，未做修改");
  change(value);
  mkdirSync(dirname(file), { recursive: true });
  const temp = file + ".thindesk-" + randomUUID();
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(temp, file);
}
async function skills(agent: string, cwd: string): Promise<Skill[]> {
  if (agent === "codex") {
    const result = await cliRpc(agent, cwd, "skills/list", { cwds: [cwd], forceReload: true });
    const entries: Skill[] = (result.data || []).flatMap((entry: any) => (entry.skills || []).map((s: any) => ({ name: s.name, description: s.description || "", path: s.path, enabled: s.enabled !== false, scope: String(s.scope || "") })));
    const count = (result.data || []).reduce((n: number, entry: any) => n + (entry.errors?.length || 0), 0);
    return Object.assign(entries, { warning: count ? `CLI 报告 ${count} 项技能加载错误` : undefined });
  }
  const result = await cliRpc(agent, cwd, "get_commands");
  const loaded: Skill[] = (result.commands || []).filter((c: any) => c.source === "skill").map((c: any) => ({ name: c.name.replace(/^skill:/, ""), description: c.description || "", path: c.sourceInfo?.path || "", scope: c.sourceInfo?.scope || "user", enabled: true }));
  // Pi omits disabled resources from get_commands. Exact native exclusions remain visible.
  for (const path of nativeJson(join(piDirectory(), "settings.json")).skills || []) {
    if (typeof path !== "string" || !path.startsWith("-/") || loaded.some(s => s.path === path.slice(1))) continue;
    loaded.push({ name: path.split("/").slice(-2, -1)[0] || path.slice(1), description: "由 Pi 原生配置禁用", path: path.slice(1), scope: "user", enabled: false });
  }
  return loaded;
}
async function servers(agent: string, cwd: string) {
  let result;
  try { result = JSON.parse(await cliCommand(agent, ["mcp", "list", "--json"], cwd)); }
  catch { throw Error("CLI 未返回有效的 MCP 清单"); }
  const entries = (Array.isArray(result) ? result : result.servers || []).map((s: any) => ({
    name: s.name, enabled: s.enabled !== false, scope: s.scope || "user",
    state: s.state || (s.enabled === false ? "disabled" : "configured"),
    tools: Array.isArray(s.tools) ? s.tools.length : undefined,
    source: typeof s.source === "string" ? s.source : undefined,
    error: s.error ? "CLI 报告连接失败，请检查原生配置" : undefined,
  }));
  return Object.assign(entries, { warning: result.errors?.length ? `CLI 报告 ${result.errors.length} 项 MCP 配置错误` : undefined });
}
export async function cliResources(agent: string, cwd: string) {
  const [skillResult, serverResult] = await Promise.allSettled([skills(agent, cwd), servers(agent, cwd)]);
  return {
    skills: skillResult.status === "fulfilled" ? skillResult.value : [],
    servers: serverResult.status === "fulfilled" ? serverResult.value : [],
    skillError: skillResult.status === "rejected" ? String(skillResult.reason.message) : (skillResult.value as Skill[] & { warning?: string }).warning,
    serverError: serverResult.status === "rejected" ? String(serverResult.reason.message) : serverResult.value.warning,
    notice: "配置保存在 CLI 原生目录，由 CLI 加载和执行；修改不干扰当前正在运行的轮次，下一轮生效。",
  };
}
export async function changeCliResource(agent: string, cwd: string, input: any) {
  if (input.action === "skill-toggle") {
    const list = await skills(agent, cwd);
    const skill = list.find(s => s.path === input.path);
    if (!skill || typeof input.enabled !== "boolean") throw Error("技能状态已变化，请刷新");
    if (agent === "codex") await cliRpc(agent, cwd, "skills/config/write", { path: skill.path, enabled: input.enabled });
    else updateNativeJson(join(piDirectory(), "settings.json"), config => {
      config.skills = (config.skills || []).filter((s: string) => s !== "-" + skill.path && s !== "+" + skill.path);
      config.skills.push((input.enabled ? "+" : "-") + skill.path);
    });
  } else if (input.action === "mcp-add") {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(input.name)) throw Error("MCP 名称请使用字母、数字、下划线或连字符");
    const args = ["mcp", "add", input.name];
    if (input.url) {
      const url = new URL(input.url);
      if (!["http:", "https:"].includes(url.protocol)) throw Error("请输入 HTTP MCP 地址");
      args.push("--url", url.href);
      if (input.tokenEnv) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.tokenEnv)) throw Error("令牌环境变量名无效");
        args.push("--bearer-token-env-var", input.tokenEnv);
      }
    } else {
      if (typeof input.command !== "string" || !input.command.trim()) throw Error("请输入命令或 MCP 地址");
      if (!Array.isArray(input.args) || !input.args.every((a: unknown) => typeof a === "string")) throw Error("参数应为字符串数组");
      args.push("--", input.command, ...input.args);
    }
    await cliCommand(agent, args, cwd);
  } else if (input.action === "mcp-remove" || input.action === "mcp-toggle") {
    const server = (await servers(agent, cwd)).find((s: any) => s.name === input.name);
    if (!server) throw Error("MCP 状态已变化，请刷新");
    if (input.action === "mcp-remove") {
      if (agent === "pi" && server.scope === "project") throw Error("项目级 MCP 请在其原生配置中删除；此入口管理用户级配置");
      await cliCommand(agent, ["mcp", "remove", server.name], cwd);
    } else {
      if (typeof input.enabled !== "boolean") throw Error("请选择启用状态");
      if (agent === "pi" && server.scope === "project") throw Error("此入口仅修改用户级 MCP，项目级配置保持原生管理");
      if (agent === "codex") {
        if (!/^[a-zA-Z0-9_-]+$/.test(server.name)) throw Error("此名称请在原生 CLI 中管理");
        await cliRpc(agent, cwd, "config/value/write", { keyPath: "mcp_servers." + server.name + ".enabled", value: input.enabled, mergeStrategy: "upsert" });
      } else {
        const file = server.source || join(piDirectory(), "mcp.json");
        updateNativeJson(file, config => {
          if (!config.mcpServers?.[server.name]) throw Error("原生配置已变化，请刷新");
          config.mcpServers[server.name].enabled = input.enabled;
        });
      }
    }
  } else throw Error("未知 CLI 管理操作");
  return cliResources(agent, cwd);
}
