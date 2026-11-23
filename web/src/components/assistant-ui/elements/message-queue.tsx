// Runtime-connected adaptation of assistant-ui Elements Message Queue (MIT).
import { ComposerPrimitive, QueueItemPrimitive, useAuiState } from "@assistant-ui/react";
import { ArrowUp, X } from "lucide-react";
import { cn } from "../utils";
import { field, ghostButton, mono } from "./surfaces";
import { usePendingQueue } from "../../../features/conversation/AssistantProvider";

const actionClass = cn(ghostButton, "size-6 shrink-0 p-0 disabled:opacity-40");

export function MessageQueue() {
  const { entries, paused, error, resume } = usePendingQueue();
  const count = useAuiState(s => s.composer.queue.length);
  if (!count) return null;

  const details = new Map(entries?.map((item, index) => [item.id, { item, number: index + 1 }] as const));
  return (
    <section data-slot="message-queue" aria-label="待发送的追加问题" className="mb-2 flex w-full min-w-0 flex-col gap-2">
      <header className={cn(mono, "flex items-baseline justify-between gap-2 px-1 text-muted-foreground")}>
        <span>{count} 条待发送{paused && " · 已暂停"}</span>
        {paused ? (
          <button type="button" onClick={resume} className={cn(ghostButton, "px-2 py-0.5")}>继续发送</button>
        ) : <span>本轮结束后依次发送</span>}
      </header>
      {error && <p role="status" className="px-1 text-xs text-muted-foreground">{error}</p>}
      <ol className="m-0 flex max-h-[30dvh] list-none flex-col gap-1.5 overflow-y-auto p-0">
        <ComposerPrimitive.Queue>
          {({ queueItem }) => {
            const detail = details.get(queueItem.id);
            const note = detail?.item.steering ? "正在交给 CLI…" : detail?.item.steeringNote;
            return (
              <li data-queue-id={queueItem.id} className={cn(field,
                "flex items-center gap-2.5 rounded-2xl py-2 pr-2 pl-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300",
              )}>
                <span aria-hidden="true" className={cn(mono, "min-w-3 shrink-0 text-muted-foreground tabular-nums")}>
                  {detail?.number}
                </span>
                <div className="min-w-0 flex-1">
                  <QueueItemPrimitive.Text title={detail?.item.text || detail?.item.attachments.map(f => f.name).join("、")}
                    className="block truncate text-[13.5px] text-foreground/65" />
                  {note && <small role="status" className="block text-xs text-muted-foreground">{note}</small>}
                </div>
                <QueueItemPrimitive.Steer type="button" aria-label="补充到本轮" title="尝试补充到本轮"
                  disabled={detail?.item.steering} className={actionClass}>
                  <ArrowUp className="size-3.5" />
                </QueueItemPrimitive.Steer>
                <QueueItemPrimitive.Remove type="button" aria-label="取消这条追加问题" title="取消这条消息"
                  disabled={detail?.item.steering} className={actionClass}>
                  <X className="size-3.5" />
                </QueueItemPrimitive.Remove>
              </li>
            );
          }}
        </ComposerPrimitive.Queue>
      </ol>
    </section>
  );
}
