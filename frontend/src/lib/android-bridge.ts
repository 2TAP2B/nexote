// The Android app's native side, reached through the `NexoteAndroid` object
// its WebView injects (WebViewCompat.addWebMessageListener, only for the
// engine's own origin). Messages are JSON strings both ways:
//   page → app: {"type":"hello"} once per page load, {"type":"chooseFolder"},
//               {"type":"theme","dark","color":"#rrggbb"} after hello and on
//               every theme change (the app paints the system bars with it)
//   app → page: {"type":"info","folder","version"} as the answer to hello,
//               {"type":"share","text","subject","files":[{name,type,data}]}
//               for content shared from another app, each delivered once.
// Outside the app (or in a browser opening the engine) there is no object and
// nothing here does anything.

import { useSyncExternalStore } from "react";

import { isAndroidApp } from "./app-info";

/** What the app tells the page about itself. */
export type AndroidInfo = { folder: string; version: string };

/** A file shared from another app; `data` is base64. */
export type AndroidShareFile = { name: string; type: string; data: string };

/** Content shared from another app ("Share" → Nexote). Any part may be missing. */
export type AndroidShare = { text: string; subject: string; files: AndroidShareFile[] };

export type AndroidMessage = { type: "info"; info: AndroidInfo } | { type: "share"; share: AndroidShare };

const stringField = (data: object, key: string): string => {
  const value: unknown = Reflect.get(data, key);
  return typeof value === "string" ? value : "";
};

function parseShareFile(value: unknown): AndroidShareFile | null {
  if (typeof value !== "object" || value === null) return null;
  const data = stringField(value, "data");
  if (!data) return null;
  return { name: stringField(value, "name") || "shared", type: stringField(value, "type"), data };
}

/** Reads one message from the app (a JSON string); null for anything else. */
export function parseAndroidMessage(raw: unknown): AndroidMessage | null {
  if (typeof raw !== "string") return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || !("type" in data)) return null;
  if (data.type === "info") {
    return { type: "info", info: { folder: stringField(data, "folder"), version: stringField(data, "version") } };
  }
  if (data.type === "share") {
    const files: unknown = "files" in data ? data.files : [];
    return {
      type: "share",
      share: {
        text: stringField(data, "text"),
        subject: stringField(data, "subject"),
        files: Array.isArray(files) ? files.flatMap((f) => parseShareFile(f) ?? []) : [],
      },
    };
  }
  return null;
}

/** The memo text for a share: the subject on its own line above the text,
 *  unless the text already contains it (browsers share a page as subject =
 *  title, text = title + URL, or the URL alone). */
export function shareText(share: AndroidShare): string {
  const text = share.text.trim();
  const subject = share.subject.trim();
  if (!subject || text.includes(subject)) return text;
  return text ? `${subject}\n${text}` : subject;
}

/** `addition` after what the composer already holds, on a new line. */
export function appendToDraft(current: string, addition: string): string {
  if (!addition) return current;
  return current.trim() ? `${current.replace(/\s+$/, "")}\n${addition}` : addition;
}

/** The shared files as File objects (as if picked in the composer); files
 *  whose data isn't valid base64 are left out. */
