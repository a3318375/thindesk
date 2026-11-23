import type { ActivityEntry, SubagentTask } from "../shared/workspace.ts";

type NativeAgent = { status: string; message?: string | null };
type NativeItem = {
  id: string;
  type: string;
  tool?: string;
  kind?: string;
  status?: string;
  agentPath?: string;
  agentThreadId?: string;
  receiverThreadIds?: string[];
  prompt?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  agentsStates?: Record<string, NativeAgent>;
};
const states: Record<string, SubagentTask["state"]> = {
  pendingInit: "waiting", running: "working", completed: "done", errored: "failed",
  interrupted: "cancelled", shutdown: "closed", notFound: "unknown",
};

// A completed spawn/wait call describes the tool invocation, not the child's outcome.
export function recordSubagent(activity: Map<string, ActivityEntry>, item: NativeItem) {
  if (item.type !== "subAgentActivity" && item.type !== "collabAgentToolCall") return false;
  const spawn = item.tool === "spawnAgent";
  const childIds = new Set(item.receiverThreadIds || []);
  for (const id of Object.keys(item.agentsStates || {})) childIds.add(id);
  if (item.agentThreadId) childIds.add(item.agentThreadId);
  const pendingKey = "spawn:" + item.id;
  const pending = spawn ? activity.get(pendingKey) : undefined;
  if (spawn && childIds.size) activity.delete(pendingKey);
  const keys = Array.from(childIds, id => "agent:" + id);
  if (spawn && !keys.length) keys.push(pendingKey);

  for (const key of keys) {
    const previous = activity.get(key);
    const task: SubagentTask = { state: "unknown", ...previous?.subagent };
    const report = key.startsWith("agent:") ? item.agentsStates?.[key.slice(6)] : undefined;
    let prompt = previous?.text || pending?.text;
    let result = previous?.output;
    if (spawn) {
      prompt = item.prompt || prompt;
      task.requestedModel = item.model || task.requestedModel || pending?.subagent?.requestedModel;
      task.requestedEffort = item.reasoningEffort || task.requestedEffort || pending?.subagent?.requestedEffort;
      if (!previous) task.state = "waiting";
      if (task.state === "waiting" && item.status === "failed") task.state = "failed";
      if (task.state === "waiting" && item.status === "interrupted") task.state = "cancelled";
    }
    if (item.type === "subAgentActivity") {
      task.path = item.agentPath || task.path;
      task.model = item.model || task.model;
      task.effort = item.reasoningEffort || task.effort;
      if (item.kind === "started" && (!previous || ["waiting", "unknown"].includes(task.state))) task.state = "working";
      if (item.kind === "completed" && !["failed", "cancelled", "closed"].includes(task.state)) task.state = "done";
      if (item.kind === "interrupted") task.state = "cancelled";
    }
    if (item.tool === "followupTask" && item.prompt && item.status !== "failed" && item.status !== "interrupted") {
      prompt = item.prompt;
      if (item.status === "inProgress") {
        result = undefined;
        task.state = "waiting";
      }
    }
    if (report) {
      const state = states[report.status];
      // Closing a finished child does not erase its result.
      if (state && !(state === "closed" && ["done", "failed", "cancelled"].includes(task.state))) task.state = state;
      if (report.message) result = report.message;
    }
    activity.set(key, {
      id: key, kind: "subagent", label: (prompt?.trim().split("\n", 1)[0] || task.path || "子代理任务").slice(0, 100),
      subagent: task, text: prompt, output: result,
    });
  }
  return true;
}
