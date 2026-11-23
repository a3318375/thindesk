import { useEffect, useState } from "react";
import { TerminalBlock } from "../../components/assistant-ui/elements/terminal-block";
import {
  CodeDiff,
  type DiffLine,
} from "../../components/assistant-ui/elements/code-diff";
import { CodeBlock } from "../../components/assistant-ui/CodeBlock";
import { Button } from "../../components/ui";
import { messageRequest } from "../../api/desk";
import type { ActivityEntry, Message } from "../../../../shared/workspace";

export function ToolOutput({
  message,
  entry,
  file,
}: {
  message: Message;
  entry: ActivityEntry;
  file?: string;
}) {
  const [output, setOutput] = useState(
    entry.output ??
      (entry.id === "legacy-command" ? message.command : undefined),
  );
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  const session = location.hash.slice(1);
  useEffect(() => {
    const initial =
      entry.output ??
      (entry.id === "legacy-command" ? message.command : undefined);
    if (initial !== undefined) {
      setOutput(initial);
      return;
    }
    const controller = new AbortController();
    setError("");
    void messageRequest(session, message.id, controller.signal)
      .then((result) => {
        setOutput(
          entry.id === "legacy-command"
            ? result.command || ""
            : result.activity?.find((item) => item.id === entry.id)?.output ||
                "暂无执行输出",
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error));
      });
    return () => controller.abort();
  }, [
    entry.id,
    entry.output,
    entry.outputVersion,
    message.id,
    message.command,
    message.commandVersion,
    session,
    attempt,
  ]);
  if (error)
    return (
      <p role="status">
        {error}{" "}
        <Button onClick={() => retry((value) => value + 1)}>重试</Button>
      </p>
    );
  if (output === undefined)
    return (
      <p role="status" className="muted">
        正在加载执行记录…
      </p>
    );
  if (entry.toolType === "terminal") {
    const lines = output.split("\n");
    return (
      <div className="commandRecord">
        <TerminalBlock
          command={entry.command || entry.label}
          lines={lines}
          visibleCount={lines.length}
          done={entry.status !== "running"}
          exitCode={entry.exitCode}
          failed={entry.status === "error"}
          durationMs={entry.durationMs}
          truncated={entry.truncated}
          maxCollapsedLines={10}
        />
      </div>
    );
  }
  if (entry.toolType === "diff") {
    try {
      const changes = JSON.parse(output) as { path: string; diff: string }[];
      return (
        <div className="activityDiffs">
          {changes
            .filter((change) => !file || change.path === file)
            .map((change, index) => {
              const lines: DiffLine[] = (change.diff || "")
                .split("\n")
                .filter((line) => !/^(diff |index |--- |\+\+\+ |@@)/.test(line))
                .map((line) => ({
                  kind: line.startsWith("+")
                    ? "added"
                    : line.startsWith("-")
                      ? "removed"
                      : "context",
                  text: /^[+ -]/.test(line) ? line.slice(1) : line,
                }));
              return (
                <CodeDiff
                  key={change.path + index}
                  filename={change.path}
                  additions={
                    lines.filter((line) => line.kind === "added").length
                  }
                  deletions={
                    lines.filter((line) => line.kind === "removed").length
                  }
                  lines={lines}
                  cycle={0}
                />
              );
            })}
        </div>
      );
    } catch {
      /* Older transcripts may have plain-text output. */
    }
  }
  return (
    <div className="commandRecord">
      <CodeBlock language="text" code={output || "暂无执行输出"} />
    </div>
  );
}
