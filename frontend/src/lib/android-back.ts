// The Android system Back button. Overlays (dialogs, sheets, menus, settings,
// viewers…) aren't browser history entries, so the app asks the page first:
// it calls `window.__nexoteAndroidBack()`, which closes the topmost open
// overlay and returns true; false lets the app go back in the WebView's
// history (the previous note) and finally leave.
//
// Every overlay registers itself while open (useAndroidBack). The newest
// registration is the top one: an overlay opened from another registers
// after it. Shells add a fallback for what isn't an overlay (the touch
// shell's pager returning to the note pane). Nothing happens outside the
// Android app build.

import { useEffect, useRef } from "react";

import { isAndroidApp } from "./app-info";

type Entry = { back: () => void; closing: boolean };

// Open overlays, oldest first.
const stack: Entry[] = [];
let fallback: (() => boolean) | null = null;

function androidBack(): boolean {
  // An overlay asked to close may still be animating out: the next Back
  // goes to the one below instead of being swallowed.
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i];
    if (entry.closing) continue;
    entry.closing = true;
    entry.back();
    return true;
  }
  return fallback?.() ?? false;
}

if (isAndroidApp && typeof window !== "undefined") {
  Reflect.set(window, "__nexoteAndroidBack", androidBack);
}

/** Registers an open overlay: Back calls `onBack` (close it) while `open`.
 *  Becoming open again puts it on top. `open` may be a key (falsy = closed)
 *  for a view whose Back only steps back within it: a new key after the
 *  step counts as opened again, so the next Back reaches it too. */
export function useAndroidBack(onBack: () => void, open: boolean | string = true): void {
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });
  useEffect(() => {
    if (!isAndroidApp || !open) return;
    const entry: Entry = { back: () => latest.current(), closing: false };
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open]);
}

/** What Back does when no overlay is open (at most one shell sets it):
 *  return true when it moved something, false to let the app go back. */
export function useAndroidBackFallback(handler: () => boolean): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!isAndroidApp) return;
    const own = () => latest.current();
    fallback = own;
    return () => {
      if (fallback === own) fallback = null;
    };
  }, []);
}
