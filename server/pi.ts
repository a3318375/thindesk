import { piInteraction } from "./interactions.ts";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { agents } from "./agents.ts";
import { fileChangeStats } from "../shared/activities.ts";
import type { ActivityEntry } from "../shared/workspace.ts";
import type { AgentTurnOptions, AgentControl, SteerInput } from "./agent-turn.ts";

export function runPi(o: AgentTurnOptions) {
  const binary =
    process.env.THINDESK_PI ||
    agents.find((agent) => agent.name === "Pi CLI")?.executable;
  if (!binary) throw Error("服务器未找到 Pi CLI");
  if (o.permission === "工作区内修改")
    throw Error("Pi CLI 不支持工作区沙箱，请选择仅可查看或完全权限。");
  const directory = o.sessionDirectory;
  mkdirSync(directory, { recursive: true });
  const session = o.thread || join(directory, randomUUID() + ".jsonl");
  const args = ["--mode", "rpc", "--offline", "--session", session];
  if (o.model) args.push("--model", o.model);
  if (o.effort) args.push("--thinking", o.effort);
  args.push("--extension", fileURLToPath(new URL("./pi-questions.ts", import.meta.url)));
  if (o.permission === "仅可查看")
    args.push("--tools", "read,grep,find,ls", "--no-mcp");
  const child = spawn(binary, args, {
    cwd: o.cwd,
    stdio: ["pipe", "pipe", "ignore"],
  });
  let closed = false,
    cancelled = false,
    buffer = "",
    completed = "",
    partial = "",
    notice = "",
    temp = "";
  let compacting = false;
  let timer: NodeJS.Timeout | undefined;
  const activity = new Map<string, ActivityEntry>();
  const steering = new Map<string, (accepted: boolean, note?: string) => void>();
  let messageIndex = 0;
  const send = (message: object) => {
    if (!closed && !child.stdin.destroyed)
      child.stdin.write(JSON.stringify(message) + "\n");
  };
  function finish(error?: string) {
    if (closed) return;
    if (compacting) o.onCompaction?.("error", error || "CLI 已结束本轮，上下文整理未完成");
    for (const done of steering.values()) done(false, "本轮已结束，保留在下一轮队列");
    steering.clear();
    closed = true;
    clearTimeout(timer);
    child.stdin.end();
    child.kill();
    const force = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }, 3000);
    force.unref();
    if (temp) rmSync(temp, { recursive: true, force: true });
    o.onEnd(cancelled ? "已停止生成。" : error || notice || undefined);
  }
  function prompt() {
    let message = o.prompt;
    if (!o.thread && o.history.length)
      message =
        "以下是本会话此前的对话记录。\n" +
        o.history
          .map(
            (item) => (item.role === "user" ? "用户：" : "助手：") + item.text,
          )
          .join("\n\n") +
        "\n\n用户：" +
        message;
    const images: { type: "image"; data: string; mimeType: string }[] = [];
    const mime: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
    };
    for (const [index, file] of o.files.entries()) {
      const type = mime[extname(file.name).toLowerCase()];
      if (type)
        images.push({
          type: "image",
          data: file.bytes.toString("base64"),
          mimeType: type,
        });
      else {
        temp ||= mkdtempSync(join(tmpdir(), "thindesk-pi-"));
        const path = join(
          temp,
          index + "-" + basename(file.name).replaceAll("\0", "_"),
        );
        writeFileSync(path, file.bytes, { mode: 0o600 });
        message += "\n附件 " + file.name + " 的本地路径：" + path;
      }
    }
    send({ id: "prompt", type: "prompt", message, images });
  }
  child.on("error", (error) => finish(error.message));
  child.stdin.on("error", () => finish("Pi 连接已关闭。"));
  child.on("close", () => finish("Pi 进程提前退出。"));
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (closed || !line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "response") {
          if (steering.has(event.id)) {
            const done = steering.get(event.id)!; steering.delete(event.id);
            done(event.success === true, event.success ? undefined : "CLI 当前无法接收，保留在下一轮队列");
            continue;
          }
          if (!event.success) return finish(event.error || "Pi 请求失败。");
          if (event.id === "state") {
            if (cancelled) return finish();
            o.onThread(event.data.sessionFile || session);
            const model = event.data.model;
            if (o.model || model?.id)
              o.onModel(
                model?.id ? (model.provider ? model.provider + "/" : "") + model.id : o.model!,
                event.data.thinkingLevel ?? o.effort,
              );
            prompt();
          } else if (event.id === "prompt") {
            if (!cancelled) clearTimeout(timer);
            if (event.data?.disposition === "handled") finish();
          } else if (event.id === "stats") {
            const stats = event.data,
              tokens = stats.tokens || {};
            const total = {
              inputTokens:
                (tokens.input || 0) +
                (tokens.cacheRead || 0) +
                (tokens.cacheWrite || 0),
              outputTokens: tokens.output || 0,
              cachedInputTokens: tokens.cacheRead || 0,
              reasoningOutputTokens: 0,
              totalTokens: tokens.total || 0,
            };
            o.onUsage({
              total,
              last: {
                ...total,
                totalTokens: stats.contextUsage?.tokens ?? total.totalTokens,
              },
              modelContextWindow: stats.contextUsage?.contextWindow,
            });
            finish();
          }
        } else if (
          event.type === "message_start" &&
          event.message?.role === "assistant"
        ) {
          partial = "";
          messageIndex++;
        } else if (
          event.type === "message_update" &&
          event.assistantMessageEvent?.type === "text_delta"
        ) {
          partial += event.assistantMessageEvent.delta;
          o.onText(completed + partial);
        } else if (
          event.type === "message_update" &&
          event.assistantMessageEvent?.type === "thinking_delta"
        ) {
          const id = "pi-reasoning-" + messageIndex;
          activity.set(id, {
            id,
            kind: "reasoning",
            label: "思考",
            text:
              (activity.get(id)?.text || "") +
              event.assistantMessageEvent.delta,
          });
          o.onActivity([...activity.values()]);
        } else if (
          event.type === "message_end" &&
          event.message?.role === "assistant"
        ) {
          const text = event.message.content
            .filter((part: { type: string }) => part.type === "text")
            .map((part: { text: string }) => part.text)
            .join("\n");
          const toolUse =
            event.message.stopReason === "toolUse" ||
            event.message.content.some(
              (part: { type: string }) => part.type === "toolCall",
            );
          if (toolUse && text) {
            const id = "pi-commentary-" + messageIndex;
            activity.set(id, {
              id,
              kind: "commentary",
              label: text.split("\n", 1)[0].slice(0, 100),
              text,
            });
            o.onActivity([...activity.values()]);
          } else completed += text + (text ? "\n\n" : "");
          partial = "";
          o.onText(completed.trimEnd());
          if (event.message.errorMessage) notice = event.message.errorMessage;
        } else if (
          event.type === "tool_execution_start" ||
          event.type === "tool_execution_update" ||
          event.type === "tool_execution_end"
        ) {
          const label =
            event.toolName +
            (event.args ? " " + JSON.stringify(event.args) : "");
          const result =
            event.type === "tool_execution_update"
              ? event.partialResult
              : event.result;
          const output =
            result?.content
              ?.filter((part: { type: string }) => part.type === "text")
              .map((part: { text: string }) => part.text)
              .join("\n") || "";
          const done = event.type === "tool_execution_end";
          const path = event.args?.path || activity.get(event.toolCallId)?.target;
          const patch =
            done && !event.isError && event.toolName === "edit" &&
            typeof result?.details?.patch === "string"
              ? result.details.patch
              : undefined;
          const changes = path && patch ? [{ path, diff: patch }] : undefined;
          activity.set(event.toolCallId, {
            id: event.toolCallId,
            kind: "tool",
            toolName: event.toolName || activity.get(event.toolCallId)?.toolName,
            label: (activity.get(event.toolCallId)?.label || label).slice(
              0,
              200,
            ),
            action:
              event.toolName === "bash"
                ? "run"
                : ["read", "grep", "find", "ls"].includes(event.toolName)
                  ? "read"
                  : ["edit", "write"].includes(event.toolName)
                    ? "edit"
                    : "tool",
            target: event.args?.path || activity.get(event.toolCallId)?.target,
            files: changes ? fileChangeStats(changes) :
              done &&
              !event.isError &&
              ["edit", "write"].includes(event.toolName) &&
              (event.args?.path || activity.get(event.toolCallId)?.target)
                ? [
                    {
                      path:
                        event.args?.path ||
                        activity.get(event.toolCallId)?.target,
                    },
                  ]
                : undefined,
            toolType: changes ? "diff" : event.toolName === "bash" ? "terminal" : "tool",
            command:
              event.args?.command || activity.get(event.toolCallId)?.command,
            exitCode:
              typeof result?.details?.exitCode === "number"
                ? result.details.exitCode
                : undefined,
            durationMs:
              typeof event.durationMs === "number"
                ? event.durationMs
                : undefined,
            truncated: changes ? false : output.length > 8000,
            output: changes ? JSON.stringify(changes) : output.slice(-8000),
            status: event.isError ? "error" : done ? "complete" : "running",
          });
          o.onActivity([...activity.values()]);
        } else if (event.type === "compaction_start" || event.type === "auto_compaction_start") {
          compacting = true;
          o.onCompaction?.("running");
        } else if (event.type === "compaction_end" || event.type === "auto_compaction_end") {
          compacting = false;
          o.onCompaction?.(event.aborted || event.errorMessage ? "error" : "complete", event.errorMessage || (event.aborted ? "CLI 已取消本次压缩" : undefined));
        } else if (event.type === "agent_settled") {
          if (event.aborted || cancelled) finish("已停止生成。");
          else {
            send({ id: "stats", type: "get_session_stats" });
            timer = setTimeout(() => finish(), 3000);
          }
        } else if (event.type === "extension_ui_request") {
          const request = piInteraction(event);
          if (request && o.onRequest) {
            o.onRequest(request, response => {
              send({ type: "extension_ui_response", id: event.id,
                ...(response.cancelled ? { cancelled: true } : event.method === "confirm"
                  ? { confirmed: response.approved === true }
                  : { value: response.answers?.value || "" }),
              });
              o.onResolved?.(String(event.id));
            });
          } else if (request) send({ type: "extension_ui_response", id: event.id, cancelled: true });
        }
      } catch (error) {
        finish(error instanceof Error ? error.message : "Pi 响应无效。");
      }
    }
  });
  timer = setTimeout(() => finish("Pi 启动超时。"), 90000);
  send({ id: "state", type: "get_state" });
  const stop = () => {
    if (closed || cancelled) return;
    cancelled = true;
    send({ id: "abort", type: "abort" });
    clearTimeout(timer);
    timer = setTimeout(() => finish(), 3000);
  };
  const control: AgentControl = Object.assign(stop, {
    steer(input: SteerInput, done: (accepted: boolean, note?: string) => void) {
      if (closed || cancelled) return done(false, "本轮已结束");
      const id = "steer-" + input.id;
      let message = input.text;
      const images: { type: "image"; data: string; mimeType: string }[] = [];
      for (const [index, file] of input.files.entries()) {
        const extension = extname(file.name).toLowerCase();
        const mime: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
        if (mime[extension]) images.push({ type: "image", data: file.bytes.toString("base64"), mimeType: mime[extension] });
        else {
          temp ||= mkdtempSync(join(tmpdir(), "thindesk-pi-"));
          const path = join(temp, `${id}-${index}-` + basename(file.name).replaceAll("\0", "_"));
          writeFileSync(path, file.bytes, { mode: 0o600 });
          message += "\n附件 " + file.name + " 的本地路径：" + path;
        }
      }
      steering.set(id, done);
      send({ id, type: "steer", message, images });
    },
  });
  return control;
}
