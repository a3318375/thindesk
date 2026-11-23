import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft } from "lucide-react";
import { RightDrawer } from "../../components/RightDrawer";
import { IconButton } from "../../components/ui";
import { CodeBlock } from "../../components/assistant-ui/CodeBlock";

type Target = { path: string; base?: string };
type Document = { path: string; name: string; text: string; line?: number };
const Links = createContext<{
  open: (target: Target) => void;
  base?: string;
} | null>(null);
const remarkPlugins = [remarkGfm];
const components = { a: FileLink };

export function FileLink({
  href, children, node: _node, ...props
}: ComponentProps<"a"> & { node?: unknown }) {
  const context = useContext(Links);
  const local = href && !href.startsWith("#") &&
    !href.startsWith("//") && !/^[a-z][a-z\d+.-]*:/i.test(href);
  return (
    <a
      {...props}
      href={href}
      onClick={event => {
        props.onClick?.(event);
        if (event.defaultPrevented || !context || !local) return;
        event.preventDefault();
        context.open({ path: href, base: context.base });
      }}
    >
      {children}
    </a>
  );
}

export function DocumentLinks({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<Target[]>([]);
  const target = history.at(-1);
  const [document, setDocument] = useState<Document>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const close = () => setHistory([]);
  const open = (next: Target) => setHistory(items => [...items, next]);
  useEffect(() => {
    setDocument(undefined);
    setError("");
    if (!target) return;
    const controller = new AbortController();
    setLoading(true);
    const query = new URLSearchParams({ path: target.path });
    if (target.base) query.set("base", target.base);
    void fetch("/api/local-file?" + query, { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw Error(result.error || "无法读取文件");
        if (!controller.signal.aborted) setDocument(result);
      })
      .catch(error => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [target]);
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [document]);
  return (
    <Links.Provider value={{ open }}>
      {children}
      {target && (
        <RightDrawer title={document?.name || "文件预览"} close={close} closeLabel="关闭文件预览"
          subtitle={(document?.path || target.path) + (document?.line ? ` · 第 ${document.line} 行` : "")}
          bodyRef={body}
          leading={history.length > 1 && <IconButton icon={ArrowLeft} aria-label="返回上一份文档"
            onClick={() => setHistory(items => items.slice(0, -1))} />}>
            {loading && <p role="status">正在读取文件…</p>}
            {error && <p role="alert">{error}</p>}
            {document && (
              <Links.Provider value={{ open, base: document.path }}>
                {/\.md(?:own)?$/i.test(document.name) ? (
                  <div className="markdown aui-md">
                    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
                      {document.text}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <CodeBlock
                    code={document.text}
                    language={document.name.split(".").at(-1) || "text"}
                  />
                )}
              </Links.Provider>
            )}
        </RightDrawer>
      )}
    </Links.Provider>
  );
}
