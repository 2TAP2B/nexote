"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { offlineOutboxCount } from "@/lib/offline-db";

// Provides the online/offline state for the app and renders a small fixed
// indicator: an "Offline" banner when disconnected, plus a pending-sync badge
// showing how many queued changes are waiting to be replayed to the server.
//
// navigator.onLine is unreliable on some setups (e.g. Linux where the network
// manager reports the interface as down even though localhost is reachable), so
// we verify connectivity with a lightweight HEAD request to the API on mount
// and whenever the browser fires online/offline events. The last known result
// is cached in localStorage so the initial paint matches the previous session.
export default function OfflineStatus() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const probeRef = useRef(0);

  const refreshPending = useCallback(async () => {
    try {
      setPending(await offlineOutboxCount());
    } catch {
      setPending(0);
    }
  }, []);

  const probe = useCallback(async () => {
    const id = ++probeRef.current;
    try {
      const res = await fetch("/api/vaults", {
        method: "HEAD",
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      if (id !== probeRef.current) return;
      const reachable = res.ok || res.status === 405;
      setOnline(reachable);
      if (reachable) {
        try { localStorage.setItem("nexote:online", "1"); } catch {}
      } else {
        try { localStorage.setItem("nexote:online", "0"); } catch {}
      }
    } catch {
      if (id !== probeRef.current) return;
      setOnline(false);
      try { localStorage.setItem("nexote:online", "0"); } catch {}
    }
  }, []);

  const handleOnline = useCallback(() => {
    void probe();
    setSyncing(true);
    window.setTimeout(() => {
      setSyncing(false);
      void refreshPending();
      window.dispatchEvent(new CustomEvent("nexote:refresh-data"));
    }, 1200);
  }, [probe, refreshPending]);

  const handleOffline = useCallback(() => {
    setOnline(false);
    try { localStorage.setItem("nexote:online", "0"); } catch {}
    void refreshPending();
  }, [refreshPending]);

  useEffect(() => {
    // Restore last known state for the initial paint, then verify with a probe.
    try {
      const cached = localStorage.getItem("nexote:online");
      if (cached === "0") setOnline(false);
    } catch {}

    void probe();
    void refreshPending();

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    // Listen for the SW finishing a sync replay.
    const onSynced = (e: Event) => {
      const conflicts = (e as MessageEvent).data as { conflicts?: string[] };
      if (conflicts?.conflicts?.length) {
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
    navigator.serviceWorker?.addEventListener("message", onSynced);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      navigator.serviceWorker?.removeEventListener("message", onSynced);
    };
  }, [handleOnline, handleOffline, probe, refreshPending]);

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
