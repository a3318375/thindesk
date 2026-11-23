import type { AgentModels } from "../../../shared/models";
let catalog: Promise<AgentModels[]> | undefined;
export function readModels() {
  return (catalog ??= fetch("/api/models")
    .then(async (response) => {
      if (!response.ok) throw Error("模型列表加载失败");
      return response.json() as Promise<AgentModels[]>;
    })
    .catch((error) => {
      catalog = undefined;
      throw error;
    }));
}
