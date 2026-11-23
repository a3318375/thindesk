import type { InsightSession } from "../../../../shared/insights";
type Price = { input: string; cached: string; output: string };
export type Prices = Record<string, Price>;
export const modelKey = (session: InsightSession) =>
  session.agent + ":" + session.model;
export function estimate(session: InsightSession, prices: Prices) {
  if (session.sample) return session.sampleCost;
  const rates = prices[modelKey(session)],
    usage = session.usage;
  if (
    !rates ||
    !usage ||
    Object.values(rates).some(
      (value) =>
        value.trim() === "" ||
        !Number.isFinite(Number(value)) ||
        Number(value) < 0,
    )
  )
    return undefined;
  return (
    (Math.max(0, usage.inputTokens - usage.cachedInputTokens) *
      Number(rates.input) +
      usage.cachedInputTokens * Number(rates.cached) +
      usage.outputTokens * Number(rates.output)) /
    1e6
  );
}
