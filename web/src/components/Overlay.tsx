import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Icon } from "./Icon";
import { useText } from "../app/locale/text";
import type { ReactNode } from "react";

export function Dialog({
  title,
  close,
  children,
  className = "",
  returnFocus,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  className?: string;
  returnFocus?: HTMLElement | null;
}) {
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-backdrop" />
        <DialogPrimitive.Content
          className={`ui-dialog deskDialog ${className}`}
          aria-describedby={undefined}
          onCloseAutoFocus={event => {
            if (returnFocus?.isConnected) {
              event.preventDefault();
              returnFocus.focus({ preventScroll: true });
            }
          }}
        >
          <DialogPrimitive.Title className="srOnly">
            {title}
          </DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
export type MenuItem = {
  label: string;
  action?: () => void;
  selected?: boolean;
  icon?: string;
  children?: MenuItem[];
};
export type Popover = {
  anchor: HTMLElement;
  items: MenuItem[];
  layout?: "grouped" | "permission";
};
export function Menu({ menu, close }: { menu: Popover; close: () => void }) {
  const rect = menu.anchor.getBoundingClientRect();
  return (
    <DropdownMenu.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DropdownMenu.Trigger
        className="menuAnchor"
        style={{
          position: "fixed",
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          pointerEvents: "none",
          opacity: 0,
        }}
        aria-hidden
        tabIndex={-1}
      />
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="ui-popup"
          side={menu.layout === "permission" ? "top" : "bottom"}
          align={menu.layout === "grouped" ? "end" : "start"}
          sideOffset={4}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            menu.anchor.focus();
          }}
        >
          <MenuItems items={menu.items} close={close} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuItems({ items, close }: { items: MenuItem[]; close: () => void }) {
  const tr = useText();
  return items.map((item) =>
    item.children ? (
      <DropdownMenu.Sub key={item.label}>
        <DropdownMenu.SubTrigger className="ui-menu-item">
          {item.icon && <Icon name={item.icon} />}
          <span style={{ flex: 1 }}>{tr(item.label)}</span>
          <Icon name="next" size={14} />
        </DropdownMenu.SubTrigger>
        <DropdownMenu.Portal>
          <DropdownMenu.SubContent
            className="ui-popup"
            sideOffset={4}
            collisionPadding={8}
          >
            <MenuItems items={item.children} close={close} />
          </DropdownMenu.SubContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Sub>
    ) : item.action ? (
      <DropdownMenu.Item
        className="ui-menu-item"
        key={item.label}
        onSelect={() => {
          close();
          item.action?.();
        }}
      >
        {item.icon && <Icon name={item.icon} />}
        <span style={{ flex: 1 }}>{tr(item.label)}</span>
        {item.selected && <Icon name="check" size={14} />}
      </DropdownMenu.Item>
    ) : (
      <DropdownMenu.Label className="menuLabel" key={item.label}>
        {tr(item.label)}
      </DropdownMenu.Label>
    ),
  );
}
