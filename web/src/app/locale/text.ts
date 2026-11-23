import { createContext, useContext } from "react";
import labels from "./labels.json";
export const languages = [
  "中文",
  "English",
  "日本語",
  "Español",
  "Français",
  "Deutsch",
  "Русский",
  "Português",
];
export const languageTags = ["zh-CN", "en", "ja", "es", "fr", "de", "ru", "pt"];
export function textFor(language: string) {
  const index = languages.indexOf(language) - 1;
  const dictionary: Record<string, string[]> = labels;
  return (text: string) =>
    index < 0 ? text : (dictionary[text]?.[index] ?? text);
}
export const TextContext = createContext(textFor("中文"));
export function useText() {
  return useContext(TextContext);
}
