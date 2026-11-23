import { cliResources, changeCliResource } from "./cli-resources.ts";
import { DeskStore } from "./desk-store.ts";
import { managedRun, readRun, controlRun, submitResponse } from "./managed-run.ts";
import type { AgentRequest, AgentResponse } from "../shared/interactions.ts";
import { handleImRequest } from "./im/api.ts";
import { enqueueMessage } from "./messages.ts";
import { ImManager } from "./im/manager.ts";
import { ImLogin } from "./im/login.ts";
import { addNativeUsage } from "./native-usage.ts";
import { insightsView } from "./insights.ts";
import { beginQueuedTurn, moveQueuedItem } from "./queue.ts";
import { getModels, modelCapabilities } from "./models.ts";
import { workspaceView, sessionPage } from "./views.ts";
import { createServer, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, normalize, join, resolve, sep, extname, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  emptyDesk,
  PERSONAL_SESSION_ID,
  type ActivityEntry,
  type Session,
  type Desk,
} from "../shared/workspace.ts";

import { agents } from "./agents.ts";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const dataDirectory =
  process.env.THINDESK_DATA || join(homedir(), ".local/share/thindesk");
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(join(dataDirectory, "workspace.sqlite"));
db.exec(
  "CREATE TABLE IF NOT EXISTS desks (id TEXT PRIMARY KEY, body TEXT NOT NULL)",
);
const read = db.prepare("SELECT body FROM desks WHERE id=?");
const save = db.prepare("INSERT OR REPLACE INTO desks VALUES (?,?)");
db.exec(
  "CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, bytes BLOB NOT NULL)",
);
const insertFile = db.prepare("INSERT INTO files VALUES (?,?,?,?)");
const removeFile = db.prepare("DELETE FROM files WHERE id=? AND owner=?");
const readFile = db.prepare(
  "SELECT name,bytes FROM files WHERE id=? AND owner=?",
);
const streams = new Map<
  ServerResponse,
  { workspace: boolean; session: string | null }
