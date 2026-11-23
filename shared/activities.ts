export function fileChangeStats(changes: { path: string; diff?: string }[]) {
  return changes.map((change) => {
    if (!change.diff) return { path: change.path };
    const lines = (change.diff || "").split("\n");
    return {
      path: change.path,
      added: lines.filter(
        (line) => line.startsWith("+") && !line.startsWith("+++ "),
      ).length,
      removed: lines.filter(
        (line) => line.startsWith("-") && !line.startsWith("--- "),
      ).length,
    };
  });
}
