import { X } from "lucide-react";
import { useState, type ReactNode, type Ref } from "react";
import { Dialog } from "./Overlay";
import { IconButton } from "./ui";
import "./RightDrawer.css";

export function RightDrawer({ title, subtitle, label = title, close, closeLabel = "关闭", leading, bodyRef, children }: {
  title: string; subtitle?: string; label?: string; close: () => void; closeLabel?: string;
  leading?: ReactNode; bodyRef?: Ref<HTMLDivElement>; children: ReactNode;
}) {
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  return <Dialog returnFocus={opener} title={label} className="rightDrawer" close={close}>
    <header>
      {leading}
      <div><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</div>
      <IconButton icon={X} aria-label={closeLabel} onClick={close} />
    </header>
    <div className="rightDrawerBody" ref={bodyRef}>{children}</div>
  </Dialog>;
}
