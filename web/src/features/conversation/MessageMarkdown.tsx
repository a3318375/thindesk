import { FileLink } from "../panels/DocumentPreview";
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { MarkdownText } from "../../components/assistant-ui/elements/markdown-text";
const components = { a: FileLink };
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];
export const AssistantMarkdown = memo(MarkdownText);
export const MessageMarkdown = memo(function MessageMarkdown({
  children,
}: {
  children: string;
}) {
  return (
    <div className="markdown aui-md">
      <ReactMarkdown
        components={components}
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
