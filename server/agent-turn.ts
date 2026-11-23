import type { AgentRequest, AgentResponse } from "../shared/interactions.ts";
import type {
  ActivityEntry,
  Message,
  TokenUsage,
} from "../shared/workspace.ts";
export type AgentTurnOptions = {
  cwd: string;
  thread?: string;
  permission: string;
  model?: string;
  effort?: string;
  sessionDirectory: string;
  prompt: string;
  history: Message[];
  files: { name: string; bytes: Buffer }[];
  onThread: (id: string) => void;
  onModel: (model: string, effort?: string) => void;
  onText: (text: string) => void;
  onActivity: (entries: ActivityEntry[]) => void;
  onUsage: (usage: TokenUsage) => void;
  onRequest?: (request: AgentRequest, respond: (answer: AgentResponse) => void) => void;
  onResolved?: (id: string) => void;
  onCompaction?: (status: "running" | "complete" | "error", detail?: string) => void;
  onEnd: (notice?: string) => void;
};

export type SteerInput = { id: string; text: string; files: { name: string; bytes: Buffer }[] };
export type AgentControl = (() => void) & {
  steer?: (input: SteerInput, done: (accepted: boolean, note?: string) => void) => void;
};
