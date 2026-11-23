import { useState } from "react";
import { FileTree } from "../../components/assistant-ui/elements/file-tree";
import { DiffDrawer } from "./DiffDrawer";
import type { Message, ActivityEntry } from "../../../../shared/workspace";

type ChangedFile = {
  path: string;
  entries: ActivityEntry[];
  added: number;
  removed: number;
};

/** Only native patches from this reply; never infer edits from assistant text. */
export function TurnChanges({ message, workspace }: { message: Message; workspace: string }) {
  const [selected, select] = useState<string>();
  const files = new Map<string, ChangedFile>();
  for (const entry of message.activity || []) {
    if (entry.toolType !== "diff" || entry.status !== "complete") continue;
    for (const file of entry.files || []) {
      if (file.added === undefined || file.removed === undefined) continue;
      const value = files.get(file.path) || { path: file.path, entries: [], added: 0, removed: 0 };
      if (value.entries.at(-1) !== entry) value.entries.push(entry);
      value.added += file.added;
      value.removed += file.removed;
      files.set(file.path, value);
    }
  }
  if (!files.size) return null;
  return (
    <>
      <FileTree files={[...files.values()]} workspace={workspace} onOpen={select} />
      {selected && files.has(selected) && (
        <DiffDrawer title="本轮文件变更" file={selected} message={message}
          entries={files.get(selected)!.entries} close={() => select(undefined)} />
      )}
    </>
  );
}
