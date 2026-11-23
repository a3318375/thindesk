import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { ApprovalCard } from "../../components/assistant-ui/elements/approval-card";
import { QuestionFlow } from "../../components/assistant-ui/elements/question-flow";
import { deskRequest } from "../../api/desk";
import type { Message } from "../../../../shared/workspace";
import type { AgentRequest, AgentResponse } from "../../../../shared/interactions";

function Request({ request, message }: { request: AgentRequest; message: Message }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function answer(response: AgentResponse) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await deskRequest({ action: "respond", session: location.hash.slice(1), message: message.id, request: request.id, ...response });
    } catch (error) {
      setBusy(false);
      setError(error instanceof Error ? error.message : "提交失败");
    }
  }
  const pending = request.status === "pending";
  if (!pending && (request.kind === "question" || request.status !== "answered"))
    return <div className="agentReceipt" role="status">
      {request.status === "answered" ? "已回答" : request.status === "expired" ? "请求已结束" : "请求已取消"}
      {request.status === "answered" && request.questions.map(q => !q.secret && request.answers?.[q.id] &&
        <p key={q.id}>{q.question} · {request.answers[q.id]}</p>)}
    </div>;
  return <fieldset className="agentRequest" aria-label={request.title} disabled={busy || !pending} aria-busy={busy && pending}>
    {request.kind === "question" ? (
      <QuestionFlow questions={request.questions} detail={request.detail}
        onComplete={answers => void answer({ answers })} onCancel={() => void answer({ cancelled: true })} />
    ) : (
      <ApprovalCard state={pending ? "request" : request.approved ? "done" : "denied"}
        icon={<ShieldCheck size={16} />} title={request.title} subtitle={pending ? "等待你的授权" : "授权记录"}
        command={request.detail} className="border-solid"
        allowOnceLabel="允许本次" denyLabel="拒绝" statusLabel={request.approved ? "已允许操作" : "已拒绝操作"}
        onAllowOnce={() => void answer({ approved: true })} onDeny={() => void answer({ approved: false })} />
    )}
    {error && pending && <p role="alert">{error}</p>}
  </fieldset>;
}
export function AgentRequests({ message }: { message: Message }) {
  return message.requests?.map(request => <Request key={request.id} request={request} message={message} />);
}
