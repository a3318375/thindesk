// Chunk on Unicode characters and prefer paragraph boundaries. Every delivery part
// has its own persisted identity, so retrying one part never repeats earlier parts.
export function splitReply(text: string, limit: number) {
  const result: string[] = [];
  let rest = Array.from(text.trim());
  while (rest.length) {
    let end = Math.min(limit, rest.length);
    if (end < rest.length) {
      const boundary = rest.slice(0, end).lastIndexOf("\n");
      if (boundary > limit / 2) end = boundary + 1;
    }
    result.push(rest.slice(0, end).join(""));
    rest = rest.slice(end);
  }
  return result;
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "渠道操作失败";
}
