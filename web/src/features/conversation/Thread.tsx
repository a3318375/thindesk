import { PERSONAL_SESSION_ID } from "../../../../shared/workspace";
import "./conversation.css";
import { ArrowDown } from "lucide-react";
import { ThreadPrimitive } from "@assistant-ui/react";
import { Button } from "../../components/ui";
import type { MenuItem } from "../../components/Overlay";
import { useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import type { Session } from "../../../../shared/workspace";
import { useText } from "../../app/locale/text";
import { sum, tokensOf } from "../usage";
import { Icon } from "../../components/Icon";
import { TranscriptMessage } from "./TranscriptMessage";

type Props = {
  session: Session;
  recover: (
    message: string,
    action: "retry-turn" | "continue-turn",
  ) => Promise<void>;
  loadEarlier: () => Promise<void>;
  historyLoading: boolean;
  codeViews: boolean;
  stepDisplay: string;
  collapseTiming: string;
  replyDisplay: string;
  menu: (anchor: HTMLElement, items: MenuItem[]) => void;
  branch?: (id: string) => void;
  answer: (id: string, approved: boolean) => void;
};
export function Thread({
  session,
  recover,
  loadEarlier,
  historyLoading,
  menu,
  branch,
  answer,
  codeViews,
  stepDisplay,
  collapseTiming,
  replyDisplay,
}: Props) {
  const tr = useText();
  const [selected, setTab] = useState("对话");
  const [contextId, setContextId] = useState("");
  const [pinned, setPinned] = useState(true);
  const tab = codeViews ? selected : "对话";
  const scroll = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const olderAnchor = useRef<{
    height: number;
    top: number;
    first: string;
  } | null>(null);
  const positions = useMemo(
    () =>
      new Map(session.messages.map((message, index) => [message.id, index])),
    [session.messages],
  );
  useLayoutEffect(() => {
    const anchor = olderAnchor.current;
    if (anchor && scroll.current && session.messages[0]?.id !== anchor.first) {
      scroll.current.scrollTop =
        anchor.top + scroll.current.scrollHeight - anchor.height;
      olderAnchor.current = null;
    }
  }, [session.messages]);
  useLayoutEffect(() => {
    follow.current = true;
    olderAnchor.current = null;
    setPinned(true);
  }, [session.id]);
  useLayoutEffect(() => {
    if (scroll.current && follow.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [session, tab]);
  useEffect(() => {
    const container = scroll.current;
    if (!container) return;
    const followBottom = () => {
      if (follow.current && !olderAnchor.current)
        container.scrollTop = container.scrollHeight;
    };
    const resize = new ResizeObserver(followBottom);
    const observeContent = () => {
      resize.disconnect();
      resize.observe(container);
      for (const child of container.children) resize.observe(child);
      followBottom();
    };
    const mutations = new MutationObserver(observeContent);
    mutations.observe(container, { childList: true });
    observeContent();
    return () => { resize.disconnect(); mutations.disconnect(); };
  }, [session.id, tab]);
  const lastUser = session.messages.findLastIndex((m) => m.role === "user");
  const lastReply = session.messages.findLastIndex(
    (m) => m.role === "assistant" && m.text,
  );
  // Earlier sample transcripts store timing on the session instead of each message.
  const sampleSeconds = session.sampleUsage
    ? sum(session.sampleUsage.seconds)
    : undefined;
  const sampleEnd =
    session.messages[1]?.createdAt ??
    (session.messages.length === 2 ? session.updatedAt : undefined);
  const turnTails = new Set<string>();
  let tail: string | undefined;
  for (const message of session.messages) {
    if (message.role === "user") {
      if (tail) turnTails.add(tail);
      tail = undefined;
    } else if (message.text) tail = message.id;
  }
  if (tail && !session.running) turnTails.add(tail);
  const focusIndex = session.messages.findIndex((m) => m.id === contextId);
  const contextStart =
    focusIndex < 0
      ? lastUser
      : session.messages
          .slice(0, focusIndex + 1)
          .findLastIndex((m) => m.role === "user");
  const contextMessages = session.messages.slice(
    Math.max(0, contextStart),
    focusIndex < 0 ? undefined : focusIndex + 1,
  );
  return (
    <>
      <header className="threadHead">
        <div>
          <b>
            {(session.channel || "网页") + " · "}
            {session.title}
          </b>
          {session.agent && (
            <small>{session.agent === "pi" ? "Pi" : "Codex"}</small>
          )}
        </div>
        {tab !== "对话" && (
          <Button variant="ghost" onClick={() => setTab("对话")}>
            返回对话
          </Button>
        )}
        {codeViews && (
          <Button
            variant="ghost"
            className="iconButton"
            aria-label="会话视图"
            title="会话视图"
            onClick={(event) =>
              menu(event.currentTarget, [
                {
                  label: "对话",
                  selected: tab === "对话",
                  action: () => setTab("对话"),
                },
                {
                  label: "工具记录",
                  selected: tab === "轨迹",
                  action: () => setTab("轨迹"),
                },
                {
                  label: "上下文",
                  selected: tab === "上下文",
                  action: () => setTab("上下文"),
                },
              ])
            }
          >
            <Icon name="sliders" size={16} />
          </Button>
        )}
      </header>
      <div
        ref={scroll}
        className="messages"
        aria-live={session.running ? "off" : "polite"}
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          setPinned(follow.current);
        }}
      >
        {!!session.messageOffset && (
          <div className="historyLoader">
            <Button
              disabled={historyLoading}
              onClick={() => {
                if (scroll.current)
                  olderAnchor.current = {
                    height: scroll.current.scrollHeight,
                    top: scroll.current.scrollTop,
                    first: session.messages[0].id,
                  };
                follow.current = false;
                void loadEarlier();
              }}
            >
              {historyLoading ? "正在加载更早消息…" : "加载更早消息"}
            </Button>
          </div>
        )}
        {tab === "上下文" ? (
          <section>
            <h3>{tr("工作区")}</h3>
            {session.workspace}
            <h3>本轮消息</h3>
            {contextMessages.map((message) => (
              <p key={message.id}>
                <b>{message.role === "user" ? "用户" : "助手"}</b>　
                {message.text}
              </p>
            ))}
          </section>
        ) : (
          <ThreadPrimitive.Messages>
            {({ message }) => {
              const index = positions.get(message.id) ?? -1;
              const m = session.messages[index];
              if (!m) return null;
              return (
                <TranscriptMessage
                  workspace={session.workspace}
                  message={m}
                  recover={
                    !session.running && m.id === session.messages.at(-1)?.id
                      ? (action) => recover(m.id, action)
                      : undefined
                  }
                  timestamp={
                    m.createdAt ??
                    (sampleSeconds !== undefined &&
                    sampleEnd !== undefined &&
                    index < 2
                      ? sampleEnd - (index === 0 ? sampleSeconds * 1000 : 0)
                      : undefined)
                  }
                  duration={index === 1 ? sampleSeconds : undefined}
                  showActions={turnTails.has(m.id) && m.approval !== "pending"}
                  context={
                    codeViews
                      ? () => {
                          setContextId(m.id);
                          setTab("上下文");
                        }
                      : undefined
                  }
                  branch={branch && (() => branch(m.id))}
                  source={session.id === PERSONAL_SESSION_ID ? m.origin || "web" : undefined}
                  turnUsage={
                    index === 1 && session.sampleUsage
                      ? {
                          tokens: tokensOf(session),
                          cached: session.sampleUsage.cached,
                        }
                      : undefined
                  }
                  trajectory={tab === "轨迹"}
                  steps={stepDisplay !== "简洁"}
                  running={!!session.running && index > lastUser}
                  expanded={
                    stepDisplay === "完全展开" ||
                    (stepDisplay === "详细" &&
                      index > lastUser &&
                      (collapseTiming === "下次有新消息时" ||
                        !!session.running))
                  }
                  hideReply={
                    !session.running &&
                    replyDisplay === "仅最终回答" &&
                    index > lastUser &&
                    index !== lastReply
                  }
                  answer={answer}
                />
              );
            }}
          </ThreadPrimitive.Messages>
        )}
        {!pinned && (
          <div className="chatScrollAnchor">
            <Button
              aria-label="回到最新消息"
              onClick={() => {
                if (scroll.current)
                  scroll.current.scrollTo({
                    top: scroll.current.scrollHeight,
                    behavior: matchMedia("(prefers-reduced-motion: reduce)")
                      .matches
                      ? "instant"
                      : "smooth",
                  });
                follow.current = true;
                setPinned(true);
              }}
            >
              <ArrowDown size={14} />
              回到最新
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
