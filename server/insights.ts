import { commandPrograms } from "./command-programs.ts";
import type { Desk, TokenBreakdown } from "../shared/workspace.ts";
import type { InsightDay, InsightsData } from "../shared/insights.ts";
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
function day(time: number) {
  const date = new Date(time);
  return new Date(time - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}
export function insightsView(desk: Desk): InsightsData {
  return {
    generatedAt: Date.now(),
    sessions: desk.sessions.map((session) => {
      const tools: Record<string, number> = {},
        commands: Record<string, number> = {},
        skills: Record<string, number> = {};
      const bump = (map: Record<string, number>, key: string) => {
        if (key) map[key] = (map[key] || 0) + 1;
      };
      const days = new Map<string, InsightDay>();
      const bucket = (time: number) => {
        const date = day(time);
        if (!days.has(date))
          days.set(date, { date, tokens: 0, runs: 0, tools: 0, seconds: 0 });
        return days.get(date)!;
      };
      let seconds = 0,
        toolSeconds = 0,
        toolRunSeconds = 0,
        timedRuns = 0,
        datedTokens = 0;
      for (const message of session.messages) {
        if (message.role !== "assistant") continue;
        const when =
          message.finishedAt ?? message.startedAt ?? message.createdAt;
        const entry = when !== undefined ? bucket(when) : undefined;
        if (entry) entry.runs++;
        if (message.tokenUsage && entry) {
          entry.tokens += message.tokenUsage.totalTokens;
          datedTokens += message.tokenUsage.totalTokens;
          entry.usage ??= {
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 0,
          };
          for (const key of Object.keys(
            entry.usage,
          ) as (keyof TokenBreakdown)[])
            entry.usage[key] += message.tokenUsage[key];
        }
        if (
          message.startedAt !== undefined &&
          message.finishedAt !== undefined
        ) {
          const elapsed =
            Math.max(0, message.finishedAt - message.startedAt) / 1000;
          seconds += elapsed;
          timedRuns++;
          if (
            message.command ||
            message.activity?.some((activity) => activity.kind === "tool")
          )
            toolRunSeconds += elapsed;
          if (entry) entry.seconds += elapsed;
        }
        const native =
          message.activity?.filter((activity) => activity.kind === "tool") ||
          [];
        for (const activity of native) {
          const tool =
            activity.toolName ||
            (activity.toolType === "terminal"
              ? "命令执行"
              : activity.toolType === "diff"
                ? "文件修改"
                : activity.label.split(/\s+/, 1)[0]);
          bump(tools, tool);
          if (entry) entry.tools++;
          if (activity.durationMs !== undefined)
            toolSeconds += Math.max(0, activity.durationMs) / 1000;
          if (activity.command)
            for (const program of commandPrograms(activity.command))
              bump(commands, program);
          if (/^(?:load_skill|skill)$/i.test(tool) && activity.target)
            bump(skills, activity.target);
        }
        if (!native.length && message.command) {
          bump(tools, session.agent === "pi" ? "bash" : "命令执行");
          for (const program of commandPrograms(message.command.split("\n", 1)[0]))
            bump(commands, program);
          if (entry) entry.tools++;
        }
      }
      const sample = !session.tokenUsage && session.sampleUsage;
      let usage: TokenBreakdown | undefined = session.tokenUsage?.total;
      if (sample) {
        const total = sum(sample.tokens),
          output = (sample.tokens[6] || 0) + (sample.tokens[7] || 0);
        usage = {
          totalTokens: total,
          inputTokens: Math.max(0, total - output),
          outputTokens: output,
          cachedInputTokens: sample.cached,
          reasoningOutputTokens: sample.tokens[6] || 0,
        };
        seconds = sum(sample.seconds);
        toolSeconds = sample.seconds[2] || 0;
        toolRunSeconds = Math.min(seconds, toolSeconds);
        timedRuns = session.messages.filter(
          (m) => m.role === "assistant",
        ).length;
        if (sample.skill) bump(skills, sample.skill);
        if (session.updatedAt !== undefined) {
          const entry = bucket(session.updatedAt);
          entry.tokens = total;
          entry.usage = usage;
          entry.seconds = seconds;
          datedTokens = total;
        }
      }
      return {
        id: session.id,
        title: session.title,
        workspace: session.workspace,
        preview: session.messages.at(-1)?.text.slice(0, 240) || "",
        updatedAt: session.updatedAt,
        archived: !!session.archived,
        agent: session.agent || "codex",
        model: session.model || "CLI 默认",
        sample: !!sample,
        turns: session.messages.filter((m) => m.role === "user").length,
        steps: session.messages.filter((m) => m.role === "assistant").length,
        tools,
        commands,
        skills,
        usage,
        contextTokens: session.tokenUsage?.last.totalTokens,
        contextWindow: session.tokenUsage?.modelContextWindow ?? undefined,
        seconds,
        toolSeconds,
        toolRunSeconds,
        timedRuns,
        days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
        undatedTokens: Math.max(0, (usage?.totalTokens || 0) - datedTokens),
        sampleCost: sample ? sample.costUSD : undefined,
      };
    }),
  };
}
