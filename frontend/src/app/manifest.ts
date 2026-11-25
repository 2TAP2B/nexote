import type { MetadataRoute } from "next";

// Already prerendered in the server build; the static export (Android app)
// requires saying so.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nexote",
    short_name: "Nexote",
    description: "A markdown note-taking app powered by Milkdown.",
    id: "/",
    scope: "/",
    // One address for every device; the start page picks touch or desktop.
    start_url: "/",
    display: "standalone",
    background_color: "#1a1d29",
    theme_color: "#1a1d29",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}