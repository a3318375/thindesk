import { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import type { Message } from "../../../../shared/workspace";
import { MessageAttachments } from "../../components/assistant-ui/elements/message-attachment";
import { Dialog } from "../../components/Overlay";
import { IconButton } from "../../components/ui";
import { FilePreview } from "../panels/Inspector";

type File = { id: string; name: string };
export function StoredAttachments({
  attachments,
}: {
  attachments: NonNullable<Message["attachments"]>;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [selected, select] = useState<File>();
  const files = attachments.filter(
    (file): file is File => typeof file !== "string",
  );
  const key = files.map((file) => file.id).join("/");
  useEffect(() => {
    const controller = new AbortController(),
      sources: string[] = [];
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      for (const file of files.filter((file) =>
        /\.(png|jpe?g|gif|webp)$/i.test(file.name),
      )) {
        void fetch("/api/files/" + file.id, { signal: controller.signal })
          .then(async (response) => {
            if (!response.ok) return;
            const type = file.name
              .split(".")
              .pop()!
              .toLowerCase()
              .replace("jpg", "jpeg");
            const blob = await response.blob();
            if (controller.signal.aborted) return;
            const url = URL.createObjectURL(
              blob.slice(0, blob.size, "image/" + type),
            );
            sources.push(url);
            setUrls((previous) => ({ ...previous, [file.id]: url }));
          })
          .catch(() => {});
      }
    });
    if (holder.current) observer.observe(holder.current);
    return () => {
      observer.disconnect();
      controller.abort();
      for (const url of sources) URL.revokeObjectURL(url);
    };
  }, [key]);
  if (!attachments.length) return null;
  return (
    <div className="storedAttachments" ref={holder}>
      <MessageAttachments
        attachments={files.map((file) => ({
          ...file,
          size: /\.(png|jpe?g|gif|webp)$/i.test(file.name) ? "图片" : "文件",
          kind: /\.(png|jpe?g|gif|webp)$/i.test(file.name)
            ? "image"
            : "document",
          swatch: urls[file.id] ? `url("${urls[file.id]}")` : undefined,
        }))}
        onOpen={(id) => select(files.find((file) => file.id === id))}
      />
      <div className="storedDownloads">
        {files.map((file) => (
          <a
            key={file.id}
            href={"/api/files/" + file.id}
            download={file.name}
            aria-label={"下载 " + file.name}
            title={"下载 " + file.name}
          >
            <Download size={12} />
            {file.name}
          </a>
        ))}
      </div>
      {attachments
        .filter((file) => typeof file === "string")
        .map((file, index) => (
          <span key={index}>{file}</span>
        ))}
      {selected && (
        <Dialog
          title={"预览 " + selected.name}
          close={() => select(undefined)}
          className="attachmentPreview storedAttachmentPreview"
        >
          <header>
            <strong>附件预览</strong>
            <IconButton
              icon={X}
              aria-label="关闭预览"
              onClick={() => select(undefined)}
            />
          </header>
          <FilePreview file={selected} />
        </Dialog>
      )}
    </div>
  );
}
