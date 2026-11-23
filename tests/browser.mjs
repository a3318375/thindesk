import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

// Keep layout assertions and reference captures on the same Chinese font stack.
const referenceFonts = join(
  homedir(),
  ".local/state/thindesk/visual-fonts/fonts.conf",
);
export const usesReferenceFonts =
  existsSync(referenceFonts) &&
  (!process.env.FONTCONFIG_FILE ||
    process.env.FONTCONFIG_FILE === referenceFonts);
export function launchBrowser() {
  const fonts =
    process.env.FONTCONFIG_FILE ||
    (usesReferenceFonts ? referenceFonts : undefined);
  return chromium.launch(
    fonts ? { env: { ...process.env, FONTCONFIG_FILE: fonts } } : {},
  );
}
