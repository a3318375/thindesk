import type { Session } from "../../../shared/workspace";

export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
export const turnsOf = (s: Session) =>
  s.turnCount ?? s.messages.filter((m) => m.role === "user").length;
export const tokensOf = (s: Session) => sum(s.sampleUsage?.tokens ?? []);
const compactNumbers = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
export const compact = (value: number) => compactNumbers.format(value);
export function elapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  if (minutes >= 60)
    return Math.floor(minutes / 60) + "h" + (minutes % 60) + "m";
  return minutes ? minutes + "m" + (seconds % 60) + "s" : seconds + "s";
}
export function localDay(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}
export function offsetDay(iso: string, offset: number) {
  const date = new Date(iso + "T12:00:00");
  date.setDate(date.getDate() + offset);
  return localDay(date);
}
