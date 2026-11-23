import type { ActivityEntry, Message } from "../../../../shared/workspace";
import { RightDrawer } from "../../components/RightDrawer";
import { ToolOutput } from "./ToolOutput";

export function DiffDrawer({ title, file, message, entries, close }: {
  title: string; file?: string; message: Message; entries: ActivityEntry[]; close: () => void;
}) {
  return <RightDrawer title={title} label={file ? title + " " + file : title} subtitle={file} close={close}>
    {entries.map((entry, i) => <section key={entry.id}>
      {entries.length > 1 && <h3>第 {i + 1} 次修改</h3>}
      <ToolOutput message={message} entry={entry} file={file} />
    </section>)}
  </RightDrawer>;
}
