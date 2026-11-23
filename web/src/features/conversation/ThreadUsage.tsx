import { Button } from "../../components/ui";
import type { Session } from "../../../../shared/workspace";
import { Icon } from "../../components/Icon";
import { compact, tokensOf, turnsOf } from "../usage";

export function ThreadUsage({
  session,
  openInsights,
}: {
  session: Session;
  openInsights: () => void;
}) {
  const turns = turnsOf(session);
  const steps =
    session.stepCount ??
    session.messages.filter((m) => m.role === "assistant").length;
  const usage = session.sampleUsage;
  const actual = session.tokenUsage;
  const tokens = actual?.total.totalTokens ?? tokensOf(session);
  const rate =
    !actual && usage && usage.seconds[1] > 0
      ? Math.round(usage.tokens[7] / usage.seconds[1])
      : undefined;
  const cached = actual?.total.cachedInputTokens ?? usage?.cached ?? 0;
  const input = actual?.total.inputTokens ?? tokens;
  const hit = input ? Math.round((100 * cached) / input) : 0;
  const contextWindow = actual?.modelContextWindow;
  const contextTokens = actual?.last.totalTokens;
  return (
    <footer className="threadUsage" aria-label="会话统计">
      <details name="thread-stat">
        <summary>
          <Icon name="gauge" size={16} />
          {turns} 轮 {steps} 步{rate !== undefined && <> · {rate} tok/s</>}
        </summary>
        <p>
          {turns} 轮对话，{steps} 个助手步骤。
          {rate !== undefined && <>示例输出速率按回复 Token 和回复耗时计算。</>}
        </p>
      </details>
      {(actual || usage) && (
        <Button
          variant="ghost"
          className="usageContextButton"
          aria-label="查看上下文与用量"
          onClick={openInsights}
        >
          <Icon name="database" size={16} />
          {compact(tokens)} tok · 缓存命中 {hit}%
        </Button>
      )}
      <Button
        variant="ghost"
        className="usageContextButton"
        aria-label="上下文占用情况"
        onClick={openInsights}
      >
        <i aria-hidden="true" className="contextGauge" />
        {contextWindow && contextTokens !== undefined
          ? Math.round((contextTokens / contextWindow) * 100) + "%"
          : "—"}
      </Button>
    </footer>
  );
}
