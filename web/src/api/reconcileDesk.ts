import type { Desk, Message, Session } from "../../../shared/workspace";

function sameMessage(a: Message, b: Message) {
  return (
    a.id === b.id &&
    JSON.stringify(a.requests) === JSON.stringify(b.requests) &&
    a.role === b.role &&
    a.text === b.text &&
    a.steered === b.steered &&
    JSON.stringify(a.tokenUsage) === JSON.stringify(b.tokenUsage) &&
    JSON.stringify(a.compaction) === JSON.stringify(b.compaction) &&
    a.command === b.command &&
    a.hasCommand === b.hasCommand &&
    a.commandVersion === b.commandVersion &&
    a.reasoning === b.reasoning &&
    a.approval === b.approval &&
    a.createdAt === b.createdAt &&
    a.startedAt === b.startedAt &&
    a.finishedAt === b.finishedAt &&
    a.runStatus === b.runStatus &&
    a.runError === b.runError &&
    JSON.stringify(a.activity) === JSON.stringify(b.activity) &&
    JSON.stringify(a.attachments) === JSON.stringify(b.attachments)
  );
}
export function reconcileSession(
  previous: Session | undefined,
  next: Session,
): Session {
  if (!previous) return next;
  const oldMessages = new Map(
    previous.messages.map((message) => [message.id, message]),
  );
  const prefix =
    previous.historyLoaded && next.messageOffset !== undefined
      ? previous.messages.slice(
          0,
          Math.max(0, next.messageOffset - (previous.messageOffset ?? 0)),
        )
      : [];
  const messages = [...prefix, ...next.messages].map((message) => {
    const old = oldMessages.get(message.id);
    return old && sameMessage(old, message) ? old : message;
  });
  const result = {
    ...next,
    messages,
    ...(JSON.stringify(previous.queue) === JSON.stringify(next.queue)
      ? { queue: previous.queue }
      : {}),
    ...(previous.historyLoaded && next.messageOffset !== undefined
      ? { historyLoaded: true }
      : {}),
    ...(prefix.length
      ? { messageOffset: previous.messageOffset, historyLoaded: true }
      : {}),
  };
  if (
    messages.length === previous.messages.length &&
    messages.every((message, index) => message === previous.messages[index])
  ) {
    result.messages = previous.messages;
    const { messages: _old, ...oldMeta } = previous;
    const { messages: _new, ...newMeta } = result;
    if (JSON.stringify(oldMeta) === JSON.stringify(newMeta)) return previous;
  }
  return result;
}
export function reconcileDesk(previous: Desk, next: Desk): Desk {
  if ((next.revision ?? 0) < (previous.revision ?? 0)) return previous;
  const sessions = new Map(
    previous.sessions.map((session) => [session.id, session]),
  );
  return {
    ...next,
    sessions: next.sessions.map((session) =>
      reconcileSession(sessions.get(session.id), session),
    ),
  };
}
