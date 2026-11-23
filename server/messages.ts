import { randomUUID } from "node:crypto";
import type { Desk, QueuedMessage } from "../shared/workspace.ts";
import type { ImChannel } from "../shared/im.ts";
// Web and IM create exactly the same persisted queue entries. The runner remains
// the sole owner of CLI startup, model changes and native session identifiers.
export function enqueueMessage(
  state: Desk,
  workspace: string,
  pending: QueuedMessage,
  sessionId?: string,
  channel?: ImChannel,
  immediate = false,
) {
  let session = state.sessions.find(
    (session) => session.id === sessionId && session.workspace === workspace,
  );
  if (sessionId && !session) throw Error("会话不存在");
  if (!session) {
    session = {
      id: randomUUID(),
      workspace,
      title: (
        pending.text.trim() ||
        pending.attachments[0]?.name ||
        "新会话"
      ).slice(0, 40),
      channel,
      messages: [],
      agent: pending.agent,
      model: pending.model,
      effort: pending.effort,
      permission: pending.permission,
      mode: pending.mode,
    };
    state.sessions.unshift(session);
  }
  session.queue ??= [];
  if (immediate) session.queue.unshift(pending);
  else session.queue.push(pending);
  session.queuePaused = false;
  delete session.queueError;
  session.updatedAt = Date.now();
  return session;
}
