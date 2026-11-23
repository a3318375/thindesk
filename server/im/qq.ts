import {
  QQBot,
  ApiError,
  type QQBotInboundMessage,
  type ReplyTarget,
} from "@tencent-connect/qqbot-nodejs";
import { ImHttp } from "./http.ts";
import {
  DeliveryError,
  InboundFileError,
  type AdapterEvents,
  type ImAdapter,
  type ImBot,
  type Outbound,
  type ReplyContext,
} from "./types.ts";
export function qqInbound(message: QQBotInboundMessage) {
  if (!["c2c", "group"].includes(message.kind) || message.senderIsBot)
    return null;
  if (
    message.kind === "group" &&
    message.rawEventType !== "GROUP_AT_MESSAGE_CREATE"
  )
    return null;
  const content = message.content.replace(/<@!?\w+>/g, "").trim();
  const attachments = message.attachments || [];
  return {
    id: message.messageId,
    conversation: `${message.kind}:${message.replyTarget.targetId}:${message.senderId}`,
    sender: message.senderId,
    label:
      message.senderName || (message.kind === "group" ? "QQ 群聊" : "QQ 私聊"),
    text: content,
    attachments,
    timestamp: Date.parse(message.timestamp) || undefined,
    context: {
      chatId: message.replyTarget.targetId,
      messageId: message.messageId,
      group: message.kind === "group",
    },
  };
}
export class QqAdapter implements ImAdapter {
  private inbox = new Map<string, Promise<void>>();
  private client: QQBot;
  private http: ImHttp;
  private signal?: AbortSignal;
  private events: AdapterEvents;
  constructor(
    bot: ImBot,
    events: AdapterEvents,
    createBot = (options: ConstructorParameters<typeof QQBot>[0]) =>
      new QQBot(options),
  ) {
    this.events = events;
    this.http = new ImHttp(bot.proxy);
    this.client = createBot({
      appId: bot.credentials.appId!,
      appSecret: bot.credentials.appSecret!,
      transport: "websocket",
      markdownSupport: false,
      logger: {
        error: () => {},
        warn: () => {},
        info: () => {},
        debug: () => {},
      },
    });
    this.client.on("ready", () => events.state("connected"));
    this.client.on("resumed", () => events.state("connected"));
    this.client.on("error", () =>
      events.state("error", "QQ 连接异常，正在等待恢复"),
    );
    this.client.on("message", (_context, message) => {
      const key = `${message.kind}:${message.replyTarget.targetId}:${message.senderId}`;
      const pending = (this.inbox.get(key) || Promise.resolve())
        .then(() => this.receive(message))
        .catch(() => events.state("error", "QQ 消息处理失败，请重新发送"));
      this.inbox.set(key, pending);
      void pending.finally(() => {
        if (this.inbox.get(key) === pending) this.inbox.delete(key);
      });
    });
  }
  private async receive(message: QQBotInboundMessage) {
    const normalized = qqInbound(message);
    if (!normalized) return;
    const files = [];
    let rejected: string | undefined;
    try {
      for (const attachment of normalized.attachments) {
        const url = attachment.url.startsWith("//")
          ? "https:" + attachment.url
          : attachment.url;
        files.push({
          name:
            attachment.filename ||
            (attachment.content_type.startsWith("image/")
              ? "qq-image.jpg"
              : "qq-file"),
          bytes: await this.http.bytes(url, this.signal),
        });
      }
    } catch (error) {
      if (error instanceof InboundFileError) rejected = error.message;
      else throw error;
    }
    if (normalized.text || files.length || rejected)
      await this.events.receive({
        ...normalized,
        files: rejected ? [] : files,
        rejected,
      });
  }
  async start(signal: AbortSignal) {
    this.signal = signal;
    await this.client.start(signal);
  }
  private target(context: ReplyContext): ReplyTarget {
    return {
      scope: context.group ? "group" : "c2c",
      targetId: context.chatId,
      msgId: context.messageId,
    };
  }
  async send(message: Outbound) {
    const target = this.target(message.context);
    try {
      const result = await this.client.send({
        target,
        msgType: 2,
        markdown: { content: message.text },
        extra: { msg_seq: message.sequence },
      });
      return result.id;
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.httpStatus === 429)
          throw new DeliveryError("QQ 请求过于频繁", false, 5);
        if (error.httpStatus >= 200 && error.httpStatus < 500) {
          try {
            return (
              await this.client.send({
                target,
                msgType: 0,
                content: message.text,
                extra: { msg_seq: message.sequence },
              })
            ).id;
          } catch (fallback) {
            if (fallback instanceof ApiError)
              throw new DeliveryError(
                `QQ 拒绝投递（${fallback.bizCode || fallback.httpStatus}）`,
              );
            throw new DeliveryError("QQ 投递结果未得到确认", true);
          }
        }
        throw new DeliveryError(
          `QQ 投递失败（${error.bizCode || error.httpStatus}）`,
          error.httpStatus >= 500,
        );
      }
      throw new DeliveryError("QQ 投递结果未得到确认", true);
    }
  }
  async typing(context: ReplyContext) {
    if (!context.group) await this.client.sendTyping(this.target(context), 8);
  }
  close() {
    this.client.stop();
    this.http.close();
  }
}
