"use client";

import { useEffect } from "react";

import { APP, isAndroidApp } from "@/lib/app-info";

// Registers the service worker for offline use. Production only: in
// development the worker would cache stale chunks and break HMR.
//
// The build goes into the worker URL (?v=), so every build installs a fresh
// worker that caches that build's files and drops the previous cache.
//
// The Android app never has one: its engine runs on the device, so there is
// nothing to be offline from, and a worker would keep serving the previous
// build's files after an app update. Registrations and caches left from an
// earlier build are removed.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (isAndroidApp) {
      void removeServiceWorkers();
      return;
    }
    if (process.env.NODE_ENV !== "production") return;
    const build = encodeURIComponent([APP.version, APP.commit, APP.builtAt].filter(Boolean).join("-") || "0");
    navigator.serviceWorker.register(`/sw.js?v=${build}`).catch(() => {});
  }, []);
  return null;
}

async function removeServiceWorkers() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("nexote-")).map((k) => caches.delete(k)));
    }
  } catch {
    // Best effort: without storage access nothing was registered or cached.
  }
}
