import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, delimiter } from "node:path";
export const agents = [
  {
    name: "Codex CLI",
    command: "codex",
    directory: process.env.CODEX_HOME || join(homedir(), ".codex"),
  },
  {
    name: "Pi CLI",
    command: "pi",
    directory:
      process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"),
  },
].map(({ name, command, directory }) => {
  const paths = [
    ...(process.env.PATH || "").split(delimiter).filter(Boolean),
    join(homedir(), ".local/bin"),
  ];
  const executable = paths
    .map((dir) => join(dir, command))
    .find((file) => {
      try {
        accessSync(file, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  let version = "";
  if (executable) {
    try {
      version = execFileSync(executable, ["--version"], {
        encoding: "utf8",
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .trim()
        .split("\n")[0];
    } catch {
      /* The path remains useful if the version probe fails. */
    }
  }
  return {
    name,
    executable: executable || "",
    version,
    directory,
    configured: existsSync(directory),
  };
});
