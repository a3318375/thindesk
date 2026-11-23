#!/usr/bin/env node
import { join } from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const home = process.env.CODEX_HOME || process.env.THINDESK_DATA;
const resourcesFile = home && join(home, "fixture-resources.json");
const resources = () => { try { return JSON.parse(readFileSync(resourcesFile,"utf8")); } catch { return { enabled: true, servers: {} }; } };
const saveResources = value => { mkdirSync(home,{recursive:true});writeFileSync(resourcesFile,JSON.stringify(value)); };
const cli = process.argv.slice(2);
if (cli[0] === "mcp") {
  const value=resources();
  if(cli[1]==="list")console.log(JSON.stringify(Object.entries(value.servers).map(([name,server])=>({name,...server}))));
  if(cli[1]==="add"){value.servers[cli[2]]={enabled:true};saveResources(value);}
  if(cli[1]==="remove"){delete value.servers[cli[2]];saveResources(value);}
  process.exit(0);
}
const emit = (message) => console.log(JSON.stringify(message));
let threadId, turnId, resumed;
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params, result: nativeResult } = JSON.parse(line);
  if (id === "question-native" || id === "approval-native") {
    emit({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "answer", delta: "收到原生回答：" + JSON.stringify(nativeResult) } });
    emit({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
    continue;
  }
  if (id == null) continue;
  let result = {};
  if(method === "skills/list")result={data:[{cwd:params.cwds[0],skills:[{name:"test-skill",description:"CLI skill",path:join(home,"skills/test-skill/SKILL.md"),enabled:resources().enabled,scope:"user"}]}]};
  if(method === "skills/config/write"){const value=resources();value.enabled=params.enabled;saveResources(value);}
  if(method === "config/value/write"){const value=resources();const name=params.keyPath.split(".")[1];value.servers[name].enabled=params.value;saveResources(value);}
  if(method === "turn/steer") {
    if (params.input.some(p => p.text?.includes("不能插队"))) {
      // Server-originated requests have their own ID namespace.
      emit({ id, method: "item/commandExecution/requestApproval", params: { threadId, turnId, command: "pwd" } });
      emit({ method: "serverRequest/resolved", params: { threadId, requestId: id } });
      emit({ id, error: { code: -32600, message: "cannot steer now" } });
      continue;
    }
    emit({id,result:{turnId}});
    setTimeout(()=>{
      emit({method:"item/agentMessage/delta",params:{threadId,turnId,itemId:"steer-answer",delta:"测试回复 · 本轮补充："+params.input.filter(i=>i.text).map(i=>i.text).join(" ")}});
      emit({method:"turn/completed",params:{threadId,turn:{id:turnId,status:"completed"}}});
    },400);
    continue;
  }
  if (method === "model/list") result = { data: [{ id: "test-default", model: "test-default", displayName: "Test Default", isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }], defaultReasoningEffort: "low" }, { id: "test-fast", model: "test-fast", displayName: "Test Fast", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }], defaultReasoningEffort: "low" }, { id: "test-deep", model: "test-deep", displayName: "Test Deep", supportedReasoningEfforts: [{ reasoningEffort: "high" }, { reasoningEffort: "max" }], defaultReasoningEffort: "high" }] };
  if (method === "thread/start" || method === "thread/resume") {
    resumed = method === "thread/resume";
    threadId = params.threadId || randomUUID();
    result = { thread: { id: threadId }, model: params.model || "test-default", reasoningEffort: params.config?.model_reasoning_effort || (params.model === "test-deep" ? "high" : "low") };
  }
  if (method === "turn/start") {
    turnId = randomUUID();
    result = { turn: { id: turnId } };
    if (params.input.some(i => i.text?.includes("模拟子代理委托"))) {
      emit({ id, result });
      const notify = (method, item) => emit({ method, params: { threadId, turnId, item } });
      const childId = randomUUID();
      const call = { id: "spawn", type: "collabAgentToolCall", tool: "spawnAgent", prompt: "检查子线程归并" };
      notify("item/started", { ...call, status: "inProgress", receiverThreadIds: [] });
      notify("item/completed", { ...call, status: "completed", receiverThreadIds: [childId] });
      notify("item/completed", { id: "created", type: "subAgentActivity", kind: "started", agentThreadId: childId, model: "test-fast" });
      notify("item/completed", { id: "wait", type: "collabAgentToolCall", tool: "wait", status: "completed", agentsStates: {
        [childId]: { status: "completed", message: "子线程独立报告" },
      } });
      notify("item/completed", { id: "main", type: "agentMessage", phase: "final_answer", text: "主线程汇总完毕" });
      emit({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
      continue;
    }
    if (params.input.some(i => i.text === "原生提问测试" || i.text === "原生审批测试")) {
      emit({ id, result });
      if (params.input.some(i => i.text === "原生审批测试"))
        emit({ id: "approval-native", method: "item/commandExecution/requestApproval", params: { threadId, turnId, command: "npm run build", reason: "需要本次操作授权" } });
      else emit({ id: "question-native", method: "item/tool/requestUserInput", params: { threadId, turnId, questions: [
        { id: "database", question: "选择数据库", options: [{ label: "SQLite", description: "本地文件" }, { label: "PostgreSQL" }] },
        { id: "name", question: "输入项目名称", options: null },
      ] } });
      continue;
    }
    if(params.input.some(i=>i.text==="自动压缩测试")) {
      emit({id,result});
      emit({method:"item/started",params:{threadId,turnId,item:{type:"contextCompaction",id:"compact"}}});
      setTimeout(()=>{
        emit({method:"item/completed",params:{threadId,turnId,item:{type:"contextCompaction",id:"compact"}}});
        emit({method:"item/agentMessage/delta",params:{threadId,turnId,itemId:"compact-answer",delta:"压缩后继续回答"}});
        emit({method:"turn/completed",params:{threadId,turn:{id:turnId,status:"completed"}}});
      },1500);
      continue;
    }
    const activityTest = params.input.some(i => i.text === "活动记录测试");
    const literal = params.input.find(i => i.text === "协议边界测试" || i.text === "停止文本测试")?.text;
    if (literal) {
      emit({ id, result });
      const text = literal === "协议边界测试" ? "中文\u2028段落\u2029结束" : "这是引用文本：已停止生成。";
      const record = JSON.stringify({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "literal", delta: text } }) + "\n";
      const bytes = Buffer.from(record);
      // Force a UTF-8 codepoint and a JSON record across separate stdout writes.
      const split = bytes.indexOf(Buffer.from("中文")) + 1;
      process.stdout.write(bytes.subarray(0, split));
      setTimeout(() => {
        process.stdout.write(bytes.subarray(split));
        emit({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
      }, 20);
      continue;
    }
    const failureTest = params.input.some(i => i.text === "执行失败测试") && !resumed;
    if (failureTest) {
      emit({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "partial", delta: "先保留这一段回答。" } });
      setTimeout(() => emit({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed", error: { message: "构建命令失败" } } } }), 150);
    }
    if (activityTest) {
      emit({ method: "turn/plan/updated", params: { threadId, turnId, plan: [{ step: "检查项目文件", status: "completed" }, { step: "运行构建", status: "inProgress" }] } });
      emit({ method: "item/started", params: { threadId, turnId, item: { id: "note", type: "agentMessage", phase: "commentary", text: "" } } });
      emit({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "note", delta: "我会先检查项目，再运行构建。" } });
      emit({ method: "item/completed", params: { threadId, turnId, item: { id: "note", type: "agentMessage", phase: "commentary", text: "我会先检查项目，再运行构建。" } } });
      emit({ method: "item/started", params: { threadId, turnId, item: { id: "build", type: "commandExecution", command: "npm run build", status: "inProgress" } } });
      setTimeout(() => emit({ method: "item/commandExecution/outputDelta", params: { threadId, turnId, itemId: "build", delta: "正在检查依赖…\n" } }), 200);
    }
    if (!failureTest && !params.input.some((i) => i.text?.startsWith("等待停止测试")))
      setTimeout(() => {
        if (activityTest) {
          emit({ method: "item/completed", params: { threadId, turnId, item: { id: "build", type: "commandExecution", command: "npm run build", aggregatedOutput: "构建成功\n" + "build output ".repeat(2000), status: "completed", exitCode: 0, durationMs: 1800 } } });
          emit({ method: "turn/plan/updated", params: { threadId, turnId, plan: [{ step: "检查项目文件", status: "completed" }, { step: "运行构建", status: "completed" }] } });
          emit({ method: "item/completed", params: { threadId, turnId, item: { id: "patch", type: "fileChange", status: "completed", changes: [{ path: "/demo/example.ts", kind: { type: "update" }, diff: "@@ -1 +1 @@\n-const ready = false;\n+const ready = true;" }] } } });
          emit({ method: "item/started", params: { threadId, turnId, item: { id: "reply", type: "agentMessage", phase: "final_answer", text: "" } } });
        }
        emit({
          method: "item/agentMessage/delta",
          params: { threadId, turnId, itemId: "reply", delta:
            params.input.some((i) => i.type === "localImage" && readFileSync(i.path).subarray(0, 8).toString("hex") === "89504e470d0a1a0a")
              ? "已收到测试图片" : "测试回复" + (params.effort ? " · effort:" + params.effort : "") + (params.model && params.model !== "test-default" ? " · " + params.model + (params.input.some(part => part.text?.includes("Pi 测试回复")) ? " · 已带入 Pi 历史" : "") : "") },
        });
        emit({
          method: "thread/tokenUsage/updated",
          params: {
            threadId, turnId,
            tokenUsage: {
              total: { inputTokens: 1200, outputTokens: 300, cachedInputTokens: 600, reasoningOutputTokens: 50, totalTokens: 1500 },
              last: { inputTokens: 1200, outputTokens: 300, cachedInputTokens: 600, reasoningOutputTokens: 50, totalTokens: 1500 },
              modelContextWindow: 10000,
            },
          },
        });
        emit({
          method: "turn/completed",
          params: { threadId, turn: { id: turnId, status: "completed" } },
        });
      }, activityTest ? 1800 : 70);
  }
  emit({ id, result });
  if (method === "turn/interrupt")
    emit({
      method: "turn/completed",
      params: { threadId, turn: { id: turnId, status: "interrupted" } },
    });
}
