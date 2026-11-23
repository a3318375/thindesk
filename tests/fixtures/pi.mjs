#!/usr/bin/env node
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
if (args.includes("--list-models")) {
  console.log("provider model context max-out thinking images\ntest pi-default 100K 10K yes yes\ntest pi-fast 100K 10K yes yes\ntest pi-deep 100K 10K yes yes");
  process.exit(0);
}
const home=process.env.PI_CODING_AGENT_DIR||process.env.THINDESK_DATA;
const file=home&&join(home,"mcp.json");
const config=()=>{try{return JSON.parse(readFileSync(file,"utf8"));}catch{return {mcpServers:{}};}};
if(args[0]==="mcp"){
 const data=config();
 if(args[1]==="list")console.log(JSON.stringify({servers:Object.entries(data.mcpServers).map(([name,s])=>({name,enabled:s.enabled!==false,state:s.enabled===false?"disabled":"connected",scope:"user",source:file,tools:[]}))}));
 if(args[1]==="add"){data.mcpServers[args[2]]={enabled:true};mkdirSync(home,{recursive:true});writeFileSync(file,JSON.stringify(data));}
 if(args[1]==="remove"){delete data.mcpServers[args[2]];writeFileSync(file,JSON.stringify(data));}
 process.exit(0);
}
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "default";
const session = args[args.indexOf("--session") + 1];
const emit = message => console.log(JSON.stringify(message));
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  const respond = data => emit({ id: request.id, type: "response", command: request.type, success: true, data });
  if (request.type === "get_state") respond({ sessionFile: session, thinkingLevel: args.includes("--thinking") ? args[args.indexOf("--thinking") + 1] : "low", model: { provider: "test", id: model.includes("/") ? model.split("/").slice(1).join("/") : "pi-default" } });
  else if(request.type === "get_commands"){
    const path=join(home,"skills/pi-test/SKILL.md");
    let settings={};try{settings=JSON.parse(readFileSync(join(home,"settings.json"),"utf8"));}catch{}
    respond({commands:settings.skills?.includes("-"+path)?[]:[{name:"skill:pi-test",description:"Pi CLI skill",source:"skill",sourceInfo:{path,scope:"user"}}]});
  }
  else if(request.type === "steer"){
    if(request.message.includes("不能插队")){emit({id:request.id,type:"response",command:"steer",success:false,error:"cannot steer"});continue;}
    respond({disposition:"queued"});
    setTimeout(()=>{
      emit({type:"message_start",message:{role:"assistant"}});
      emit({type:"message_end",message:{role:"assistant",content:[{type:"text",text:"Pi 测试回复 · 本轮补充："+request.message}]}});
      emit({type:"agent_settled",aborted:false});
    },400);
  }
  else if (request.type === "get_available_thinking_levels") respond({ levels: model.includes("fast") ? ["off", "low"] : ["off", "low", "high", "max"] });
  else if (request.type === "extension_ui_response") {
    emit({ type: "message_start", message: { role: "assistant" } });
    emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "收到 Pi 回答：" + JSON.stringify(request) }] } });
    emit({ type: "agent_settled", aborted: false });
  }
  else if (request.type === "prompt") {
    respond({ disposition: "started" });
    if (request.message === "原生提问测试" || request.message === "原生审批测试") {
      emit({ type: "extension_ui_request", id: "pi-question", method: request.message === "原生审批测试" ? "confirm" : "select", title: "选择数据库", options: ["SQLite", "PostgreSQL"], message: "请确认是否继续" });
      continue;
    }
    if(request.message==="自动压缩测试"){
      emit({type:"compaction_start",reason:"threshold"});
      setTimeout(()=>{
        emit({type:"compaction_end",result:{summary:"native only"}});
        emit({type:"message_start",message:{role:"assistant"}});
        emit({type:"message_end",message:{role:"assistant",content:[{type:"text",text:"压缩后继续回答"}]}});
        emit({type:"agent_settled",aborted:false});
      },1500);continue;
    }
    const activityTest = request.message === "活动记录测试";
    if (activityTest) {
      emit({ type: "message_start", message: { role: "assistant" } });
      emit({ type: "message_end", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "text", text: "我会先检查项目，再运行构建。" }, { type: "toolCall", id: "build" }] } });
      emit({ type: "tool_execution_start", toolCallId: "build", toolName: "bash", args: { command: "npm run build" } });
      setTimeout(() => emit({ type: "tool_execution_update", toolCallId: "build", toolName: "bash", args: { command: "npm run build" }, partialResult: { content: [{ type: "text", text: "正在检查依赖…\n" }] } }), 200);
    }
    if (!request.message.trim().endsWith("等待停止测试")) setTimeout(() => {
      if (activityTest) emit({ type: "tool_execution_end", toolCallId: "build", toolName: "bash", result: { content: [{ type: "text", text: "构建成功\n" + "build output ".repeat(2000) }], details: { exitCode: 0 } } });
      if (activityTest) {
        for (let i = 0; i < 2; i++) {
          const args = { path: "/demo/pi-example.ts" };
          emit({ type: "tool_execution_start", toolCallId: "edit-" + i, toolName: "edit", args });
          emit({ type: "tool_execution_end", toolCallId: "edit-" + i, toolName: "edit", result: { content: [{ type: "text", text: "edited" }], details: { patch: "--- a/pi-example.ts\n+++ b/pi-example.ts\n@@ -1 +1 @@\n-const value = " + i + ";\n+const value = " + (i + 1) + ";" } } });
        }
        emit({ type: "tool_execution_start", toolCallId: "write", toolName: "write", args: { path: "/demo/no-patch.ts" } });
        emit({ type: "tool_execution_end", toolCallId: "write", toolName: "write", result: { content: [{ type: "text", text: "written" }] } });
      }
      const text = "Pi 测试回复 · " + model + (args.includes("--thinking") ? " · effort:" + args[args.indexOf("--thinking") + 1] : "") + (request.message.includes("以下是本会话此前") ? " · 已带入历史" : "") + (request.images?.length ? " · 已收到图片" : "");
      emit({ type: "message_start", message: { role: "assistant" } });
      emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text } });
      emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } });
      emit({ type: "agent_settled", aborted: false });
    }, activityTest ? 1800 : 70);
  } else if (request.type === "get_session_stats") respond({ tokens: { input: 200, output: 50, cacheRead: 100, cacheWrite: 0, total: 350 }, contextUsage: { tokens: 200, contextWindow: 10000 } });
  else if (request.type === "abort") { respond({}); emit({ type: "agent_settled", aborted: true }); }
}
