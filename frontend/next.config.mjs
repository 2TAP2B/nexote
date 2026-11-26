import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

const git = (...args) => {
  try {
    return execFileSync("git", args, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
};

// Version and build shown in Settings › About. A build from a checkout follows
// the release tags: "v0.0.6-12-gabc1234" = 12 commits after v0.0.6. Docker
// builds have no .git; they take the NEXOTE_VERSION / NEXOTE_COMMIT build args
// (see docker-compose.yml) and otherwise fall back to package.json.
const described = git("describe", "--tags", "--long", "--match", "v[0-9]*").match(/^v?(.+)-(\d+)-g([0-9a-f]+)$/);
const build = {
  version: process.env.NEXOTE_VERSION?.replace(/^v/, "") || described?.[1] || pkg.version,
  ahead: process.env.NEXOTE_VERSION ? 0 : Number(described?.[2] ?? 0),
  commit: process.env.NEXOTE_COMMIT || described?.[3] || git("rev-parse", "--short", "HEAD"),
  time: new Date().toISOString(),
};

// Two builds from one source:
// - Standalone (default): the server build for Docker. Next serves the pages
//   and proxies /api/* to the Go backend.
// - `NEXOTE_EXPORT=1`: the Android app. A static export into `out/` that the
//   Go engine embeds and serves on 127.0.0.1 itself, including the deep-link
//   fallbacks and the /m redirects below (a static export can't have
//   rewrites or redirects).
// Routes only the server build has (they need a Next server: the service
// worker's asset list, invite links into a multi-account server) are named
// `*.standalone.ts(x)`; only the standalone build lists that extension in
// `pageExtensions`, so the export never sees them. The target is inlined as
// NEXOTE_BUILD_TARGET ("server" | "app", read in src/lib/app-info.ts).
const exportBuild = process.env.NEXOTE_EXPORT === "1";

/** @type {import('next').NextConfig} */
const shared = {
  // Tell Turbopack the workspace root so it stops warning about the two
  // pnpm-lock.yaml files (repo root + frontend/).
  turbopack: {
    root: new URL(".", import.meta.url).pathname,
  },
  // Disable response compression: the /api/events Server-Sent Events stream
  // must pass through uncompressed (small buffered gzip frames never reach the
  // browser's EventSource in time), and the app is a self-hosted LAN app where
  // gzip saves little anyway.
  compress: false,
  // Allow LAN access to the dev server (HMR/websocket) from the machine's
  // local IP and Tailscale IP so phones on the LAN can load the dev server.
  allowedDevOrigins: ["192.168.178.94", "100.64.0.26"],
  // Inlined into the client bundle at build time (src/lib/app-info.ts).
  env: {
    NEXOTE_BUILD_VERSION: build.version,
    NEXOTE_BUILD_AHEAD: String(build.ahead),
    NEXOTE_BUILD_COMMIT: build.commit,
    NEXOTE_BUILD_TIME: build.time,
    NEXOTE_BUILD_TARGET: exportBuild ? "app" : "server",
  },
};

/** @type {import('next').NextConfig} */
const appConfig = {
  ...shared,
  output: "export",
};

/** @type {import('next').NextConfig} */
const serverConfig = {
  ...shared,
  // Emit a self-contained server bundle (`.next/standalone`) so the app can
  // ship inside a single Docker container alongside the Go backend.
  output: "standalone",
  pageExtensions: ["standalone.tsx", "standalone.ts", "tsx", "ts", "jsx", "js"],
  // Proxy /api/* to the Go backend during development so the app and API
  // share an origin. In production the same routes can be served by a
  // reverse proxy in front of both processes.
  async rewrites() {
    const backend = process.env.NEXOTE_BACKEND_URL || "http://localhost:8080";
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
      // SPA deep-link routes — serve the same shell so the client can read the
      // URL via window.location and resolve the note client-side.
      { source: "/note/:vaultId/:noteId", destination: "/" },
      { source: "/journal/:noteId", destination: "/" },
      { source: "/dashboard", destination: "/" },
      // A pairing link (`/pair#CODE`, made for the Android app) opened in a
      // browser lands on the app instead of a 404; the code stays in the
      // fragment and never reaches the server.
      { source: "/pair", destination: "/" },
    ];
  },
  // The touch interface used to live under /m; both share one address now.
  // Old links and home-screen icons land on the same page without the prefix.
  async redirects() {
    return [
      { source: "/m", destination: "/", permanent: false },
      { source: "/m/:path*", destination: "/:path*", permanent: false },
    ];
  },
};

export default exportBuild ? appConfig : serverConfig;