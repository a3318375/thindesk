export const imChannels = ["QQ", "微信", "Telegram"] as const;
export type ImChannel = (typeof imChannels)[number];
export type ImBotSettings = {
  channel: ImChannel;
  enabled: boolean;
  proxy?: string;
};
export type ImBotView = ImBotSettings & {
  id: string;
  configured: boolean;
  appId?: string;
  state: "disabled" | "connecting" | "connected" | "error";
  error?: string;
  connectedAt?: number;
};
export type ImRouteView = {
  id: string;
  bot: string;
  channel: ImChannel;
  label: string;
  sessionId: string;
  lastInbound: number;
};
export type ImDeliveryView = {
  id: string;
  channel: ImChannel;
  sessionId: string;
  messageId: string;
  preview: string;
  state: "pending" | "sending" | "sent" | "failed" | "unknown" | "cancelled";
  error?: string;
  updatedAt: number;
};
export type ImState = {
  bots: ImBotView[];
  routes: ImRouteView[];
  deliveries: ImDeliveryView[];
};
export type ImQrState = {
  id: string;
  channel: "QQ" | "微信";
  state: "waiting" | "scanned" | "verify" | "success" | "error" | "expired";
  image?: string;
  error?: string;
};

export type ImReplyContext = {
  chatId: string;
  threadId?: number;
  messageId?: string;
  contextToken?: string;
  group?: boolean;
};
