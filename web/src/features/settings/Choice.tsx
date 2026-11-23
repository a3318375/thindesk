import { Button } from "../../components/ui";
import { useCallback, useState } from "react";
import { useText } from "../../app/locale/text";
import { Icon } from "../../components/Icon";
import { Menu, type Popover } from "../../components/Overlay";
export function Choice({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const tr = useText(),
    [popup, setPopup] = useState<Popover | null>(null),
    close = useCallback(() => setPopup(null), []);
  return (
    <>
      <Button
        variant="ghost"
        className="choice"
        aria-label={tr(value)}
        title={tr(label)}
        aria-haspopup="menu"
        aria-expanded={!!popup}
        onClick={(e) =>
          setPopup(
            popup
              ? null
              : {
                  anchor: e.currentTarget,
                  items: options.map((v) => ({
                    label: v,
                    selected: value === v,
                    action: () => onChange(v),
                  })),
                },
          )
        }
      >
        {tr(value)}
        <Icon name="down" size={12} />
      </Button>
      {popup && <Menu menu={popup} close={close} />}
    </>
  );
}
