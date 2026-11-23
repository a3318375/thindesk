import {
  AttachmentPrimitive,
  ComposerPrimitive,
  type Attachment,
} from "@assistant-ui/react";
import { FileText, X } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { Dialog } from "../Overlay";
import { Button } from "../ui";

const AttachmentTile = memo(function AttachmentTile({
  attachment,
}: {
  attachment: Attachment;
}) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState(false);
  const file = attachment.file;
  const image = !!file?.type.startsWith("image/");
  useEffect(() => {
    if (!file) return;
    const source = URL.createObjectURL(file);
    setUrl(source);
    return () => URL.revokeObjectURL(source);
  }, [file]);
  return (
    <AttachmentPrimitive.Root className="aui-attachment-root">
      <button
        type="button"
        className="aui-attachment-tile"
        aria-label={attachment.name}
        title={attachment.name}
        onClick={() => setPreview(true)}
      >
        {image && url ? (
          <img src={url} alt="" decoding="async" />
        ) : (
          <FileText size={25} />
        )}
      </button>
      <AttachmentPrimitive.Remove asChild>
        <button
          type="button"
          className="aui-attachment-remove"
          aria-label={"移除 " + attachment.name}
          title="移除附件"
        >
          <X size={12} />
        </button>
      </AttachmentPrimitive.Remove>
      {preview && (
        <Dialog
          title={"预览 " + attachment.name}
          close={() => setPreview(false)}
          className="attachmentPreview"
        >
          <header>
            <strong>{attachment.name}</strong>
            <Button
              variant="ghost"
              aria-label="关闭预览"
              onClick={() => setPreview(false)}
            >
              <X size={16} />
            </Button>
          </header>
          {image ? (
            <img src={url} alt={attachment.name} />
          ) : (
            <p>
              <FileText size={32} />
              {file
                ? (file.size / 1024).toFixed(1) + " KiB"
                : "文件附件"} ·{" "}
              <a href={url} download={attachment.name}>
                下载文件
              </a>
            </p>
          )}
        </Dialog>
      )}
    </AttachmentPrimitive.Root>
  );
});
export function ComposerAttachments() {
  return (
    <div className="aui-composer-attachments">
      <ComposerPrimitive.Attachments>
        {({ attachment }) => <AttachmentTile attachment={attachment} />}
      </ComposerPrimitive.Attachments>
    </div>
  );
}
