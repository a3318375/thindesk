import { sessionVersions } from "./desk-store.ts";
import { fileChangeStats } from "../shared/activities.ts";
import { createHash } from "node:crypto";
import type { ActivityEntry, Desk, Session } from "../shared/workspace.ts";

function activityView(activity: ActivityEntry): ActivityEntry {
  const { output, ...entry } = activity;
  let files = entry.files;
  if (
    !files &&
    entry.toolType === "diff" &&
    entry.status !== "error" &&
    output
  ) {
    try {
      const changes = JSON.parse(output);
      if (Array.isArray(changes)) files = fileChangeStats(changes);
    } catch {
      /* Legacy records can contain plain output. */
    }
  }
  return {
    ...entry,
    ...(entry.subagent ? { text: undefined } : {}),
    files,
    hasOutput: !!output,
    outputVersion: output
      ? createHash("sha256").update(output).digest("hex").slice(0, 16)
      : undefined,
  };
}

export const MESSAGE_PAGE_SIZE = 20;
const summaries = new WeakMap<Session, { version: number; summary: Session }>();
export function sessionSummary(session: Session): Session {
  const version = sessionVersions.get(session);
  const cached = summaries.get(session);
  if (version !== undefined && cached?.version === version) return cached.summary;
  const summary: Session = {
    ...session,
    messages: [],
    queue: undefined,
    queueCount: session.queue?.length ?? 0,
    messageCount: session.messages.length,
    turnCount: session.messages.filter((message) => message.role === "user")
      .length,
    stepCount: session.messages.filter(
      (message) => message.role === "assistant",
    ).length,
    pendingApproval: session.messages.some(
      (message) => message.approval === "pending" || message.requests?.some(request => request.status === "pending"),
    ),
    preview: session.messages.at(-1)?.text.slice(0, 240) ?? "",
    files: session.messages.flatMap((message) => message.attachments ?? []),
  };
  if (version !== undefined) summaries.set(session, { version, summary });
  return summary;
}

export function sessionPage(session: Session, before?: string | null): Session {
  const end = before
    ? session.messages.findIndex((message) => message.id === before)
    : session.messages.length;
  if (end < 0) throw Error("消息游标不存在");
  const start = Math.max(0, end - MESSAGE_PAGE_SIZE);
  return {
    ...sessionSummary(session),
    queue: session.queue?.map(({ im, ...item }) => item),
    messages: session.messages.slice(start, end).map((message) => {
      const { command, im, ...rest } = message;
      return {
        ...rest,
        activity: message.activity?.map(activityView),
        hasCommand: !!command,
        commandVersion: command
          ? createHash("sha256").update(command).digest("hex").slice(0, 16)
          : undefined,
      };
    }),
    messageOffset: start,
  };
}
export function workspaceView(desk: Desk, session: string | null): Desk {
  return {
    ...desk,
    sessions: desk.sessions.map((item) =>
      item.id === session ? sessionPage(item) : sessionSummary(item),
    ),
  };
}
