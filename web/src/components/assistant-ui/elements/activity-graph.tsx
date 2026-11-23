"use client";

import type { ComponentProps } from "react";
import * as HeatGraph from "heat-graph";
import { cn } from "../utils";
import { mono, paper } from "./surfaces";

const LEVEL_TINT = [
  "bg-foreground/[0.06] inset-ring inset-ring-border forced-colors:border",
  "bg-blue-500/25 dark:bg-blue-400/25 forced-color-adjust-none",
  "bg-blue-500/45 dark:bg-blue-400/45 forced-color-adjust-none",
  "bg-blue-500/70 dark:bg-blue-400/70 forced-color-adjust-none",
  "bg-blue-500 dark:bg-blue-400 forced-color-adjust-none",
] as const;

export function ActivityGraph({
  data,
  start,
  end,
  title,
  total,
  className,
  onSelectDate,
  ...props
}: Omit<
  ComponentProps<"div">,
  "children" | "data" | "start" | "end" | "title" | "total"
> & {
  data: readonly HeatGraph.DataPoint[];
  start: string | Date;
  end: string | Date;
  title: string;
  total: string;
  onSelectDate?: (date: string) => void;
}) {
  return (
    <div
      data-slot="activity-graph"
      className={cn(
        paper,
        "flex w-full max-w-sm flex-col gap-3 rounded-2xl p-4",
        className,
      )}

      {...props}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[13.5px] font-medium">{title}</span>
        <span className={cn(mono, "text-muted-foreground tabular-nums")}>
          {total}
        </span>
      </div>

      <HeatGraph.Root
        data={[...data]}
        start={start}
        end={end}
        weekStart="monday"
        className="flex flex-col gap-2"
      >
        <div className="ml-[28px] grid auto-cols-[17px] grid-flow-col gap-[3px] text-[10px] text-muted-foreground">
          <HeatGraph.MonthLabels>
            {({ label }) => (
              <span
                style={{
                  gridColumn: label.column + 1,
                  gridRow: 1,
                  whiteSpace: "nowrap",
                }}
              >
                {label.month + 1}月
              </span>
            )}
          </HeatGraph.MonthLabels>
        </div>
        <div className="flex gap-2">
          <div className="flex shrink-0 flex-col gap-[3px]">
            <HeatGraph.DayLabels>
              {({ label }) => (
                <span
                  className={cn(
                    mono,
                    "text-muted-foreground flex h-[17px] items-center leading-none",
                  )}
                >
                  {label.row % 2 === 0
                    ? ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][
                        label.dayOfWeek
                      ]
                    : ""}
                </span>
              )}
            </HeatGraph.DayLabels>
          </div>

          {/* A reversed row starts scrolled to its end, so a narrow graph opens on the newest weeks. */}
          <div className="flex min-w-0 flex-row-reverse overflow-x-auto">
            <HeatGraph.Grid className="shrink-0 gap-[3px]">
              {({ cell }) => (
                <HeatGraph.Cell
                  role={onSelectDate ? "button" : undefined}
                  tabIndex={onSelectDate ? 0 : undefined}
                  aria-label={
                    cell.date.toLocaleDateString("sv-SE") + " · " + cell.count
                  }
                  title={
                    cell.date.toLocaleDateString("sv-SE") + " · " + cell.count
                  }
                  onClick={() =>
                    onSelectDate?.(cell.date.toLocaleDateString("sv-SE"))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectDate?.(cell.date.toLocaleDateString("sv-SE"));
                    }
                  }}
                  className={cn(
                    "size-[17px] rounded-[2px]",
                    LEVEL_TINT[cell.level] ?? LEVEL_TINT[0],
                  )}
                />
              )}
            </HeatGraph.Grid>
          </div>
        </div>

        <div className="flex items-center gap-1.5 self-end">
          <span className={cn(mono, "text-muted-foreground")}>少</span>
          {LEVEL_TINT.map((tint, level) => (
            <span
              key={level}
              aria-hidden
              className={cn("size-[17px] rounded-[2px]", tint)}
            />
          ))}
          <span className={cn(mono, "text-muted-foreground")}>多</span>
        </div>
      </HeatGraph.Root>
    </div>
  );
}
