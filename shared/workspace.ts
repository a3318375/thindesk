import type { AgentRequest } from "./interactions.ts";
import type { ImChannel, ImReplyContext } from "./im.ts";
import type { AgentId, ModelSelection } from "./models.ts";
export type TokenBreakdown = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};
export type TokenUsage = {
  total: TokenBreakdown;
  last: TokenBreakdown;
  modelContextWindow?: number | null;
};
export type SubagentTask = {
  state: "waiting" | "working" | "done" | "failed" | "cancelled" | "closed" | "unknown";
  path?: string;
  model?: string;
  effort?: string;
  requestedModel?: string;
  requestedEffort?: string;
};
export type ActivityEntry = {
  id: string;
  kind: "commentary" | "reasoning" | "tool" | "plan" | "subagent";
  subagent?: SubagentTask;
  label: string;
  text?: string;
  files?: { path: string; added?: number; removed?: number }[];
  target?: string;
  action?: "read" | "edit" | "run" | "search" | "tool";
  toolType?: "terminal" | "diff" | "tool";
  toolName?: string;
  command?: string;
  exitCode?: number;
  durationMs?: number;
  truncated?: boolean;
  plan?: { step: string; status: "pending" | "inProgress" | "completed" }[];
  output?: string;
  hasOutput?: boolean;
  outputVersion?: string;
  status?: "running" | "complete" | "error";
};
export type Message = {
  requests?: AgentRequest[];
  steered?: boolean;
  compaction?: { status: "running" | "complete" | "error"; detail?: string };
  runId?: string;
  runBaseline?: TokenBreakdown | null;
  origin?: "web" | ImChannel;
  im?: { routeId: string; context: ImReplyContext };
  tokenUsage?: TokenBreakdown;
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: number;
  attachments?: (string | { id: string; name: string })[];
  reasoning?: string;
  activity?: ActivityEntry[];
  startedAt?: number;
  finishedAt?: number;
  runStatus?: "complete" | "cancelled" | "error";
  runError?: string;
  command?: string;
  hasCommand?: boolean;
  commandVersion?: string;
  approval?: "pending" | "approved" | "denied";
};
export type QueuedMessage = {
  steering?: boolean;
  steeringNote?: string;
  origin?: "web" | ImChannel;
  im?: { routeId: string; context: ImReplyContext };
  id: string;
  text: string;
  attachments: { id: string; name: string }[];
  mode: string;
  permission: string;
  agent: AgentId;
  model: string;
  effort?: string;
  createdAt: number;
};
export type Session = {
  id: string;
  workspace: string;
  title: string;
  mode?: string;
  channel?: ImChannel;
  sampleUsage?: {
    tokens: number[];
    seconds: number[];
    cached: number;
    costUSD: number;
    skill: string;
  };
  archived?: boolean;
  updatedAt?: number;
  running?: boolean;
  codexThread?: string;
  piSession?: string;
  agent?: AgentId;
  model?: string;
  effort?: string;
  permission?: string;
  tokenUsage?: TokenUsage;
  queue?: QueuedMessage[];
  queueCount?: number;
  queuePaused?: boolean;
  queueError?: string;
  messages: Message[];
  // Response projections: counts cover the whole session; messages may be one page.
  messageCount?: number;
  messageOffset?: number;
  turnCount?: number;
  stepCount?: number;
  pendingApproval?: boolean;
  preview?: string;
  files?: Message["attachments"];
  historyLoaded?: boolean;
};
export type Job = {
  id: string;
  name: string;
  prompt: string;
  workspace: string;
  schedule: string;
  repeat: boolean;
  status: "已开启" | "已暂停" | "已结束";
};
export type Desk = {
  lastSelection?: ModelSelection & { runId: string };
  revision?: number;
  folders: string[];
  workspaces: string[];
  workspaceNames?: Record<string, string>;
  sessions: Session[];
  jobs: Job[];
};
export const PERSONAL_SESSION_ID = "personal-assistant";

export const emptyDesk: Desk = {
  folders: [],
  workspaces: [],
  sessions: [],
  jobs: [],
};

export const messageCountOf = (session: Session) =>
  session.messageCount ?? session.messages.length;

export const workspaceName = (desk: Desk, path: string) =>
  desk.workspaceNames?.[path] ||
  (path === "/" ? "主目录" : path.split("/").pop() || path);

export function messageBody(message: Message) {
  const notice =
    message.runStatus === "cancelled" ? "已停止生成。" : message.runError;
  return notice && message.text.endsWith(notice)
    ? message.text.slice(0, -notice.length).trimEnd()
    : message.text;
}
