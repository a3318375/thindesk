import type { AgentRequest, AgentResponse } from "../shared/interactions.ts";

// Native request IDs stay owned by the runner, never by browser-generated text.
export function codexInteraction(method: string, id: string, p: any): {
  request: AgentRequest;
  result: (response: AgentResponse) => object;
} | undefined {
  if (method === "item/tool/requestUserInput") return {
    request: {
      id, kind: "question", title: "需要你的回答", status: "pending",
      questions: (p.questions || []).map((q: any) => ({
        id: q.id, question: q.question, options: q.options || [], secret: q.isSecret, allowCustom: q.isOther !== false || !q.options?.length,
      })),
    },
    result: response => ({ answers: Object.fromEntries((p.questions || []).map((q: any) => [
      q.id, { answers: response.cancelled ? [] : [response.answers?.[q.id] || ""] },
    ])) }),
  };
  if (["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval"].includes(method)) return {
    request: {
      id, kind: "approval", title: "操作授权", status: "pending", questions: [],
      detail: [p.reason, p.command, p.cwd, p.permissions && JSON.stringify(p.permissions)].filter(Boolean).join("\n"),
    },
    result: response => method === "item/permissions/requestApproval"
      ? { permissions: response.approved && !response.cancelled ? p.permissions : {}, scope: "turn" }
      : { decision: response.approved && !response.cancelled ? "accept" : "decline" },
  };
}

export function piInteraction(event: any): AgentRequest | undefined {
  if (!["select", "confirm", "input", "editor"].includes(event.method)) return;
  return {
    id: String(event.id), status: "pending", title: event.title || "需要你的回答",
    kind: event.method === "confirm" ? "approval" : "question",
    detail: event.message,
    expiresAt: event.timeout ? Date.now() + event.timeout : undefined,
    questions: event.method === "confirm" ? [] : [{
      id: "value", question: event.title || "请输入",
      options: event.options?.map((label: string) => ({ label })),
      prefill: event.prefill, allowCustom: event.method !== "select",
    }],
  };
}
