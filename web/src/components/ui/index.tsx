import {
  type ButtonHTMLAttributes,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import "./ui.css";

export function Button({
  variant = "default",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "ghost" | "primary";
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      type={type}
      className={`ui-button ui-${variant} ${className}`}
      {...props}
    />
  );
}
export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input className={`ui-input ${className}`} {...props} />;
}
export function TextArea({
  className = "",
  ...props
}: ComponentProps<"textarea">) {
  return <textarea className={`ui-textarea ${className}`} {...props} />;
}
export function Switch({
  onChange,
  className = "",
  ...props
}: Omit<ComponentProps<typeof SwitchPrimitive.Root>, "onChange"> & {
  onChange?: (value: boolean) => void;
}) {
  return (
    <SwitchPrimitive.Root
      className={`ui-switch ${className}`}
      onCheckedChange={onChange}
      {...props}
    >
      <SwitchPrimitive.Thumb className="ui-switch-thumb" />
    </SwitchPrimitive.Root>
  );
}
export function Checkbox({
  children,
  onChange,
  ...props
}: Omit<ComponentProps<typeof CheckboxPrimitive.Root>, "onChange"> & {
  onChange?: (value: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <label className="ui-checkbox-label">
      <CheckboxPrimitive.Root
        className="ui-checkbox"
        onCheckedChange={(value) => onChange?.(value === true)}
        {...props}
      >
        <CheckboxPrimitive.Indicator>
          <Check size={12} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {children}
    </label>
  );
}
export function Select({
  options,
  onValueChange,
  value,
  defaultValue,
  name,
  id,
  "aria-label": label,
  required,
}: {
  options: { value: string; label: string }[];
  onValueChange?: (value: string) => void;
  value?: string;
  defaultValue?: string;
  name?: string;
  id?: string;
  "aria-label"?: string;
  required?: boolean;
}) {
  return (
    <SelectPrimitive.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      name={name}
      required={required}
    >
      <SelectPrimitive.Trigger className="ui-select" id={id} aria-label={label}>
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronDown size={14} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="ui-popup"
          position="popper"
          sideOffset={4}
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                className="ui-select-item"
                key={option.value}
                value={option.value}
              >
                <SelectPrimitive.ItemText>
                  {option.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check size={14} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
// Shared icon controls keep the same hit area as assistant-ui's action bar.
export function IconButton({
  icon: Glyph,
  className = "",
  variant = "ghost",
  ...props
}: Omit<ComponentProps<typeof Button>, "children"> & {
  icon: React.ComponentType<{
    size?: number;
    strokeWidth?: number;
    "aria-hidden"?: boolean;
  }>;
}) {
  return (
    <Button
      className={`ui-icon-button ${className}`}
      variant={variant}
      {...props}
    >
      <Glyph size={16} strokeWidth={1.6} aria-hidden />
    </Button>
  );
}
