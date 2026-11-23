// The dashboard's sections, their order and look (Settings › Dashboard).
// Desktop and touch dashboards differ (the desktop has a main and a side
// column, the phone one column), so each interface keeps its own layout.

export type DashShell = "desktop" | "touch";

export type DashSectionId =
  | "actions"
  | "recents"
  | "collections"
  | "calendar"
  | "shortcuts"
  | "bookmarks"
  | "tasks"
  | "tags"
  | "hotkeys";

/** One section in a layout: shown or not, and its compact or detailed look. */
export type DashSection = { id: DashSectionId; shown: boolean; compact: boolean };

type SectionInfo = {
  name: string;
  description: string;
  /** Offers a compact and a detailed look. */
  modes: boolean;
  /** Where the desktop puts it: the wide main column or the side column. */
  column: "main" | "side";
  /** Only on the desktop (keyboard shortcuts mean nothing on a phone). */
  desktopOnly?: boolean;
};

export const DASH_SECTIONS: Record<DashSectionId, SectionInfo> = {
  actions: { name: "Quick actions", description: "New note, today's journal and search.", modes: true, column: "main" },
  recents: { name: "Recently edited", description: "The notes you edited last.", modes: true, column: "main" },
  collections: { name: "Collections", description: "Collections shown on the dashboard.", modes: true, column: "main" },
  calendar: { name: "Calendar", description: "The journal's month; days with a note are marked.", modes: false, column: "side" },
  shortcuts: { name: "Shortcuts", description: "Notes you added to shortcuts.", modes: true, column: "side" },
  bookmarks: { name: "Bookmarks", description: "Bookmarked notes.", modes: true, column: "side" },
  tasks: { name: "Todo", description: "Open tasks from all notes.", modes: true, column: "side" },
  tags: { name: "Tags", description: "Tags with their note counts.", modes: true, column: "side" },
  hotkeys: { name: "Hotkeys", description: "The keyboard shortcuts.", modes: false, column: "side", desktopOnly: true },
};

const section = (id: DashSectionId, compact = false, shown = true): DashSection => ({ id, shown, compact });

// The layouts before any customizing: the dashboards as they always looked
// (the phone gets the calendar as an option, off).
const DEFAULTS: Record<DashShell, DashSection[]> = {
  desktop: [
    section("actions"),
    section("recents"),
    section("collections"),
    section("calendar"),
    section("shortcuts", true),
    section("bookmarks", true),
    section("tasks"),
    section("tags"),
    section("hotkeys"),
  ],
  touch: [
    section("actions"),
    section("shortcuts"),
    section("recents"),
    section("collections"),
    section("calendar", false, false),
    section("bookmarks"),
    section("tasks"),
    section("tags"),
  ],
};

export function defaultDashLayout(shell: DashShell): DashSection[] {
  return DEFAULTS[shell].map((s) => ({ ...s }));
}

const isSectionId = (v: unknown): v is DashSectionId => typeof v === "string" && v in DASH_SECTIONS;

function isSection(v: unknown): v is DashSection {
  if (typeof v !== "object" || v === null) return false;
  const o: Record<string, unknown> = { ...v };
  return isSectionId(o.id) && typeof o.shown === "boolean" && typeof o.compact === "boolean";
}

/**
 * The layout a dashboard renders: the stored one (anything malformed
 * skipped, each section once, none of another interface) with sections it
 * lacks — new ones from a later version — inserted where the default has
 * them. Nothing stored: the default.
 */
export function dashLayout(stored: unknown, shell: DashShell): DashSection[] {
  const fits = (id: DashSectionId) => shell === "desktop" || !DASH_SECTIONS[id].desktopOnly;
  if (!Array.isArray(stored)) return defaultDashLayout(shell);
  const seen = new Set<DashSectionId>();
  const layout: DashSection[] = [];
  for (const s of stored) {
    if (!isSection(s) || seen.has(s.id) || !fits(s.id)) continue;
    seen.add(s.id);
    layout.push({ id: s.id, shown: s.shown, compact: s.compact });
  }
  DEFAULTS[shell].forEach((d, i) => {
    if (seen.has(d.id)) return;
    // After the default's previous section that the layout has, else first.
    const before = DEFAULTS[shell].slice(0, i).reverse().find((p) => seen.has(p.id));
    const at = before ? layout.findIndex((s) => s.id === before.id) + 1 : 0;
    layout.splice(at, 0, { ...d });
    seen.add(d.id);
  });
  return layout;
}

/** Moves a section one step up (-1) or down (+1) among `peers` (its column on the desktop). */
export function moveSection(layout: DashSection[], id: DashSectionId, step: -1 | 1, peers: DashSectionId[]): DashSection[] {
  const order = peers.filter((p) => layout.some((s) => s.id === p));
  const at = order.indexOf(id);
  const swap = order[at + step];
  if (at < 0 || !swap) return layout;
  const i = layout.findIndex((s) => s.id === id);
  const j = layout.findIndex((s) => s.id === swap);
  const next = [...layout];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// The on/off switches of earlier versions (one per section, both interfaces).
const LEGACY_KEYS: Record<string, DashSectionId> = {
  dashActions: "actions",
  dashShortcuts: "shortcuts",
  dashRecents: "recents",
  dashCollections: "collections",
  dashBookmarks: "bookmarks",
  dashTasks: "tasks",
  dashTags: "tags",
};

/**
 * Stored settings from before layouts: the sections switched off become
 * hidden in both layouts. Null when there's nothing to carry over.
 */
export function migrateLegacyDashboard(stored: Record<string, unknown>): Record<DashShell, DashSection[]> | null {
  const hidden = Object.entries(LEGACY_KEYS)
    .filter(([key]) => stored[key] === false)
    .map(([, id]) => id);
  if (hidden.length === 0) return null;
  const apply = (shell: DashShell) => defaultDashLayout(shell).map((s) => (hidden.includes(s.id) ? { ...s, shown: false } : s));
  return { desktop: apply("desktop"), touch: apply("touch") };
}
