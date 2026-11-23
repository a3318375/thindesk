// Adapted from assistant-ui Elements ReasoningEffort (MIT).
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { RotateCcw } from "lucide-react";
import { field, ghostButton, mono } from "./surfaces";
import { cn } from "../utils";

const labels: Record<string, string> = {
  off: "关闭", none: "无", minimal: "最低", low: "低", medium: "中",
  high: "高", xhigh: "极高", max: "最大", ultra: "超高",
};
export const effortLabel = (key: string) => labels[key] || key;

export function ReasoningEffort({ levels, selectedKey, spent, onSelect, onReset }: {
  levels: string[];
  selectedKey?: string;
  spent?: number;
  onSelect: (key: string) => void;
  onReset?: () => void;
}) {
  return (
    <div data-slot="reasoning-effort" className="flex w-full flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-1">
          <Dropdown.Label className="text-[13.5px] font-medium">思考强度</Dropdown.Label>
          {onReset && (
            <Dropdown.Item aria-label="沿用 CLI 默认" title="沿用 CLI 默认" onSelect={onReset}
              className={cn(ghostButton, "size-5 cursor-pointer")}>
              <RotateCcw size={12} aria-hidden="true" />
            </Dropdown.Item>
          )}
        </div>
        {spent !== undefined && (
          <span className={cn(mono, "text-muted-foreground tabular-nums")}>
            最近一轮 · {spent.toLocaleString()} tok
          </span>
        )}
      </div>
      <Dropdown.RadioGroup
        aria-label="思考强度"
        value={selectedKey ?? ""}
        onValueChange={onSelect}
        className={cn(field, "flex w-full items-stretch gap-0.5 rounded-full p-0.5")}
      >
        {levels.map(level => (
          <Dropdown.RadioItem
            key={level}
            value={level}
            onSelect={event => event.preventDefault()}
            className="min-w-0 flex-1 cursor-pointer whitespace-nowrap rounded-full px-0 py-1 text-center text-xs font-medium text-muted-foreground outline-hidden transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-foreground/30 data-[state=checked]:bg-background data-[state=checked]:text-foreground motion-reduce:transition-none"
          >
            {effortLabel(level)}
          </Dropdown.RadioItem>
        ))}
      </Dropdown.RadioGroup>
    </div>
  );
}
