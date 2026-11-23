import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { agents } from "./agents.ts";
import type { AgentModels, AgentModel } from "../shared/models.ts";
const exec = promisify(execFile);

async function codexModels(): Promise<AgentModels> {
  const agent = agents.find((agent) => agent.name === "Codex CLI")!;
  const binary = process.env.THINDESK_CODEX || agent.executable;
  let configured = "", configuredEffort: string | undefined;
  const models: AgentModel[] = [{ id: "", name: "CLI 默认模型" }];
  if (!binary) return { id: "codex", name: "Codex", available: false, models };
  return new Promise((resolve) => {
    const child = spawn(binary, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let done = false,
      buffer = "";
    const finish = (error?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      resolve({
        id: "codex",
        name: "Codex",
        available: true,
        models,
        defaultModel: configured || undefined,
        ...(error ? { error } : {}),
      });
    };
    const write = (message: object) =>
      child.stdin.write(JSON.stringify(message) + "\n");
    const timer = setTimeout(
      () => finish("暂未获取到模型列表，可使用 CLI 默认模型"),
      8000,
    );
    child.on("error", () => finish("Codex 模型列表读取失败"));
    child.on("close", () => finish());
    child.stdin.on("error", () => finish());
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const response = JSON.parse(line);
          if (response.id === 1) {
            write({ method: "initialized", params: {} });
            write({ id: 3, method: "config/read", params: { includeLayers: false } });
          } else if (response.id === 3) {
            configured = response.result?.config?.model || "";
            configuredEffort = response.result?.config?.model_reasoning_effort;
            write({ id: 2, method: "model/list", params: { limit: 200 } });
          } else if (response.id === 2) {
            for (const model of response.result?.data ?? []) {
              if (!configured && model.isDefault)
                configured = model.model ?? model.id;
              const efforts = model.supportedReasoningEfforts?.map((e: { reasoningEffort: string }) => e.reasoningEffort);
              models.push({
                id: model.model ?? model.id,
                name: model.displayName || model.model || model.id,
                efforts,
                defaultEffort: configuredEffort && efforts?.includes(configuredEffort) ? configuredEffort : model.defaultReasoningEffort,
              });
            }
            finish(
              response.error
                ? "暂未获取到模型列表，可使用 CLI 默认模型"
                : undefined,
            );
          }
        } catch {
          finish("Codex 模型列表格式错误");
        }
      }
    });
    write({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "thindesk-models", version: "1" } },
    });
  });
}
async function piDefaultModel(binary: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(
      binary,
      ["--mode", "rpc", "--offline", "--no-session"],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    let buffer = "",
      done = false;
    const finish = (value?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      resolve(value);
    };
    const timer = setTimeout(() => finish(), 5000);
    child.on("error", () => finish());
    child.on("close", () => finish());
    child.stdin.on("error", () => finish());
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const event = JSON.parse(line);
          if (event.id === "model-state") {
            const model = event.data?.model;
            finish(
              model?.id
                ? (model.provider ? model.provider + "/" : "") + model.id
                : undefined,
            );
          }
        } catch {
          finish();
        }
      }
    });
    child.stdin.write(
      JSON.stringify({ id: "model-state", type: "get_state" }) + "\n",
    );
  });
}
async function piModels(): Promise<AgentModels> {
  const binary =
    process.env.THINDESK_PI ||
    agents.find((agent) => agent.name === "Pi CLI")?.executable;
  const models: AgentModel[] = [{ id: "", name: "CLI 默认模型" }];
  if (!binary) return { id: "pi", name: "Pi", available: false, models };
  try {
    const { stdout } = await exec(binary, ["--offline", "--list-models"], {
      timeout: 8000,
      maxBuffer: 1024 * 1024,
    });
    for (const line of stdout.split(/\r?\n/).slice(1)) {
      const [provider, id] = line.trim().split(/\s+/);
      if (provider && id)
        models.push({ id: provider + "/" + id, name: id, provider });
    }
    const defaultModel = await piDefaultModel(binary);
    if (defaultModel) models[0].name = defaultModel;
    return { id: "pi", name: "Pi", available: true, models, defaultModel };
  } catch {
    return {
      id: "pi",
      name: "Pi",
      available: true,
      models,
      error: "暂未获取到模型列表，可使用 CLI 默认模型",
    };
  }
}
let cached: { at: number; value: Promise<AgentModels[]> } | undefined;
export function getModels() {
  if (!cached || Date.now() - cached.at > 60000)
    cached = {
      at: Date.now(),
      value: Promise.all([codexModels(), piModels()]),
    };
  return cached.value;
}


const capabilities = new Map<string, { at: number; result: Promise<{ levels: string[]; defaultEffort?: string }> }>();
export function modelCapabilities(agent: string, model: string) {
  const key = agent + "/" + model;
  const cached = capabilities.get(key);
  if (cached && Date.now() - cached.at < 60000) return cached.result;
  const result = agent === "codex" ? getModels().then(groups => {
    const group = groups.find(g => g.id === "codex");
    const entry = group?.models.find(m => m.id === (model || group.defaultModel));
    return { levels: entry?.efforts || [], defaultEffort: entry?.defaultEffort };
  }) : new Promise<{ levels: string[]; defaultEffort?: string }>((resolve, reject) => {
    const binary = process.env.THINDESK_PI || agents.find(a => a.name === "Pi CLI")?.executable;
    if (!binary) return reject(Error("服务器未找到 Pi"));
    const child = spawn(binary, ["--mode", "rpc", "--offline", "--no-session", ...(model ? ["--model", model] : [])], { stdio: ["pipe", "pipe", "ignore"] });
    let done = false, buffer = "", current: string | undefined;
    const finish = (levels?: string[], error?: string) => {
      if (done) return; done = true; clearTimeout(timer); child.stdin.end(); child.kill();
      if (error) reject(Error(error)); else resolve({ levels: levels || [], defaultEffort: current });
    };
    const timer = setTimeout(() => finish(undefined, "模型能力查询超时"), 8000);
    child.on("error", () => finish(undefined, "模型能力读取失败"));
    child.on("close", () => { if (!done) finish(undefined, "模型能力进程退出"); });
    child.stdin.on("error", () => finish(undefined, "模型能力连接关闭"));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      buffer += chunk; let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const e = JSON.parse(line);
          if (!e.success && e.type === "response") return finish(undefined, e.error || "模型能力读取失败");
          if (e.id === "state") {
            current = e.data?.thinkingLevel;
            child.stdin.write(JSON.stringify({ id: "levels", type: "get_available_thinking_levels" }) + "\n");
          }
          if (e.id === "levels") finish(e.data?.levels);
        } catch { finish(undefined, "模型能力格式错误"); }
      }
    });
    child.stdin.write(JSON.stringify({ id: "state", type: "get_state" }) + "\n");
  });
  capabilities.set(key, { at: Date.now(), result });
  result.catch(() => capabilities.delete(key));
  return result;
}
