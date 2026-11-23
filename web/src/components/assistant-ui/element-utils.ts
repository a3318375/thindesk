import { useEffect, useRef, useState } from "react";
import { copyText } from "../clipboard";
export const clamp = (value: number, min: number, max: number) =>
  Number.isNaN(value) ? min : Math.min(max, Math.max(min, value));
export const take = <T>(items: readonly T[], count: number) =>
  items.slice(0, Math.floor(clamp(count, 0, items.length)));
export const pct = (value: number, total: number) =>
  total > 0 ? clamp((value / total) * 100, 0, 100) : 0;
export const announced = (share: number) => Math.round(share * 10) / 10;
export const progressOf = (index: number, total: number) =>
  total > 0 ? Math.floor(clamp(index, 0, total)) : 0;
export function useCopyToClipboard() {
  const [isCopied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copyToClipboard(text: string) {
    try {
      await copyText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return { isCopied, copyToClipboard };
}
