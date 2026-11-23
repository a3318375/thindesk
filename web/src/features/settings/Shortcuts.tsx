import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui";
import { useState } from "react";
import { Dialog } from "../../components/Overlay";
const bindings: Record<string, string> = {
  快捷键速查: "Ctrl+/",
  新会话: "",
  "展开／收起左侧栏": "",
  搜索会话: "",
  添加工作区: "",
  打开设置: "",
  "展开／收起右侧栏": "",
};
export function readBindings(): Record<string, string> {
  return {
    ...bindings,
    ...JSON.parse(localStorage.getItem("shortcuts") || "{}"),
  };
}
export function keyName(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}) {
  return [
    e.ctrlKey ? "Ctrl" : "",
    e.metaKey ? "Meta" : "",
    e.altKey ? "Alt" : "",
    e.shiftKey ? "Shift" : "",
    e.key.length === 1 ? e.key.toUpperCase() : e.key,
  ]
    .filter(Boolean)
    .join("+");
}
export function Shortcuts({ close }: { close: () => void }) {
  const [keys, setKeys] = useState(readBindings),
    [editing, setEditing] = useState(""),
    [error, setError] = useState("");
  const save = (next: Record<string, string>) => {
    setKeys(next);
    localStorage.setItem("shortcuts", JSON.stringify(next));
    setEditing("");
    setError("");
  };
  const group = (title: string, entries: string[][]) => (
    <section>
      <h3>{title}</h3>
      {entries.map(([name, key]) => (
        <div className="keyRow" key={name}>
          <span>{name}</span>
          <kbd>{key}</kbd>
        </div>
      ))}
    </section>
  );
  return (
    <Dialog title="快捷键" close={close} className="shortcuts">
      <header>
        <h2>快捷键</h2>
        <Button variant="ghost" aria-label="关闭" onClick={close}>
          <Icon name="close" size={16} />
        </Button>
      </header>
      {Object.entries(keys).map(([name, key]) => (
        <div className="keyRow" key={name}>
          <span>{name}</span>
          <Button
            variant="ghost"
            onClick={() => {
              setEditing(name);
              setError("");
            }}
            onKeyDown={(e) => {
              if (editing !== name) return;
              e.stopPropagation();
              e.preventDefault();
              if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
              if (e.key === "Escape") {
                setEditing("");
                return;
              }
              const v = e.key === "Backspace" ? "" : keyName(e);
              if (
                v &&
                Object.entries(keys).some(([n, k]) => n !== name && k === v)
              ) {
                setError("快捷键已被占用");
                return;
              }
              save({ ...keys, [name]: v });
            }}
          >
            {editing === name ? "按下快捷键…" : key || "暂无快捷键"}
          </Button>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
      {group("消息输入", [
        ["使用互补的 Queue／Steer 方式", "Ctrl + Enter"],
        ["打开引用菜单", "@"],
        ["换行", "Shift + Enter"],
        ["发送消息", "Enter"],
        ["打开命令菜单", "/"],
        ["停止生成", "Esc Esc"],
      ])}
      {group("菜单与弹层", [
        ["关闭菜单或顶层弹窗", "Esc"],
        ["移动菜单选择", "↑ ↓"],
        ["选择菜单项", "Enter"],
      ])}
      {group("审批区域", [
        ["允许", "Enter"],
        ["拒绝", "Esc"],
      ])}
      <footer>
        <Button
          variant="default"
          className="outline"
          onClick={() => save({ ...bindings })}
        >
          恢复全部默认
        </Button>
      </footer>
    </Dialog>
  );
}
