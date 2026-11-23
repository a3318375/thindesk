import { useEffect, useState } from "react";
import { TaskCard, type TaskCardState } from "../../components/assistant-ui/elements/task-card";
import { messageRequest } from "../../api/desk";
import { MessageMarkdown } from "./MessageMarkdown";
import type { ActivityEntry, Message, SubagentTask } from "../../../../shared/workspace";

const labels: Record<SubagentTask["state"], string> = {
  waiting: "等待启动", working: "执行中", done: "已完成", failed: "失败",
  cancelled: "已中断", closed: "已关闭", unknown: "状态未报告",
};

function TaskDetails({ messageId, entry }: { messageId: string; entry: ActivityEntry }) {
  const [record, setRecord] = useState<ActivityEntry>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const sessionId = location.hash.slice(1);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    messageRequest(sessionId, messageId, controller.signal).then(message => {
      const task = message.activity?.find(item => item.id === entry.id);
      if (!task) throw Error("未找到委托记录");
      if (!controller.signal.aborted) setRecord(task);
    }).catch(error => {
      if (!controller.signal.aborted) setError(String(error));
    });
    return () => controller.abort();
  }, [sessionId, messageId, entry.id, entry.label, entry.outputVersion, attempt]);
  if (error) return <p role="alert">{error} <button type="button" onClick={() => setAttempt(n => n + 1)}>重试</button></p>;
  if (!record) return <small>正在读取委托记录…</small>;
  const task = entry.subagent!;
  return <>
    {task.path && <small>{task.path}</small>}
    {task.model && <small>实际模型 · {task.model}{task.effort && " · " + task.effort}</small>}
    {task.requestedModel && <small>指定模型 · {task.requestedModel}{task.requestedEffort && " · " + task.requestedEffort}</small>}
    {record.text && <div><small>委托任务</small><p className="whitespace-pre-wrap break-words">{record.text}</p></div>}
    {record.output ? <div><small>运行器回报</small><MessageMarkdown>{record.output}</MessageMarkdown></div> : <small>暂无结果回报</small>}
  </>;
}

export function SubagentTasks({ message, running }: { message: Message; running: boolean }) {
  const entries = message.activity?.filter(entry => entry.subagent);
  if (!entries?.length) return null;
  return <section aria-label="子代理委托" data-slot={entries.length > 1 ? "subagent-list" : undefined}
    className="my-2 flex min-w-0 flex-col gap-2">
    {entries.map(entry => {
      const task = entry.subagent!;
      const pending = task.state === "working" || task.state === "waiting";
      const state: TaskCardState = task.state === "closed" || task.state === "unknown" || (!running && pending)
        ? "waiting" : task.state;
      const status = !running && pending ? "未收到结束状态" : labels[task.state];
      return <TaskCard key={entry.id} label={entry.label} state={state}
        meta={task.model || (task.requestedModel ? "指定 " + task.requestedModel : undefined)}
        elapsed={status} className="max-w-lg border-solid">
        <TaskDetails messageId={message.id} entry={entry} />
      </TaskCard>;
    })}
  </section>;
}
