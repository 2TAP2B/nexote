"use client";

import { useEffect } from "react";

import { APP } from "@/lib/app-info";

// Registers the service worker for offline use. Production only: in
// development the worker would cache stale chunks and break HMR.
//
// The build goes into the worker URL (?v=), so every build installs a fresh
// worker that caches that build's files and drops the previous cache.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const build = encodeURIComponent([APP.version, APP.commit, APP.builtAt].filter(Boolean).join("-") || "0");
    navigator.serviceWorker.register(`/sw.js?v=${build}`).catch(() => {});
  }, []);
  return null;
}
