import { randomUUID } from "node:crypto";
import { PERSONAL_SESSION_ID, type Session } from "../shared/workspace.ts";

// Queue state is persisted with the session; CLI processes only own active turns.
export function beginQueuedTurn(session: Session) {
  if (session.running || session.queuePaused || !session.queue?.length) return;
  const item = session.queue.shift()!;
  if ((session.agent ?? "codex") !== item.agent) {
    delete session.codexThread;
    delete session.piSession;
    delete session.tokenUsage;
  }
  session.agent = item.agent;
  session.model = item.model;
  session.effort = item.effort;
  session.permission = item.permission;
  if (!session.messages.length) {
    if (session.id !== PERSONAL_SESSION_ID) session.title = (
      item.text.trim() ||
      item.attachments[0]?.name ||
      "新会话"
    ).slice(0, 40);
    session.mode = item.mode;
  }
  session.updatedAt = Date.now();
  delete session.queueError;
  session.messages.push({
    id: item.id,
    role: "user",
    origin: item.origin || "web",
    text: item.text,
    attachments: item.attachments,
    createdAt: session.updatedAt,
  });
  const replyId = randomUUID();
  session.messages.push({
    id: replyId,
    role: "assistant",
    origin: item.origin || "web",
    im: item.im,
    text: "",
    startedAt: Date.now(),
    createdAt: Date.now(),
  });
  session.running = true;
  return { item, replyId };
}
export function moveQueuedItem(
  session: Session,
  id: string,
  placement: {
    lane?: string;
    insertBefore?: string | null;
    insertAfter?: string | null;
  },
) {
  const queue = session.queue ?? [];
  const index = queue.findIndex((item) => item.id === id);
  if (index < 0) throw Error("待发送消息已发生变化");
  const item = queue[index];
  const rest = queue.filter((candidate) => candidate.id !== id);
  let destination = rest.length;
  if (typeof placement.insertBefore === "string")
    destination = rest.findIndex((item) => item.id === placement.insertBefore);
  else if (typeof placement.insertAfter === "string") {
    const anchor = rest.findIndex((item) => item.id === placement.insertAfter);
    destination = anchor < 0 ? -1 : anchor + 1;
  } else if (placement.insertAfter === null || placement.lane === "steer")
    destination = 0;
  if (destination < 0) throw Error("队列位置已发生变化");
  rest.splice(destination, 0, item);
  session.queue = rest;
  return (
    placement.lane === "steer" &&
    !placement.insertBefore &&
    !placement.insertAfter
  );
}
