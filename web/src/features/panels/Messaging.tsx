import { useEffect, useState } from "react";
import { Button, Input } from "../../components/ui";
import { ChannelIcon } from "../../components/ChannelIcon";
import { QrLogin } from "./QrLogin";
import { imRequest as request } from "../../api/im";
import { paper } from "../../components/assistant-ui/elements/surfaces";
import type {
  ImBotView,
  ImChannel,
  ImState,
} from "../../../../shared/im";
import { imChannels } from "../../../../shared/im";
import s from "./Messaging.module.css";
const connectionText = {
  disabled: "未连接",
  connecting: "连接中",
  connected: "已连接",
  error: "连接异常",
};
const deliveryText = {
  cancelled: "已取消",
  pending: "等待投递",
  sending: "正在投递",
  sent: "已送达",
  failed: "投递失败",
  unknown: "结果待确认",
};
type BotForm = {
  proxy: string;
  appId: string;
  appSecret: string;
  token: string;
};
const newForm = (bot: ImBotView): BotForm => ({
  proxy: bot.proxy || "",
  appId: bot.appId || "",
  appSecret: "",
  token: "",
});
export function Messaging() {
  const [channel, setChannel] = useState<ImChannel>("微信"),
    [state, setState] = useState<ImState | null>(null);
  const [form, setForm] = useState<BotForm | null>(null),
    [formId, setFormId] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const bot = state?.bots.find((bot) => bot.channel === channel);
  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      void request<ImState>(undefined, controller.signal)
        .then(setState)
        .catch((reason) => {
          if (!controller.signal.aborted) setError(reason.message);
        });
    };
    load();
    const interval = setInterval(load, 3000);
    return () => {
      clearInterval(interval);
      controller.abort();
    };
  }, []);
  useEffect(() => {
    if (bot && bot.id !== formId) {
      setForm(newForm(bot));
      setFormId(bot.id);
      setSaved(false);
    }
  }, [bot, formId]);
  async function perform(operation: Record<string, unknown>) {
    setError("");
    setBusy(true);
    setSaved(false);
    try {
      const next = await request<ImState>(operation);
      setState(next);
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  async function save(enabled?: boolean) {
    if (!bot || !form) return;
    const next = await perform({
      action: "save",
      bot: bot.id,
      ...form,
      enabled: enabled ?? bot.enabled,
    });
    const updated = next?.bots.find((item) => item.id === bot.id);
    if (updated) {
      setForm(newForm(updated));
      setSaved(true);
    }
  }
  const change = (key: keyof BotForm, value: string) => {
    setForm((previous) => previous && { ...previous, [key]: value });
    setSaved(false);
  };
  return (
    <article
      className={s.page}
      aria-label="IM 机器人"
    >
      <header className={s.header}>
        <div>
          <h2>IM 机器人</h2>
          <p>个人助手共用一份会话。网页可查看全部消息，各机器人只回复发来问题的聊天。</p>
        </div>
      </header>
      <nav className={s.tabs} role="tablist" aria-label="渠道">
        {imChannels.map((name) => (
          <Button
            variant="ghost"
            role="tab"
            key={name}
            aria-selected={channel === name}
            onClick={() => {
              setQrOpen(false);
              setChannel(name);
              setError("");
            }}
          >
            <ChannelIcon name={name} size={22} />
            {name}
          </Button>
        ))}
      </nav>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {!bot || !form || formId !== bot.id ? (
        <p role="status">正在读取渠道配置…</p>
      ) : (
        <section
          role="tabpanel"
          aria-label={channel + "设置"}
          className={s.panel}
        >
          <section className={paper + " " + s.card}>
            <header>
              <div>
                <h3>
                  <ChannelIcon name={channel} size={26} />
                  {channel === "QQ"
                    ? "QQ 官方 Bot"
                    : channel === "微信"
                      ? "微信 iLink Bot"
                      : "Telegram Bot"}
                </h3>
                <p>
                  {channel === "QQ"
                    ? "通过腾讯官方机器人接口收发私聊与群 @ 消息。"
                    : channel === "微信"
                      ? "扫码绑定 iLink 机器人，不接入个人微信的其他聊天。"
                      : "使用 BotFather 创建的机器人 Token。"}
                </p>
              </div>
              <span className={s.status} data-state={bot.state}>
                {connectionText[bot.state]}
              </span>
            </header>
            {bot.error && <p className={s.error}>{bot.error}</p>}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              {channel !== "Telegram" && (
                <Button type="button" variant="primary" className={s.scan} disabled={busy}
                  onClick={() => setQrOpen(true)}>
                  {channel}扫码登录
                </Button>
              )}
              {channel === "QQ" ? (
                <div className={s.fields}>
                  <label>
                    App ID
                    <Input
                      aria-label="QQ App ID"
                      value={form.appId}
                      onChange={(event) => change("appId", event.target.value)}
                    />
                  </label>
                  <label>
                    App Secret
                    <Input
                      type="password"
                      autoComplete="new-password"
                      aria-label="QQ App Secret"
                      placeholder={
                        bot.configured ? "已保存，留空不变" : "填写 App Secret"
                      }
                      value={form.appSecret}
                      onChange={(event) =>
                        change("appSecret", event.target.value)
                      }
                    />
                  </label>
                </div>
              ) : (
                <label>
                  {channel === "Telegram"
                    ? "Bot Token"
                    : "已有机器人 Token（也可扫码绑定）"}
                  <Input
                    type="password"
                    autoComplete="new-password"
                    aria-label={channel + " Bot Token"}
                    placeholder={
                      bot.configured ? "已保存，留空不变" : "填写机器人 Token"
                    }
                    value={form.token}
                    onChange={(event) => change("token", event.target.value)}
                  />
                </label>
              )}
              {channel === "Telegram" && (
                <label>
                  HTTP 代理（可选）
                  <Input
                    aria-label="Telegram 代理"
                    placeholder="http://127.0.0.1:端口"
                    value={form.proxy}
                    onChange={(event) => change("proxy", event.target.value)}
                  />
                </label>
              )}
              <footer>
                <Button type="submit" disabled={busy}>
                  {busy ? "处理中…" : "保存配置"}
                </Button>
                <Button
                  type="button"
                  variant={bot.enabled ? "default" : "primary"}
                  disabled={busy}
                  onClick={() => void save(!bot.enabled)}
                >
                  {bot.enabled ? "断开连接" : "连接机器人"}
                </Button>
                {saved && <span role="status">配置已保存</span>}
              </footer>
            </form>
          </section>
          <section className={paper + " " + s.card}>
            <h3>已绑定的聊天</h3>
            <p>首次收到消息后，这里会列出与个人助手聊过的聊天。</p>
            {state!.routes
              .filter((route) => route.bot === bot.id)
              .map((route) => (
                <div className={s.route} key={route.id}>
                  <div>
                    <strong>{route.label}</strong>
                    <small>
                      {new Date(route.lastInbound).toLocaleString()}
                    </small>
                  </div>
                </div>
              ))}
            {!state!.routes.some((route) => route.bot === bot.id) && (
              <div className={s.empty}>还没有聊天绑定</div>
            )}
          </section>
          <section className={paper + " " + s.card}>
            <h3>回复投递</h3>
            <p>
              这里记录发送结果。重新投递只发送已生成的回答，不会重新执行 CLI。
            </p>
            {state!.deliveries
              .filter((item) => item.channel === channel)
              .map((item) => (
                <div className={s.delivery} key={item.id}>
                  <div>
                    <span data-delivery={item.state}>
                      {deliveryText[item.state]}
                    </span>
                    <small>
                      {new Date(item.updatedAt).toLocaleTimeString()}
                    </small>
                    <p>{item.preview}</p>
                    {item.error && <small>{item.error}</small>}
                    {item.state === "unknown" && (
                      <small>平台可能已收到，请核实后再重新投递。</small>
                    )}
                  </div>
                  {["failed", "unknown"].includes(item.state) && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void perform({ action: "retry", id: item.id })
                      }
                    >
                      重新投递
                    </Button>
                  )}
                </div>
              ))}
            {!state!.deliveries.some((item) => item.channel === channel) && (
              <div className={s.empty}>暂无回复投递记录</div>
            )}
          </section>
        </section>
      )}
      {qrOpen && bot && channel !== "Telegram" && (
        <QrLogin botId={bot.id} channel={channel} close={authorized => {
          setQrOpen(false);
          if (authorized) void request<ImState>().then(next => {
            setState(next);
            const updated = next.bots.find(item => item.id === bot.id);
            if (updated) { setForm(newForm(updated)); setFormId(updated.id); }
          }).catch(reason => setError(reason.message));
        }} />
      )}
    </article>
  );
}
