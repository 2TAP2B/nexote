// Copies text to the clipboard. The async Clipboard API only exists in secure
// contexts (https or localhost); over plain http (a LAN or Tailscale IP) fall
// back to selecting a hidden element and execCommand("copy"), which also works
// in iOS Safari as long as it runs inside the tap handler.
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or similar: try the legacy path.
    }
  }
  const el = document.createElement("span");
  el.textContent = text;
  el.style.cssText =
    "position:fixed;top:0;left:0;clip:rect(0,0,0,0);white-space:pre;user-select:text;-webkit-user-select:text;";
  document.body.appendChild(el);
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  selection?.removeAllRanges();
  selection?.addRange(range);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  selection?.removeAllRanges();
  el.remove();
  return ok;
}
