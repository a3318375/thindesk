import type { IncomingMessage } from "node:http";
import type { ImManager } from "./manager.ts";
import type { ImLogin } from "./login.ts";
export async function handleImRequest(
  req: IncomingMessage,
  url: URL,
  im: ImManager,
  imLogin: ImLogin,
  send: (status: number, body: unknown) => void,
) {
  const path = url.pathname;
  if (req.method === "GET") {
    if (path === "/api/im") return send(200, im.view());
    if (path.startsWith("/api/im/qr/")) {
      try { return send(200, imLogin.get(path.slice("/api/im/qr/".length))); }
      catch { return send(404, { error: "扫码已结束，请重新生成二维码" }); }
    }
    return send(404, { error: "未找到" });
  }
  if (req.method !== "POST") return send(405, { error: "请求方式不支持" });
  if (
    (req.headers.origin !== "http://" + req.headers.host && req.headers.origin !== "https://" + req.headers.host) ||
    !req.headers["content-type"]?.startsWith("application/json")
  )
    return send(403, { error: "仅接受同源操作" });
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64000) return send(413, { error: "配置过长" });
    parts.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(parts).toString());
  try {
    if (input.action === "save")
      return send(200, im.save(String(input.bot), input));
    if (input.action === "retry") return send(200, im.retry(String(input.id)));
    if (input.action === "qr")
      return send(200, imLogin.begin(String(input.bot), input.connect === true));
    if (input.action === "verify-qr") return send(200, imLogin.verify(String(input.id), String(input.code)));
    if (input.action === "cancel-qr") {
      imLogin.cancel(String(input.id));
      return send(200, im.view());
    }
    return send(400, { error: "操作无效" });
  } catch (error) {
    return send(400, {
      error: error instanceof Error ? error.message : "操作失败",
    });
  }
}
