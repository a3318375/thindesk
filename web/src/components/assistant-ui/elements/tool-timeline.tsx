"use client";

import type { ReactNode } from "react";
import { ChevronRightIcon, type LucideIcon } from "lucide-react";
import { cn } from "../utils";
import {
  CollapsibleRoot as Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible-root";
import { collapsePanel, ShimmerLabel, SwapLabel } from "./surfaces";
import { take } from "../element-utils";

export interface TimelineStep {
  id?: string;
  verb: string;
  chip: string;
  icon: LucideIcon;
}

export interface TimelineStat {
  file: string;
  canOpen?: boolean;
  added?: number;
  removed?: number;
}

export interface ToolTimelineProps {
  steps: readonly TimelineStep[];
  visibleSteps: number;
  streaming: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restingLabel: string;
  activeLabel: string;
  stats: TimelineStat[];
  className?: string;
  onFileClick?: (path: string) => void;
  renderStep?: (step: TimelineStep, index: number) => ReactNode;
}

export function ToolTimeline({
  steps,
  visibleSteps,
  streaming,
  open,
  onOpenChange,
  restingLabel,
  activeLabel,
  stats,
  onFileClick,
  renderStep,
  className,
}: ToolTimelineProps) {
  return (
    <Collapsible
      data-slot="tool-timeline"
      open={open}
      onOpenChange={onOpenChange}
      className={cn("w-full max-w-full", className)}
    >
      <CollapsibleTrigger className="group/trigger text-muted-foreground hover:text-foreground/90 flex items-center gap-1.5 rounded-md py-1 text-[13.5px] transition-colors outline-none">
        <ChevronRightIcon className="size-3.5 shrink-0 opacity-60 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-[state=open]/trigger:rotate-90 motion-reduce:transition-none" />
        <SwapLabel
          active={streaming ? 0 : 1}
          className="text-start tabular-nums"
        >
          <ShimmerLabel
            active={streaming}
            className="relative inline-block leading-none"
          >
            {activeLabel}
          </ShimmerLabel>
          <>{restingLabel}</>
        </SwapLabel>
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(collapsePanel, "outline-none")}>
        <div className="flex flex-col gap-2.5 ps-4 pt-2.5">
          {take(steps, visibleSteps).map((step, index, shown) => {
            if (renderStep)
              return (
                <div
                  key={step.id || index}
                  className="min-w-0 fade-in slide-in-from-bottom-1 animate-in fill-mode-both duration-300 motion-reduce:animate-none"
                >
                  {renderStep(step, index)}
                </div>
              );
            const Icon = step.icon;
            const active = streaming && index === shown.length - 1;

            return (
              <div
                key={step.id ? `id:${step.id}` : index}
                className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-muted-foreground flex items-center gap-2 text-[13.5px] duration-300"
              >
                <Icon className="text-muted-foreground size-3.5 shrink-0" />
                <ShimmerLabel
                  active={active}
                  className="relative inline-block leading-none"
                >
                  {step.verb}
                </ShimmerLabel>
                <span className="bg-foreground/[0.06] text-foreground/70 max-w-full rounded-md px-1.5 py-0.5 font-mono text-[11px]">
                  {step.chip}
                </span>
              </div>
            );
          })}
          {stats.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {stats.map((stat) => (
                <button
                  type="button"
                  onClick={() => onFileClick?.(stat.file)}
                  disabled={!onFileClick || stat.canOpen === false}
                  aria-label={"查看变更 " + stat.file}
                  key={stat.file}
                  className="bg-foreground/[0.06] text-foreground/70 inline-flex items-center gap-1 max-w-full rounded-md px-1.5 py-0.5 font-mono text-[11px]"
                >
                  <span className="min-w-0 truncate">
                    {stat.file.split("/").pop()}
                  </span>
                  {stat.added !== undefined && (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      +{stat.added}
                    </span>
                  )}
                  {stat.removed !== undefined && (
                    <span className="text-red-600 dark:text-red-400">
                      −{stat.removed}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
