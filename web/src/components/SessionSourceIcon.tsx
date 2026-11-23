import { Globe } from "lucide-react";
import type { ImChannel } from "../../../shared/im";
import { ChannelIcon } from "./ChannelIcon";

export function SessionSourceIcon({ channel, size = 16 }: { channel?: ImChannel; size?: number }) {
  return <span className="sessionChannel" data-channel={channel || "web"} title={channel || "网页会话"} aria-hidden="true">
    {channel ? <ChannelIcon name={channel} size={size} /> : <Globe size={size} strokeWidth={1.6} />}
  </span>;
}
