import { fetch, ProxyAgent, type Dispatcher } from "undici";
import { DeliveryError, InboundFileError } from "./types.ts";
export class ImHttp {
  private dispatcher?: Dispatcher;
  constructor(proxy?: string) {
    if (proxy) this.dispatcher = new ProxyAgent(proxy);
  }
  async json<T>(
    url: string,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
      signal?: AbortSignal;
      sending?: boolean;
      timeout?: number;
    } = {},
  ): Promise<T> {
    let response;
    try {
      const timeout = AbortSignal.timeout(init.timeout || 40000);
      response = await fetch(url, {
        method: init.method || (init.body ? "POST" : "GET"),
        headers: { "Content-Type": "application/json", ...init.headers },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
        dispatcher: this.dispatcher,
      });
    } catch {
      throw new DeliveryError(
        "渠道请求未得到确认，请检查网络连接",
        !!init.sending,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      const delay = Number(response.headers.get("retry-after"));
      throw new DeliveryError(
        `渠道返回 HTTP ${response.status}`,
        !!init.sending && response.status >= 500,
        response.status === 429
          ? Number.isFinite(delay) && delay > 0
            ? delay
            : 5
          : undefined,
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new DeliveryError("渠道响应未能解析", !!init.sending);
    }
  }
  async bytes(url: string, signal?: AbortSignal) {
    const response = await fetch(url, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
      dispatcher: this.dispatcher,
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status >= 400 && response.status < 500)
        throw new InboundFileError("附件已失效或无法下载，请重新发送");
      throw new Error("附件下载暂时失败");
    }
    const parts: Buffer[] = [];
    let length = 0;
    for await (const part of response.body!) {
      length += part.length;
      if (length > 8 * 1024 * 1024) {
        await response.body?.cancel().catch(() => {});
        throw new InboundFileError("单条消息附件不能超过 8 MiB");
      }
      parts.push(Buffer.from(part));
    }
    return Buffer.concat(parts);
  }
  close() {
    void this.dispatcher?.close();
  }
}
export function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done();
  });
}
