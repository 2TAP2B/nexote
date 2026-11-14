// Product metadata for Settings › About. The version and build are inlined at
// build time by next.config.mjs (release tag + commit from git, or the Docker
// build args).

const repository = "https://github.com/2tap2b/nexote";

export const APP = {
  name: "Nexote",
  tagline: "Self-hosted Markdown notes",
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
