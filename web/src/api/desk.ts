import type { Desk } from "../../../shared/workspace";
export async function deskRequest(
  operation?: Record<string, unknown>,
): Promise<Desk> {
  const response = await fetch(
    workspaceUrl("/api/desk"),
    operation
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(operation),
        }
      : undefined,
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "无法连接工作台");
  return result;
}

export async function encodeAttachments(files: File[]) {
  if (
    files.length > 32 ||
    files.reduce((sum, f) => sum + f.size, 0) > 8 * 1024 * 1024
  )
    throw Error("单条消息最多 32 个附件、合计 8 MiB");
  return Promise.all(
    files.map(
      (file) =>
        new Promise<{ name: string; base64: string }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              name: file.name,
              base64: String(reader.result).split(",")[1],
            });
          reader.onerror = () => reject(Error("无法读取附件 " + file.name));
          reader.readAsDataURL(file);
        }),
    ),
  );
}

export function workspaceUrl(path: string, session = location.hash.slice(1)) {
  return path + "?" + new URLSearchParams({ view: "workspace", session });
}
export async function sessionRequest(
  id: string,
  before?: string,
  full = false,
): Promise<import("../../../shared/workspace").Session> {
  const query = new URLSearchParams(
    full ? { view: "full" } : before ? { before } : {},
  );
  const response = await fetch(
    "/api/sessions/" + encodeURIComponent(id) + "?" + query,
  );
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "无法加载会话");
  return result;
}

export async function messageRequest(
  session: string,
  message: string,
  signal: AbortSignal,
): Promise<import("../../../shared/workspace").Message> {
  const response = await fetch(
    "/api/sessions/" +
      encodeURIComponent(session) +
      "/messages/" +
      encodeURIComponent(message),
    { signal },
  );
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "无法加载执行记录");
  return result;
}
