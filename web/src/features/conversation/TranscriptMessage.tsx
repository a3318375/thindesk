import { SubagentTasks } from "./SubagentTasks";
import { AgentRequests } from "./AgentRequests";
import { Check, CircleAlert } from "lucide-react";
import { copyText } from "../../components/clipboard";
import { MessagePrimitive } from "@assistant-ui/react";
import { Button } from "../../components/ui";
import { useState } from "react";
import { AssistantMarkdown } from "./MessageMarkdown";
import { StoredAttachments } from "./StoredAttachments";
import { ErrorState } from "../../components/assistant-ui/elements/error-state";
import { StoppedRun } from "../../components/assistant-ui/elements/stopped-run";
import { messageBody } from "../../../../shared/workspace";
import type { Message } from "../../../../shared/workspace";
import { ghostButton } from "../../components/assistant-ui/elements/surfaces";
import { Activity } from "./Activity";
import { TurnChanges } from "./TurnChanges";
import { compact } from "../usage";
import { Icon } from "../../components/Icon";
import { useText } from "../../app/locale/text";

function Copy({ text }: { text: string }) {
  const tr = useText();
  const [result, setResult] = useState("");
  const label = tr("复制消息");
  return (
    <Button
      variant="ghost"
      className={ghostButton}
      aria-label={result || label}
      title={result || label}
      onClick={() =>
        void copyText(text).then(
          () => setResult("已复制"),
          () => setResult("复制失败"),
        )
      }
      onBlur={() => setResult("")}
    >
      {result ? (
        result === "已复制" ? (
          <Check size={16} />
        ) : (
          <CircleAlert size={16} />
        )
      ) : (
        <Icon name="copy" size={16} />
      )}
    </Button>
  );
}
function Clock({ at }: { at?: number }) {
  if (at === undefined) return null;
  const date = new Date(at);
  return (
    <time dateTime={date.toISOString()}>
      {date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })}
    </time>
  );
}
type Props = {
  workspace: string;
  message: Message;
  timestamp?: number;
  duration?: number;
  trajectory: boolean;
  steps: boolean;
  expanded: boolean;
  running: boolean;
  hideReply: boolean;
  showActions: boolean;
  recover?: (action: "retry-turn" | "continue-turn") => Promise<void>;
  turnUsage?: { tokens: number; cached: number };
  context?: () => void;
  source?: string;
  branch?: () => void;
  answer: (id: string, approved: boolean) => void;
};
export function TranscriptMessage({
  message: m,
  workspace,
  timestamp,
  duration,
  trajectory,
  steps,
  expanded,
  running,
  hideReply,
  showActions,
  recover,
  turnUsage,
  context,
  branch,
  source,
  answer,
}: Props) {
  const tr = useText();
  const body = messageBody(m);
  const [recovering, setRecovering] = useState(false);
  const [recoverError, setRecoverError] = useState("");
  const recoverTurn = async (action: "retry-turn" | "continue-turn") => {
    if (!recover || recovering) return;
    setRecovering(true);
    setRecoverError("");
    try {
      await recover(action);
    } catch (error) {
      setRecoverError(error instanceof Error ? error.message : "操作失败");
    } finally {
      setRecovering(false);
    }
  };
  const [vote, setVote] = useState(() => localStorage.getItem("vote/" + m.id));
  const hasSteps = !!(
    m.reasoning ||
    m.command ||
    m.hasCommand ||
    m.activity?.length
  );
  if (trajectory && !hasSteps && !m.approval) return null;
  return (
    <MessagePrimitive.Root asChild>
      <section
        className={
          "transcriptMessage " +
          (m.role === "user" ? "userMessage" : "assistantMessage")
        }
        data-message-id={m.id}
      >
        {!trajectory && m.role === "user" && (
          <>
            {!!m.attachments?.length && (
              <StoredAttachments attachments={m.attachments} />
            )}
            {m.steered && <small className="muted">补充指令 · 已交给运行器</small>}
            {m.text && <div className="bubble">{m.text}</div>}
            <div className="messageActions userActions">
              {source && <small>{source === "web" ? "网页" : source}</small>}
              <Clock at={timestamp} />
              {m.text && <Copy text={body} />}
            </div>
          </>
        )}
        {m.role === "assistant" && m.compaction && <div role="status" className="compactionStatus" data-status={m.compaction.status}>
          {m.compaction.status === "running" ? "正在整理上下文…" : m.compaction.status === "complete" ? "上下文整理完成" : "上下文整理未完成"}
          {m.compaction.detail && <small>{m.compaction.detail}</small>}
        </div>}
        {m.role === "assistant" && (
          <Activity
            message={m}
            running={running}
            duration={duration}
            expanded={expanded || trajectory}
            hidden={!steps && !trajectory}
            attention={<><SubagentTasks message={m} running={running} /><AgentRequests message={m} /></>}
          >
            {!trajectory && m.role === "assistant" && !hideReply && body && (
              <>
                <MessagePrimitive.Parts>
                  {({ part }) =>
                    part.type === "text" ? <AssistantMarkdown /> : null
                  }
                </MessagePrimitive.Parts>
                <TurnChanges message={m} workspace={workspace} />
                {!running && (
                  <div className="messageActions assistantActions">
                    <Copy text={body} />
                    {(["up", "down"] as const).map((direction) => (
                      <Button
                        variant="ghost"
                        className={ghostButton}
                        key={direction}
                        aria-label={
                          direction === "up" ? "赞同回答" : "不赞同回答"
                        }
                        title={direction === "up" ? "赞同回答" : "不赞同回答"}
                        aria-pressed={vote === direction}
                        onClick={() => {
                          const next = vote === direction ? null : direction;
                          if (next) localStorage.setItem("vote/" + m.id, next);
                          else localStorage.removeItem("vote/" + m.id);
                          setVote(next);
                        }}
                      >
                        <Icon name={"vote-" + direction} size={16} />
                      </Button>
                    ))}
                    {showActions && (
                      <>
                        {context && (
                          <Button
                            variant="ghost"
                            className={ghostButton}
                            aria-label="在上下文视图中查看此轮"
                            title="在上下文视图中查看此轮"
                            onClick={context}
                          >
                            <Icon name="turn-context" size={16} />
                          </Button>
                        )}
                        {branch && <Button
                          variant="ghost"
                          className={ghostButton}
                          aria-label="复制到新会话"
                          title="保留此处以前的记录，另开会话"
                          onClick={branch}
                        >
                          <Icon name="branch" size={16} />
                        </Button>}
                        {turnUsage && (
                          <details className="turnUsage">
                            <summary>
                              <Icon name="database" size={16} /> 用量{" "}
                              {compact(turnUsage.tokens)} tok
                            </summary>
                            <div>
                              本轮用量（示例）
                              <br />
                              {turnUsage.tokens.toLocaleString()} Token ·
                              缓存命中{" "}
                              {Math.round(
                                (turnUsage.cached * 100) /
                                  (turnUsage.tokens || 1),
                              )}
                              %
                            </div>
                          </details>
                        )}
                      </>
                    )}
                    <Clock at={timestamp} />
                  </div>
                )}
              </>
            )}
            {!trajectory && !hideReply && !body && <TurnChanges message={m} workspace={workspace} />}
          </Activity>
        )}
        {!trajectory &&
          m.role === "assistant" &&
          !running &&
          m.runStatus === "error" && (
            <div className="runOutcome">
              <ErrorState
                title="本轮执行失败"
                detail={recoverError || m.runError || "执行未能完成"}
                retrying={recovering}
                onRetry={
                  recover ? () => void recoverTurn("retry-turn") : undefined
                }
              />
            </div>
          )}
        {!trajectory &&
          m.role === "assistant" &&
          !running &&
          m.runStatus === "cancelled" && (
            <div className="runOutcome">
              <StoppedRun
                words={[]}
                reason="已停止生成。"
                onContinue={
                  recover && !recovering
                    ? () => void recoverTurn("continue-turn")
                    : undefined
                }
              />
              {recoverError && <p role="alert">{recoverError}</p>}
            </div>
          )}
        {m.approval && (
          <div className="approval">
            <strong>
              {tr(
                m.approval === "pending"
                  ? "等待审批"
                  : m.approval === "approved"
                    ? "已批准"
                    : "已拒绝",
              )}
            </strong>
            {m.approval === "pending" && (
              <div>
                <Button
                  variant="default"
                  className="outline"
                  onClick={() => answer(m.id, false)}
                >
                  {tr("拒绝")}
                </Button>{" "}
                <Button
                  variant="primary"
                  className="primary"
                  onClick={() => answer(m.id, true)}
                >
                  {tr("允许一次")}
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
    </MessagePrimitive.Root>
  );
}
