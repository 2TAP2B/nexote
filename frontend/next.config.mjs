/** @type {import('next').NextConfig} */
const nextConfig = {
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