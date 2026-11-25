// Product metadata for Settings › About. The version and build are inlined at
// build time by next.config.mjs (release tag + commit from git, or the Docker
// build args).

const repository = "https://github.com/2tap2b/nexote";

/** Which build this is (next.config.mjs): "server" = the self-hosted web
 *  app, "app" = the static export the Android app's local engine serves. */
export const BUILD_TARGET: "server" | "app" = process.env.NEXOTE_BUILD_TARGET === "app" ? "app" : "server";

/** The Android app's build: no service worker, no offline layer (the engine
 *  runs on the device), and the native bridge (lib/android-bridge.ts). */
export const isAndroidApp = BUILD_TARGET === "app";

export const APP = {
  name: "Nexote",
  tagline: isAndroidApp ? "Markdown notes on your phone" : "Self-hosted Markdown notes",
  version: process.env.NEXOTE_BUILD_VERSION ?? "",
  /** Commits after the release tag; above 0 means a development build. */
  commitsAhead: Number(process.env.NEXOTE_BUILD_AHEAD ?? "0"),
  commit: process.env.NEXOTE_BUILD_COMMIT ?? "",
  /** ISO timestamp of the build (dev server: when it started). */
  builtAt: process.env.NEXOTE_BUILD_TIME ?? "",
  links: {
    source: repository,
    releases: `${repository}/releases`,
    issues: `${repository}/issues/new`,
  },
} as const;
