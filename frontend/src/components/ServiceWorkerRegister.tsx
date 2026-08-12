"use client";

import { useEffect } from "react";

// Registers the service worker for PWA offline support. Only runs in
// production — in development the SW would cache stale chunks and break HMR.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}