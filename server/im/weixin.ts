import { createDecipheriv, randomBytes } from "node:crypto";
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
export const weixinBase = "https://ilinkai.weixin.qq.com";
type Media = {
  encrypt_query_param?: string;
  full_url?: string;
  aes_key?: string;
};
type MediaItem = { media?: Media; aeskey?: string; file_name?: string };
type WxMessage = {
  message_id?: string | number;
  from_user_id?: string;
  message_type?: number;
  context_token?: string;
  create_time_ms?: number;
  item_list?: {
    type: number;
    text_item?: { text?: string };
    image_item?: MediaItem;
    file_item?: MediaItem;
    voice_item?: { text?: string };
  }[];
};
export function weixinMediaKey(item: MediaItem) {
  if (item.aeskey && /^[a-f0-9]{32}$/i.test(item.aeskey))
    return Buffer.from(item.aeskey, "hex");
  const key = Buffer.from(item.media?.aes_key || "", "base64");
  if (key.length === 16) return key;
  if (key.length === 32 && /^[a-f0-9]{32}$/i.test(key.toString()))
    return Buffer.from(key.toString(), "hex");
  throw new InboundFileError("微信附件密钥无效，请重新发送");
}
export class WeixinAdapter implements ImAdapter {
  private http: ImHttp;
  private signal?: AbortSignal;
  private bot: ImBot;
  private events: AdapterEvents;
  private cursor: string;
  constructor(bot: ImBot, events: AdapterEvents, cursor: string) {
    this.bot = bot;
    this.events = events;
    this.cursor = cursor;
    this.http = new ImHttp(bot.proxy);
  }
  private async call<T>(
    path: string,
    body: Record<string, unknown>,
    sending = false,
  ) {
    const result = await this.http.json<T & { ret?: number; errcode?: number }>(
      `${(this.bot.credentials.baseUrl || weixinBase).replace(/\/$/, "")}/ilink/bot/${path}`,
      {
        body: {
          ...body,
          base_info: {
            channel_version: "thindesk-weixin/1.0",
            bot_agent: "ThinDesk",
          },
        },
        headers: {
          Authorization: `Bearer ${this.bot.credentials.token}`,
          AuthorizationType: "ilink_bot_token",
          "X-WECHAT-UIN": Buffer.from(
            String(randomBytes(4).readUInt32BE()),
          ).toString("base64"),
        },
        sending,
        signal: this.signal,
        timeout: 40000,
      },
    );
    if (
      (result.ret !== undefined && result.ret !== 0) ||
      (result.errcode !== undefined && result.errcode !== 0)
    )
      throw new DeliveryError(
        `微信请求被拒绝（${result.errcode || result.ret}）`,
      );
    return result;
  }
  async start(signal: AbortSignal) {
    this.signal = signal;
    let backoff = 1000;
    while (!signal.aborted) {
      try {
        const result = await this.call<{
          msgs?: WxMessage[];
          get_updates_buf?: string;
        }>("getupdates", { get_updates_buf: this.cursor });
        this.events.state("connected");
        for (const message of result.msgs || []) {
          if (signal.aborted) break;
          if (
            message.message_type !== 1 ||
            !message.from_user_id ||
            message.message_id === undefined
          )
            continue;
          const texts: string[] = [],
            files: InboundFile[] = [];
          let rejected: string | undefined;
          try {
            for (const item of message.item_list || []) {
              if (item.text_item?.text) texts.push(item.text_item.text);
              if (item.voice_item?.text) texts.push(item.voice_item.text);
              const media = item.image_item || item.file_item;
              if (media) {
                const url = media.media?.encrypt_query_param
                  ? `${this.bot.credentials.cdnUrl || "https://novac2c.cdn.weixin.qq.com/c2c"}/download?encrypted_query_param=${encodeURIComponent(media.media.encrypt_query_param)}`
                  : media.media?.full_url;
                if (!url)
                  throw new InboundFileError(
                    "微信附件缺少下载地址，请重新发送",
                  );
                const encrypted = await this.http.bytes(url, signal),
                  decrypt = createDecipheriv(
                    "aes-128-ecb",
                    weixinMediaKey(media),
                    null,
                  );
                files.push({
                  name: media.file_name || "wechat-image.jpg",
                  bytes: Buffer.concat([
                    decrypt.update(encrypted),
                    decrypt.final(),
                  ]),
                });
              }
            }
          } catch (error) {
            if (
              error instanceof InboundFileError ||
              (error instanceof Error &&
                /decrypt|padding|cipher/i.test(error.message))
            )
              rejected = "微信附件无法接收，请重新发送";
            else throw error;
          }
          if (texts.length || files.length || rejected)
            await this.events.receive({
              id: String(message.message_id),
              conversation: message.from_user_id,
              sender: message.from_user_id,
              label: "微信",
              text: texts.join("\n"),
              files: rejected ? [] : files,
              rejected,
              timestamp: message.create_time_ms,
              context: {
                chatId: message.from_user_id,
                contextToken: message.context_token,
                messageId: String(message.message_id),
              },
            });
        }
        if (result.get_updates_buf !== undefined) {
          this.cursor = result.get_updates_buf;
          this.events.cursor(this.cursor);
        }
        backoff = 1000;
      } catch (error) {
        if (signal.aborted) break;
        this.events.state(
          "error",
          error instanceof Error ? error.message : "微信连接异常",
        );
        await pause(backoff, signal);
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  }
  async send(message: Outbound) {
    if (!message.context.contextToken)
      throw new DeliveryError(
        "请先在微信给机器人发送一条消息，以获取回复上下文",
      );
    await this.call(
      "sendmessage",
      {
        msg: {
          from_user_id: "",
          to_user_id: message.context.chatId,
          client_id: "thindesk-" + message.id,
          message_type: 2,
          message_state: 2,
          context_token: message.context.contextToken,
          item_list: [{ type: 1, text_item: { text: message.text } }],
        },
      },
      true,
    );
    return message.id;
  }
  async typing(context: ReplyContext) {
    const result = await this.call<{ typing_ticket?: string }>("getconfig", {
      ilink_user_id: context.chatId,
      context_token: context.contextToken,
    });
    if (result.typing_ticket)
      await this.call("sendtyping", {
        ilink_user_id: context.chatId,
        typing_ticket: result.typing_ticket,
        status: 1,
      });
  }
  close() {
    this.http.close();
  }
}
