import wechat from "../assets/channels/brands/wechat.svg";
import qq from "../assets/channels/brands/qq.svg";
import telegram from "../assets/channels/brands/telegram.svg";
import { Icon } from "./Icon";

const brands: Record<string, { color: string; src: string }> = {
  微信: { color: "#07a95c", src: wechat },
  QQ: { color: "#1495dc", src: qq },
  Telegram: { color: "#229ed9", src: telegram },
};
export function ChannelIcon({
  name,
  size = 16,
}: {
  name: string;
  size?: number;
}) {
  const brand = brands[name as keyof typeof brands];
  if (brand)
    return (
      <span
        className="channel-mark"
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          background: brand.color,
          fontSize: Math.max(9, size * 0.44),
        }}
      >
        <img src={brand.src} width={size * 0.68} height={size * 0.68} alt="" />
      </span>
    );
  return <Icon name="im" size={size} />;
}
