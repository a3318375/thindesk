import { copyText } from "../clipboard";
import { PrismLight } from "react-syntax-highlighter";
import {
  oneDark,
  oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import { Copy, Check } from "lucide-react";
import { memo, useState, useSyncExternalStore } from "react";
import { Button } from "../ui";
import type {
  SyntaxHighlighterProps,
  CodeHeaderProps,
} from "@assistant-ui/react-markdown";

for (const [name, syntax] of Object.entries({
  javascript,
  typescript,
  jsx,
  tsx,
  bash,
  python,
  json,
}))
  PrismLight.registerLanguage(name, syntax);
function subscribeTheme(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}
export const CodeBlock = memo(function CodeBlock({
  code,
  language,
}: Pick<SyntaxHighlighterProps, "code" | "language">) {
  const dark = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.dataset.theme === "dark",
    () => false,
  );
  return (
    <div className="aui-code-content">
      {code.length > 16000 ? (
        <pre>
          <code>{code}</code>
        </pre>
      ) : (
        <PrismLight
          language={language || "text"}
          style={dark ? oneDark : oneLight}
          wrapLongLines={false}
          codeTagProps={{
            style: {
              display: "block",
              background: "transparent",
              font: "inherit",
            },
          }}
        >
          {code}
        </PrismLight>
      )}
    </div>
  );
});
export function MarkdownCodeHeader({ code, language }: CodeHeaderProps) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="aui-code-header">
      <span>{language || "text"}</span>
      <Button
        variant="ghost"
        aria-label="复制代码"
        onClick={async () => {
          await copyText(code);
          setCopied(true);
        }}
        onBlur={() => setCopied(false)}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "已复制" : "复制代码"}
      </Button>
    </div>
  );
}
