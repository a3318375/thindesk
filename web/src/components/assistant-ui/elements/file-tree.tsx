// Adapted from assistant-ui Elements File Tree (MIT) for native patch records.
import { useState } from "react";
import { ChevronDownIcon, FileIcon, FolderIcon } from "lucide-react";
import { cn } from "../utils";
import { mono, paper } from "./surfaces";

type FileRow = { path: string; added: number; removed: number };
type Group = { directory: string; files: { file: FileRow; name: string }[] };

function Counts({ added, removed, total }: { added: number; removed: number; total?: boolean }) {
  return <span className={cn(mono, "inline-flex shrink-0 gap-1.5 tabular-nums")}>
    {(added > 0 || total) && <span className="text-emerald-600 dark:text-emerald-400">+{added}</span>}
    {(removed > 0 || total) && <span className="text-red-600 dark:text-red-400">−{removed}</span>}
  </span>;
}

export function FileTree({ files, workspace, onOpen }: {
  files: FileRow[]; workspace: string; onOpen: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = new Map<string, Group>();
  const prefix = workspace.replace(/\/$/, "") + "/";
  let added = 0, removed = 0;
  for (const file of files) {
    const path = workspace && file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path;
    const slash = path.lastIndexOf("/");
    const directory = path.slice(0, slash + 1);
    const group = groups.get(directory) || { directory, files: [] };
    group.files.push({ file, name: path.slice(slash + 1) });
    groups.set(directory, group);
    added += file.added;
    removed += file.removed;
  }
  function toggle(directory: string) {
    setCollapsed(previous => {
      const next = new Set(previous);
      if (next.has(directory)) next.delete(directory);
      else next.add(directory);
      return next;
    });
  }
  const row = "flex w-full min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-left text-[13px] hover:bg-foreground/[0.03]";
  return <section aria-label="本轮原生文件变更" data-slot="file-tree"
    className={cn(paper, "my-4 flex w-full max-w-sm flex-col gap-2 rounded-2xl border-solid p-3.5")}>
    <header className="flex items-baseline justify-between gap-2 px-1" title="增删行数按本轮运行器返回的修改记录累计">
      <span className="text-[13.5px] font-medium">已更改 {files.length} 个文件</span>
      <Counts added={added} removed={removed} total />
    </header>
    <div className="max-h-80 overflow-y-auto">
      {[...groups.values()].map(({ directory, files: children }) => {
        const expanded = !collapsed.has(directory);
        const label = directory.replace(/\/$/, "") || "/";
        return <div key={directory}>
          {directory && <button type="button" className={row} title={label}
            aria-expanded={expanded} onClick={() => toggle(directory)}>
            <ChevronDownIcon className={cn("size-3 shrink-0 text-muted-foreground", !expanded && "-rotate-90")} />
            <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-foreground/60">{label}</span>
          </button>}
          {expanded && children.map(({ file, name }) => <button key={file.path} type="button"
            className={cn(row, directory && "ps-[1.1rem]")} title={file.path}
            aria-label={`查看变更 ${file.path}`} aria-haspopup="dialog" onClick={() => onOpen(file.path)}>
            <FileIcon className="ms-3 size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-foreground/85">{name}</span>
            <Counts added={file.added} removed={file.removed} />
          </button>)}
        </div>;
      })}
    </div>
  </section>;
}
