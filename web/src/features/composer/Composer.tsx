import { DelegateTask } from "./DelegateTask";
import { EffortPicker } from "../../components/assistant-ui/EffortPicker";
import { MessageQueue } from "../../components/assistant-ui/elements/message-queue";
import { ModelPicker } from "../../components/assistant-ui/ModelPicker";
import { ComposerAttachments } from "../../components/assistant-ui/ComposerAttachments";
import { ArrowUp, Plus, Square, Mic } from "lucide-react";
import { ComposerPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { useComposerOptions } from "../conversation/AssistantProvider";
import { IconButton, Button } from "../../components/ui";
import { useText } from "../../app/locale/text";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { CommandMenu, matchingCommands } from "./CommandMenu";
import type { Popover, MenuItem } from "../../components/Overlay";
import s from "./Composer.module.css";
const permissionIcons: Record<string, string> = {
  仅可查看: "shield-check",
  工作区内修改: "shield-edit",
  完全权限: "permission",
};

type Props = {
  workspace: string;
  projectName: string;
  reasoningTokens?: number;
  session: string;
  hero: boolean;
  running: boolean;
  pick: (anchor: HTMLElement) => void;
  downloadLog: () => void;
  personal: boolean;
  popupLayout?: Popover["layout"];
  menu: (
    el: HTMLElement,
    items: MenuItem[],
    layout?: Popover["layout"],
  ) => void;
};
export function Composer(p: Props) {
  const tr = useText();
  const aui = useAui();
  const draft = useAuiState((s) => s.composer.text);
  const files = useAuiState((s) => s.composer.attachments);
  const canSend = useAuiState((s) => s.composer.canSend);
  const { options, configure, draftScope } = useComposerOptions();
  const { mode, permission, agent } = options;
  const setMode = (mode: string) => configure({ ...options, mode });
  const setPermission = (permission: string) =>
    configure({ ...options, permission });
  const dictating = useAuiState((state) => state.composer.dictation != null);
  const speechSupported = useAuiState(
    (state) => state.thread.capabilities.dictation,
  );
  const [commandQuery, setCommandQuery] = useState<string | null>(null);
  const [delegateDraft, setDelegateDraft] = useState<string | null>(null);
  const card = useRef<HTMLFormElement>(null);
  const rows =
    commandQuery === null ? [] : matchingCommands(commandQuery, agent === "codex");
  const commandsOpen = rows.length > 0;

  const permissionButton = useRef<HTMLButtonElement>(null);
  const modelButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null),
    file = useRef<HTMLInputElement>(null);
  const key = "draft/" + p.workspace + "/" + p.session;
  useEffect(() => {
    if (draftScope.current !== key) {
      draftScope.current = key;
      aui.composer.reset();
      aui.composer.setText(sessionStorage.getItem(key) || "");
    }
    setCommandQuery(null);
    setDelegateDraft(null);
  }, [key, aui, draftScope]);
  useEffect(() => {
    sessionStorage.setItem(key, draft);
  }, [draft, key]);
  function change(value: string) {
    aui.composer.setText(value);
    sessionStorage.setItem(key, value);
  }
  function chooseCommand(command: string) {
    setCommandQuery(null);
    const remaining = draft.replace(/^\/\S*$/, "");
    if (command === "delegate") { setDelegateDraft(remaining); return; }
    if (["file", "permission", "model", "export"].includes(command)) {
      if (remaining !== draft) change(remaining);
      if (command === "export") p.downloadLog();
      if (command === "file") file.current?.click();
      if (command === "permission") permissionButton.current?.click();
      if (command === "model") modelButton.current?.click();
      return;
    }
    change("/" + command + " " + remaining);
    input.current?.focus();
  }
  return (
    <div className={s.stack + " " + (p.hero ? s.hero : "")}>
      {p.hero && (
        <>
          <header className={s.headline}>
            <h1>{p.personal ? tr("个人助手") : "有什么可以帮你？"}</h1>
          </header>
          {!p.personal && <div className={s.choices}>
            <Button variant="ghost" onClick={(e) => p.pick(e.currentTarget)}>
              <Icon name="folder" />
              <span className={s.projectLabel}>
                {p.workspace ? p.projectName : "选择项目"}
              </span>
              <Icon name="down" size={12} />
            </Button>
            <Button
              variant="ghost"
              aria-label={tr("选择新任务使用的 Agent 预设")}
              onClick={(e) =>
                p.menu(
                  e.currentTarget,
                  ["标准模式", "PTC 模式", "极简模式", "创造模式"].map(
                    (label) => ({
                      label,
                      selected: mode === label,
                      action: () => setMode(label),
                    }),
                  ),
                )
              }
            >
              <Icon name="mode" />
              {tr(mode)}
              <Icon name="down" size={14} />
            </Button>
          </div>}
        </>
      )}
      {delegateDraft !== null && agent === "codex" && (
        <DelegateTask draft={delegateDraft} close={() => setDelegateDraft(null)} apply={value => {
          change(value);
          setDelegateDraft(null);
          requestAnimationFrame(() => input.current?.focus());
        }} />
      )}
      <MessageQueue />
      <ComposerPrimitive.Root
        ref={card}
        data-composer=""
        className={s.card + " " + (!p.workspace ? s.pending : "")}
        onClick={
          !p.workspace
            ? (event) => {
                if (
                  !(event.target as Element).closest(
                    "button,input,textarea,[role=menuitem]",
                  )
                )
                  p.pick(event.currentTarget);
              }
            : undefined
        }
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const dropped = Array.from(e.dataTransfer.files);
          if (p.workspace)
            for (const file of dropped) void aui.composer.addAttachment(file);
        }}
      >
        {commandsOpen && (
          <CommandMenu
            rows={rows}
            anchor={card}
            close={() => setCommandQuery(null)}
            choose={chooseCommand}
          />
        )}
        {files.length > 0 && <ComposerAttachments />}
        {p.workspace ? (
          <ComposerPrimitive.Input
            minRows={1}
            maxRows={8}
            submitMode="none"
            addAttachmentOnPaste={false}
            ref={input}
            aria-label={tr("消息")}
            placeholder={tr("发送消息…")}
            value={draft}
            onPaste={(e) => {
              const images = Array.from(e.clipboardData.files).filter((file) =>
                file.type.startsWith("image/"),
              );
              if (!images.length) return;
              // Keep ordinary text paste native; screenshots become attachments.
              e.preventDefault();
              for (const file of images) void aui.composer.addAttachment(file);
            }}
            aria-controls={commandsOpen ? "composer-commands" : undefined}
            onChange={(e) => {
              const value = e.target.value;
              change(value);
              setCommandQuery(/^\/\S*$/.test(value) ? value.slice(1) : null);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
                e.stopPropagation();
                return;
              }
              if (commandsOpen) {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setCommandQuery(null);
                  return;
                }
                if (["ArrowUp", "ArrowDown", "Enter"].includes(e.key)) return;
              }
              if (e.key === "Enter" && e.shiftKey && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                aui.composer.send({ steer: true });
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                aui.composer.send();
              }
            }}
          />
        ) : (
          <Button
            variant="ghost"
            className={s.placeholder}
            aria-label={tr("选择项目")}
            onClick={(e) => p.pick(e.currentTarget)}
          >
            {tr("选择一个项目开始")}
          </Button>
        )}
        <div className={s.actions}>
          <div className={s.leftActions}>
            <>
              <input
                type="file"
                multiple
                hidden
                ref={file}
                onChange={(e) => {
                  const selected = Array.from(e.target.files || []);
                  for (const file of selected)
                    void aui.composer.addAttachment(file);
                  e.target.value = "";
                }}
              />
              <IconButton
                icon={Plus}
                aria-label={tr("添加文件或调用指令")}
                disabled={!p.workspace}
                aria-haspopup="listbox"
                aria-expanded={commandsOpen}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setCommandQuery(commandsOpen ? null : "");
                  input.current?.focus();
                }}
              />
              {p.workspace && (
                <Button
                  variant="ghost"
                  ref={permissionButton}
                  className={s.permission}
                  aria-haspopup="menu"
                  aria-expanded={p.popupLayout === "permission"}
                  aria-label={"访问模式，当前：" + permission}
                  title={permission}
                  onClick={(e) =>
                    p.menu(
                      e.currentTarget,
                      Object.entries(permissionIcons)
                        .filter(
                          ([label]) =>
                            agent !== "pi" || label !== "工作区内修改",
                        )
                        .map(([label, icon]) => ({
                          label,
                          icon,
                          selected: label === permission,
                          action: () => setPermission(label),
                        })),
                      "permission",
                    )
                  }
                >
                  <Icon
                    name={permissionIcons[permission] || "permission"}
                    size={16}
                  />
                  <span>{tr(permission)}</span>
                  <Icon name="down" size={12} />
                </Button>
              )}
            </>
          </div>
          <div className={s.rightActions}>
            <EffortPicker spent={p.reasoningTokens} />
            <ModelPicker triggerRef={modelButton} />
            <>
              {dictating ? (
                <ComposerPrimitive.StopDictation asChild>
                  <IconButton icon={Square} aria-label="停止语音输入" />
                </ComposerPrimitive.StopDictation>
              ) : (
                <ComposerPrimitive.Dictate asChild>
                  <IconButton
                    icon={Mic}
                    aria-label="语音输入"
                    title={
                      speechSupported ? "语音输入" : "当前浏览器不支持语音输入"
                    }
                    disabled={!speechSupported || !p.workspace}
                  />
                </ComposerPrimitive.Dictate>
              )}
              {p.running ? (
                <ComposerPrimitive.Cancel asChild>
                  <IconButton
                    icon={Square}
                    variant="primary"
                    aria-label={tr("停止生成")}
                  />
                </ComposerPrimitive.Cancel>
              ) : null}
              {(!p.running || canSend) && (
                <ComposerPrimitive.Send asChild>
                  <IconButton
                    icon={ArrowUp}
                    variant="primary"
                    className={s.send}
                    aria-label={tr(p.running ? "追加提问" : "发送消息")}
                    title={
                      p.running
                        ? "加入队列，当前回复结束后自动发送"
                        : "发送消息"
                    }
                    disabled={!canSend}
                  />
                </ComposerPrimitive.Send>
              )}
            </>
          </div>
        </div>
      </ComposerPrimitive.Root>
    </div>
  );
}
