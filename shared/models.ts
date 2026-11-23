export type AgentId = "codex" | "pi";
export type ModelSelection = { agent: AgentId; model: string; effort?: string };
export type AgentModel = { id: string; name: string; provider?: string; efforts?: string[]; defaultEffort?: string };
export type AgentModels = {
  id: AgentId;
  name: string;
  available: boolean;
  models: AgentModel[];
  defaultModel?: string;
  error?: string;
};
