import type { InsightSession } from "../../../../shared/insights";
import { Button } from "../../components/ui";
import { Ring } from "./Charts";
import { compact, localDay } from "../usage";
import s from "./Insights.module.css";
export function SessionCards({
  visible,
  setDetailId,
  costText,
}: {
  visible: InsightSession[];
  setDetailId: (id: string) => void;
  costText: (session: InsightSession) => string;
}) {
  return (
    <div className={s.sessionGrid}>
      {visible.map((session) => (
        <Button key={session.id} onClick={() => setDetailId(session.id)}>
          <header>
            <b>{session.title}</b>
            <small>
              {session.updatedAt ? localDay(new Date(session.updatedAt)) : ""}
            </small>
          </header>
          <small>
            {session.sample ? "示例 · " : ""}
            {session.agent} · {session.model}
            {session.archived ? " · 已归档" : ""}
          </small>
          <div className={s.sessionUsage}>
            <Ring
              values={
                session.contextTokens !== undefined
                  ? [
                      session.contextTokens,
                      Math.max(
                        0,
                        (session.contextWindow || session.contextTokens) -
                          session.contextTokens,
                      ),
                    ]
                  : []
              }
              value={
                session.contextTokens === undefined
                  ? "—"
                  : compact(session.contextTokens)
              }
              label={
                session.contextWindow
                  ? (
                      (session.contextTokens! / session.contextWindow) *
                      100
                    ).toFixed(1) + "%"
                  : "当前上下文"
              }
            />
            <dl>
              <dt>轮次</dt>
              <dd>
                {session.turns} 轮 {session.steps} 步
              </dd>
              <dt>Token 总用量</dt>
              <dd>
                {session.usage ? compact(session.usage.totalTokens) : "—"}
              </dd>
              <dt>预估费用</dt>
              <dd>{costText(session)}</dd>
            </dl>
          </div>
        </Button>
      ))}
    </div>
  );
}
