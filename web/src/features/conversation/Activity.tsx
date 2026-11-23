import { useEffect, useState, type ReactNode } from "react";
import {
  FileSearch,
  PencilLine,
  Terminal,
  Sparkles,
  Search,
} from "lucide-react";
import { ToolTimeline } from "../../components/assistant-ui/elements/tool-timeline";
import { DiffDrawer } from "./DiffDrawer";
import { RunActivity } from "../../components/assistant-ui/elements/run-activity";
import { ToolCall } from "../../components/assistant-ui/elements/tool-call";
import { AgentPlan } from "../../components/assistant-ui/elements/agent-plan";
import { Button } from "../../components/ui";
import { ToolOutput } from "./ToolOutput";
import { MessageMarkdown } from "./MessageMarkdown";
import type { ActivityEntry, Message } from "../../../../shared/workspace";

function ToolEntry({
  message,
  entry,
}: {
  message: Message;
  entry: ActivityEntry;
}) {
  const [open, setOpen] = useState(false);
  if (entry.toolType === "diff") {
    return <>
      <Button variant="ghost" className="activityToolTrigger" aria-haspopup="dialog" aria-label={entry.label}
        onClick={() => setOpen(true)}>
        <PencilLine size={14} />{entry.status === "running" ? "正在修改" : entry.status === "error" ? "修改失败" : "文件变更"} · {entry.label}
      </Button>
      {open && <DiffDrawer title="文件变更" message={message} entries={[entry]} close={() => setOpen(false)} />}
    </>;
  }
  return (
    <ToolCall
      className="activityTool"
      label={entry.toolType === "terminal" ? "已执行" : "已调用"}
      activeLabel={entry.toolType === "terminal" ? "正在执行" : "正在调用"}
      query={entry.label}
      request={entry.command || entry.label}
      result={<ToolOutput message={message} entry={entry} />}
      running={entry.status === "running"}
      failed={entry.status === "error"}
      open={open}
      onOpenChange={setOpen}
    />
  );
}
function ActivityContent({
  entry,
  message,
  running,
}: {
  entry: ActivityEntry;
  message: Message;
  running: boolean;
}) {
  if (entry.kind === "tool")
    return <ToolEntry message={message} entry={entry} />;
  if (entry.kind === "plan")
    return (
      <AgentPlan
        running={running}
        title={entry.label}
        activeIndex={0}
        steps={(entry.plan || []).map((step) => ({
          label: step.step,
          status: step.status,
        }))}
      />
    );
  return (
    <div
      className={
        entry.kind === "reasoning" ? "activityReasoning" : "activityCommentary"
      }
    >
      {entry.kind === "reasoning" && <small>思考</small>}
      <MessageMarkdown>{entry.text || entry.label}</MessageMarkdown>
    </div>
  );
}
function ExecutionTimeline({
  message,
  entries,
  running,
}: {
  message: Message;
  entries: ActivityEntry[];
  running: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [selected, select] = useState<string>();
  const tools = entries.filter((entry) => entry.kind === "tool");
  const steps = entries.filter((entry) => entry.kind !== "commentary");
  const changed = new Map<
    string,
    { file: string; added?: number; removed?: number; entry: ActivityEntry }
  >();
  for (const entry of tools)
    for (const file of entry.files || []) {
      const previous = changed.get(file.path);
      changed.set(file.path, {
        file: file.path,
        added:
          file.added === undefined
            ? previous?.added
            : (previous?.added || 0) + file.added,
        removed:
          file.removed === undefined
            ? previous?.removed
            : (previous?.removed || 0) + file.removed,
        entry,
      });
    }
  return (
    <>
      <ToolTimeline
        steps={entries.map((entry) => ({
          id: entry.id,
          verb:
            entry.kind === "reasoning"
              ? "思考"
              : entry.kind === "plan"
                ? "计划"
                : entry.action === "read"
                  ? "读取"
                  : entry.action === "edit"
                    ? "修改"
                    : entry.action === "search"
                      ? "搜索"
                      : entry.action === "run"
                        ? "运行"
                        : "调用",
          chip:
            entry.kind === "reasoning"
              ? (entry.text || entry.label).split("\n", 1)[0].slice(0, 100)
              : entry.kind === "plan"
                ? "执行计划 · " + (entry.plan?.length || 0) + " 项"
                : entry.target || entry.command || entry.label,
          icon:
            entry.action === "read"
              ? FileSearch
              : entry.action === "edit"
                ? PencilLine
                : entry.action === "search"
                  ? Search
                  : entry.action === "run"
                    ? Terminal
                    : Sparkles,
        }))}
        visibleSteps={entries.length}
        renderStep={(_, index) => (
          <ActivityContent
            entry={entries[index]}
            message={message}
            running={running}
          />
        )}
        streaming={running}
        open={open}
        onOpenChange={setOpen}
        restingLabel={
          steps.length +
          " 步" +
          (changed.size ? " · " + changed.size + " 个文件变更" : "")
        }
        activeLabel={"执行步骤 · " + steps.length}
        stats={[...changed.values()].map((file) => ({
          ...file,
          canOpen: file.entry.toolType === "diff",
        }))}
        onFileClick={(path) => {
          const file = changed.get(path);
          if (file?.entry.toolType === "diff")
            select(path);
        }}
      />
      {selected && (
        <DiffDrawer title="文件变更" file={selected} message={message}
          entries={tools.filter(entry => entry.toolType === "diff" && entry.files?.some(file => file.path === selected))}
          close={() => select(undefined)} />
      )}
    </>
  );
}
function durationLabel(seconds?: number) {
  if (seconds === undefined) return undefined;
  const value = Math.max(0, Math.round(seconds));
  return value < 60
    ? value + " 秒"
    : Math.floor(value / 60) + " 分 " + (value % 60) + " 秒";
}
export function Activity({
  message,
  running,
  duration,
  expanded = false,
  children,
  attention,
  hidden = false,
}: {
  message: Message;
  running: boolean;
  duration?: number;
  expanded?: boolean;
  children?: ReactNode;
  attention?: ReactNode;
  hidden?: boolean;
}) {
  const [open, setOpen] = useState(expanded);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setOpen(expanded);
  }, [expanded]);
  useEffect(() => {
    if (running) {
      const timer = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(timer);
    }
  }, [running]);
  const entries = message.activity?.filter(entry => entry.kind !== "subagent") || [];
  if (message.reasoning)
    entries.unshift({
      id: "legacy-reasoning",
      kind: "reasoning",
      label: "思考",
      text: message.reasoning,
    });
  if (message.command || message.hasCommand)
    entries.push({
      id: "legacy-command",
      kind: "tool",
      label: "终端",
      output: message.command,
    });
  const elapsed =
    message.startedAt !== undefined
      ? ((running
          ? now
          : (message.finishedAt ?? message.createdAt ?? message.startedAt)) -
          message.startedAt) /
        1000
      : duration;
  const pendingRequest = message.requests?.find(request => request.status === "pending");
  const needsAction = pendingRequest || message.approval === "pending";
  const status = needsAction ? "requires-action" : running ? "running" : message.runStatus || "complete";
  if ((hidden || !entries.length) && !running)
    return (
      <>
        {attention}
        {children}
      </>
    );
  return (
    <RunActivity
      className="messageActivity"
      status={status}
      statusLabel={
        status === "requires-action"
          ? pendingRequest?.kind === "question" ? "等待你的回答" : "等待授权"
          : running ? "正在处理"
          : status === "cancelled"
              ? "已停止"
              : status === "error"
                ? "执行失败"
                : "已完成"
      }
      durationLabel={durationLabel(elapsed)}
      open={open}
      onOpenChange={setOpen}
      attention={attention}
      entries={
        hidden
          ? []
          : message.activity?.some((entry) => entry.kind === "tool")
            ? [
                {
                  id: "execution-timeline",
                  kind: "tool",
                  label: entries.at(-1)?.label || "执行概览",
                  content: (
                    <ExecutionTimeline
                      message={message}
                      entries={entries}
                      running={running}
                    />
                  ),
                },
              ]
            : entries.map((entry) => ({
                id: entry.id,
                kind: entry.kind === "tool" ? "tool" : "commentary",
                label: entry.label,
                content: (
                  <ActivityContent
                    entry={entry}
                    message={message}
                    running={running}
                  />
                ),
              }))
      }
    >
      {children}
    </RunActivity>
  );
}
