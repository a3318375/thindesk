import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { agents } from "./agents.ts";
export function cliBinary(agent: string) {
  const binary = agent === "pi" ? process.env.THINDESK_PI || agents.find(a => a.name === "Pi CLI")?.executable
    : process.env.THINDESK_CODEX || agents.find(a => a.name === "Codex CLI")?.executable;
  if (!binary) throw Error("未找到对应 CLI");
  return binary;
}
export async function cliCommand(agent: string, args: string[], cwd: string) {
  try { return (await promisify(execFile)(cliBinary(agent), args, { cwd, timeout: 20000, maxBuffer: 4 * 1024 * 1024 })).stdout; }
  catch (error: any) {
    // Pi list returns exit 1 with structured connection errors; do not expose stderr/secrets.
    if (args[0] === "mcp" && args[1] === "list" && error.stdout) return String(error.stdout);
    throw Error("CLI 操作失败，请检查配置或连接状态");
  }
}
export function cliRpc(agent: string, cwd: string, method: string, params: object = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliBinary(agent), agent === "pi" ? ["--mode", "rpc", "--offline", "--no-session", "--no-mcp"] : ["app-server", "--listen", "stdio://"], { cwd, stdio: ["pipe", "pipe", "ignore"] });
    let buffer = "", closed = false;
    const finish = (result?: unknown, error?: string) => {
      if (closed) return; closed = true; clearTimeout(timer); child.stdin.end(); child.kill();
      const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 3000);
      force.unref();
      if (error) reject(Error(error)); else resolve(result);
    };
    const send = (value: object) => child.stdin.write(JSON.stringify(value) + "\n");
    const request = () => send(agent === "pi" ? { id: 1, type: method, ...params } : { id: 1, method, params });
    const timer = setTimeout(() => finish(undefined, "CLI 管理接口超时"), 15000);
    child.on("error", () => finish(undefined, "CLI 无法启动"));
    child.on("close", () => { if (!closed) finish(undefined, "CLI 管理进程已退出"); });
    child.stdin.on("error", () => finish(undefined, "CLI 管理连接已关闭"));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      buffer += chunk;
      if (buffer.length > 4 * 1024 * 1024) return finish(undefined, "CLI 管理结果过大");
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if (e.id === 0) { if (e.error) return finish(undefined, "CLI 初始化失败"); send({ method: "initialized", params: {} }); request(); }
          else if (e.id === 1) {
            if (e.error || e.success === false) finish(undefined, "CLI 拒绝了此管理操作");
            else finish(agent === "pi" ? e.data : e.result);
          }
        } catch { finish(undefined, "CLI 管理结果格式无效"); }
      }
    });
    if (agent === "pi") request();
    else send({ id: 0, method: "initialize", params: { clientInfo: { name: "thindesk-settings", version: "1" } } });
  });
}
