import { sessionRequest } from "../../api/desk";
import { strToU8, zipSync } from "fflate";
import type { Session } from "../../../../shared/workspace";

export async function downloadSession(
  current: Session | undefined,
  workspace: string,
) {
  const session = current
    ? await sessionRequest(current.id, undefined, true)
    : { title: "新会话", workspace, messages: [] };
  const archive = zipSync({
    "session.json": strToU8(JSON.stringify(session, null, 2)),
  });
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(archive)], { type: "application/zip" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = session.title + ".zip";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
