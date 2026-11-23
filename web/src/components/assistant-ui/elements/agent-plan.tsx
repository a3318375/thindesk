"use client";

import type { ComponentProps } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { cn } from "../utils";
import { mono } from "./surfaces";
import { announced, pct, progressOf } from "../element-utils";

export type AgentPlanStep = {
  id?: string | undefined;
  label: string;
  description?: string | undefined;
  status?: "pending" | "inProgress" | "completed";
};

export function AgentPlan({
  steps,
  activeIndex,
  title = "执行计划",
  running = true,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "steps" | "activeIndex"> & {
  running?: boolean;
  steps: readonly (string | AgentPlanStep)[];
  activeIndex: number;
  title?: string | undefined;
}) {
  const total = steps.length;
  const completed = steps.some(
    (step) => typeof step !== "string" && step.status,
  )
    ? steps.filter(
        (step) => typeof step !== "string" && step.status === "completed",
      ).length
    : progressOf(activeIndex, total);
  const allDone = completed >= total;
  const progress = pct(completed, total);

  return (
    <div
      data-slot="agent-plan"
      className={cn("flex w-full max-w-full flex-col gap-3", className)}

      {...props}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13.5px] font-medium">{title}</span>
        <span className={cn(mono, "text-muted-foreground tabular-nums")}>
          {completed} / {total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${title}进度`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={announced(progress)}
        aria-valuetext={`已完成 ${completed} / ${total} 步`}
        className="bg-foreground/[0.06] inset-ring-border h-[3px] w-full overflow-hidden rounded-full inset-ring forced-colors:outline"
      >
        <span
          aria-hidden
          className="bg-foreground/80 block h-full rounded-full transition-[width] duration-500 forced-color-adjust-none motion-reduce:transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>
      <ul className="flex flex-col gap-2.5">
        {steps.map((step, i) => {
          const item = typeof step === "string" ? { label: step } : step;
          const done = item.status
            ? item.status === "completed"
            : allDone || i < completed;
          const active =
            running &&
            (item.status
              ? item.status === "inProgress"
              : !allDone && i === completed);
          const status = done ? "已完成" : active ? "进行中" : "待处理";
          return (
            <li
              key={typeof step === "string" ? i : (step.id ?? i)}
              className={cn(
                "flex gap-2.5 text-[13.5px]",
                active && item.description ? "items-start" : "items-center",
              )}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {done ? (
                  <CheckIcon
                    aria-hidden
                    className="text-muted-foreground size-3.5"
                  />
                ) : active ? (
                  <Loader2Icon
                    aria-hidden
                    className="text-foreground/90 size-3.5 animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="bg-foreground/15 inset-ring-border size-1.5 rounded-full inset-ring forced-colors:border"
                  />
                )}
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    done && "text-muted-foreground",
                    active && "text-foreground/90",
                    !done && !active && "text-muted-foreground",
                  )}
                >
                  {item.label}
                </span>
                <span className="sr-only">{` ${status}`}</span>
                {active && item.description ? (
                  <span className="text-muted-foreground mt-0.5 block text-xs">
                    {item.description}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
