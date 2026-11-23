import { Brain } from "lucide-react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { useEffect, useState } from "react";
import { Button } from "../ui";
import { ReasoningEffort, effortLabel } from "./elements/reasoning-effort";
import { useComposerOptions } from "../../features/conversation/AssistantProvider";
export function EffortPicker({ spent }: { spent?: number }) {
  const { options, configure, selectionReady } = useComposerOptions();
  const [capability, setCapability] = useState<{ key: string; levels: string[]; defaultEffort?: string }>();
  const [error, setError] = useState("");
  const key = options.agent + "/" + options.model;
  useEffect(() => {
    if (!selectionReady) return;
    const controller = new AbortController();
    setError(""); setCapability(undefined);
    const query = new URLSearchParams({ agent: options.agent, model: options.model });
    void fetch("/api/model-capabilities?" + query, { signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw Error(result.error); return result; })
      .then(result => { if (!controller.signal.aborted) setCapability({ key, levels: result.levels, defaultEffort: result.defaultEffort }); })
      .catch(() => { if (!controller.signal.aborted) setError("暂未取得模型能力"); });
    return () => controller.abort();
  }, [key, options.agent, options.model, selectionReady]);
  const levels = capability?.key === key ? capability.levels : [];
  const selected = options.effort || (capability?.key === key ? capability.defaultEffort : undefined);
  const label = selected ? effortLabel(selected) : "思考强度";
  return <Dropdown.Root modal={false}>
    <Dropdown.Trigger asChild>
      <Button variant="ghost" className="flex items-center gap-1 whitespace-nowrap max-md:px-1" disabled={!selectionReady}
        aria-label="配置思考强度" title={selected ? `思考强度 · ${selected}` : label}>
        <Brain size={14} /><span className="max-[550px]:hidden">{label}</span>
      </Button>
    </Dropdown.Trigger>
    <Dropdown.Portal><Dropdown.Content aria-label="思考强度设置"
      className="z-[100] box-border w-[min(416px,calc(100vw-24px))] rounded-xl border border-solid border-border bg-background px-4 py-3 text-foreground shadow-sm"
      side="top" align="center" sideOffset={8} collisionPadding={12}>
      {levels.length ? (
        <ReasoningEffort levels={levels} selectedKey={selected} spent={spent}
          onSelect={effort => configure({ ...options, effort })}
          onReset={options.effort ? () => configure({ ...options, effort: undefined }) : undefined}
        />
      ) : <p>{error || (capability ? "此模型未提供可调档位" : "正在读取模型能力…")}</p>}
    </Dropdown.Content></Dropdown.Portal>
  </Dropdown.Root>;
}
