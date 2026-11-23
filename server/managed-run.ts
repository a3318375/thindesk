import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, linkSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { AgentTurnOptions } from "./agent-turn.ts";
import type { AgentId } from "../shared/models.ts";
import type { AgentRequest, AgentResponse } from "../shared/interactions.ts";

export function runDirectory(data: string, runId: string) { return join(data, "runs", runId); }
export function readRun(data: string, runId: string): any | undefined {
  try { return JSON.parse(readFileSync(join(runDirectory(data, runId), "snapshot.json"), "utf8")); }
  catch { return undefined; }
}
export function runAlive(snapshot: any) {
  if (!snapshot?.running || Date.now() - snapshot.updatedAt > 15000) return false;
  try { process.kill(snapshot.pid, 0); return true; } catch { return false; }
}
export function controlRun(data: string, runId: string, command: object) {
  const file = join(runDirectory(data, runId), "control-" + randomUUID() + ".json");
  writeFileSync(file + ".tmp", JSON.stringify(command), { mode: 0o600 });
  renameSync(file + ".tmp", file);
}

// Both tabs target the same file. Publishing a complete command also claims the request.
export function submitResponse(data: string, runId: string, id: string, response: AgentResponse) {
  const directory = runDirectory(data, runId);
  const path = join(directory, "control-answer-" + createHash("sha256").update(id).digest("hex") + ".json");
  const temporary = join(directory, randomUUID() + ".tmp");
  writeFileSync(temporary, JSON.stringify({ id, response }), { mode: 0o600 });
  try {
    linkSync(temporary, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally { unlinkSync(temporary); }
}

export function managedRun(
  data: string, runId: string, agent: AgentId, options: Omit<AgentTurnOptions, "onRequest" | "onResolved">,
  attach = false,
) {
  const directory = runDirectory(data, runId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const inputFile = join(directory, "input.json");
  if (!attach && !existsSync(join(directory, "snapshot.json"))) {
    const { files, history, ...rest } = options;
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      /^(PATH|HOME|CODEX_HOME|PI_CODING_AGENT_DIR|THINDESK_CODEX|THINDESK_PI|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS)$/i.test(key)));
    writeFileSync(inputFile, JSON.stringify({ agent, environment, options: {
      ...rest, history: options.thread ? [] : history.map(({ role, text }) => ({ role, text })),
      files: files.map(f => ({ name: f.name, base64: f.bytes.toString("base64") })),
    } }), { mode: 0o600 });
    const worker = fileURLToPath(new URL("./turn-worker.ts", import.meta.url));
    const systemd = process.env.THINDESK_RUN_LAUNCHER === "systemd";
    const child = systemd
      ? spawn("systemd-run", ["--user", "--quiet", "--collect", "--property=Type=exec", "--unit=thindesk-turn-" + runId, "--working-directory=" + process.cwd(), process.execPath, worker, directory], {
          env: { ...process.env, XDG_RUNTIME_DIR: `/run/user/${process.getuid!()}`, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid!()}/bus` }, stdio: "ignore",
        })
      : spawn(process.execPath, [worker, directory], { detached: true, stdio: "ignore" });
    child.on("error", () => { launchError = "无法启动独立运行器"; });
    child.on("exit", code => { if (systemd && code) launchError = "独立运行器服务启动失败"; });
    child.unref();
  }
  let revision = -1, ended = false, launchError = "";
  const started = Date.now();
  const poll = setInterval(() => {
    if (ended) return;
    const snapshot = readRun(data, runId);
    if (launchError || (!snapshot && Date.now() - started > 15000) || (snapshot?.running && !runAlive(snapshot))) {
      ended = true; clearInterval(poll);
      options.onEnd(launchError || "独立运行器已退出，保留本轮记录；可手动继续。"); return;
    }
    if (!snapshot || revision === snapshot.revision) return;
    revision = snapshot.revision;
    if (snapshot.thread) options.onThread(snapshot.thread);
    if (snapshot.model) options.onModel(snapshot.model, snapshot.effort);
    options.onText(snapshot.text); options.onActivity(snapshot.activity);
    if (snapshot.usage) options.onUsage(snapshot.usage);
    if (snapshot.compaction) options.onCompaction?.(snapshot.compaction.status, snapshot.compaction.detail);
    onSteers?.(snapshot.steers || {});
    // Include receipts, not only pending requests, when reattaching after a Web restart.
    onRequests?.(snapshot.requests);
    if (!snapshot.running) {
      ended = true; clearInterval(poll); options.onEnd(snapshot.notice);
    }
  }, 120);
  let onSteers: ((results: Record<string, { status: string; note?: string }>) => void) | undefined;
  let onRequests: ((requests: AgentRequest[]) => void) | undefined;
  return {
    cancel: () => controlRun(data, runId, { stop: true }),
    steers: (callback: NonNullable<typeof onSteers>) => { onSteers = callback; },
    requests: (callback: (requests: AgentRequest[]) => void) => { onRequests = callback; },
  };
}
