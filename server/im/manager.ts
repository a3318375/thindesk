import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { imChannels, type ImBotView, type ImState } from "../../shared/im.ts";
import { PERSONAL_SESSION_ID, type Message, type Session } from "../../shared/workspace.ts";
import { ImStore } from "./store.ts";
import {
  DeliveryError,
  type AdapterFactory,
  type ImAdapter,
  type ImBot,
  type ImRoute,
  type Inbound,
} from "./types.ts";
import { TelegramAdapter } from "./telegram.ts";
import { WeixinAdapter } from "./weixin.ts";
import { QqAdapter } from "./qq.ts";
import { errorMessage, splitReply } from "./text.ts";
export type ImHooks = {
  rolledBack: () => void;
  session: (id: string) => Session | undefined;
  // Called inside the shared SQLite transaction. Persist only, then return the id.
  submit: (bot: ImBot, message: Inbound, route: ImRoute) => string;
  committed: () => void;
  run: (session: string) => void;
  stop: (session: string) => void;
};
export const createAdapter: AdapterFactory = (bot, events, cursor) =>
  bot.channel === "QQ"
    ? new QqAdapter(bot, events)
    : bot.channel === "微信"
      ? new WeixinAdapter(bot, events, cursor)
      : new TelegramAdapter(bot, events, cursor);
