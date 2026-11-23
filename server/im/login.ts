import { randomUUID } from "node:crypto";
import { startQrConnect } from "@tencent-connect/qqbot-connector";
import QRCode from "qrcode";
import type { ImQrState } from "../../shared/im.ts";
import { ImHttp, pause } from "./http.ts";
import { weixinBase } from "./weixin.ts";
import type { ImManager } from "./manager.ts";
export class ImLogin {
  private pending = new Map<
    string,
    {
      view: ImQrState;
      abort: AbortController;
      code?: string;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private manager: ImManager;
  constructor(manager: ImManager) {
    this.manager = manager;
  }
  begin(botId: string, connect = false): ImQrState {
    const bot = this.manager.store.bot(botId);
    if (!bot || bot.channel === "Telegram")
      throw Error("请选择 QQ 或微信扫码，Telegram 使用 Bot Token");
    for (const [id, record] of this.pending)
      if (record.view.channel === bot.channel) this.cancel(id);
    const id = randomUUID(),
      abort = new AbortController();
    const view: ImQrState = { id, channel: bot.channel, state: "waiting" };
    const timer = setTimeout(() => {
      view.state = "expired";
      abort.abort();
    }, 8 * 60000);
    timer.unref();
    const record = { view, abort, timer, code: undefined as string | undefined };
    this.pending.set(id, record);
    const success = (
      credentials: Parameters<ImManager["setCredentials"]>[1],
    ) => {
      if (abort.signal.aborted) return;
      this.manager.setCredentials(botId, credentials, connect);
      view.state = "success";
      clearTimeout(timer);
      abort.abort();
    };
    const failure = () => {
      if (!abort.signal.aborted) {
        view.state = "error";
        view.error = "扫码绑定未完成，请重试或手动填写凭据";
        clearTimeout(timer);
        abort.abort();
      }
    };
    if (bot.channel === "QQ") {
      const dispose = startQrConnect(
        {
          onQrDisplayed: (url) => {
            void QRCode.toDataURL(url, { width: 256 })
              .then((image) => {
                if (!abort.signal.aborted) view.image = image;
              })
              .catch(failure);
          },
          onQrExpired: () => { delete view.image; },
          onSuccess: (credentials) => {
            if (credentials[0]?.appId && credentials[0]?.appSecret)
              success({
                appId: credentials[0].appId,
                appSecret: credentials[0].appSecret,
              });
            else failure();
          },
          onFailure: failure,
        },
        {
          source: "thindesk",
          displayQrCodeToConsole: false,
          signal: abort.signal,
        },
      );
      abort.signal.addEventListener("abort", dispose, { once: true });
    } else {
      const http = new ImHttp(bot.proxy);
      void (async () => {
        const response = await http.json<{
          qrcode: string;
          qrcode_img_content: string;
        }>(`${weixinBase}/ilink/bot/get_bot_qrcode?bot_type=3`, {
          signal: abort.signal,
          body: { local_token_list: bot.credentials.token ? [bot.credentials.token] : [] },
        });
        if (!response.qrcode || !response.qrcode_img_content)
          throw Error("缺少二维码");
        view.image = await QRCode.toDataURL(response.qrcode_img_content, {
          width: 256,
        });
        let base = weixinBase;
        while (!abort.signal.aborted) {
          if (view.state === "verify" && !record.code) {
            await pause(250, abort.signal);
            continue;
          }
          const query = new URLSearchParams({ qrcode: response.qrcode });
          if (record.code) {
            query.set("verify_code", record.code);
            delete record.code;
          }
          const status = await http.json<{
            status: string;
            redirect_host?: string;
            bot_token?: string;
            baseurl?: string;
          }>(
            `${base}/ilink/bot/get_qrcode_status?${query}`,
            { signal: abort.signal },
          );
          if (abort.signal.aborted) break;
          if (!status.status) throw Error("微信未返回扫码状态");
          if (status.status === "binded_redirect" && bot.credentials.token) {
            success(bot.credentials);
            break;
          }
          if (status.status === "confirmed" && status.bot_token) {
            success({
              token: status.bot_token,
              baseUrl: status.baseurl || weixinBase,
            });
            break;
          }
          if (status.status === "scaned_but_redirect") {
            if (status.redirect_host) base = `https://${status.redirect_host}`;
            view.state = "scanned";
          } else if (status.status === "need_verifycode" || status.status === "confirmed_but_need_verifycode") {
            view.error = query.has("verify_code") ? "配对码未通过，请重新输入。" : undefined;
            view.state = "verify";
          } else if (status.status === "verify_code_blocked") {
            failure();
            view.error = "配对码尝试次数过多，请稍后重新扫码。";
            break;
          } else if (status.status === "confirmed" || status.status === "binded_redirect") {
            failure();
            break;
          } else if (status.status === "scaned" || status.status === "scanned")
            view.state = "scanned";
          if (status.status === "expired") {
            view.state = "expired";
            clearTimeout(timer);
            abort.abort();
            break;
          }
          await pause(1000, abort.signal);
        }
      })()
        .catch(failure)
        .finally(() => http.close());
    }
    return view;
  }
  verify(id: string, code: string) {
    const record = this.pending.get(id);
    if (record?.view.state !== "verify" || record.abort.signal.aborted) throw Error("当前没有待输入的配对码");
    if (!/^\d{1,16}$/.test(code)) throw Error("请输入手机显示的数字");
    record.code = code;
    record.view.state = "scanned";
    delete record.view.error;
    return record.view;
  }
  get(id: string) {
    const value = this.pending.get(id);
    if (!value) throw Error("扫码流程已结束");
    return value.view;
  }
  cancel(id: string) {
    const value = this.pending.get(id);
    if (value) {
      clearTimeout(value.timer);
      value.abort.abort();
      this.pending.delete(id);
    }
  }
  close() {
    for (const id of this.pending.keys()) this.cancel(id);
  }
}
