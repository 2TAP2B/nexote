import { readdir } from "node:fs/promises";
import path from "node:path";

// Every file of the running build under /_next/static (scripts, styles,
// fonts), for the service worker to cache at install: lazily loaded parts
// like the editor must be on the device before the first offline launch.
// Read from disk at runtime: `next start` and the standalone server both
// serve .next/static relative to the working directory.

export const dynamic = "force-dynamic";

let assets: Promise<string[]> | null = null;

async function list(): Promise<string[]> {
  const root = path.join(process.cwd(), ".next", "static");
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && !e.name.endsWith(".map"))
    .map((e) => "/_next/static/" + path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join("/"));
}

export async function GET() {
  assets ??= list().catch(() => {
    assets = null;
    return [];
  });
  return Response.json({ assets: await assets }, { headers: { "Cache-Control": "no-store" } });
}
