/** @type {import('next').NextConfig} */
const nextConfig = {
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
  // local IP and Tailscale IP so mobile devices can load /m.
  allowedDevOrigins: ["192.168.178.94", "100.64.0.26"],
  // Emit a self-contained server bundle (`.next/standalone`) so the app can
  // ship inside a single Docker container alongside the Go backend.
  output: "standalone",
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
      { source: "/m/note/:vaultId/:noteId", destination: "/m" },
      { source: "/m/journal/:noteId", destination: "/m" },
      { source: "/m/dashboard", destination: "/m" },
    ];
  },
};

export default nextConfig;