export class ImManager {
  readonly store: ImStore;
  private runtimes = new Map<
    string,
    { adapter: ImAdapter; abort: AbortController }
  >();
  private statuses = new Map<
    string,
    { state: ImBotView["state"]; error?: string; connectedAt?: number }
  >();
  private sending = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private typingTimer?: ReturnType<typeof setInterval>;
  private hooks: ImHooks;
  private factory: AdapterFactory;
  constructor(
    db: DatabaseSync,
    hooks: ImHooks,
    factory: AdapterFactory = createAdapter,
  ) {
    this.hooks = hooks;
    this.factory = factory;
    this.store = new ImStore(db);
    for (const channel of imChannels) {
      const id =
        channel === "QQ" ? "qq" : channel === "微信" ? "weixin" : "telegram";
      if (!this.store.bot(id))
        this.store.saveBot({
          id,
          channel,
          enabled: false,
          credentials: {},
        });
    }
  }
  configured(bot: ImBot) {
    return bot.channel === "QQ"
      ? !!(bot.credentials.appId && bot.credentials.appSecret)
      : !!bot.credentials.token;
  }
  view(): ImState {
    const bots = this.store.bots();
    return {
      bots: bots.map(bot => ({
        id: bot.id, channel: bot.channel, enabled: bot.enabled, proxy: bot.proxy,
        configured: this.configured(bot),
        appId: bot.credentials.appId,
        ...(this.statuses.get(bot.id) || { state: "disabled" as const }),
      })),
      routes: this.store
        .routes()
        .filter(route => route.sessionId === PERSONAL_SESSION_ID)
        .map(({ id, bot, channel, label, sessionId, lastInbound }) => ({
          id,
          bot,
          channel,
          label,
          sessionId,
          lastInbound,
        })),
      deliveries: this.store.deliveries(
        new Map(bots.map((bot) => [bot.id, bot.channel])),
      ),
    };
  }
  save(id: string, input: Record<string, unknown>) {
    const previous = this.store.bot(id);
    if (!previous) throw Error("渠道不存在");
    const text = (key: string, fallback: string) =>
      typeof input[key] === "string" ? String(input[key]).trim() : fallback;
    const credentials = { ...previous.credentials };
    for (const key of ["token", "appId", "appSecret"] as const)
      if (typeof input[key] === "string" && String(input[key]).trim())
        credentials[key] = String(input[key]).trim();
    const bot: ImBot = {
      ...previous,
      credentials,
      proxy: text("proxy", previous.proxy || "") || undefined,
      enabled:
        typeof input.enabled === "boolean" ? input.enabled : previous.enabled,
    };
    if (bot.proxy && !/^https?:\/\//.test(bot.proxy))
      throw Error("代理地址需要以 http:// 或 https:// 开头");
    if (bot.enabled && !this.configured(bot)) throw Error("请先配置机器人凭据");
    this.store.saveBot(bot);
    this.restart(id);
    return this.view();
  }
  setCredentials(id: string, credentials: ImBot["credentials"], enabled: boolean) {
    const bot = this.store.bot(id);
    if (!bot) throw Error("渠道不存在");
    this.store.saveBot({ ...bot, credentials, enabled });
    this.restart(id);
  }
  start() {
    for (const bot of this.store.bots()) if (bot.enabled) this.restart(bot.id);
    this.timer = setInterval(() => {
      for (const id of this.runtimes.keys()) void this.drain(id);
    }, 1500);
    this.timer.unref();
    this.typingTimer = setInterval(() => {
      const session = this.hooks.session(PERSONAL_SESSION_ID);
      const reply = session?.running ? session.messages.at(-1) : undefined;
      if (!reply?.im) return;
      const route = this.store.routeById(reply.im.routeId);
      if (route) void this.runtimes.get(route.bot)?.adapter.typing?.(reply.im.context).catch(() => {});
    }, 5000);
    this.typingTimer.unref();
  }
  private restart(id: string) {
    const old = this.runtimes.get(id);
    old?.abort.abort();
    old?.adapter.close();
    this.runtimes.delete(id);
    const bot = this.store.bot(id)!;
    if (!bot.enabled) {
      this.statuses.set(id, { state: "disabled" });
      return;
    }
    const abort = new AbortController();
    this.statuses.set(id, { state: "connecting" });
    const adapter = this.factory(
      bot,
      {
        receive: async (message) => {
          if (!abort.signal.aborted) await this.receive(id, message);
        },
        cursor: (value) => {
          if (!abort.signal.aborted) this.store.setCursor(id, value);
        },
        state: (state, error) => {
          if (!abort.signal.aborted)
            this.statuses.set(id, {
              state,
              error,
              connectedAt:
                state === "connected"
                  ? Date.now()
                  : this.statuses.get(id)?.connectedAt,
            });
        },
      },
      this.store.cursor(id),
    );
    this.runtimes.set(id, { adapter, abort });
    void adapter.start(abort.signal).catch((error) => {
      if (!abort.signal.aborted) {
        this.statuses.set(id, { state: "error", error: errorMessage(error) });
        const retry = setTimeout(() => {
          if (!abort.signal.aborted) this.restart(id);
        }, 30000);
        retry.unref();
        abort.signal.addEventListener("abort", () => clearTimeout(retry), {
          once: true,
        });
      }
    });
    void this.drain(id);
  }
  async receive(botId: string, message: Inbound) {
    const bot = this.store.bot(botId);
    if (!bot || !bot.enabled) return;
    if (
      message.files.length > 32 ||
      message.files.reduce((sum, file) => sum + file.bytes.length, 0) >
        8 * 1024 * 1024
    )
      message = {
        ...message,
        files: [],
        rejected: "每条消息最多 32 个附件、合计 8 MiB，请分开发送",
      };
    if (message.text.length > 64000)
      message = {
        ...message,
        text: "",
        files: [],
        rejected: "消息过长，请分开发送",
      };
    if (
      !message.id ||
      (!message.text.trim() && !message.files.length && !message.rejected)
    )
      return;
    let route = this.store.route(botId, message.conversation);
    if (this.store.seen(botId, message.id)) return;
    const timestamp = message.timestamp || Date.now();
    route ??= {
      id: randomUUID(),
      bot: botId,
      channel: bot.channel,
      conversation: message.conversation,
      sessionId: "",
      label: message.label,
      lastInbound: timestamp,
      context: message.context,
    };
    route.sessionId = PERSONAL_SESSION_ID;
    const routeForReply = { ...route, context: message.context };
    if (timestamp >= route.lastInbound) {
      route.context = message.context;
      route.lastInbound = timestamp;
      route.label = message.label;
    }
    const command = /^\/(\w+)(?:@\S+)?(?:\s|$)/.exec(message.text.trim())?.[1];
    let sessionId = route.sessionId,
      stopped = false;
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      this.store.remember(botId, message.id);
      if (message.rejected) {
        this.store.saveRoute(route);
        this.store.enqueue(
          routeForReply,
          "rejected:" + message.id,
          message.rejected,
          0,
        );
      } else if (command) {
        let notice =
          "这里是个人助手。/stop 停止本聊天发起的当前回复，/help 查看帮助。";
        if (command === "new") notice = "个人助手共用一份会话，可直接继续提问。";
        if (command === "stop") {
          const current = this.hooks.session(PERSONAL_SESSION_ID);
          stopped = !!current?.running && current.messages.at(-1)?.im?.routeId === route.id;
          notice = stopped ? "已请求停止本轮回复。" : "当前没有本聊天正在生成的回复。";
        }
        this.store.saveRoute(route);
        this.store.enqueue(
          { ...routeForReply, sessionId },
          "command:" + message.id,
          notice,
          0,
        );
      } else {
        sessionId = this.hooks.submit(bot, message, route);
        route.sessionId = sessionId;
        this.store.saveRoute(route);
      }
      this.store.db.exec("COMMIT");
    } catch (error) {
      this.store.db.exec("ROLLBACK");
      this.hooks.rolledBack();
      throw error;
    }
    this.hooks.committed();
    if (stopped && sessionId) this.hooks.stop(sessionId);
    if (!command && !message.rejected && sessionId) this.hooks.run(sessionId);
    if (command || message.rejected) void this.drain(botId);
  }
  enqueueReply(session: Session, reply: Message) {
    if (session.id !== PERSONAL_SESSION_ID || !reply.im) return;
    const route = this.store.routeById(reply.im.routeId);
    if (!route || route.channel !== reply.origin || route.sessionId !== session.id) return;
    const context = reply.im.context;
    splitReply(reply.text, route.channel === "Telegram" ? 3800 : 1800).forEach((text, index) =>
      this.store.enqueue(route, reply.id, text, index, context),
    );
  }
  async drain(botId: string) {
    if (this.sending.has(botId)) return;
    const runtime = this.runtimes.get(botId);
    if (!runtime) return;
    this.sending.add(botId);
    try {
      let next;
      while (!runtime.abort.signal.aborted && (next = this.store.next(botId))) {
        const { item, attempts } = next;
        this.store.setDelivery(item.id, "sending");
        try {
          const remoteId = await runtime.adapter.send(item);
          this.store.setDelivery(item.id, "sent", undefined, 0, remoteId);
        } catch (error) {
          const known = error instanceof DeliveryError;
          if (known && error.retryAfter && attempts < 3)
            this.store.setDelivery(
              item.id,
              "pending",
              error.message,
              Date.now() + error.retryAfter * 1000,
            );
          else
            this.store.setDelivery(
              item.id,
              known && !error.uncertain ? "failed" : "unknown",
              errorMessage(error),
            );
        }
      }
    } finally {
      this.sending.delete(botId);
    }
  }
  retry(id: string) {
    this.store.retry(id);
    for (const bot of this.runtimes.keys()) void this.drain(bot);
    return this.view();
  }
  close() {
    clearInterval(this.timer);
    clearInterval(this.typingTimer);
    for (const runtime of this.runtimes.values()) {
      runtime.abort.abort();
      runtime.adapter.close();
    }
    this.runtimes.clear();
  }
}
