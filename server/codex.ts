import { recordSubagent } from "./codex-subagents.ts";
import { codexInteraction } from "./interactions.ts";
import { fileChangeStats } from "../shared/activities.ts";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { agents } from "./agents.ts";
import type { ActivityEntry } from "../shared/workspace.ts";
import type { AgentTurnOptions, AgentControl, SteerInput } from "./agent-turn.ts";

// One stdio connection owns a single turn. Codex persists the thread between turns.
export function runCodex(o: AgentTurnOptions) {
  const binary =
    process.env.THINDESK_CODEX ||
    agents.find((a) => a.name === "Codex CLI")?.executable;
  if (!binary) throw Error("服务器未找到 Codex CLI");
  const sandbox =
    o.permission === "完全权限"
      ? "danger-full-access"
      : o.permission === "工作区内修改"
        ? "workspace-write"
        : "read-only";
  const child = spawn(binary, ["-c", "features.default_mode_request_user_input=true", "-c", "features.multi_agent_v2=true", "app-server", "--listen", "stdio://"], {
    cwd: o.cwd,
    stdio: ["pipe", "pipe", "ignore"],
  });
  let thread = o.thread,
    turn = "",
    closed = false,
    cancelled = false;
  let compacting = false;
  let timer: NodeJS.Timeout | undefined,
    temp = "";
  const items = new Map<string, { text: string; phase?: string }>();
  const activity = new Map<string, ActivityEntry>();
  let steerSequence = 1000;
  const steering = new Map<number, (accepted: boolean, note?: string) => void>();
  function updateText() {
    for (const [id, item] of items) {
      if (item.phase === "commentary")
        activity.set(id, {
          id,
          kind: "commentary",
          label: item.text.split("\n", 1)[0].slice(0, 100),
          text: item.text,
        });
    }
    o.onActivity([...activity.values()]);
    o.onText(
      [...items.values()]
        .filter((item) => item.phase !== "commentary")
        .map((item) => item.text)
        .join("\n\n"),
    );
  }
  const send = (object: object) => {
    if (!closed && !child.stdin.destroyed)
      child.stdin.write(JSON.stringify(object) + "\n");
  };
  const request = (id: number, method: string, params: object) =>
    send({ id, method, params });
  function finish(notice?: string) {
    if (closed) return;
    if (compacting) o.onCompaction?.("error", notice || "CLI 已结束本轮，上下文整理未完成");
    for (const done of steering.values()) done(false, "本轮已结束，保留在下一轮队列");
    steering.clear();
    closed = true;
    clearTimeout(timer);
    child.stdin.end();
    child.kill("SIGTERM");
    const force = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }, 3000);
    force.unref();
    if (temp) rmSync(temp, { recursive: true, force: true });
    o.onEnd(cancelled ? "已停止生成。" : notice);
  }
  function startTurn() {
    const input: object[] = [];
    const text = (value: string) =>
      input.push({ type: "text", text: value, text_elements: [] });
    if (!o.thread && o.history.length) {
      text(
        "以下是本会话此前在网页中显示的对话记录。\n" +
          o.history
            .map((m) => (m.role === "user" ? "用户" : "助手") + "：" + m.text)
            .join("\n\n"),
      );
    }
    if (o.prompt) text(o.prompt);
    if (o.files.length) temp = mkdtempSync(join(tmpdir(), "thindesk-input-"));
    o.files.forEach((file, index) => {
      const path = join(
        temp,
        index + "-" + basename(file.name).replaceAll("\0", "_"),
      );
      writeFileSync(path, file.bytes, { mode: 0o600 });
      if (/^\.(png|jpe?g|webp|gif)$/i.test(extname(path)))
        input.push({ type: "localImage", path });
      else text("本轮附件 " + file.name + " 的本地路径：" + path);
    });
    request(3, "turn/start", {
      threadId: thread,
      input,
      ...(o.model ? { model: o.model } : {}),
      ...(o.effort ? { effort: o.effort } : {}),
    });
  }
  function cancel() {
    if (closed || cancelled) return;
    cancelled = true;
    if (!turn) return finish();
    request(4, "turn/interrupt", { threadId: thread, turnId: turn });
    clearTimeout(timer);
    timer = setTimeout(() => finish(), 3000);
  }
  child.on("error", (e) => finish(e.message));
  child.stdin.on("error", () => finish("Codex 连接已关闭。"));
  child.on("close", () => finish("Codex 进程提前退出。"));
  // JSONL is delimited by LF only; readline also splits valid U+2028/U+2029 text.
  child.stdout.setEncoding("utf8");
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!closed && line.trim()) handleLine(line);
    }
  });
  function handleLine(line: string) {
    try {
      const e = JSON.parse(line),
        p = e.params || {};
      if (!e.method && steering.has(e.id)) {
        const done = steering.get(e.id)!; steering.delete(e.id);
        done(!e.error, e.error ? "CLI 当前无法接收，保留在下一轮队列" : undefined);
        return;
      }
      if (e.method && e.id != null) {
        const interaction = codexInteraction(e.method, String(e.id), p);
        if (interaction && o.onRequest) {
          o.onRequest(interaction.request, response => {
            send({ id: e.id, result: interaction.result(response) });
            o.onResolved?.(String(e.id));
          });
          return;
        }
        send({
          id: e.id,
          error: { code: -32601, message: "当前网页未启用此交互请求" },
        });
      } else if (e.error) finish(e.error.message || "Codex 请求失败");
      else if (e.id === 1) {
        send({ method: "initialized", params: {} });
        request(2, thread ? "thread/resume" : "thread/start", {
          ...(thread ? { threadId: thread } : {}),
          ...(o.model ? { model: o.model } : {}),
          ...(o.effort ? { config: { model_reasoning_effort: o.effort } } : {}),
          cwd: o.cwd,
          sandbox,
          approvalPolicy: o.permission === "完全权限" ? "never" : "on-request",
        });
      } else if (e.id === 2) {
        thread = e.result.thread.id;
        o.onThread(thread!);
        if (e.result.model || o.model) o.onModel(e.result.model || o.model, e.result.reasoningEffort ?? o.effort);
        startTurn();
      } else if (e.id === 3) {
        turn = e.result.turn.id;
        clearTimeout(timer);
      } else if (e.method === "serverRequest/resolved") {
        o.onResolved?.(String(p.requestId));
      } else if (p.threadId && p.threadId !== thread && activity.has("agent:" + p.threadId)) {
        // Child notifications may share this connection. Only their final report belongs on the card.
        if (e.method === "item/completed" && p.item?.type === "agentMessage" &&
            p.item.phase !== "commentary" && p.item.text) {
          const child = activity.get("agent:" + p.threadId)!;
          activity.set(child.id, { ...child, output: p.item.text });
          o.onActivity([...activity.values()]);
        }
      } else if (thread && p.threadId === thread) {
        if ((e.method === "item/started" || e.method === "item/completed") &&
            (!turn || !p.turnId || p.turnId === turn) && p.item && recordSubagent(activity, p.item)) {
          o.onActivity([...activity.values()]);
          return;
        }
        if (e.method === "thread/settings/updated" && p.threadSettings?.model) {
          o.onModel(p.threadSettings.model, p.threadSettings.effort ?? undefined);
          return;
        }
        if (e.method === "model/rerouted" && p.toModel && p.turnId === turn) {
          o.onModel(p.toModel);
          return;
        }
        if ((e.method === "item/started" || e.method === "item/completed") && p.item?.type === "contextCompaction") {
          compacting = e.method === "item/started";
          o.onCompaction?.(compacting ? "running" : "complete");
          return;
        }
        if (e.method === "thread/compacted") { compacting = false; o.onCompaction?.("complete"); return; }
        if (e.method === "thread/tokenUsage/updated") {
          o.onUsage(p.tokenUsage);
          return;
        }
        if (e.method === "item/commandExecution/outputDelta") {
          const old = activity.get(p.itemId);
          const output = (old?.output || "") + p.delta;
          activity.set(p.itemId, {
            ...old,
            id: p.itemId,
            kind: "tool",
            label: old?.label || "执行命令",
            toolType: "terminal",
            output: output.slice(-8000),
            truncated: old?.truncated || output.length > 8000,
            status: "running",
          });
          o.onActivity([...activity.values()]);
          return;
        }
        if (e.method === "turn/plan/updated") {
          activity.set("execution-plan", {
            id: "execution-plan",
            kind: "plan",
            label: "执行计划",
            text: p.explanation || undefined,
            plan: p.plan,
          });
          o.onActivity([...activity.values()]);
          return;
        }
        if (e.method === "item/agentMessage/delta") {
          const item = items.get(p.itemId) || { text: "" };
          items.set(p.itemId, { ...item, text: item.text + p.delta });
        } else if (
          (e.method === "item/started" || e.method === "item/completed") &&
          p.item?.type === "agentMessage"
        ) {
          items.set(p.item.id, {
            text: p.item.text || items.get(p.item.id)?.text || "",
            phase: p.item.phase ?? items.get(p.item.id)?.phase,
          });
        } else if (e.method === "item/reasoning/summaryTextDelta") {
          const old = activity.get(p.itemId);
          activity.set(p.itemId, {
            id: p.itemId,
            kind: "reasoning",
            label: "思考",
            text: (old?.text || "") + p.delta,
          });
          o.onActivity([...activity.values()]);
          return;
        } else if (
          (e.method === "item/started" || e.method === "item/completed") &&
          [
            "commandExecution",
            "fileChange",
            "mcpToolCall",
            "webSearch",
          ].includes(p.item?.type)
        ) {
          const item = p.item,
            done = e.method === "item/completed";
          const label =
            item.command ||
            item.tool ||
            (item.type === "webSearch" ? "搜索网页" : "修改文件");
          const rawOutput =
            typeof item.aggregatedOutput === "string"
              ? item.aggregatedOutput
              : activity.get(item.id)?.output ||
                (item.result ? JSON.stringify(item.result) : "");
          const output = String(rawOutput).slice(-8000);
          activity.set(item.id, {
            id: item.id,
            kind: "tool",
            toolName: item.type === "mcpToolCall" ? [item.server, item.tool].filter(Boolean).join("/") : item.type,
            label:
              item.type === "fileChange"
                ? "修改文件 · " +
                  (item.changes || [])
                    .map((change: { path: string }) =>
                      change.path.split("/").pop(),
                    )
                    .join("、")
                : String(label).slice(0, 200),
            action:
              item.type === "commandExecution"
                ? "run"
                : item.type === "fileChange"
                  ? "edit"
                  : item.type === "webSearch"
                    ? "search"
                    : "tool",
            files:
              item.type === "fileChange" && done && item.status === "completed"
                ? fileChangeStats(item.changes || [])
                : undefined,
            toolType:
              item.type === "commandExecution"
                ? "terminal"
                : item.type === "fileChange"
                  ? "diff"
                  : "tool",
            command: item.command,
            exitCode:
              typeof item.exitCode === "number" ? item.exitCode : undefined,
            durationMs:
              typeof item.durationMs === "number" ? item.durationMs : undefined,
            truncated:
              String(rawOutput).length > 8000 ||
              activity.get(item.id)?.truncated,
            output:
              item.type === "fileChange"
                ? JSON.stringify(item.changes || [])
                : output,
            status:
              item.status === "failed" || item.status === "declined"
                ? "error"
                : done
                  ? "complete"
                  : "running",
          });
          o.onActivity([...activity.values()]);
          return;
        } else if (e.method === "turn/completed") {
          finish(
            p.turn.status === "failed"
              ? p.turn.error?.message || "Codex 回答失败。"
              : p.turn.status === "interrupted"
                ? "已停止生成。"
                : undefined,
          );
          return;
        } else return;
        updateText();
      }
    } catch (e) {
      finish(e instanceof Error ? e.message : "Codex 响应无效");
    }
  }
  timer = setTimeout(() => finish("Codex 启动超时。"), 90000);
  request(1, "initialize", {
    clientInfo: { name: "thindesk", title: "ThinDesk", version: "1" },
  });
  const control: AgentControl = Object.assign(cancel, {
    steer(input: SteerInput, done: (accepted: boolean, note?: string) => void) {
      if (closed || cancelled || !turn) return done(false, "当前没有可接收补充的活动轮次");
      const id = ++steerSequence;
      const parts: object[] = [{ type: "text", text: input.text, text_elements: [] }];
      if (input.files.length) temp ||= mkdtempSync(join(tmpdir(), "thindesk-input-"));
      for (const [index, file] of input.files.entries()) {
        const path = join(temp, `steer-${id}-${index}-` + basename(file.name).replaceAll("\0", "_"));
        writeFileSync(path, file.bytes, { mode: 0o600 });
        parts.push(/^\.(png|jpe?g|webp|gif)$/i.test(extname(path))
          ? { type: "localImage", path }
          : { type: "text", text: "附件 " + file.name + " 的本地路径：" + path, text_elements: [] });
      }
      steering.set(id, done);
      request(id, "turn/steer", { threadId: thread, expectedTurnId: turn, input: parts, clientUserMessageId: input.id });
    },
  });
  return control;
}
