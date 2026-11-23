import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Desk, TokenBreakdown } from "../shared/workspace.ts";
import type { InsightDay, InsightsData } from "../shared/insights.ts";

type UsageRecord = { date: string; usage: TokenBreakdown };
type CachedLog = { stamp: string; records: UsageRecord[] };
const cache = new Map<string, CachedLog>();
let directory: { root: string; until: number; files: string[] } | undefined;
const zero = (): TokenBreakdown => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
});
const fields = Object.keys(zero()) as (keyof TokenBreakdown)[];
function localDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10);
}
async function usageRecords(path: string): Promise<UsageRecord[]> {
  const info = await stat(path),
    stamp = info.mtimeMs + ":" + info.size;
  const previous = cache.get(path);
  if (previous?.stamp === stamp) return previous.records;
  const records: UsageRecord[] = [];
  // Stream the rollout and parse only usage metadata. Never retain transcript lines.
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.includes('"token_count"')) continue;
      try {
        const record = JSON.parse(line),
          native = record.payload?.info?.total_token_usage;
        const date = localDate(record.timestamp);
        if (
          record.type !== "event_msg" ||
          record.payload.type !== "token_count" ||
          !native ||
          !date
        )
          continue;
        const count = (key: string) =>
          typeof native[key] === "number" && Number.isFinite(native[key])
            ? Math.max(0, native[key])
            : 0;
        records.push({
          date,
          usage: {
            inputTokens: count("input_tokens"),
            outputTokens: count("output_tokens"),
            cachedInputTokens: count("cached_input_tokens"),
            reasoningOutputTokens: count("reasoning_output_tokens"),
            totalTokens: count("total_tokens"),
          },
        });
      } catch {
        /* A running CLI may still be appending the final line. */
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  cache.set(path, { stamp, records });
  // Bound memory when many old sessions are inspected.
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return records;
}
export function dailyNativeUsage(records: UsageRecord[], ceiling: number) {
  const days = new Map<string, TokenBreakdown>();
  let previous = zero();
  for (const record of records) {
    if (
      record.usage.totalTokens <= previous.totalTokens ||
      record.usage.totalTokens > ceiling
    )
      continue;
    const usage = days.get(record.date) || zero();
    for (const key of fields)
      usage[key] += Math.max(0, record.usage[key] - previous[key]);
    days.set(record.date, usage);
    previous = record.usage;
  }
  return days;
}
export async function addNativeUsage(
  data: InsightsData,
  desk: Desk,
  root = join(homedir(), ".codex", "sessions"),
): Promise<InsightsData> {
  if (
    process.env.THINDESK_CODEX &&
    root === join(homedir(), ".codex", "sessions")
  )
    return data;
  const candidates = desk.sessions.filter(
    (session) =>
      session.codexThread && session.tokenUsage && session.agent !== "pi",
  );
  if (!candidates.length) return data;
  try {
    if (!directory || directory.root !== root || directory.until < Date.now())
      directory = {
        root,
        until: Date.now() + 30000,
        files: await readdir(root, { recursive: true }),
      };
    const files = directory.files;
    // Sequential reads avoid competing scans of several large rollouts.
    for (const session of candidates) {
      const summary = data.sessions.find((item) => item.id === session.id);
      if (!summary?.undatedTokens || !summary.usage) continue;
      const file = files.find((path) =>
        path.endsWith("-" + session.codexThread + ".jsonl"),
      );
      if (!file) continue;
      try {
        const daily = dailyNativeUsage(
          await usageRecords(join(root, file)),
          summary.usage.totalTokens,
        );
        const known = [...daily.values()].reduce(
          (sum, usage) => sum + usage.totalTokens,
          0,
        );
        if (known <= summary.usage.totalTokens - summary.undatedTokens)
          continue;
        const days = new Map<string, InsightDay>(
          summary.days.map((day) => [
            day.date,
            { ...day, tokens: 0, usage: undefined },
          ]),
        );
        for (const [date, usage] of daily) {
          const day = days.get(date) || {
            date,
            runs: 0,
            tools: 0,
            seconds: 0,
            tokens: 0,
          };
          day.tokens = usage.totalTokens;
          day.usage = usage;
          days.set(date, day);
        }
        summary.days = [...days.values()].sort((a, b) =>
          a.date.localeCompare(b.date),
        );
        summary.undatedTokens = Math.max(0, summary.usage.totalTokens - known);
      } catch {
        /* Native history is optional; retain the database summary. */
      }
    }
  } catch {
    /* No rollout directory on this host. */
  }
  return data;
}
