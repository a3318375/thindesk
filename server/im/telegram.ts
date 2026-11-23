import { ImHttp, pause } from "./http.ts";
import {
  DeliveryError,
  InboundFileError,
  type AdapterEvents,
  type ImAdapter,
  type ImBot,
  type InboundFile,
  type Outbound,
  type ReplyContext,
} from "./types.ts";
type TelegramMessage = {
  message_id: number;
  date?: number;
  chat: { id: number; title?: string; type: string };
  from?: { id: number; first_name?: string; is_bot?: boolean };
  message_thread_id?: number;
  text?: string;
  caption?: string;
  photo?: { file_id: string; file_size?: number }[];
  document?: { file_id: string; file_name?: string };
  reply_to_message?: { text?: string; caption?: string; from?: { id: number } };
};
type Update = { update_id: number; message?: TelegramMessage };
export class TelegramAdapter implements ImAdapter {
  private http: ImHttp;
  private signal?: AbortSignal;
  private base: string;
  private bot: ImBot;
  private events: AdapterEvents;
  private cursor: string;
  constructor(bot: ImBot, events: AdapterEvents, cursor: string) {
    this.bot = bot;
    this.events = events;
    this.cursor = cursor;
    this.http = new ImHttp(bot.proxy);
    this.base = (bot.credentials.baseUrl || "https://api.telegram.org").replace(
      /\/$/,
      "",
    );
  }
  private async call<T>(
    method: string,
    body: Record<string, unknown>,
    sending = false,
    signal?: AbortSignal,
  ) {
    const result = await this.http.json<{
      ok: boolean;
      result: T;
      error_code?: number;
      parameters?: { retry_after?: number };
    }>(`${this.base}/bot${this.bot.credentials.token}/${method}`, {
      body,
      sending,
      signal,
    });
    if (!result.ok)
      throw new DeliveryError(
        `Telegram 请求被拒绝（${result.error_code || "未知状态"}）`,
        false,
        result.parameters?.retry_after,
      );
    return result.result;
  }
  async start(signal: AbortSignal) {
    this.signal = signal;
    const me = await this.call<{ id: number; username?: string }>(
      "getMe",
      {},
      false,
      signal,
    );
    this.events.state("connected");
    let backoff = 1000;
    while (!signal.aborted) {
      try {
        const updates = await this.call<Update[]>(
          "getUpdates",
          {
            offset: Number(this.cursor || 0),
            timeout: 25,
            allowed_updates: ["message"],
          },
          false,
          signal,
        );
        for (const update of updates) {
          if (signal.aborted) break;
          const message = update.message;
          if (message && !message.from?.is_bot && message.from) {
            const original = message.text || message.caption || "";
            const mentioned =
              me.username &&
              original.toLowerCase().includes("@" + me.username.toLowerCase());
            const addressed =
              message.chat.type === "private" ||
              mentioned ||
              message.reply_to_message?.from?.id === me.id;
            if (!addressed) {
              this.cursor = String(update.update_id + 1);
              this.events.cursor(this.cursor);
              continue;
            }
            const content = me.username
              ? original
                  .replace(new RegExp("@" + me.username + "\\b", "ig"), "")
                  .trim()
              : original;
            const files: InboundFile[] = [];
            const photo = message.photo?.at(-1);
            const attachment = message.document || photo;
            let rejected: string | undefined;
            if (attachment)
              try {
                const info = await this.call<{ file_path: string }>(
                  "getFile",
                  { file_id: attachment.file_id },
                  false,
                  signal,
                );
                files.push({
                  name: message.document?.file_name || "telegram-image.jpg",
                  bytes: await this.http.bytes(
                    `${this.base}/file/bot${this.bot.credentials.token}/${info.file_path}`,
                    signal,
                  ),
                });
              } catch (error) {
                if (
                  error instanceof InboundFileError ||
                  (error instanceof DeliveryError &&
                    !error.uncertain &&
                    !error.retryAfter)
                )
                  rejected = "附件无法接收，请重新发送";
                else throw error;
              }
            if (content || files.length || rejected)
              await this.events.receive({
                id: String(update.update_id),
                conversation: `${message.chat.id}:${message.message_thread_id || 0}:${message.from.id}`,
                sender: String(message.from.id),
                label:
                  message.chat.title || message.from.first_name || "Telegram",
                text: content,
                files,
                rejected,
                timestamp: message.date ? message.date * 1000 : undefined,
                context: {
                  chatId: String(message.chat.id),
                  threadId: message.message_thread_id,
                  messageId: String(message.message_id),
                  group: message.chat.type !== "private",
                },
              });
          }
          this.cursor = String(update.update_id + 1);
          this.events.cursor(this.cursor);
        }
        backoff = 1000;
        this.events.state("connected");
      } catch (error) {
        if (signal.aborted) break;
        this.events.state(
          "error",
          error instanceof Error ? error.message : "Telegram 连接异常",
        );
        await pause(backoff, signal);
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  }
  async send(message: Outbound) {
    const result = await this.call<{ message_id: number }>(
      "sendMessage",
      {
        chat_id: message.context.chatId,
        message_thread_id: message.context.threadId,
        text: message.text,
      },
      true,
      this.signal,
    );
    return String(result.message_id);
  }
  async typing(context: ReplyContext) {
    await this.call(
      "sendChatAction",
      {
        chat_id: context.chatId,
        message_thread_id: context.threadId,
        action: "typing",
      },
      false,
      this.signal,
    );
  }
  close() {
    this.http.close();
  }
}
