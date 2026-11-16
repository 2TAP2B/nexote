"use client";

import { CloudOff, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { offlineOutboxCount } from "@/lib/offline-db";

type SyncCopy = { original: string; copy: string };
type SyncMessage = { type: "nexote:synced"; copies: SyncCopy[]; failed: unknown[]; remaining: number; done: number };

function isSyncMessage(data: unknown): data is SyncMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    data.type === "nexote:synced" &&
    "copies" in data &&
    Array.isArray(data.copies) &&
    "failed" in data &&
    Array.isArray(data.failed)
  );
}

function reportText(msg: SyncMessage): string | null {
  const parts: string[] = [];
  if (msg.copies.length === 1) {
    const [c] = msg.copies;
    parts.push(`"${c.original}" was changed elsewhere while you were offline. Your version was saved as "${c.copy}".`);
  } else if (msg.copies.length > 1) {
    parts.push(
      `${msg.copies.length} notes were changed elsewhere while you were offline. Your versions were saved as "(offline copy)" notes.`,
    );
  }
  if (msg.failed.length) {
    parts.push(
      `${msg.failed.length} offline change${msg.failed.length === 1 ? " was" : "s were"} rejected by the server and not applied.`,
    );
  }
  return parts.length ? parts.join(" ") : null;
}

// Provides the online/offline state and renders a small fixed indicator: an
// "Offline" pill while the server can't be reached, plus a badge with the
// number of changes waiting to sync.
//
// navigator.onLine is unreliable (Linux network managers report "down" with
// localhost reachable; iOS misses "online" events), so connectivity is
// checked with a HEAD request the service worker lets through: on mount, on
// online/offline/visibility events, and every 15 s while offline or while
// changes are queued. When the server answers and changes are queued, the
// worker is asked to sync them.
export default function OfflineStatus() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  // What the last sync wants the user to know (offline copies, rejections).
  const [report, setReport] = useState<string | null>(null);
  const probeRef = useRef(0);

  const refreshPending = useCallback(async () => {
    const count = await offlineOutboxCount().catch(() => 0);
    setPending(count);
    return count;
  }, []);

  const probe = useCallback(async () => {
    const id = ++probeRef.current;
    let reachable = false;
    try {
      const res = await fetch("/api/vaults", {
        method: "HEAD",
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      // 401 = server up, just signed out (the login screen is showing).
      reachable = res.ok || res.status === 405 || res.status === 401;
    } catch {
      reachable = false;
    }
    if (id !== probeRef.current) return;
    setOnline(reachable);
    try {
      localStorage.setItem("nexote:online", reachable ? "1" : "0");
    } catch {}
    const count = await refreshPending();
    if (reachable && count > 0) {
      setSyncing(true);
      navigator.serviceWorker?.controller?.postMessage({ type: "nexote:flush" });
    }
  }, [refreshPending]);

  useEffect(() => {
    // Last known state for the first paint, then verify.
    try {
      if (localStorage.getItem("nexote:online") === "0") setOnline(false);
    } catch {}
    void probe();

    const onProbe = () => void probe();
    const onVisible = () => {
      if (document.visibilityState === "visible") void probe();
    };
    const onWorkerMessage = (e: MessageEvent) => {
      const data: unknown = e.data;
      if (typeof data !== "object" || data === null || !("type" in data)) return;
      if (data.type === "nexote:queued") {
        // A write was queued: the server may be down even with a network.
        void probe();
        return;
      }
      if (!isSyncMessage(data)) return;
      setSyncing(false);
      setPending(data.remaining);
      const text = reportText(data);
      if (text) setReport(text);
      if (data.done > 0) window.dispatchEvent(new CustomEvent("nexote:refresh-data"));
    };
    window.addEventListener("online", onProbe);
    window.addEventListener("offline", onProbe);
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.addEventListener("message", onWorkerMessage);
    return () => {
      window.removeEventListener("online", onProbe);
      window.removeEventListener("offline", onProbe);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
    };
  }, [probe]);

  // Keep checking while offline or while changes wait.
  useEffect(() => {
    if (online && pending === 0) return;
    const timer = window.setInterval(() => void probe(), 15_000);
    return () => window.clearInterval(timer);
  }, [online, pending, probe]);

  // A sync that never reports back (worker restarted) must not spin forever.
  useEffect(() => {
    if (!syncing) return;
    const timer = window.setTimeout(() => {
      setSyncing(false);
      void refreshPending();
    }, 30_000);
    return () => window.clearTimeout(timer);
  }, [syncing, refreshPending]);

  if (online && pending === 0 && !syncing && !report) return null;

  const showOffline = !online;
  const showPending = online && !syncing && pending > 0;

  return (
    <div
      className="pointer-events-none fixed left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2"
      style={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
    >
      {showOffline && (
        <div className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg"
          style={{ background: "var(--background)", border: "1px solid var(--border)", color: "var(--foreground)" }}
        >
          <CloudOff className="h-3.5 w-3.5" />
          {pending > 0
            ? `Offline · ${pending} change${pending === 1 ? "" : "s"} will sync when back online`
            : "Offline · changes will sync when back online"}
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
      {report && (
        <div
          role="status"
          className="pointer-events-auto flex max-w-[min(28rem,calc(100vw-2rem))] items-start gap-2 rounded-xl px-3 py-2 text-xs shadow-lg"
          style={{ background: "var(--background)", border: "1px solid var(--border)", color: "var(--foreground)" }}
        >
          <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="min-w-0 flex-1">{report}</span>
          <button type="button" aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100" onClick={() => setReport(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
