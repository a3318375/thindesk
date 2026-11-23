import { useEffect, useState } from "react";
import type { ImQrState } from "../../../../shared/im";
import { imRequest } from "../../api/im";
import { Dialog } from "../../components/Overlay";
import { Button, Input } from "../../components/ui";
import s from "./Messaging.module.css";

export function QrLogin({ botId, channel, close }: {
  botId: string; channel: ImQrState["channel"]; close: (authorized: boolean) => void;
}) {
  const [qr, setQr] = useState<ImQrState>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let id: string | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const cancel = (id: string) => { void imRequest({ action: "cancel-qr", id }).catch(() => {}); };
    const failed = (err: unknown) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "无法获取扫码状态");
    };
    function show(next: ImQrState) {
      if (controller.signal.aborted) return;
      setQr(next);
      if (["success", "error", "expired"].includes(next.state)) return;
      timer = setTimeout(() => {
        void imRequest<ImQrState>(undefined, controller.signal, "/api/im/qr/" + next.id).then(show, failed);
      }, 1000);
    }
    setQr(undefined);
    setError("");
    setCode("");
    void imRequest<ImQrState>({ action: "qr", bot: botId, connect: true }).then(next => {
      id = next.id;
      if (controller.signal.aborted) cancel(next.id);
      else show(next);
    }, failed);
    return () => {
      controller.abort();
      clearTimeout(timer);
      if (id) cancel(id);
    };
  }, [botId, attempt]);

  const retry = !!error || qr?.state === "expired" || qr?.state === "error";
  const dismiss = () => close(qr?.state === "success");
  return <Dialog title={channel + "扫码登录"} close={dismiss} className={s.qrDialog}>
    <h2>{channel}扫码登录</h2>
    {!retry && qr?.state === "waiting" && qr.image &&
      <img src={qr.image} width={256} height={256} alt={channel + "机器人登录二维码"} />}
    <p role="status">{error || qr?.error || (qr?.state === "success" ? "授权成功，已启用个人助手的渠道连接。"
      : qr?.state === "verify" ? "请输入手机微信显示的配对码。"
      : qr?.state === "expired" ? "二维码已过期。"
      : qr?.state === "scanned" ? "已扫码，正在等待手机确认。"
      : qr?.image ? "用手机" + channel + "扫码，确认后将连接个人助手。"
      : "正在生成二维码…")}</p>
    {qr?.state === "verify" && !retry && <form onSubmit={async event => {
      event.preventDefault();
      if (submitting || !code) return;
      setSubmitting(true);
      try {
        const next = await imRequest<ImQrState>({ action: "verify-qr", id: qr.id, code });
        setQr(next);
        setCode("");
      } catch (err) { setError(err instanceof Error ? err.message : "配对码提交失败"); }
      finally { setSubmitting(false); }
    }}>
      <Input aria-label="微信配对码" autoFocus inputMode="numeric" autoComplete="one-time-code"
        type="text" pattern="[0-9]+" maxLength={16} value={code} onChange={e => setCode(e.target.value)} />
      <Button type="submit" disabled={!code || submitting}>确认配对码</Button>
    </form>}
    {retry && <Button variant="primary" onClick={() => setAttempt(n => n + 1)}>重新生成二维码</Button>}
    <Button onClick={dismiss}>{qr?.state === "success" ? "完成" : "关闭"}</Button>
  </Dialog>;
}
