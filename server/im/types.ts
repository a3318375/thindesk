import type {
  ImBotSettings,
  ImChannel,
  ImReplyContext,
} from "../../shared/im.ts";
export type ImBot = ImBotSettings & {
  id: string;
  credentials: {
    token?: string;
    appId?: string;
    appSecret?: string;
    baseUrl?: string;
    cdnUrl?: string;
  };
};
export type ReplyContext = ImReplyContext;
export type InboundFile = { name: string; bytes: Buffer };
export type Inbound = {
  id: string;
  conversation: string;
  sender: string;
  label: string;
  text: string;
  context: ReplyContext;
  files: InboundFile[];
  timestamp?: number;
  rejected?: string;
};
export type ImRoute = {
  id: string;
  bot: string;
  channel: ImChannel;
  conversation: string;
  label: string;
  sessionId: string;
  lastInbound: number;
  context: ReplyContext;
};
export type Outbound = {
  id: string;
  route: string;
  bot: string;
  sessionId: string;
  messageId: string;
  text: string;
  context: ReplyContext;
  part: number;
  sequence?: number;
};
export type AdapterEvents = {
  receive: (message: Inbound) => Promise<void>;
  state: (state: "connecting" | "connected" | "error", error?: string) => void;
  cursor: (value: string) => void;
};
export interface ImAdapter {
  start(signal: AbortSignal): Promise<void>;
  send(message: Outbound): Promise<string | undefined>;
  typing?(context: ReplyContext): Promise<void>;
  close(): void;
}
export type AdapterFactory = (
  bot: ImBot,
  events: AdapterEvents,
  cursor: string,
) => ImAdapter;
export class DeliveryError extends Error {
  readonly uncertain: boolean;
  readonly retryAfter?: number;
  constructor(message: string, uncertain = false, retryAfter?: number) {
    super(message);
    this.uncertain = uncertain;
    this.retryAfter = retryAfter;
  }
}

export class InboundFileError extends Error {}
