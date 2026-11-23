export async function imRequest<T>(
  operation?: Record<string, unknown>,
  signal?: AbortSignal,
  path = "/api/im",
): Promise<T> {
  const response = await fetch(path, {
    method: operation ? "POST" : "GET",
    headers: operation ? { "Content-Type": "application/json" } : undefined,
    body: operation ? JSON.stringify(operation) : undefined,
    signal,
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "IM 配置加载失败");
  return result;
}
