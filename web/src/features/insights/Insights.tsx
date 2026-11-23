import { ArrowLeft } from "lucide-react";
import { Button, Input, Select } from "../../components/ui";
import { useState, useEffect, useMemo } from "react";
import type { Desk, Session } from "../../../../shared/workspace";
import type { InsightsData, InsightSession } from "../../../../shared/insights";
import { Icon } from "../../components/Icon";
import { Chart } from "../../components/assistant-ui/elements/chart";
import { ActivityGraph } from "../../components/assistant-ui/elements/activity-graph";
import { paper } from "../../components/assistant-ui/elements/surfaces";
import { Card, Distribution, Ranking } from "./Charts";
import { compact, elapsed, localDay, offsetDay, sum } from "../usage";
import s from "./Insights.module.css";
import { modelKey, estimate, type Prices } from "./pricing";
import { InsightSettings, InsightDetail } from "./InsightDialogs";
import { SessionCards } from "./SessionCards";
const periods = ["今天", "近 7 天", "近 30 天", "全部"];
const rangeKey = "insights/default-range";
function startOf(period: string, today: string) {
  return period === "全部"
    ? ""
    : offsetDay(today, period === "今天" ? 0 : period === "近 7 天" ? -6 : -29);
}
export function Insights({
  desk,
  back,
  select,
}: {
  desk: Desk;
  back: () => void;
  select: (session: Session) => void;
}) {
  const today = localDay(new Date());
  const [preferred, setPreferred] = useState(
    () => localStorage.getItem(rangeKey) || "近 30 天",
  );
  const [range, setRange] = useState(preferred),
    [start, setStart] = useState(() => startOf(preferred, today)),
    [end, setEnd] = useState(today);
  const [calendar, setCalendar] = useState(false),
    [settings, setSettings] = useState(false);
  const [query, setQuery] = useState(""),
    [matches, setMatches] = useState<string[]>([]);
  const [sort, setSort] = useState("最近更新"),
    [archive, setArchive] = useState("全部会话（显示已归档）"),
    [group, setGroup] = useState("");
  const [includeSamples, setIncludeSamples] = useState(true),
    [metric, setMetric] = useState<"tokens" | "runs">("tokens");
  const [detailId, setDetailId] = useState("");
  const [prices, setPrices] = useState<Prices>(() => {
    try {
      return JSON.parse(localStorage.getItem("insights/prices") || "{}");
    } catch {
      return {};
    }
  });
  const [data, setData] = useState<InsightsData | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [loading, setLoading] = useState(true);
  // Update only this page's summary. Never fetch the full desk or message histories.
  const revision = desk.sessions
    .map(
      (session) =>
        session.id + ":" + session.updatedAt + ":" + session.archived,
    )
    .join("|");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      void fetch("/api/insights", { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw Error("统计加载失败");
          return response.json() as Promise<InsightsData>;
        })
        .then((value) => {
          setData(value);
          setError("");
        })
        .catch((reason) => {
          if (!controller.signal.aborted)
            setError(String(reason.message || reason));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [revision, reload]);
  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        void fetch("/api/search?" + new URLSearchParams({ query }), {
          signal: controller.signal,
        })
          .then((response) => response.json())
          .then((result) => setMatches(result.ids || []))
          .catch(() => {
            if (!controller.signal.aborted) setMatches([]);
          }),
      150,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  function choose(period: string) {
    setRange(period);
    setStart(startOf(period, today));
    setEnd(today);
  }
  const sessions = useMemo(
    () =>
      (data?.sessions || []).filter((session) => {
        if (session.sample && !includeSamples) return false;
        const date =
          session.updatedAt === undefined
            ? ""
            : localDay(new Date(session.updatedAt));
        return (!start || date >= start) && (!end || date <= end);
      }),
    [data, includeSamples, start, end],
  );
  const usage = sessions.flatMap((session) =>
    session.usage ? [session.usage] : [],
  );
  const total = sum(usage.map((item) => item.totalTokens)),
    input = sum(usage.map((item) => item.inputTokens)),
    cached = sum(usage.map((item) => item.cachedInputTokens));
  const output = sum(usage.map((item) => item.outputTokens)),
    reasoning = sum(usage.map((item) => item.reasoningOutputTokens));
  const seconds = sum(sessions.map((session) => session.seconds)),
    toolSeconds = sum(sessions.map((session) => session.toolSeconds));
  const toolRunSeconds = sum(sessions.map((session) => session.toolRunSeconds));
  const counts = (key: "tools" | "commands" | "skills") => {
    const result: Record<string, number> = {};
    for (const session of sessions)
      for (const [name, count] of Object.entries(session[key]))
        result[name] = (result[name] || 0) + count;
    return result;
  };
  const tools = counts("tools"),
    commands = counts("commands"),
    skills = counts("skills");
  const costs = sessions
    .map((session) => estimate(session, prices))
    .filter((value): value is number => value !== undefined);
  const groups = [...new Set(sessions.map((session) => session.workspace))];
  const activeGroup = groups.includes(group) ? group : "";
  const term = query.trim().toLowerCase();
  const visible = sessions
    .filter(
      (session) =>
        (!activeGroup || session.workspace === activeGroup) &&
        (archive !== "仅已归档" || session.archived) &&
        (archive !== "隐藏已归档" || !session.archived) &&
        (!term ||
          matches.includes(session.id) ||
          [session.title, session.workspace, session.preview].some((value) =>
            value.toLowerCase().includes(term),
          )),
    )
    .sort(
      (a, b) =>
        (sort === "Token 总用量"
          ? (b.usage?.totalTokens || 0) - (a.usage?.totalTokens || 0)
          : sort === "当前上下文"
            ? (b.contextTokens || 0) - (a.contextTokens || 0)
            : sort === "轮次"
              ? b.turns - a.turns
              : 0) || (b.updatedAt || 0) - (a.updatedAt || 0),
    );
  const days = new Map<
    string,
    { tokens: number; runs: number; cost: number; priced: boolean }
  >();
  for (const session of sessions)
    for (const entry of session.days) {
      if ((start && entry.date < start) || (end && entry.date > end)) continue;
      const value = days.get(entry.date) || {
        tokens: 0,
        runs: 0,
        cost: 0,
        priced: false,
      };
      value.tokens += entry.tokens;
      value.runs += entry.runs;
      const dailyCost = entry.usage
        ? estimate({ ...session, usage: entry.usage }, prices)
        : undefined;
      if (dailyCost !== undefined) {
        value.cost += dailyCost;
        value.priced = true;
      }
      days.set(entry.date, value);
    }
  const week = Array.from({ length: 7 }, (_, index) =>
    offsetDay(end || today, index - 6),
  );
  const detail = data?.sessions.find((session) => session.id === detailId);
  const currentModels = [
    ...new Map(
      (data?.sessions || [])
        .filter((session) => !session.sample)
        .map((session) => [modelKey(session), session]),
    ).values(),
  ];
  const costText = (session: InsightSession) => {
    const value = estimate(session, prices);
    return value === undefined ? "未配置单价" : "$" + value.toFixed(4);
  };
  const open = (session: InsightSession) => {
    const original = desk.sessions.find((item) => item.id === session.id);
    if (original) select(original);
  };
  return (
    <article className={s.page} aria-label="上下文洞察">
      <div className={s.heading}>
        <Button variant="ghost" onClick={back}>
          <ArrowLeft size={16} />
          返回会话
        </Button>
        <h1>上下文洞察</h1>
        <Button variant="ghost" onClick={() => setSettings(true)}>
          <Icon name="im-settings" size={14} />
          统计设置
        </Button>
        <Button
          variant="ghost"
          onClick={() => setReload((value) => value + 1)}
          disabled={loading}
        >
          {loading ? "更新中…" : "刷新统计"}
        </Button>
        <span />
        <Button
          variant="ghost"
          onClick={() => setCalendar(!calendar)}
          aria-expanded={calendar}
        >
          {start || "全部"} → {end || "全部"}
          <Icon name="down" size={12} />
        </Button>
        <div className={s.pills}>
          {periods.map((period) => (
            <Button
              variant="ghost"
              key={period}
              aria-pressed={range === period}
              onClick={() => choose(period)}
            >
              {period}
            </Button>
          ))}
        </div>
      </div>
      {calendar && (
        <div className={s.dates}>
          <input
            type="date"
            aria-label="起始日期"
            max={end}
            value={start}
            onChange={(event) => {
              setStart(event.target.value);
              setRange("自定义");
            }}
          />{" "}
          →
          <input
            type="date"
            aria-label="结束日期"
            min={start}
            value={end}
            onChange={(event) => {
              setEnd(event.target.value);
              setRange("自定义");
            }}
          />
          <Button variant="ghost" onClick={() => setCalendar(false)}>
            确定
          </Button>
        </div>
      )}
      {error && (
        <p role="alert">
          {error}
          <Button onClick={() => setReload((value) => value + 1)}>重试</Button>
        </p>
      )}
      {!data ? (
        <p role="status">正在异步加载统计…</p>
      ) : (
        <>
          <div className={s.sourceLine}>
            <label>
              <input
                type="checkbox"
                checked={includeSamples}
                onChange={(event) => setIncludeSamples(event.target.checked)}
              />
              包含示例数据
            </label>
            <small>
              {sessions.filter((session) => !session.sample).length} 个真实会话
              · {sessions.filter((session) => session.sample).length} 个示例 ·
              日期按会话最近活动筛选
            </small>
          </div>
          <div className={s.grid}>
            <div className={s.stats}>
              {[
                [
                  "全部会话",
                  sessions.length,
                  "其中已归档 " +
                    sessions.filter((session) => session.archived).length +
                    " 个",
                ],
                [
                  "Token 消耗",
                  usage.length ? compact(total) : "—",
                  "轮次 " + sum(sessions.map((session) => session.turns)),
                ],
                [
                  "预估费用",
                  costs.length ? "$" + sum(costs).toFixed(3) : "—",
                  "已计价 " + costs.length + "/" + sessions.length + " 个会话",
                ],
                [
                  "缓存命中",
                  input ? ((100 * cached) / input).toFixed(2) + "%" : "—",
                  "缓存命中 / 输入 Token",
                ],
                [
                  "工具调用",
                  sum(Object.values(tools)),
                  "工具执行 " + elapsed(Math.round(toolSeconds)),
                ],
                [
                  "活跃时长",
                  seconds ? elapsed(Math.round(seconds)) : "—",
                  "已计时 " +
                    sum(sessions.map((session) => session.timedRuns)) +
                    " 次回复",
                ],
              ].map(([label, value, description]) => (
                <div className={paper} key={label}>
                  <small>{label}</small>
                  <b>{value}</b>
                  <small>{description}</small>
                </div>
              ))}
            </div>
            <Card title="近 7 天用量" icon="data">
              <div className={s.trends}>
                <div>
                  <Chart
                    className={s.trend}
                    label="Token 消耗"
                    value={compact(
                      sum(week.map((date) => days.get(date)?.tokens || 0)),
                    )}
                    variant="bars"
                    points={week.map((date) => days.get(date)?.tokens || 0)}
                    visibleCount={7}
                  />
                  <div className={s.dayLabels}>
                    {week.map((date) => (
                      <small
                        key={date}
                        title={
                          date +
                          " · " +
                          (days.get(date)?.tokens || 0).toLocaleString() +
                          " Token"
                        }
                      >
                        {date.slice(5)}
                      </small>
                    ))}
                  </div>
                </div>
                <div>
                  <Chart
                    className={s.trend}
                    label="预估费用 · USD"
                    value={
                      week.some((date) => days.get(date)?.priced)
                        ? "$" +
                          sum(
                            week.map((date) => days.get(date)?.cost || 0),
                          ).toFixed(3)
                        : "未配置 / 无记录"
                    }
                    variant="bars"
                    points={week.map((date) => days.get(date)?.cost || 0)}
                    visibleCount={7}
                  />
                  <div className={s.dayLabels}>
                    {week.map((date) => (
                      <small
                        key={date}
                        title={
                          date +
                          (days.get(date)?.priced
                            ? " · $" + days.get(date)!.cost.toFixed(4)
                            : " · 无已计价记录")
                        }
                      >
                        {date.slice(5)}
                      </small>
                    ))}
                  </div>
                </div>
              </div>
              <p className={s.note}>
                按已记录的每轮用量汇总；
                {compact(
                  sum(sessions.map((session) => session.undatedTokens)),
                )}{" "}
                Token 未分日。费用按当前模型配置的单价估算。
              </p>
            </Card>
            <Distribution
              title="Token 统计"
              labels={["非缓存输入", "缓存输入", "推理输出", "其他输出"]}
              values={[
                Math.max(0, input - cached),
                cached,
                reasoning,
                Math.max(0, output - reasoning),
              ]}
              note="缓存与推理按包含关系拆开，避免重复计算。CLI 未提供系统提示词、工具定义和文件各自的 Token 数。"
            />
            <Distribution
              title="耗时统计"
              labels={["含工具调用的回复", "其他回复"]}
              values={[toolRunSeconds, Math.max(0, seconds - toolRunSeconds)]}
              timed
              note="按回复墙钟时间统计。工具累计执行时间单列于顶部，可包含并行重叠；CLI 未提供等待、思考和输出各阶段计时。"
            />
          </div>
          <div className={s.details}>
            <Card
              title="活跃度"
              icon="gauge"
              extra={
                <div className={s.pills}>
                  {(["runs", "tokens"] as const).map((key) => (
                    <Button
                      variant="ghost"
                      key={key}
                      aria-pressed={metric === key}
                      onClick={() => setMetric(key)}
                    >
                      {key === "runs" ? "回复次数" : "Token 消耗"}
                    </Button>
                  ))}
                </div>
              }
            >
              <ActivityGraph
                className={s.activityGraph}
                title={
                  metric === "tokens" ? "已记录的每日用量" : "每日助手回复"
                }
                total={compact(
                  sum([...days.values()].map((value) => value[metric])),
                )}
                start={offsetDay(end || today, -55)}
                end={end || today}
                data={[...days].map(([date, value]) => ({
                  date,
                  count: value[metric],
                }))}
                onSelectDate={(date) => {
                  setStart(date);
                  setEnd(date);
                  setRange("自定义");
                }}
              />
            </Card>
            <Ranking
              title="技能加载"
              icon="skill"
              counts={skills}
              unit="技能"
            />
            <Ranking
              title="工具调用"
              icon="inspect"
              counts={tools}
              unit="工具"
            />
            <Ranking
              title="命令执行"
              icon="api"
              counts={commands}
              unit="命令"
            />
          </div>
          <div className={s.search}>
            <b>
              会话 <small>{visible.length}</small>
            </b>
            <Input
              aria-label="搜索会话"
              placeholder="搜索标题 / 目录 / 消息…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Select
              aria-label="归档筛选"
              id="insights-archive"
              value={archive}
              onValueChange={setArchive}
              options={["全部会话（显示已归档）", "隐藏已归档", "仅已归档"].map(
                (value) => ({ label: value, value }),
              )}
            />
            <div className={s.pills}>
              {["最近更新", "Token 总用量", "当前上下文", "轮次"].map(
                (value) => (
                  <Button
                    variant="ghost"
                    key={value}
                    aria-pressed={sort === value}
                    onClick={() => setSort(value)}
                  >
                    {value}
                  </Button>
                ),
              )}
            </div>
          </div>
          <div className={s.pills}>
            {["", ...groups].map((path) => (
              <Button
                variant="ghost"
                key={path}
                aria-pressed={activeGroup === path}
                onClick={() => setGroup(path)}
              >
                {path
                  ? desk.workspaceNames?.[path] || path.split("/").pop() || path
                  : "全部"}
              </Button>
            ))}
          </div>
          <SessionCards
            visible={visible}
            setDetailId={setDetailId}
            costText={costText}
          />
          {!visible.length && <p className={s.empty}>当前筛选范围内没有会话</p>}
        </>
      )}
      {settings && (
        <InsightSettings
          close={() => setSettings(false)}
          preferred={preferred}
          setPreferred={setPreferred}
          choose={choose}
          periods={periods}
          currentModels={currentModels}
          prices={prices}
          setPrices={setPrices}
        />
      )}
      {detail && (
        <InsightDetail
          detail={detail}
          close={() => setDetailId("")}
          costText={costText}
          open={open}
        />
      )}
    </article>
  );
}
