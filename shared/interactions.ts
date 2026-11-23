export type AgentQuestion = {
  id: string;
  question: string;
  options?: { label: string; description?: string }[];
  secret?: boolean;
  allowCustom?: boolean;
  prefill?: string;
};
export type AgentRequest = {
  id: string;
  kind: "question" | "approval";
  title: string;
  detail?: string;
  questions: AgentQuestion[];
  status: "pending" | "answered" | "cancelled" | "expired";
  expiresAt?: number;
  answers?: Record<string, string>;
  approved?: boolean;
};
export type AgentResponse = {
  answers?: Record<string, string>;
  approved?: boolean;
  cancelled?: boolean;
};
