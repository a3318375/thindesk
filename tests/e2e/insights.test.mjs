import { test } from "node:test";
import assert from "node:assert/strict";
import { insightsView } from "../../server/insights.ts";
const usage = (totalTokens) => ({ inputTokens: totalTokens - 100, outputTokens: 100, cachedInputTokens: 50, reasoningOutputTokens: 20, totalTokens });
const make = (session) => insightsView({ sessions: [{ id: "test", title: "标题", workspace: "/project", messages: [], ...session }] }).sessions[0];
test("历史累计用量不冒充最后一天用量；未保留原文或工具输出", () => {
  const result = make({ updatedAt: Date.now(), tokenUsage: { total: usage(10000), last: usage(1000), modelContextWindow: 20000 }, messages: [{ id: "m", role: "assistant", text: "x".repeat(10000), activity: [{ kind: "tool", label: "read_file", output: "SECRET_OUTPUT" }] }] });
  assert.equal(result.undatedTokens, 10000);
  assert.equal(result.days.length, 0);
  assert.equal(result.tools.read_file, 1);
  assert.equal(result.preview.length, 240);
  assert.equal(result.messages, undefined);
  assert.equal(JSON.stringify(result).includes("SECRET_OUTPUT"), false);
});
test("真实每轮用量跨日累加，执行时间独立统计，不重复计入旧命令字段", () => {
  const result = make({ tokenUsage: { total: usage(3000), last: usage(2000) }, messages: [
    { id: "m1", role: "assistant", text: "", tokenUsage: usage(1000), startedAt: Date.parse("2026-11-18T10:00:00+08:00"), finishedAt: Date.parse("2026-11-18T10:00:10+08:00"), command: "npm run build", activity: [{ kind: "tool", label: "exec_command", command: "npm run build", durationMs: 3000 }] },
    { id: "m2", role: "assistant", text: "", tokenUsage: usage(2000), startedAt: Date.parse("2026-11-19T10:00:00+08:00"), finishedAt: Date.parse("2026-11-19T10:00:05+08:00") },
  ] });
  assert.deepEqual(result.days.map(day => day.tokens), [1000, 2000]);
  assert.equal(result.undatedTokens, 0);
  assert.equal(result.commands.npm, 1);
  assert.equal(result.toolSeconds, 3);
  assert.equal(result.seconds, 15);
  assert.equal(result.toolRunSeconds, 10);
});
test("有 CLI 实际数据时不再混入该会话的示例费用与用量", () => {
  const result = make({ sampleUsage: { tokens: [900000], seconds: [90], cached: 0, costUSD: 999, skill: "demo" }, tokenUsage: { total: usage(1000), last: usage(1000) } });
  assert.equal(result.sample, false);
  assert.equal(result.usage.totalTokens, 1000);
  assert.equal(result.sampleCost, undefined);
  assert.deepEqual(result.skills, {});
});

import { addNativeUsage, dailyNativeUsage } from "../../server/native-usage.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("原生累计事件去重，按记录日期差分，不纳入超过快照的用量", () => {
  const days = dailyNativeUsage([
    { date: "2026-11-18", usage: usage(1000) },
    { date: "2026-11-19", usage: usage(1000) },
    { date: "2026-11-19", usage: usage(1500) },
    { date: "2026-11-19", usage: usage(3000) },
    { date: "2026-11-19", usage: usage(2000) },
  ], 2000);
  assert.deepEqual([...days].map(([date, value]) => [date, value.totalTokens]), [["2026-11-18", 1000], ["2026-11-19", 1000]]);
});
test("流式读取旧 Codex 日志补回每日用量，跳过正文、重复与未写完的记录", async () => {
  const root = await mkdtemp(join(tmpdir(), "thindesk-native-usage-"));
  try {
    const event = (timestamp, total) => JSON.stringify({ type: "event_msg", timestamp, payload: { type: "token_count", info: { total_token_usage: { input_tokens: total - 100, output_tokens: 100, cached_input_tokens: 50, reasoning_output_tokens: 20, total_tokens: total } } } });
    await writeFile(join(root, "rollout-example-thread.jsonl"), [
      JSON.stringify({ type: "response_item", payload: { text: "SECRET_BODY" } }),
      event("2026-11-18T12:00:00+08:00", 2000), event("2026-11-18T12:01:00+08:00", 2000),
      event("2026-11-19T12:00:00+08:00", 5000), event("2026-11-19T12:01:00+08:00", 8000), '{"token_count":',
    ].join("\n"));
    const desk = { sessions: [{ id: "s", title: "旧会话", workspace: "/project", codexThread: "example-thread", tokenUsage: { total: usage(5000), last: usage(1000) }, messages: [] }] };
    const data = await addNativeUsage(insightsView(desk), desk, root);
    assert.equal(data.sessions[0].undatedTokens, 0);
    assert.deepEqual(data.sessions[0].days.map(day => day.tokens), [2000, 3000]);
    assert.equal(JSON.stringify(data).includes("SECRET_BODY"), false);
    const again = await addNativeUsage(insightsView(desk), desk, root);
    assert.deepEqual(again.sessions[0].days, data.sessions[0].days);
  } finally { await rm(root, { recursive: true, force: true }); }
});

import { commandPrograms } from "../../server/command-programs.ts";
test("命令排行展开 shell 包装、管道和多行，保留引号内分隔符", () => {
  assert.deepEqual(commandPrograms('/bin/bash -lc "rg \'x;y\' .; npm run build"'), ["rg", "npm"]);
  assert.deepEqual(commandPrograms("echo 'a;b' && /usr/bin/rg needle docs | head -5"), ["echo", "rg", "head"]);
  assert.deepEqual(commandPrograms("NAME=value node test.mjs\nprintf 'line1\nline2'"), ["node", "printf"]);
  assert.deepEqual(commandPrograms("python3 - <<'PY'\nimport os\nprint('hello')\nPY\nrg x ."), ["python3", "rg"]);
  assert.deepEqual(commandPrograms("echo '<<EOF'\nls"), ["echo", "ls"]);
  assert.deepEqual(commandPrograms("echo 'unterminated"), []);
});

test("旧版混合命令日志只分析首行，不把执行输出统计成程序", () => {
  const result = make({ messages: [{ id: "old", role: "assistant", text: "", command: "npm run build\n\n}\n=\ncompiled successfully" }] });
  assert.deepEqual(result.commands, { npm: 1 });
});
