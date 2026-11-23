import { messageCountOf } from "../../../../shared/workspace";
import { Button } from "../../components/ui";
import type { Session } from "../../../../shared/workspace";
import { useText } from "../../app/locale/text";
import { SessionSourceIcon } from "../../components/SessionSourceIcon";

export function RecentSessions({
  sessions,
  select,
}: {
  sessions: Session[];
  select: (session: Session) => void;
}) {
  const tr = useText();
  const recent = sessions
    .filter((s) => !s.archived && messageCountOf(s))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 5);
  if (!recent.length) return null;
  return (
    <section className="recentSessions" aria-label={tr("最近会话")}>
      <h2>{tr("最近会话")}</h2>
      {recent.map((session) => (
        <Button
          variant="ghost"
          key={session.id}
          aria-label={tr("打开会话") + " · " + session.title}
          onClick={() => select(session)}
        >
          <SessionSourceIcon channel={session.channel} size={26} />
          <div className="recentCopy">
            <strong>{session.title}</strong>
            <small>
              {(session.preview ?? session.messages.at(-1)?.text ?? "")
                .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
                .replace(/(\*\*|`)/g, "")}
            </small>
          </div>
          {session.updatedAt && (
            <time>
              {new Date(session.updatedAt).toLocaleDateString(
                document.documentElement.lang,
                { month: "short", day: "numeric" },
              )}
            </time>
          )}
        </Button>
      ))}
    </section>
  );
}
