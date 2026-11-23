import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useState } from "react";
import { Command } from "cmdk";
import type { RefObject } from "react";
import { Icon } from "../../components/Icon";
import { useText } from "../../app/locale/text";
import s from "./Composer.module.css";
const commands = [
  { key: "file", label: "文件", icon: "paperclip", group: "添加", hint: "" },
  {
    key: "goal",
    label: "目标",
    icon: "goal",
    group: "添加",
    hint: "设置或查看长期任务目标",
  },
  {
    key: "plan",
    label: "计划",
    icon: "plan",
    group: "添加",
    hint: "进入或退出计划模式",
  },
  {
    key: "feedback",
    label: "反馈",
    icon: "paper-plane",
    group: "添加",
    hint: "发送关于当前会话的反馈",
  },
  { key: "delegate", label: "委托子任务", icon: "branch", group: "添加", hint: "选择子代理模型并填写任务" },
  {
    key: "permission",
    label: "权限",
    icon: "permission",
    group: "指令",
    hint: "切换权限预设（沙箱模式与审批策略）",
  },
  {
    key: "model",
    label: "模型",
    icon: "data",
    group: "指令",
    hint: "选择本会话使用的模型",
  },
  {
    key: "export",
    label: "下载日志",
    icon: "download",
    group: "指令",
    hint: "将当前会话内容导出为 ZIP",
  },
  {
    key: "ab",
    label: "ab",
    icon: "",
    group: "指令",
    hint: "破甲台插件指令 · /ab <目标>",
  },
];

export function matchingCommands(query: string, codex: boolean) {
  return commands.filter(
    (row) =>
      (codex || row.key !== "delegate") &&
      (row.key.startsWith(query.toLowerCase()) || row.label.includes(query)),
  );
}

export function CommandMenu({
  rows,
  anchor,
  choose,
  close,
}: {
  rows: typeof commands;
  anchor: RefObject<HTMLFormElement | null>;
  choose: (key: string) => void;
  close: () => void;
}) {
  const tr = useText();
  const [selected, setSelected] = useState(rows[0]?.key || "");
  const [bounds, setBounds] = useState({ left: 0, bottom: 0, width: 0 });
  useLayoutEffect(() => {
    function measure() {
      const rect = anchor.current?.getBoundingClientRect();
      if (rect)
        setBounds({
          left: rect.left,
          bottom: innerHeight - rect.top + 4,
          width: rect.width,
        });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchor]);
  const signature = rows.map((row) => row.key).join(",");
  useEffect(() => {
    setSelected(rows[0]?.key || "");
  }, [signature]);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (event.isComposing || event.keyCode === 229) return;
      if (!["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(event.key))
        return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") return close();
      if (event.key === "Enter") return choose(selected || rows[0].key);
      const index = rows.findIndex((row) => row.key === selected);
      setSelected(
        rows[
          (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) %
            rows.length
        ].key,
      );
    }
    function outside(event: PointerEvent) {
      if (
        !anchor.current?.contains(event.target as Node) &&
        !(event.target as Element).closest(".commandMenu")
      )
        close();
    }
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [rows, selected, choose, close, anchor]);
  return createPortal(
    <Command
      shouldFilter={false}
      value={selected}
      onValueChange={setSelected}
      className={s.commandMenu + " commandMenu ui-popup"}
      style={{
        position: "fixed",
        left: bounds.left,
        bottom: bounds.bottom,
        width: bounds.width,
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <Command.List id="composer-commands" label={tr("触发候选建议")}>
        {["添加", "指令"].map((group) => {
          const items = rows.filter((row) => row.group === group);
          return items.length ? (
            <Command.Group key={group} heading={tr(group)}>
              {items.map((item) => (
                <Command.Item
                  key={item.key}
                  value={item.key}
                  onSelect={() => choose(item.key)}
                >
                  <div className={s.commandRow}>
                    {item.icon && <Icon name={item.icon} size={15} />}
                    <span>{tr(item.label)}</span>
                    <small>{item.key}</small>
                    <small className={s.commandHint}>{tr(item.hint)}</small>
                  </div>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null;
        })}
      </Command.List>
    </Command>,
    document.body,
  );
}