export function shareFiles(share: AndroidShare): File[] {
  return share.files.flatMap((f) => {
    try {
      const binary = atob(f.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return [new File([bytes], f.name, { type: f.type })];
    } catch {
      return [];
    }
  });
}

// --- Runtime ---

type BridgeEvent = { data: unknown };
type BridgeObject = {
  postMessage: (message: string) => void;
  addEventListener: (type: "message", listener: (event: BridgeEvent) => void) => void;
};

function isBridgeObject(value: unknown): value is BridgeObject {
  return (
    typeof value === "object" &&
    value !== null &&
    "postMessage" in value &&
    typeof value.postMessage === "function" &&
    "addEventListener" in value &&
    typeof value.addEventListener === "function"
  );
}

let bridge: BridgeObject | null = null;
let info: AndroidInfo | null = null;
// Shares nobody has taken yet (quick notes aren't open), oldest first.
const pendingShares: AndroidShare[] = [];
// Counts every share received, so the shells can open quick notes even when
// the share was taken right away.
let shareCount = 0;
let shareHandler: ((share: AndroidShare) => boolean) | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function receive(event: BridgeEvent) {
  const message = parseAndroidMessage(event.data);
  if (!message) return;
  if (message.type === "info") {
    info = message.info;
  } else {
    shareCount++;
    // Behind any that already wait, so shares land in the order they came.
    if (pendingShares.length > 0 || !shareHandler?.(message.share)) pendingShares.push(message.share);
  }
  notify();
}

/** Connects to the app (once per page load) and says hello; the app answers
 *  with its info and any shares that arrived before the page was ready. */
export function startAndroidBridge(): void {
  if (bridge || !isAndroidApp || typeof window === "undefined") return;
  const candidate: unknown = Reflect.get(window, "NexoteAndroid");
  if (!isBridgeObject(candidate)) return;
  bridge = candidate;
  bridge.addEventListener("message", receive);
  bridge.postMessage(JSON.stringify({ type: "hello" }));
  watchTheme();
}

// --- Theme for the system bars ---

let swatch: CanvasRenderingContext2D | null = null;

/** Any CSS color (computed styles may be oklch) as #rrggbb; null when
 *  transparent or unreadable. */
function cssColorToHex(css: string): string | null {
  swatch ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!swatch) return null;
  swatch.clearRect(0, 0, 1, 1);
  swatch.fillStyle = "rgba(0, 0, 0, 0)";
  swatch.fillStyle = css;
  swatch.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = swatch.getImageData(0, 0, 1, 1).data;
  if (a === 0) return null;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// The background behind the bars: the touch shell paints its own, the
// desktop shell shows the page's.
function shellBackground(): string | null {
  for (const el of [document.querySelector(".mob-shell-root"), document.body, document.documentElement]) {
    if (!el) continue;
    const hex = cssColorToHex(getComputedStyle(el).backgroundColor);
    if (hex) return hex;
  }
  return null;
}

let lastTheme = "";

/** Tells the app the theme for the system bars (only when it changed). The
 *  bridge does on its own on theme changes; a shell calls it once its own
 *  background is on screen. */
export function refreshAndroidTheme(): void {
  if (!bridge) return;
  // next-themes resolves light/dark/system into the class on <html>.
  const dark = document.documentElement.classList.contains("dark");
  const message = JSON.stringify({ type: "theme", dark, color: shellBackground() ?? (dark ? "#000000" : "#ffffff") });
  if (message === lastTheme) return;
  lastTheme = message;
  bridge.postMessage(message);
}

// Everything the theme decides is on <html>: next-themes' dark class and
// color-scheme style (it follows the system setting while "system" is
// selected) and the color scheme classes. The media query is watched too, as
// a backstop for a system change that reaches the page before the class.
function watchTheme() {
  refreshAndroidTheme();
  new MutationObserver(refreshAndroidTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", refreshAndroidTheme);
}

/** Asks the app for another data folder; it restarts the engine on it and
 *  reloads the page. */
export function chooseAndroidFolder(): void {
  bridge?.postMessage(JSON.stringify({ type: "chooseFolder" }));
}

/** The app's info once it answered hello (null outside the app). */
export function useAndroidInfo(): AndroidInfo | null {
  return useSyncExternalStore(
    subscribe,
    () => info,
    () => null,
  );
}

/** How many shares arrived so far (each one means: open quick notes). */
export function useAndroidShareCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => shareCount,
    () => 0,
  );
}

/** Takes the shares: the waiting ones now, later ones as they arrive. One
 *  taker at a time (the quick-notes composer); returns the release. The
 *  handler returns false when it can't take a share right now: that one and
 *  any after it keep waiting, in order. */
export function takeAndroidShares(handler: (share: AndroidShare) => boolean): () => void {
  shareHandler = handler;
  while (pendingShares.length > 0 && handler(pendingShares[0])) pendingShares.shift();
  return () => {
    if (shareHandler === handler) shareHandler = null;
  };
}
