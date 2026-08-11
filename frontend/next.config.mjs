/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tell Turbopack the workspace root so it stops warning about the two
  // pnpm-lock.yaml files (repo root + frontend/).
  turbopack: {
    root: new URL(".", import.meta.url).pathname,
  },
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
    ];
  },
};

export default nextConfig;