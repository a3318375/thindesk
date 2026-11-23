import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Code2,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { useEffect, useState, type Ref } from "react";
import { useAui } from "@assistant-ui/react";
import { Button } from "../ui";
import { useComposerOptions } from "../../features/conversation/AssistantProvider";
import type {
  AgentId,
  AgentModel,
  AgentModels,
} from "../../../../shared/models";

import { readModels } from "../../api/models";

export function ModelPicker({
  triggerRef,
}: {
  triggerRef: Ref<HTMLButtonElement>;
}) {
  const { options, configure, selectionReady } = useComposerOptions();
  const aui = useAui();
  const [groups, setGroups] = useState<AgentModels[]>([]);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<AgentId | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!groups.length)
      void readModels()
        .then(setGroups)
        .catch((error) => setError(String(error)));
  }, [open, groups.length]);
  const selected = groups.find((group) => group.id === options.agent);
  const model = selected?.models.find((model) => model.id === options.model);
  const label = !selectionReady ? "读取会话模型…" :
    (options.agent === "pi" ? "Pi" : "Codex") +
    " · " +
    ((options.model && model?.name) ||
      options.model ||
      (groups.length ? "CLI 默认模型" : "读取模型…"));
  useEffect(
    () =>
      aui.modelContext.register({
        getModelContext: () => ({
          config: { modelName: options.model || undefined },
        }),
      }),
    [aui, options.model],
  );
  const current = groups.find((group) => group.id === stage);
  const models = current
    ? current.models.filter((model) => model.id || !current.defaultModel)
    : [];
  if (
    current &&
    options.agent === stage &&
    options.model &&
    !models.some((model) => model.id === options.model)
  )
    models.unshift({ id: options.model, name: options.model });
  function choose(model: AgentModel) {
    configure({
      ...options,
      agent: stage!,
      effort: stage === options.agent && model.id === options.model ? options.effort : undefined,
      model: model.id || current?.defaultModel || "",
      permission:
        stage === "pi" && options.permission === "工作区内修改"
          ? "仅可查看"
          : options.permission,
    });
    setOpen(false);
    setStage(null);
    setQuery("");
  }
  return (
    <Dropdown.Root
      open={open}
      modal={false}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) {
          setStage(null);
          setQuery("");
        }
      }}
    >
      <Dropdown.Trigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          className="modelTrigger"
          aria-label={"选择运行器和模型，当前：" + label}
          title={label}
          disabled={!selectionReady}
        >
          {options.agent === "pi" ? (
            <Sparkles size={14} />
          ) : (
            <Code2 size={14} />
          )}
          <span>{label}</span>
          <ChevronDown size={12} />
        </Button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="ui-popup modelPicker"
          side="top"
          align="start"
          sideOffset={8}
        >
          {!stage ? (
            <>
              <Dropdown.Label className="menuLabel">选择运行器</Dropdown.Label>
              {groups.length ? (
                groups.map((group) => (
                  <Dropdown.Item
                    className="ui-menu-item"
                    key={group.id}
                    aria-label={group.name}
                    disabled={!group.available}
                    onSelect={(event) => {
                      event.preventDefault();
                      setStage(group.id);
                    }}
                  >
                    {group.id === "pi" ? (
                      <Sparkles size={16} />
                    ) : (
                      <Code2 size={16} />
                    )}
                    <span>{group.name}</span>
                    <small>
                      {group.available
                        ? group.models.length - 1 + " 个模型"
                        : "未安装"}
                    </small>
                    <ChevronRight size={14} />
                  </Dropdown.Item>
                ))
              ) : (
                <div role="status" className="menuLabel">
                  {error || "正在读取 CLI 模型…"}
                </div>
              )}
            </>
          ) : (
            <>
              <Dropdown.Item
                className="ui-menu-item modelBack"
                aria-label="返回运行器"
                onSelect={(event) => {
                  event.preventDefault();
                  setStage(null);
                  setQuery("");
                }}
              >
                <ArrowLeft size={14} />
                {current?.name} 模型
              </Dropdown.Item>
              <input
                className="ui-input modelSearch"
                autoFocus
                aria-label={"搜索 " + current?.name + " 模型"}
                placeholder="搜索模型…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setOpen(false);
                  else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    event.currentTarget.parentElement
                      ?.querySelector<HTMLElement>(
                        ".modelChoices [role=menuitem]",
                      )
                      ?.focus();
                  }
                  event.stopPropagation();
                }}
              />
              <div className="modelChoices">
                {models
                  .filter((model) =>
                    (model.name + model.id)
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((model) => (
                    <Dropdown.Item
                      className="ui-menu-item modelOption"
                      key={model.id}
                      aria-label={model.id || "默认 " + current?.name}
                      onSelect={() => choose(model)}
                    >
                      <span>
                        {model.name}
                        <small>
                          {model.id === current?.defaultModel
                            ? "CLI 默认"
                            : model.provider ||
                              (!model.id
                                ? "CLI 默认"
                                : model.id !== model.name
                                  ? model.id
                                  : "")}
                        </small>
                      </span>
                      {options.agent === stage &&
                        options.model === model.id && <Check size={14} />}
                    </Dropdown.Item>
                  ))}
              </div>
              {current?.error && <p className="menuLabel">{current.error}</p>}
            </>
          )}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
