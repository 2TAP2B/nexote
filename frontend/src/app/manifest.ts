import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nexote",
    short_name: "Nexote",
    description: "A markdown note-taking app powered by Milkdown.",
    id: "/",
    scope: "/",
    // Phones are sent on to /m by the start page; desktops stay on /.
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