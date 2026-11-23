import { parse } from "shell-quote";
import { basename } from "node:path";

// Keep quoted newlines intact; shell-quote handles quoting and control operators.
function commandLines(command: string) {
  let quote = "",
    escaped = false,
    result = "";
  const heredocs: string[] = [];
  for (const line of command.split("\n")) {
    if (heredocs.length) {
      if (line.replace(/^\t+/, "") === heredocs[0]) heredocs.shift();
      continue;
    }
    for (let index = 0; index < line.length; index++) {
      const character = line[index];
      if (escaped) {
        result += character;
        escaped = false;
        continue;
      }
      if (character === "\\" && quote !== "'") {
        result += character;
        escaped = true;
        continue;
      }
      if (!quote && line.slice(index, index + 2) === "<<") {
        const match =
          /^<<-?\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z_0-9]*))/.exec(
            line.slice(index),
          );
        if (match) heredocs.push(match[1] || match[2] || match[3]);
      }
      if (
        (character === "'" || character === '"') &&
        (!quote || quote === character)
      )
        quote = quote ? "" : character;
      result += character;
    }
    result += quote || escaped ? "\n" : ";";
    escaped = false;
  }
  return quote ? null : result;
}
export function commandPrograms(command: string, depth = 0): string[] {
  if (depth > 3) return [];
  const result: string[] = [];
  const flush = (words: string[]) => {
    while (words.length && /^[A-Za-z_][A-Za-z_0-9]*=/.test(words[0]))
      words.shift();
    if (!words.length) return;
    const name = basename(words[0]);
    if (["bash", "sh", "zsh", "dash"].includes(name)) {
      const option = words.findIndex(
        (word, index) =>
          index > 0 &&
          (/^-[A-Za-z]*c[A-Za-z]*$/.test(word) || word === "--command"),
      );
      if (option > 0 && words[option + 1] !== undefined) {
        result.push(...commandPrograms(words[option + 1], depth + 1));
        return;
      }
    }
    result.push(name);
  };
  try {
    const source = commandLines(command);
    if (source === null) return [];
    let words: string[] = [];
    for (const token of parse(source, (key) => "$" + key)) {
      if (typeof token === "string") words.push(token);
      else if (
        "op" in token &&
        [";", "&&", "||", "|", "|&", "&", "(", ")"].includes(token.op)
      ) {
        flush(words);
        words = [];
      }
    }
    flush(words);
  } catch {
    /* Incomplete or unsupported shell syntax has no reliable program list. */
  }
  return result;
}
