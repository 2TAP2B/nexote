"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { offlineOutboxCount } from "@/lib/offline-db";

// Provides the online/offline state for the app and renders a small fixed
// indicator: an "Offline" banner when disconnected, plus a pending-sync badge
// showing how many queued changes are waiting to be replayed to the server.
export default function OfflineStatus() {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshPending = useCallback(async () => {
    try {
      setPending(await offlineOutboxCount());
    } catch {
      setPending(0);
    }
  }, []);

  const handleOnline = useCallback(() => {
    setOnline(true);
    setSyncing(true);
    // Give the SW (if any) a moment to flush the outbox, then refresh.
    window.setTimeout(() => {
      setSyncing(false);
      void refreshPending();
      window.dispatchEvent(new CustomEvent("nexote:refresh-data"));
    }, 1200);
  }, [refreshPending]);

  const handleOffline = useCallback(() => {
    setOnline(false);
    void refreshPending();
  }, [refreshPending]);

  useEffect(() => {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    // Listen for the SW finishing a sync replay.
    const onSynced = (e: Event) => {
      const conflicts = (e as MessageEvent).data as { conflicts?: string[] };
      if (conflicts?.conflicts?.length) {
        // Surface conflicts to the app so NotesProvider can show a notice.
        window.dispatchEvent(
          new CustomEvent("nexote:sync-conflicts", {
            detail: conflicts.conflicts,
          }),
        );
      }
      setSyncing(false);
      void refreshPending();
      window.dispatchEvent(new CustomEvent("nexote:refresh-data"));
    };
    const navigate = navigator as Navigator & {
      connection?: { addEventListener: (t: string, cb: () => void) => void; removeEventListener: (t: string, cb: () => void) => void };
    };
    navigate.connection?.addEventListener?.("change", () => {
      setOnline(navigator.onLine);
      void refreshPending();
    });
    navigator.serviceWorker?.addEventListener("message", onSynced);
    void refreshPending();
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      navigate.connection?.removeEventListener?.("change", handleOnline);
      navigator.serviceWorker?.removeEventListener("message", onSynced);
    };
  }, [handleOnline, handleOffline, refreshPending]);

  if (online && pending === 0 && !syncing) return null;

  const showOffline = !online;
  const showPending = online && !syncing && pending > 0;

  return (
    <div
      className="pointer-events-none fixed left-1/2 z-[60] -translate-x-1/2"
      style={{ top: 12 }}
    >
      {showOffline && (
        <div className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg"
          style={{ background: "var(--background)", border: "1px solid var(--border)", color: "var(--foreground)" }}
        >
          <CloudOff className="h-3.5 w-3.5" />
          Offline — changes will sync when back online
        </div>
      )}
      {showPending && (
        <div className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg"
          style={{ background: "var(--background)", border: "1px solid var(--border)", color: "var(--foreground)" }}
        >
          <RefreshCw className="h-3.5 w-3.5 text-amber-500" />
          {pending} change{pending === 1 ? "" : "s"} pending sync
        </div>
      )}
      {syncing && (
        <div className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg"
          style={{ background: "var(--background)", border: "1px solid var(--border)", color: "var(--foreground)" }}
        >
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Syncing…
        </div>
      )}
    </div>
  );
}
