import { Button, Input } from "../../components/ui";
import { useState } from "react";
import { Dialog } from "../../components/Overlay";
export function Picker({
  close,
  choose,
}: {
  close: () => void;
  choose: (path: string, name: string) => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [path, setPath] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title="创建项目" close={close} className="formDialog">
      <h2>创建项目</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            await choose(path.trim(), name.trim());
          } catch (e) {
            setError(e instanceof Error ? e.message : "无法打开目录");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          项目名称
          <Input
            autoFocus
            required
            maxLength={120}
            placeholder="例如：ThinDesk"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          服务器目录
          <Input
            required
            placeholder="/data/projects/demo"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </label>
        <small>请输入绝对路径，目录不存在时会自动创建。</small>
        {error && <div role="alert">{error}</div>}
        <footer>
          <Button onClick={close}>取消</Button>
          <Button
            variant="primary"
            type="submit"
            aria-busy={busy}
            disabled={busy || !path.trim() || !name.trim()}
          >
            创建项目
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
