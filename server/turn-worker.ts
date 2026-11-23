import { readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { runCodex } from "./codex.ts";
import { runPi } from "./pi.ts";
import type { AgentTurnOptions, AgentControl } from "./agent-turn.ts";
import type { AgentRequest, AgentResponse } from "../shared/interactions.ts";

const directory = process.argv[2];
const input = JSON.parse(readFileSync(join(directory, "input.json"), "utf8"));
Object.assign(process.env, input.environment);
const state: any = {
  pid: process.pid, updatedAt: Date.now(), revision: 0, running: true,
  text: "", activity: [], requests: [], steers: {}, capabilities: { steer: true },
};
const responses = new Map<string, (response: AgentResponse) => void>();
let dirty = true;
function save() {
  state.updatedAt = Date.now();
  if (dirty || !state.running) state.revision++;
  const file = join(directory, "snapshot.json");
  writeFileSync(file + ".tmp", JSON.stringify(state), { mode: 0o600 });
  renameSync(file + ".tmp", file);
  dirty = false;
}
save();
const heartbeat = setInterval(save, 2000);
const flush = setInterval(() => { if (dirty) save(); }, 100);
let cancel: AgentControl | undefined;
const consumedAnswers = new Set<string>();
const controls = setInterval(() => {
  for (const file of readdirSync(directory).filter(name => name.startsWith("control-") && name.endsWith(".json"))) {
    if (consumedAnswers.has(file)) continue;
    try {
      const path = join(directory, file);
      const command = JSON.parse(readFileSync(path, "utf8"));
      if (file.startsWith("control-answer-")) {
        // Keep the claim until the run ends, without retaining the answer (which can be secret).
        writeFileSync(path, "");
        consumedAnswers.add(file);
      } else unlinkSync(path);
      if (command.stop) cancel?.();
      else if (command.steer) {
        const pending = command.steer;
        if (state.steers[pending.id]) continue;
        state.steers[pending.id] = { status: "pending" };
        const result = (accepted: boolean, note?: string) => {
          state.steers[pending.id] = { status: accepted ? "accepted" : "rejected", note };
          dirty = true;
        };
        if (cancel?.steer) cancel.steer({ ...pending, files: (pending.files || []).map((f: any) => ({ name: f.name, bytes: Buffer.from(f.base64, "base64") })) }, result);
        else result(false, "当前运行器不支持本轮补充");
        dirty = true;
      } else {
        const request = state.requests.find((r: AgentRequest) => r.id === command.id && r.status === "pending");
        if (!request || (request.expiresAt && request.expiresAt <= Date.now())) continue;
        const response = command.response as AgentResponse;
        request.status = response.cancelled ? "cancelled" : "answered";
        request.approved = response.approved;
        request.answers = Object.fromEntries(Object.entries(response.answers || {}).filter(([id]) => !request.questions.find((q: any) => q.id === id)?.secret));
        responses.get(command.id)?.(response);
        responses.delete(command.id); dirty = true;
      }
    } catch { /* An incomplete control file is never published; a stale one is ignored. */ }
  }
  for (const request of state.requests as AgentRequest[]) {
    if (request.status === "pending" && request.expiresAt && request.expiresAt <= Date.now()) {
      request.status = "expired";
      responses.get(request.id)?.({ cancelled: true });
      responses.delete(request.id); dirty = true;
    }
  }
}, 100);
function finish(notice?: string) {
  state.running = false; state.notice = notice;
  for (const item of Object.values(state.steers) as any[]) if (item.status === "pending") { item.status = "rejected"; item.note = "本轮已结束，保留在下一轮队列"; }
  for (const request of state.requests as AgentRequest[])
    if (request.status === "pending") request.status = "expired";
  save(); clearInterval(heartbeat); clearInterval(flush); clearInterval(controls);
}
const options: AgentTurnOptions = {
  ...input.options,
  files: input.options.files.map((f: any) => ({ name: f.name, bytes: Buffer.from(f.base64, "base64") })),
  onThread: thread => { state.thread = thread; dirty = true; },
  onModel: (model, effort) => { state.model = model; state.effort = effort; dirty = true; },
  onText: text => { state.text = text; dirty = true; },
  onActivity: activity => { state.activity = activity; dirty = true; },
  onCompaction: (status, detail) => { state.compaction = { status, detail }; dirty = true; },
  onUsage: usage => { state.usage = usage; dirty = true; },
  onRequest: (request, respond) => { state.requests.push(request); responses.set(request.id, respond); dirty = true; },
  onResolved: id => {
    const request = state.requests.find((r: AgentRequest) => r.id === id);
    if (request?.status === "pending") request.status = "expired";
    dirty = true;
  },
  onEnd: finish,
};
try {
  cancel = (input.agent === "pi" ? runPi : runCodex)(options);
  unlinkSync(join(directory, "input.json"));
} catch (error) { finish(error instanceof Error ? error.message : "运行器启动失败"); }
