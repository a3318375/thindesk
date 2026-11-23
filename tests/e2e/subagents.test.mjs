import assert from "node:assert/strict";
import test from "node:test";
import { recordSubagent } from "../../server/codex-subagents.ts";

test("Codex 派发、创建、等待和关闭归并为同一子线程，派发结束不等于任务完成", () => {
  const activity = new Map();
  const spawn = { type: "collabAgentToolCall", id: "spawn", tool: "spawnAgent", model: "requested", prompt: "检查事件处理" };
  recordSubagent(activity, { ...spawn, status: "inProgress", receiverThreadIds: [] });
  recordSubagent(activity, { type: "subAgentActivity", id: "native", agentThreadId: "child", agentPath: "/review", kind: "started", model: "actual", reasoningEffort: "low" });
  recordSubagent(activity, { ...spawn, status: "completed", receiverThreadIds: ["child"] });
  const get = () => activity.get("agent:child");
  assert.equal(activity.size, 1);
  assert.equal(get().subagent.state, "working");
  assert.equal(get().subagent.model, "actual");
  assert.equal(get().subagent.effort, "low");
  assert.equal(get().subagent.requestedModel, "requested");
  assert.equal(get().text, "检查事件处理");
  const report = { type: "collabAgentToolCall", id: "wait", tool: "wait", status: "completed", receiverThreadIds: ["child", "other"] };
  recordSubagent(activity, { ...report, agentsStates: { child: { status: "completed", message: "检查完毕" }, other: { status: "errored", message: "读取失败" } } });
  recordSubagent(activity, { ...report, tool: "closeAgent", receiverThreadIds: ["child"], agentsStates: { child: { status: "shutdown" } } });
  assert.equal(get().subagent.state, "done");
  assert.equal(get().output, "检查完毕");
  assert.equal(activity.get("agent:other").subagent.state, "failed");
  assert.equal(activity.get("agent:other").output, "读取失败");
});

test("派发失败且未分配子线程时保留失败记录", () => {
  const activity = new Map();
  recordSubagent(activity, { type: "collabAgentToolCall", id: "spawn", tool: "spawnAgent", status: "failed", prompt: "查日志" });
  assert.equal(activity.get("spawn:spawn").subagent.state, "failed");
});
