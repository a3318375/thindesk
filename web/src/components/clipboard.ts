export async function copyText(text: string) {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* Older browsers and HTTP origins use the selection fallback below. */
    }
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  const active = document.activeElement;
  document.body.append(input);
  try {
    input.select();
    if (!document.execCommand("copy")) throw Error("无法访问剪贴板");
  } finally {
    input.remove();
    if (active instanceof HTMLElement) active.focus({ preventScroll: true });
  }
}
