import type { InsightSession } from "../../../../shared/insights";
import { Button, Input, Select } from "../../components/ui";
import { Dialog } from "../../components/Overlay";
import { ContextBreakdown } from "../../components/assistant-ui/elements/context-breakdown";
import { modelKey, type Prices } from "./pricing";
import { elapsed, sum } from "../usage";
import s from "./Insights.module.css";
export function InsightSettings({
  close,
  preferred,
  setPreferred,
  choose,
  periods,
  currentModels,
  prices,
  setPrices,
}: {
  close: () => void;
  preferred: string;
  setPreferred: (value: string) => void;
  choose: (value: string) => void;
  periods: string[];
  currentModels: InsightSession[];
  prices: Prices;
  setPrices: (prices: Prices) => void;
}) {
  const rangeKey = "insights/default-range";
  return (
    <Dialog
      title="统计设置"
      close={close}
      className={s.settingsDialog + " formDialog"}
    >
      <h2>统计设置</h2>
      <label>
        默认时间范围
        <Select
          aria-label="默认时间范围"
          id="insights-period"
          value={preferred}
          options={periods.map((value) => ({ label: value, value }))}
          onValueChange={(value) => {
            setPreferred(value);
            localStorage.setItem(rangeKey, value);
            choose(value);
          }}
        />
      </label>
      <h3>模型单价 · 美元 / 百万 Token</h3>
      <p>
        单价由你填写，保存在当前浏览器。未配置时不估算费用；示例费用独立标注。
      </p>
      {currentModels.map((session) => {
        const key = modelKey(session);
        return (
          <fieldset key={key}>
            <legend>
              {session.agent} · {session.model}
            </legend>
            {(
              [
                ["input", "非缓存输入"],
                ["cached", "缓存输入"],
                ["output", "输出"],
              ] as const
            ).map(([field, label]) => (
              <label key={field}>
                {label}
                <Input
                  type="number"
                  min="0"
                  step="any"
                  aria-label={key + " " + label}
                  value={prices[key]?.[field] || ""}
                  onChange={(event) => {
                    const next = {
                      ...prices,
                      [key]: {
                        ...(prices[key] || {
                          input: "",
                          cached: "",
                          output: "",
                        }),
                        [field]: event.target.value,
                      },
                    };
                    setPrices(next);
                    localStorage.setItem(
                      "insights/prices",
                      JSON.stringify(next),
                    );
                  }}
                />
              </label>
            ))}
          </fieldset>
        );
      })}
      {!currentModels.length && (
        <p>实际会话出现模型用量后，可在这里配置单价。</p>
      )}
      <footer>
        <Button onClick={close}>关闭</Button>
      </footer>
    </Dialog>
  );
}
export function InsightDetail({
  detail,
  close,
  costText,
  open,
}: {
  detail: InsightSession;
  close: () => void;
  costText: (session: InsightSession) => string;
  open: (session: InsightSession) => void;
}) {
  return (
    <Dialog
      title={detail.title}
      close={close}
      className={s.sessionDialog + " formDialog"}
    >
      <h2>{detail.title}</h2>
      <p>{detail.workspace}</p>
      <small>
        {detail.sample ? "示例数据" : "CLI 实际记录"} · {detail.agent} ·{" "}
        {detail.model}
      </small>
      {!!detail.contextWindow && detail.contextTokens !== undefined && (
        <ContextBreakdown
          limit={detail.contextWindow}
          segments={[
            {
              label: "已报告上下文",
              tokens: detail.contextTokens,
              tint: "bg-blue-500",
            },
          ]}
        />
      )}
      <dl className={s.detailRows}>
        {[
          ["轮次", detail.turns],
          [
            "Token 总用量",
            detail.usage?.totalTokens.toLocaleString() || "未提供",
          ],
          ["输入", detail.usage?.inputTokens.toLocaleString() || "未提供"],
          [
            "缓存命中",
            detail.usage?.cachedInputTokens.toLocaleString() || "未提供",
          ],
          ["输出", detail.usage?.outputTokens.toLocaleString() || "未提供"],
          [
            "推理",
            detail.usage?.reasoningOutputTokens.toLocaleString() || "未提供",
          ],
          ["工具调用", sum(Object.values(detail.tools))],
          ["已记录耗时", elapsed(Math.round(detail.seconds))],
          ["预估费用", costText(detail)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>最后消息</h3>
      <p className={s.preview}>{detail.preview || "暂无消息"}</p>
      <footer>
        <Button variant="ghost" onClick={close}>
          关闭
        </Button>
        <Button onClick={() => open(detail)}>打开会话</Button>
      </footer>
    </Dialog>
  );
}