>();
const id = "personal";
if (!read.get(id)) {
  // Keep the most recently used legacy workbench when upgrading to a single shared desk.
  const old = db
    .prepare(
      "SELECT id,body FROM desks ORDER BY coalesce(json_extract(body,'$.revision'),0) DESC,rowid DESC LIMIT 1",
    )
    .get();
  db.exec("BEGIN");
  try {
    save.run(
      id,
      old
        ? String(old.body)
        : JSON.stringify(emptyDesk),
    );
    if (old)
      db.prepare("UPDATE files SET owner=? WHERE owner=?").run(
        id,
        String(old.id),
      );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
const deskStore = new DeskStore(db);
const getDesk = (): Desk => deskStore.get();
const personalDirectory = resolve(process.env.THINDESK_PERSONAL_DIR || join(dataDirectory, "personal-assistant"));
function personalSession(state: Desk): Session {
  let session = state.sessions.find(item => item.id === PERSONAL_SESSION_ID);
  mkdirSync(personalDirectory, { recursive: true, mode: 0o700 });
  if (!session) {
    state.sessions.push({
      id: PERSONAL_SESSION_ID, title: "个人助手", workspace: personalDirectory,
      messages: [], permission: "完全权限", agent: state.lastSelection?.agent || "codex",
      model: state.lastSelection?.model || "", effort: state.lastSelection?.effort,
    });
    session = state.sessions[state.sessions.length - 1];
  }
  session.workspace = personalDirectory;
  return session;
}
const active = new Map<string, () => void>();
function saveDesk(state: Desk) {
  state.revision = (state.revision || 0) + 1;
  deskStore.save(state);
}
function publish(state: Desk, onSave?: () => void) {
  db.exec("BEGIN IMMEDIATE");
  try { saveDesk(state); onSave?.(); db.exec("COMMIT"); }
  catch (error) { db.exec("ROLLBACK"); deskStore.invalidate(); throw error; }
  broadcast(state);
}
function broadcast(state: Desk) {
  for (const [client, view] of streams) {
    const data = view.workspace ? workspaceView(state, view.session) : state;
    client.write("data: " + JSON.stringify(data) + "\n\n");
  }
}
const recovered = getDesk();
publish(recovered);
const resumable = new Set(recovered.sessions.filter(s => {
  const reply = s.messages.at(-1);
  // An independent worker can still be starting. The attach path already bounds this wait.
  return s.running && reply?.runId;
}).map(s => s.id));
const emptySessions = recovered.sessions.filter(
  (session) =>
    session.id !== PERSONAL_SESSION_ID && !session.messages.length &&
    !session.running &&
    !session.queue?.length &&
    !session.codexThread &&
    !session.piSession,
);
if (emptySessions.length) {
  recovered.sessions = recovered.sessions.filter(
    (session) => !emptySessions.includes(session),
  );
  publish(recovered);
}

if (recovered.sessions.some((s) => s.running || s.queue?.length)) {
  for (const s of recovered.sessions.filter((s) => s.running && !resumable.has(s.id))) {
    s.running = false;
    const reply = s.messages.at(-1);
    const notice = "服务已重新启动，上轮回答已中断。";
    if (reply?.role === "assistant") {
      reply.text += (reply.text ? "\n\n" : "") + notice;
      reply.finishedAt = Date.now();
      reply.runStatus = "cancelled";
      reply.activity = reply.activity?.map((entry) =>
        entry.status === "running"
          ? { ...entry, status: "error" as const }
          : entry,
      );
    } else
      s.messages.push({
        id: randomUUID(),
        role: "assistant",
        createdAt: Date.now(),
        text: notice,
        runStatus: "cancelled",
      });
  }
  for (const session of recovered.sessions)
    if (session.queue?.length && !resumable.has(session.id)) session.queuePaused = true;
  publish(recovered);
}
function startNext(sessionId: string) {
  const state = getDesk(),
    session = state.sessions.find((item) => item.id === sessionId);
  if (
    !session ||
    session.running ||
    session.queuePaused ||
    !session.queue?.length
  )
    return;
  try {
    const sample = state.sessions.some(
      (item) => item.workspace === session.workspace && item.sampleUsage,
    );
    const cwd = sample
      ? join(dataDirectory, "examples", session.workspace.split("/").pop()!)
      : session.workspace;
    if (sample) mkdirSync(cwd, { recursive: true });
    if (!existsSync(cwd) || !statSync(cwd).isDirectory())
      throw Error("工作区目录不存在，请检查后继续发送。");
    const files = session.queue[0].attachments.map((file) => {
      const stored = readFile.get(file.id, id);
      if (!stored) throw Error("待发送附件不存在：" + file.name);
      return {
        name: file.name,
        bytes: Buffer.from(stored.bytes as Uint8Array),
      };
    });
    const turn = beginQueuedTurn(session)!;
    state.lastSelection = { runId: turn.replyId, agent: turn.item.agent, model: turn.item.model, effort: turn.item.effort };
    publish(state);
    answer(cwd, session.id, turn.replyId, files, turn.item.permission);
  } catch (error) {
    session.queuePaused = true;
    session.queueError =
      error instanceof Error ? error.message : "无法启动下一条消息";
    publish(state);
  }
}
function steerQueued(sessionId: string, itemId: string) {
  const state = getDesk();
  const session = state.sessions.find(s => s.id === sessionId);
  const item = session?.queue?.find(q => q.id === itemId);
  const reply = session?.messages.at(-1);
  if (!session?.running || !item || !reply?.runId) return;
  if (reply.im && item.origin !== reply.origin) {
    item.steeringNote = "不同来源的问题按独立轮次回复";
    publish(state); return;
  }
  const snapshot = readRun(dataDirectory, reply.runId);
  if (snapshot?.steers?.[item.id] || session.queue?.some(q => q.id !== item.id && q.steering)) {
    item.steeringNote = "本轮已尝试交付或正在交付其他补充，保留在下一轮队列";
    publish(state); return;
  }
  const compatible = (item.origin || "web") === "web" && item.agent === (session.agent || "codex") &&
    (!item.model || item.model === session.model) && (!item.effort || item.effort === session.effort) && item.permission === session.permission;
  if (!compatible || !snapshot?.capabilities?.steer || snapshot.requests?.some((r: AgentRequest) => r.status === "pending")) {
    item.steeringNote = !compatible ? "模型或权限不同，排到下一轮" : "当前阶段不接收补充，排到下一轮";
    publish(state); return;
  }
  item.steering = true;
  delete item.steeringNote;
  publish(state);
  try {
    controlRun(dataDirectory, reply.runId, { steer: {
      id: item.id, text: item.text,
      files: item.attachments.map(file => {
        const stored = readFile.get(file.id, id);
        if (!stored) throw Error("补充附件不存在");
        return { name: file.name, base64: Buffer.from(stored.bytes as Uint8Array).toString("base64") };
      }),
    } });
  } catch {
    item.steering = false; item.steeringNote = "未能交给 CLI，保留在下一轮队列"; publish(state);
  }
}

function answer(
  cwd: string,
  sessionId: string,
  messageId: string,
  files: { name: string; bytes: Buffer }[],
  permission: string,
  attach = false,
) {
  const s = getDesk().sessions.find((s) => s.id === sessionId)!;
  const existingReply = s.messages.find(m => m.id === messageId)!;
  if (!attach) existingReply.runBaseline = s.tokenUsage?.total || ((s.codexThread || s.piSession) ? undefined : null);
  let text = existingReply.text,
    activity: ActivityEntry[] = existingReply.activity || [],
    thread = s.agent === "pi" ? s.piSession : s.codexThread,
    tokenUsage = s.tokenUsage,
    timer: NodeJS.Timeout | undefined;
  const usageBaseline = existingReply.runBaseline || undefined;
  const hadNative = existingReply.runBaseline !== null;
  let requests: AgentRequest[] = s.messages.find(m => m.id === messageId)?.requests || [];
  let receivedUsage = false;
  function flush(done = false, failure?: string, cancelled = false) {
    clearTimeout(timer);
    timer = undefined;
    const latest = getDesk(),
      session = latest.sessions.find((s) => s.id === sessionId);
    const reply = session?.messages.find((m) => m.id === messageId);
    if (!session || !reply) return;
    reply.text = text;
    reply.requests = requests;
    if (receivedUsage && tokenUsage && (usageBaseline || !hadNative)) {
      const total = tokenUsage.total;
      const baseline = usageBaseline && total.totalTokens >= usageBaseline.totalTokens ? usageBaseline : undefined;
      reply.tokenUsage = {
        inputTokens: Math.max(0, total.inputTokens - (baseline?.inputTokens || 0)),
        outputTokens: Math.max(0, total.outputTokens - (baseline?.outputTokens || 0)),
        cachedInputTokens: Math.max(0, total.cachedInputTokens - (baseline?.cachedInputTokens || 0)),
        reasoningOutputTokens: Math.max(0, total.reasoningOutputTokens - (baseline?.reasoningOutputTokens || 0)),
        totalTokens: Math.max(0, total.totalTokens - (baseline?.totalTokens || 0)),
      };
    }
    if (activity.length) reply.activity = activity;
    if (done) {
      reply.finishedAt = Date.now();
      if (failure) reply.runError = failure;
      reply.runStatus = failure
        ? "error"
        : cancelled
          ? "cancelled"
          : "complete";
      if (reply.runStatus !== "complete")
        reply.activity = reply.activity?.map((entry) =>
          entry.status === "running"
            ? { ...entry, status: "error" as const }
            : entry,
        );
    }
    if (s.agent === "pi") session.piSession = thread;
    else session.codexThread = thread;
    session.tokenUsage = tokenUsage;
    session.running = !done;
    if (failure) {
      session.queuePaused = true;
      session.queueError = failure;
    }
    session.updatedAt = Date.now();
    publish(latest, done ? () => im.enqueueReply(session, reply) : undefined);
    if (done) for (const bot of im.store.bots()) void im.drain(bot.id);
  }
  function finish(notice?: string) {
    active.delete(sessionId);
    const current = getDesk().sessions.find(s => s.id === sessionId);
    for (const item of current?.queue || []) if (item.steering) { item.steering = false; item.steeringNote = "本轮已结束，保留在下一轮队列"; }
    requests = requests.map(request => request.status === "pending" ? { ...request, status: "expired" as const } : request);
    if (notice) text += (text ? "\n\n" : "") + notice;
    if (!text)
      text = (s.agent === "pi" ? "Pi" : "Codex") + " 已结束本轮，未返回正文。";
    flush(
      true,
      notice && notice !== "已停止生成。" ? notice : undefined,
      notice === "已停止生成。",
    );
    queueMicrotask(() => startNext(sessionId));
  }
  try {
    const reply = s.messages.find(m => m.id === messageId)!;
    reply.runId ||= messageId;
    publish(getDesk());
    const run = managedRun(dataDirectory, reply.runId, s.agent || "codex", {
      cwd,
      permission,
      model: s.model,
      effort: s.effort,
      sessionDirectory: join(dataDirectory, "pi-sessions"),
      thread,
      prompt: s.messages.at(-2)!.text,
      history: s.messages.slice(0, -2),
      files,
      onModel(model, effort) {
        const latest = getDesk();
        const session = latest.sessions.find((item) => item.id === sessionId);
        if (session && (session.model !== model || (effort !== undefined && session.effort !== effort))) {
          session.model = model;
          if (effort !== undefined) session.effort = effort;
          if (latest.lastSelection?.runId === messageId)
            latest.lastSelection = { runId: messageId, agent: session.agent || "codex", model, effort: session.effort };
          publish(latest);
        }
      },
      onThread(value) {
        if (thread === value) return;
        thread = value;
        flush();
      },
      onText(value) {
        text = value;
        timer ??= setTimeout(() => flush(), 100);
      },
      onActivity(value) {
        activity = value;
        timer ??= setTimeout(() => flush(), 100);
      },
      onUsage(value) {
        receivedUsage = true;
        tokenUsage = value;
        timer ??= setTimeout(() => flush(), 100);
      },
      onCompaction(status, detail) {
        const reply = getDesk().sessions.find(item => item.id === sessionId)?.messages.find(m => m.id === messageId);
        if (reply) { reply.compaction = { status, detail }; timer ??= setTimeout(() => flush(), 100); }
      },
      onEnd: finish,
    }, attach);
    run.requests(value => { requests = value; });
    run.steers(results => {
      const state = getDesk();
      const session = state.sessions.find(s => s.id === sessionId);
      if (!session) return;
      let changed = false;
      for (const [itemId, result] of Object.entries(results)) {
        const item = session.queue?.find(q => q.id === itemId && q.steering);
        if (!item || result.status === "pending") continue;
        if (result.status === "accepted") {
          const position = session.messages.findIndex(m => m.id === messageId);
          if (position >= 0) session.messages.splice(position, 0, { id: item.id, role: "user", text: item.text, attachments: item.attachments, origin: item.origin || "web", createdAt: Date.now(), steered: true });
          session.queue = session.queue!.filter(q => q.id !== itemId);
        } else { item.steering = false; item.steeringNote = result.note || "CLI 当前无法接收，保留在下一轮队列"; }
        changed = true;
      }
      if (changed) publish(state);
    });
    active.set(sessionId, run.cancel);
  } catch (e) {
    finish(e instanceof Error ? e.message : "无法启动 Codex");
  }
}
const im = new ImManager(db, {
  rolledBack: () => deskStore.invalidate(),
  session: sessionId => getDesk().sessions.find(session => session.id === sessionId),
  submit: (bot, input, route) => {
    const state = getDesk();
    const existing = personalSession(state);
    const attachments = input.files.map(file => {
      const fileId = randomUUID();
      const name = file.name.replaceAll("\\", "/").split("/").pop() || "附件";
      insertFile.run(fileId, id, name, file.bytes); return { id: fileId, name };
    });
    const session = enqueueMessage(state, existing.workspace, {
      id: randomUUID(), text: input.text, attachments, agent: existing.agent || "codex",
      model: existing.model || "", effort: existing.effort, permission: existing.permission || "完全权限",
      mode: existing.mode || "标准模式", createdAt: Date.now(), origin: bot.channel,
      im: { routeId: route.id, context: input.context },
    }, existing.id);
    saveDesk(state); return session.id;
  },
  committed: () => broadcast(getDesk()),
  run: startNext,
  stop: sessionId => {
    const state = getDesk(), session = state.sessions.find(item => item.id === sessionId);
    if (session) { session.queuePaused = true; publish(state); }
    active.get(sessionId)?.();
  },
});
const imLogin = new ImLogin(im);
im.start();
process.once("SIGTERM", () => { imLogin.close(); im.close(); process.exit(0); });
const mime: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
};
// A Web restart reattaches snapshots without submitting a second native turn.
setImmediate(() => {
  for (const sessionId of resumable) {
    const session = getDesk().sessions.find(s => s.id === sessionId);
    const reply = session?.messages.at(-1);
    if (session && reply) answer(session.workspace, sessionId, reply.id, [], session.permission || "仅可查看", true);
  }
});

const server = createServer(async (req, res) => {
  const send = (code: number, value: unknown) => {
    res.writeHead(code, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname;
    const compactView = url.searchParams.get("view") === "workspace";
    const selectedSession = url.searchParams.get("session");
    const project = (desk: Desk) =>
      compactView ? workspaceView(desk, selectedSession) : desk;
    if (path === "/api/local-file") {
      if (req.method !== "GET") return send(405, { error: "请求方式不支持" });
      const requested = url.searchParams.get("path");
      if (!requested || requested.includes("\0"))
        return send(400, { error: "文件路径无效" });
      let file;
      try {
        let line: number | undefined;
        const filename = decodeURIComponent(requested).replace(
          /:(\d+)(?::\d+)?$|#L(\d+)(?:-L?\d+)?$/,
          (_, colon, hash) => { line = Number(colon || hash); return ""; },
        );
        const base = url.searchParams.get("base");
        const absolute = resolve(base ? dirname(base) : process.cwd(), filename);
        file = await open(absolute, "r");
        const info = await file.stat();
        if (!info.isFile()) return send(400, { error: "这个路径不是文件" });
        if (info.size > 1024 * 1024)
          return send(413, { error: "文件超过 1 MiB，暂不支持全文预览" });
        const bytes = await file.readFile();
        if (bytes.includes(0)) return send(415, { error: "暂不支持预览此二进制文件" });
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return send(200, { path: absolute, name: basename(absolute), text, line });
      } catch {
        return send(400, { error: "无法读取文件，请检查路径、文件是否存在及文本编码" });
      } finally {
        await file?.close();
      }
    }
    if (path === "/api/im" || path.startsWith("/api/im/")) {
      await handleImRequest(req, url, im, imLogin, send); return;
    }
    if (path === "/api/insights") {
      if (req.method !== "GET") return send(405, { error: "请求方式不支持" });
      const state = getDesk();
      const desk = { ...state, sessions: state.sessions.filter(s => s.id !== PERSONAL_SESSION_ID) };
      return send(200, await addNativeUsage(insightsView(desk), desk));
    }
    if (path === "/api/search") {
      if (req.method !== "GET") return send(405, { error: "请求方式不支持" });
      const term = (url.searchParams.get("query") || "").trim().toLowerCase();
      return send(200, {
        ids: term
          ? getDesk()
              .sessions.filter((session) => session.id !== PERSONAL_SESSION_ID &&
                [
                  session.title,
                  session.workspace,
                  ...session.messages.map((message) => message.text),
                ].some((value) => value.toLowerCase().includes(term)),
              )
              .map((session) => session.id)
          : [],
      });
    }
    if (path.startsWith("/api/sessions/")) {
      if (req.method !== "GET") return send(405, { error: "请求方式不支持" });
      const parts = path
        .slice("/api/sessions/".length)
        .split("/")
        .map(decodeURIComponent);
      const session = getDesk().sessions.find((item) => item.id === parts[0]);
      if (!session) return send(404, { error: "会话不存在" });
      if (parts[1] === "messages" && parts[2]) {
        const message = session.messages.find((item) => item.id === parts[2]);
        return message
          ? send(200, message)
          : send(404, { error: "消息不存在" });
      }
      return send(
        200,
        url.searchParams.get("view") === "full"
          ? session
          : sessionPage(session, url.searchParams.get("before")),
      );
    }
    if (path === "/api/model-capabilities") {
      if (req.method !== "GET") return send(405, { error: "请求方式不支持" });
      return send(200, await modelCapabilities(url.searchParams.get("agent") || "codex", url.searchParams.get("model") || ""));
    }
    if (path === "/api/models")
      return req.method === "GET"
        ? send(200, await getModels())
        : send(405, { error: "请求方式不支持" });
    if (path === "/api/cli-resources") {
      const agent = url.searchParams.get("agent") || "codex";
      const cwd = url.searchParams.get("workspace") || process.cwd();
      if (!["codex", "pi"].includes(agent) || !isAbsolute(cwd)) return send(400, { error: "运行器或目录无效" });
      if (req.method === "GET") return send(200, await cliResources(agent, cwd));
      if (req.method !== "POST") return send(405, { error: "请求方式不支持" });
      if (req.headers.origin !== "http://" + req.headers.host && req.headers.origin !== "https://" + req.headers.host) return send(403, { error: "请求来源无效" });
      const chunks: Buffer[] = []; let size = 0;
      for await (const part of req) { size += part.length; if (size > 64000) return send(413, { error: "内容太长" }); chunks.push(part); }
      try { return send(200, await changeCliResource(agent, cwd, JSON.parse(Buffer.concat(chunks).toString("utf8")))); }
      catch (error) { return send(400, { error: error instanceof Error ? error.message : "CLI 管理失败" }); }
    }
    if (path === "/api/agents")
      return req.method === "GET"
        ? send(200, agents)
        : send(405, { error: "请求方式不支持" });
    if (
      path !== "/api/desk" &&
      path !== "/api/desk/events" &&
      !path.startsWith("/api/files/")
    ) {
      if (req.method !== "GET" && req.method !== "HEAD")
        return send(405, { error: "请求方式不支持" });
      const file = resolve(
        dist,
        "." + decodeURIComponent(path === "/" ? "/index.html" : path),
      );
      if (
        !file.startsWith(resolve(dist) + sep) ||
        !existsSync(file) ||
        !statSync(file).isFile()
      )
        return send(404, { error: "未找到" });
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      return res.end(req.method === "HEAD" ? undefined : readFileSync(file));
    }
    if (
      req.method === "POST" &&
      (req.headers.origin !== "http://" + req.headers.host ||
        !req.headers["content-type"]?.startsWith("application/json"))
    )
      return send(403, { error: "仅接受同源操作" });

    if (path.startsWith("/api/files/")) {
      if (req.method !== "GET") return send(405, { error: "请求方式不支持" });
      const file = readFile.get(path.slice(11), id);
      if (!file) return send(404, { error: "未找到附件" });
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition":
          "attachment; filename*=UTF-8''" +
          encodeURIComponent(String(file.name)),
        "Cache-Control": "private,no-store",
        "X-Content-Type-Options": "nosniff",
      });
      return res.end(file.bytes as Uint8Array);
    }
    if (path === "/api/desk/events") {
      if (req.method !== "GET") return send(405, { error: "请求方式不支持" });
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      });
      streams.set(res, { workspace: compactView, session: selectedSession });
      res.write("data: " + JSON.stringify(project(getDesk())) + "\n\n");
      const ping = setInterval(() => res.write(": keepalive\n\n"), 20000);
      res.on("close", () => {
        clearInterval(ping);
        streams.delete(res);
      });
      return;
    }
    if (req.method === "GET") return send(200, project(getDesk()));
    if (req.method !== "POST") return send(405, { error: "请求方式不支持" });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const part of req) {
      chunks.push(part);
      size += part.length;
      if (size > 12 * 1024 * 1024) return send(413, { error: "内容太长" });
    }
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const files: { id: string; name: string; bytes: Buffer }[] = [];
    const deletedFiles: string[] = [];
    const state = getDesk();
    const value = (v: unknown, max = 4000) =>
      typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
    let folder = value(input.path, 500);
    let afterSave: (() => void) | undefined;
    let persistRelated: (() => void) | undefined;
    if (input.session === PERSONAL_SESSION_ID && ["delete-session", "rename", "archive", "fork"].includes(input.action))
      return send(400, { error: "个人助手具有固定的会话入口" });
    if (input.action === "open-personal") {
      if (state.sessions.some(s => s.id === PERSONAL_SESSION_ID && s.workspace === personalDirectory) && existsSync(personalDirectory))
        return send(200, project(state));
      personalSession(state);
    } else if (input.action === "respond") {
      const session = state.sessions.find(s => s.id === input.session);
      const reply = session?.messages.find(m => m.id === input.message);
      const snapshot = reply?.runId ? readRun(dataDirectory, reply.runId) : undefined;
      const request = snapshot?.requests.find((r: AgentRequest) => r.id === input.request && r.status === "pending");
      if (!session?.running || !reply?.runId || !request || (request.expiresAt && request.expiresAt <= Date.now()))
        return send(409, { error: "这项请求已结束或过期" });
      const response: AgentResponse = { cancelled: input.cancelled === true };
      if (request.kind === "approval") {
        if (typeof input.approved !== "boolean" && !response.cancelled) return send(400, { error: "请选择允许或拒绝" });
        response.approved = input.approved === true;
      } else {
        response.answers = {};
        for (const question of request.questions) {
          const answer = input.answers?.[question.id];
          if (!response.cancelled && (typeof answer !== "string" || !answer.trim() || answer.length > 16000)) return send(400, { error: "请完整回答问题" });
          if (!response.cancelled && question.allowCustom === false && question.options?.length &&
              !question.options.some((option: { label: string }) => option.label === answer))
            return send(400, { error: "请从该问题提供的选项中选择" });
          response.answers![question.id] = response.cancelled ? "" : answer;
        }
      }
      if (!submitResponse(dataDirectory, reply.runId, request.id, response))
        return send(409, { error: "这项请求已有答复" });
      return send(200, project(state));
    } else if (input.action === "workspace") {
      if (!folder || !isAbsolute(folder) || folder.includes("\0"))
        return send(400, {
          error: "请输入服务器上的绝对目录路径，例如 /data/projects/demo",
        });
      if (input.name !== undefined && !value(input.name, 120))
        return send(400, { error: "请输入项目名称（最多 120 字）" });
      const path = normalize(input.path.trim()).replace(/\/$/, "") || "/";
      try {
        mkdirSync(path, { recursive: true });
        if (!statSync(path).isDirectory()) throw Error();
      } catch {
        return send(400, {
          error: "无法打开或创建这个目录，请检查路径和写入权限。",
        });
      }
      if (path === personalDirectory) return send(400, { error: "此目录专用于个人助手" });
      folder = path;
      if (input.name !== undefined) {
        state.workspaceNames ??= {};
        state.workspaceNames[folder] = input.name.trim();
      }
      if (!state.folders.includes(folder)) state.folders.push(folder);
      if (!state.workspaces.includes(folder)) state.workspaces.push(folder);
    } else if (input.action === "delete-workspace") {
      if (!folder || !state.workspaces.includes(folder))
        return send(404, { error: "项目不存在" });
      state.workspaces = state.workspaces.filter((path) => path !== folder);
      state.folders = state.folders.filter((path) => path !== folder);
      if (state.workspaceNames) delete state.workspaceNames[folder];
    } else if (
      input.action === "message" &&
      typeof input.text === "string" &&
      input.text.length <= 64000 &&
      (input.text.trim() || input.attachments?.length) &&
      Array.isArray(input.attachments) &&
      input.attachments.length <= 32 &&
      (state.workspaces.includes(input.workspace) ||
        state.sessions.some((session) => session.id === input.session && session.workspace === input.workspace))
    ) {
      if (input.effort) {
        const capability = await modelCapabilities(input.agent === "pi" ? "pi" : "codex", input.model || "");
        if (!capability.levels.includes(input.effort)) return send(400, { error: "所选模型不支持该思考强度，请重新选择" });
      }
      for (const part of input.attachments) {
        if (
          !value(part?.name, 255) ||
          typeof part.base64 !== "string" ||
          part.base64.length % 4 !== 0 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(part.base64)
        )
          return send(400, { error: "附件无效" });
        files.push({
          id: randomUUID(),
          name: part.name,
          bytes: Buffer.from(part.base64, "base64"),
        });
      }
      if (files.reduce((n, f) => n + f.bytes.length, 0) > 8 * 1024 * 1024)
        return send(413, { error: "附件太大" });
      const pending = {
        origin: "web" as const,
        id: randomUUID(),
        text: input.text,
        attachments: files.map(({ id, name }) => ({ id, name })),
        agent: input.agent === "pi" ? ("pi" as const) : ("codex" as const),
        model: typeof input.model === "string" ? input.model.slice(0, 240) : "",
        effort: typeof input.effort === "string" ? input.effort.slice(0, 40) : undefined,
        mode: value(input.mode, 24) || "标准模式",
        permission: value(input.permission, 40) || "仅可查看",
        createdAt: Date.now(),
      };
      const sample = state.sessions.some(
        (s) => s.workspace === input.workspace && s.sampleUsage,
      );
      const cwd = sample
        ? join(dataDirectory, "examples", input.workspace.split("/").pop()!)
        : input.workspace;
      if (sample) mkdirSync(cwd, { recursive: true });
      if (!existsSync(cwd) || !statSync(cwd).isDirectory())
        return send(400, {
          error:
            "这个工作区没有对应的服务器目录，请通过添加工作区输入实际路径。",
        });
      const session = enqueueMessage(state, input.workspace, pending, input.session, undefined, input.immediate === true);
      afterSave = () => {
        if (input.immediate === true && session.running)
          steerQueued(session.id, pending.id);
        else startNext(session.id);
      };
    } else if (
      input.action === "retry-turn" ||
      input.action === "continue-turn"
    ) {
      const session = state.sessions.find((item) => item.id === input.session);
      const reply = session?.messages.at(-1);
      if (
        !session ||
        session.running ||
        !reply ||
        reply.id !== input.message ||
        !["error", "cancelled"].includes(reply.runStatus || "")
      )
        return send(409, { error: "这轮状态已发生变化，请刷新后重试。" });
      const user = session.messages.findLast((item) => item.role === "user" && !item.steered);
      if (!user) return send(400, { error: "没有可重新发送的消息" });
      const retry = input.action === "retry-turn";
      session.queue ??= [];
      session.queue.unshift({
        id: randomUUID(),
        text: retry ? user.text : "请继续刚才未完成的工作。",
        attachments: (user.attachments ?? []).filter(
          (file): file is { id: string; name: string } =>
            typeof file !== "string",
        ),
        agent: session.agent || "codex",
        model: session.model || "",
        effort: session.effort,
        mode: session.mode || "标准模式",
        permission: session.permission || "仅可查看",
        createdAt: Date.now(),
      });
      session.queuePaused = false;
      delete session.queueError;
      afterSave = () => startNext(session.id);
    } else if (
      ["queue-remove", "queue-move", "queue-edit", "queue-resume"].includes(
        input.action,
      )
    ) {
      const session = state.sessions.find((item) => item.id === input.session);
      if (!session) return send(404, { error: "会话不存在" });
      if (session.queue?.find(q => q.id === input.id)?.steering)
        return send(409, { error: "正在向 CLI 交付这条补充，请稍候" });
      if (input.action === "queue-remove")
        session.queue = (session.queue ?? []).filter(
          (item) => item.id !== input.id,
        );
      else if (input.action === "queue-edit") {
        const item = session.queue?.find((item) => item.id === input.id);
        if (
          !item ||
          typeof input.text !== "string" ||
          input.text.length > 64000 ||
          (!input.text.trim() && !item.attachments.length)
        )
          return send(400, { error: "待发送消息无效" });
        item.text = input.text;
      } else if (input.action === "queue-resume") {
        session.queuePaused = false;
        delete session.queueError;
        afterSave = () => startNext(session.id);
      } else {
        const immediate = moveQueuedItem(
          session,
          input.id,
          input.placement || {},
        );
        if (immediate) {
          session.queuePaused = false;
          delete session.queueError;
          afterSave = () =>
            session.running
              ? steerQueued(session.id, input.id)
              : startNext(session.id);
        }
      }
    } else if (input.action === "delete-session") {
      const target = state.sessions.find((item) => item.id === input.session);
      if (!target) return send(404, { error: "会话不存在" });
      state.sessions = state.sessions.filter((item) => item.id !== target.id);
      const attachments = target.messages
        .flatMap((message) => message.attachments || [])
        .concat(target.queue?.flatMap((item) => item.attachments) || []);
      const retained = new Set(
        state.sessions
          .flatMap((session) => [
            ...session.messages.flatMap((message) => message.attachments || []),
            ...(session.queue?.flatMap((item) => item.attachments) || []),
          ])
          .flatMap((file) => (typeof file === "string" ? [] : [file.id])),
      );
      for (const file of attachments)
        if (typeof file !== "string" && !retained.has(file.id))
          deletedFiles.push(file.id);
      persistRelated = () => im.store.deleteSession(target.id);
      afterSave = () => active.get(target.id)?.();
    } else if (["rename", "archive", "fork"].includes(input.action)) {
      const session = state.sessions.find((s) => s.id === input.session);
      if (!session) return send(404, { error: "会话不存在" });
      if (input.action === "rename") {
        const name = value(input.name, 160);
        if (!name) return send(400, { error: "请输入会话名称" });
        session.title = name;
      }
      if (input.action === "archive") session.archived = !session.archived;
      if (input.action === "fork") {
        const fork: Session = JSON.parse(JSON.stringify(session));
        if (input.message !== undefined) {
          const end = fork.messages.findIndex(
            (m) => m.id === input.message && m.role === "assistant",
          );
          if (end < 0) return send(404, { error: "找不到分支起点" });
          fork.messages = fork.messages.slice(0, end + 1);
        }
        delete fork.channel;
        delete fork.codexThread;
        delete fork.piSession;
        delete fork.queue;
        delete fork.queuePaused;
        delete fork.queueError;
        for (const message of fork.messages) {
          delete message.runId;
          delete message.runBaseline;
          message.requests = message.requests?.map(request => request.status === "pending" ? { ...request, status: "expired" } : request);
          if (message.role === "assistant" && message.startedAt && !message.runStatus) {
            message.runStatus = "cancelled";
            message.finishedAt = Date.now();
          }
        }
        state.sessions.unshift({
          ...fork,
          id: randomUUID(),
          title: session.title + " · 副本",
          running: false,
          archived: false,
          updatedAt: Date.now(),
        });
      }
    } else if (input.action === "stop" || input.action === "approval") {
      const session = state.sessions.find((s) => s.id === input.session);
      if (!session) return send(404, { error: "会话不存在" });
      if (input.action === "stop" && session.running) {
        session.queuePaused = true;
        const cancel = active.get(session.id);
        if (cancel) afterSave = cancel;
        else session.running = false;
      } else if (
        input.action === "approval" &&
        typeof input.approved === "boolean"
      ) {
        const message = session.messages.find(
          (m) => m.id === input.id && m.approval === "pending",
        );
        if (!message) return send(409, { error: "审批状态已变更" });
        message.approval = input.approved ? "approved" : "denied";
      } else return send(409, { error: "会话状态已变更" });
    } else if (
      input.action === "job" &&
      value(input.name, 120) &&
      value(input.prompt) &&
      typeof input.schedule === "string" &&
      Number.isFinite(Date.parse(input.schedule))
    ) {
      state.jobs.unshift({
        id: randomUUID(),
        name: input.name,
        prompt: input.prompt,
        workspace: state.workspaces.includes(input.workspace)
          ? input.workspace
          : "未分组",
        schedule: input.schedule,
        repeat: input.repeat === true,
        status: "已开启",
      });
    } else if (
      input.action === "job-status" &&
      ["已暂停", "已开启", "已结束"].includes(input.status) &&
      state.jobs.some((j) => j.id === input.id)
    ) {
      state.jobs.find((j) => j.id === input.id)!.status = input.status;
    } else return send(400, { error: "操作或内容无效" });
    state.revision = (state.revision || 0) + 1;
    db.exec("BEGIN");
    try {
      for (const f of files) insertFile.run(f.id, id, f.name, f.bytes);
      for (const file of deletedFiles) removeFile.run(file, id);
      persistRelated?.();
      deskStore.save(state);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      deskStore.invalidate();
      throw error;
    }
    broadcast(state);
    if (afterSave) afterSave();
    return send(200, project(state));
  } catch {
    return send(400, { error: "请求失败" });
  }
});
server.listen(
  Number(process.env.PORT || 3781),
  process.env.HOST || "127.0.0.1",
  () => {
    const address = server.address();
    if (address && typeof address !== "string")
      console.log("http://" + address.address + ":" + address.port);
  },
);
