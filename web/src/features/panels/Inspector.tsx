import { Button } from "../../components/ui";
import { useText } from "../../app/locale/text";
import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import type { Desk } from "../../../../shared/workspace";
type Attachment = { id: string; name: string };
type Tab = { id: number; name: string; path: string; file?: Attachment };

export function FilePreview({ file }: { file: Attachment }) {
  const url = "/api/files/" + file.id;
  const [content, setContent] = useState("");
  const [failed, setFailed] = useState(false);
  const imageType = /\.(png|jpe?g|gif|webp)$/i
    .exec(file.name)?.[1]
    .toLowerCase();
  const isText =
    /\.(txt|md|csv|json|ya?ml|ini|log|toml|py|[cm]?[jt]sx?|css|html?|xml|sh)$/i.test(
      file.name,
    );
  useEffect(() => {
    if (!isText && !imageType) return;
    const controller = new AbortController();
    let objectUrl = "";
    async function load() {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw Error();
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (imageType) {
        objectUrl = URL.createObjectURL(
          blob.slice(
            0,
            blob.size,
            "image/" + (imageType === "jpg" ? "jpeg" : imageType),
          ),
        );
        setContent(objectUrl);
      } else {
        const text = await blob.text();
        if (!controller.signal.aborted) setContent(text);
      }
    }
    load().catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, imageType, isText]);
  return (
    <section className="inspectorBody filePreview">
      <header>
        <strong>{file.name}</strong>
        <a href={url} download={file.name}>
          下载
        </a>
      </header>
      {failed ? (
        <p role="alert">无法预览此文件</p>
      ) : imageType && content ? (
        <img src={content} alt={file.name} />
      ) : isText ? (
        <pre>{content}</pre>
      ) : !imageType ? (
        <p>此文件可下载查看</p>
      ) : null}
    </section>
  );
}
export function Inspector({
  desk,
  workspace,
  onClose,
}: {
  desk: Desk;
  workspace: string;
  onClose: () => void;
}) {
  const tr = useText();
  const [tabs, setTabs] = useState<Tab[]>([
      { id: 0, name: "开始", path: workspace },
    ]),
    [active, setActive] = useState(0),
    [full, setFull] = useState(false),
    [width, setWidth] = useState<number | null>(null),
    [tools, setTools] = useState(false);
  const tab = tabs.find((t) => t.id === active)!;
  const path = tab.path;
  const setPath = (path: string) =>
    setTabs((ts) => ts.map((t) => (t.id === active ? { ...t, path } : t)));
  const files = new Map<string, Attachment>();
  for (const session of desk.sessions) {
    if (session.workspace !== path) continue;
    for (const file of session.files ??
      session.messages.flatMap((message) => message.attachments ?? [])) {
      if (typeof file !== "string") files.set(file.id, file);
    }
  }
  const change = (name: string, file?: Attachment) => {
    setTabs((ts) =>
      ts.map((t) => (t.id === active ? { ...t, name, file } : t)),
    );
    setTools(false);
  };
  return (
    <aside
      aria-label="右侧边栏"
      className={"inspector" + (full ? " maximized" : "")}
      style={width && !full ? { width } : undefined}
    >
      <div
        className="inspectorResize"
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            setWidth(
              Math.max(300, Math.min(innerWidth * 0.7, innerWidth - e.clientX)),
            );
        }}
      />
      <header>
        <div className="inspectorTabs">
          {tabs.map((t) => (
            <Button
              variant="ghost"
              key={t.id}
              className={active === t.id ? "active" : ""}
              onClick={() => setActive(t.id)}
            >
              {t.file?.name || tr(t.name)}
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          aria-label={tr("分栏")}
          title={tr("分栏")}
          onClick={() => {
            const id = Math.max(...tabs.map((t) => t.id)) + 1;
            setTabs([...tabs, { id, name: "开始", path: workspace }]);
            setActive(id);
          }}
        >
          <Icon name="sidebar" />
        </Button>
        <Button
          variant="ghost"
          aria-label={full ? "退出全屏" : "全屏"}
          onClick={() => setFull(!full)}
        >
          ⛶
        </Button>
        <Button
          variant="ghost"
          aria-label={tr("收起右侧边栏")}
          onClick={onClose}
        >
          <Icon name="sidebar" />
        </Button>
      </header>
      {tab.name === "开始" ? (
        <div className="inspectorStart">
          <span className="compass">◈</span>
          {[
            ["工作区文件", "浏览会话工作区的文件", "folder"],
            ["新建终端", "在会话工作区运行命令", "mode"],
            ["更多工具", "", "apps"],
          ].map(([name, description, icon]) => (
            <Button
              variant="ghost"
              key={name}
              onClick={() =>
                name === "更多工具" ? setTools(!tools) : change(name)
              }
            >
              <Icon name={icon} />
              <span>
                {tr(name)}
                <small>{tr(description)}</small>
              </span>
            </Button>
          ))}
          {tools && (
            <Button variant="ghost" onClick={() => change("工作区文件")}>
              文档预览
            </Button>
          )}
        </div>
      ) : tab.name === "工作区文件" ? (
        <section className="inspectorBody">
          <Button
            variant="ghost"
            onClick={() => setPath(path.slice(0, path.lastIndexOf("/")) || "/")}
          >
            〈
          </Button>
          {path}
          {desk.folders
            .filter((f) => (f.slice(0, f.lastIndexOf("/")) || "/") === path)
            .map((f) => (
              <Button
                variant="ghost"
                key={f}
                className="catalogRow"
                onClick={() => setPath(f)}
              >
                <Icon name="folder" />
                {f.split("/").pop()}
              </Button>
            ))}
          {Array.from(files.values()).map((file) => (
            <Button
              variant="ghost"
              key={file.id}
              className="catalogRow"
              onClick={() => change("文档预览", file)}
            >
              {file.name}
            </Button>
          ))}
        </section>
      ) : tab.name === "新建终端" ? (
        <div className="terminal" role="log">
          终端未连接
        </div>
      ) : (
        tab.file && <FilePreview key={tab.file.id} file={tab.file} />
      )}
    </aside>
  );
}
