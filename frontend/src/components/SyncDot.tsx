"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { isAndroidApp } from "@/lib/app-info";
import { useLocalSync } from "@/lib/local-sync";

type Props = {
  /** "floating": over the note in the touch shell (on its own small disc);
   *  "inline": inside a bar that has its own background. */
  look?: "inline" | "floating";
};

/**
 * The Android app's sync at a glance, in the corner of each header: a
 * spinner while changes are waiting or a sync runs, a check for a moment
 * when one finished, a warning dot after a failed sync (opens Settings ›
 * Server). Nothing when idle, when not paired, and in the server build.
 */
function AppSyncDot({ look = "inline" }: Props) {
  const { status, justSynced } = useLocalSync();
  if (!status?.connected) return null;
  const busy = status.syncing || status.pending > 0;
  const failed = status.revoked || status.lastError !== undefined;
  const state = busy ? "busy" : failed ? "error" : justSynced ? "done" : null;
  if (!state) return null;

  const frame =
    "flex shrink-0 items-center justify-center self-center rounded-full" +
    (look === "floating" ? " pointer-events-auto h-7 w-7" : " mx-1 h-6 w-6");
  const frameStyle = look === "floating" ? { background: "var(--mob-surface)" } : undefined;

  if (state === "error") {
    return (
      <button
        type="button"
        aria-label="Sync problem: open Settings › Server"
        title={status.revoked ? "The server disconnected this phone" : status.lastError}
        onClick={() => window.dispatchEvent(new CustomEvent("nexote:open-settings", { detail: "server" }))}
        className={frame + " active:scale-95"}
        style={frameStyle}
      >
        <span className="block h-2.5 w-2.5 rounded-full bg-red-500" />
      </button>
    );
  }

  if (state === "done") {
    return (
      <span role="status" aria-label="Synced" title="Synced" className={frame} style={frameStyle}>
        <Check size={15} strokeWidth={3} className="text-green-600 dark:text-green-400" />
      </span>
    );
  }

  return (
    <span role="status" aria-label="Syncing" title="Syncing" className={frame} style={frameStyle}>
      {/* With reduced motion the ring becomes a still dot. */}
      <span className="block h-[15px] w-[15px] rounded-full border-2 border-primary border-t-transparent motion-safe:animate-spin motion-reduce:hidden" />
      <span className="hidden h-2.5 w-2.5 rounded-full bg-primary motion-reduce:block" />
    </span>
  );
}

// The server build has no engine to ask: never subscribe there.
export const SyncDot: (props: Props) => ReactNode = isAndroidApp ? AppSyncDot : () => null;
