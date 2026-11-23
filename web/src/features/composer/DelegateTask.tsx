import { useEffect, useState } from "react";
import { readModels } from "../../api/models";
import { Dialog } from "../../components/Overlay";
import { Button, Select, TextArea } from "../../components/ui";
import type { AgentModel } from "../../../../shared/models";

export function DelegateTask({ draft, close, apply }: {
  draft: string; close: () => void; apply: (value: string) => void;
}) {
  const [task, setTask] = useState(draft);
  const [models, setModels] = useState<AgentModel[]>([]);
  const [model, setModel] = useState("inherit");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    readModels().then(groups => {
      const group = groups.find(g => g.id === "codex");
      if (alive) {
        setModels(group?.models.filter(m => m.id) || []);
        setError(group?.error || "");
      }
    }).catch(() => { if (alive) setError("模型目录暂不可用，可沿用 Codex 配置"); });
    return () => { alive = false; };
  }, []);
  return <Dialog title="委托子任务" close={close} className="formDialog">
    <h2>委托子任务</h2>
    <form onSubmit={e => {
      e.preventDefault();
      if (!task.trim()) return;
      const choice = model === "inherit" ? "" : "（指定模型 " + model + "）";
      apply("请委托一个 Codex 子代理" + choice + "完成以下任务，等它返回结果后再汇总。\n\n" + task.trim());
    }}>
      <label>执行模型<Select aria-label="子代理执行模型" value={model} onValueChange={setModel}
        options={[{ value: "inherit", label: "沿用 Codex 子代理配置" }, ...models.map(m => ({ value: m.id, label: m.name }))]} /></label>
      {error && <small role="status">{error}</small>}
      <label>委托任务<TextArea autoFocus required value={task} onChange={e => setTask(e.target.value)} /></label>
      <footer><Button variant="ghost" onClick={close}>取消</Button>
        <Button type="submit" variant="primary" disabled={!task.trim()}>放入输入框</Button></footer>
    </form>
  </Dialog>;
}
