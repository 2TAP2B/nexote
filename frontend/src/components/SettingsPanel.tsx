"use client";

import {
  Bookmark,
  Database,
  FileText,
  Folder,
  FolderPlus,
  GitBranch,
  GraduationCap,
  Heart,
  Home,
  Info,
  Keyboard,
  Monitor,
  Moon,
  Music,
  Palette,
  PenLine,
  RefreshCw,
  Settings,
  Settings2,
  Shield,
  Star,
  Sun,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useNotes, formatTitle } from "@/lib/notes-context";
import { getIcon, ICON_OPTIONS as SHARED_ICON_OPTIONS } from "@/lib/icons";
import { api } from "@/lib/api";
import { isCollectionsVault } from "@/lib/api";
import type { CollectionMeta, GitConfig, MetadataConfig } from "@/lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  colorScheme?: string;
  onColorSchemeChange?: (scheme: string) => void;
};

type CategoryId = "appearance" | "vaults" | "editor" | "ai" | "sync" | "shortcuts" | "about";

const CATEGORIES: {
  id: CategoryId;
  label: string;
  icon: React.ReactNode;
}[] = [
  { id: "appearance", label: "Appearance", icon: <Palette className="h-4 w-4" /> },
  { id: "vaults", label: "Vaults", icon: <FolderPlus className="h-4 w-4" /> },
  { id: "editor", label: "Editor", icon: <PenLine className="h-4 w-4" /> },
  { id: "ai", label: "AI", icon: <Zap className="h-4 w-4" /> },
  { id: "sync", label: "Sync", icon: <GitBranch className="h-4 w-4" /> },
  { id: "shortcuts", label: "Shortcuts", icon: <Keyboard className="h-4 w-4" /> },
  { id: "about", label: "About", icon: <Info className="h-4 w-4" /> },
];

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: "Ctrl+Shift+N", desc: "Create a new note" },
  { keys: "Ctrl+S", desc: "Force-save the current note" },
  { keys: "Ctrl+P", desc: "Open the command palette" },
  { keys: "Ctrl+W", desc: "Close the active tab" },
  { keys: "Ctrl+Tab", desc: "Next tab" },
  { keys: "Ctrl+Shift+Tab", desc: "Previous tab" },
  { keys: "Ctrl+B / Ctrl+\\", desc: "Toggle the sidebar" },
  { keys: "Ctrl+D", desc: "Open today's daily note" },
  { keys: "Ctrl+Shift+D", desc: "Open the dashboard" },
  { keys: "Ctrl+Shift+F", desc: "Command palette (search)" },
];

export default function SettingsPanel({ open, onClose, colorScheme, onColorSchemeChange }: Props) {
  const {
    vaults,
    activeVault,
    switchVault,
    createVault,
    renameVault,
    deleteVault,
    setVaultIcon,
    settings,
    updateSettings,
    gitConfig,
    gitStatus,
    refreshGitConfig,
    saveGitConfig,
    gitInit,
    refreshGitStatus,
    gitPush,
    gitPull,
  } = useNotes();
  const { theme, setTheme } = useTheme();
  const [activeCategory, setActiveCategory] = useState<CategoryId>("appearance");
  const [newVaultName, setNewVaultName] = useState("");
  const [newVaultIcon, setNewVaultIcon] = useState("Database");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [mounted, setMounted] = useState(false);
  const [aiTestState, setAiTestState] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [aiTestMessage, setAiTestMessage] = useState("");
  const [gitBusy, setGitBusy] = useState(false);
  const [gitMsg, setGitMsg] = useState("");
  const [collections, setCollections] = useState<CollectionMeta[]>([]);
  // Local draft for the git config — inputs write here instantly (typing
  // works), the change is persisted to the backend on blur. Re-synced from
  // the provider whenever the panel opens or the remote config changes.
  const [gitDraft, setGitDraft] = useState<GitConfig | null>(null);
  // Metadata (Discogs) config draft — same draft pattern as the git config.
  const [metadataDraft, setMetadataDraft] = useState<MetadataConfig>({ discogsToken: "" });
  const [mdConfig, setMdConfig] = useState<MetadataConfig>({ discogsToken: "" });
  const [mdTestState, setMdTestState] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [mdTestMessage, setMdTestMessage] = useState("");
  const setDraftField = (patch: Partial<GitConfig>) => {
    setGitDraft((d) => (d ? { ...d, ...patch } : d));
  };

  // Hydrate the draft when the panel opens or the remote config arrives.
  useEffect(() => {
    if (gitConfig) setGitDraft(gitConfig);
  }, [gitConfig]);

  // Load collections for the visibility toggles when the panel opens.
  useEffect(() => {
    if (!open) return;
    void api.listCollections().then((res) => setCollections(res.collections ?? []));
  }, [open]);

  // Load the metadata (Discogs) config when the panel opens.
  useEffect(() => {
    if (!open) return;
    void api
      .getMetadataConfig()
      .then((cfg) => {
        setMdConfig(cfg);
        setMetadataDraft(cfg);
      })
      .catch(() => {});
  }, [open]);

  // Verify the Discogs token against the Discogs API (via a search probe).
  const handleTestDiscogs = async () => {
    setMdTestState("testing");
    setMdTestMessage("");
    try {
      // Save the draft first so the backend probe uses the entered token.
      await api.setMetadataConfig(metadataDraft);
      setMdConfig(metadataDraft);
      const res = await fetch(
        "/api/metadata/discogs/search?q=test",
        { cache: "no-store" },
      );
      if (res.ok) {
        setMdTestState("ok");
        setMdTestMessage("Token works");
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setMdTestState("error");
        setMdTestMessage(body?.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setMdTestState("error");
      setMdTestMessage(err instanceof Error ? err.message : "Test failed");
    }
  };

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setNewVaultName("");
      setRenamingId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const handleCreate = async () => {
    const name = newVaultName.trim();
    if (!name) return;
    await createVault(name, newVaultIcon);
    setNewVaultName("");
    setNewVaultIcon("Database");
  };

  const handleTestAI = async () => {
    setAiTestState("testing");
    setAiTestMessage("");
    try {
      const result = await api.testAI({
        baseUrl: settings.aiBaseUrl,
        apiKey: settings.aiApiKey,
        model: settings.aiModel,
      });
      if (result.ok) {
        setAiTestState("ok");
        setAiTestMessage("Connection successful");
      } else {
        setAiTestState("error");
        setAiTestMessage(result.error ?? "Connection failed");
      }
    } catch (err) {
      setAiTestState("error");
      setAiTestMessage(err instanceof Error ? err.message : "Connection failed");
    }
  };

  const handleRename = async (id: string) => {
    const name = renameValue.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    await renameVault(id, name);
    setRenamingId(null);
  };

  const resolvedTheme = mounted ? (theme ?? "system") : "system";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[8vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="nexote-settings-dialog flex h-[84vh] w-[768px] max-w-none flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <Settings size={16} className="text-muted-foreground" />
          <span className="flex-1 text-sm font-medium text-foreground">
            Settings
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground rounded-md hover:bg-muted"
          >
            <X size={16} />
          </button>
        </div>

        <div className="nexote-settings-body flex min-h-0 flex-1">
          {/* Category sidebar */}
          <nav
            className="nexote-settings-nav flex w-48 shrink-0 flex-col gap-1 border-r border-border p-2"
            aria-label="Settings categories"
          >
            {CATEGORIES.map((cat) => {
              const active = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  data-settings-cat={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors"
                  style={
                    active
                      ? { background: "var(--primary)", color: "var(--primary-foreground)" }
                      : { color: "var(--foreground)" }
                  }
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span className="shrink-0">{cat.icon}</span>
                  <span className="truncate">{cat.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Content pane */}
          <div className="nexote-settings-content min-w-0 flex-1 overflow-y-auto">
            {activeCategory === "appearance" && (
              <AppearanceSection
                theme={resolvedTheme}
                onThemeChange={setTheme}
                colorScheme={colorScheme}
                onColorSchemeChange={onColorSchemeChange}
              />
            )}

            {activeCategory === "vaults" && (
              <div className="flex flex-col gap-3 p-4">
                <SectionHeader icon={<FolderPlus className="h-4 w-4" />} title="Vaults" />

                {/* Collection visibility */}
                <div className="flex flex-col gap-1 rounded-lg border border-border p-2">
                  <div className="px-1 py-1 text-xs font-medium text-muted-foreground">
                    Collections — hide a collection to remove it from the app
                    without deleting its notes.
                  </div>
                  {collections.length === 0 && (
                    <div className="px-1 py-1 text-xs text-muted-foreground/70">
                      No collections.
                    </div>
                  )}
                  {collections.map((col) => (
                    <div
                      key={col.id}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50"
                    >
                      <span className="text-sm text-foreground">
                        {col.name}
                        {col.builtIn && (
                          <span className="ml-2 text-xs text-muted-foreground">built-in</span>
                        )}
                      </span>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={!col.hidden}
                          onChange={(e) => {
                            const hidden = !e.target.checked;
                            void api
                              .setCollectionHidden(col.id, hidden)
                              .then(() => void api.listCollections().then((res) => setCollections(res.collections ?? [])))
                              .catch(() => {});
                          }}
                          className="h-4 w-4"
                        />
                        {col.hidden ? "hidden" : "visible"}
                      </label>
                    </div>
                  ))}
                </div>

                {/* Vault list — the system Collections vault is hidden; it is
                    managed automatically via the Collections view. */}
                <div className="flex flex-col gap-1">
                  {vaults.filter((v) => !isCollectionsVault(v)).map((vault) => (
                    <div
                      key={vault.id}
                      className={[
                        "flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors",
                        vault.id === activeVault?.id
                          ? "border-primary/40 bg-primary/10"
                          : "border-border hover:bg-muted/50",
                      ].join(" ")}
                    >
                      <IconPicker
                        value={vault.icon ?? "Database"}
                        onChange={(icon) => void setVaultIcon(vault.id, icon)}
                      />
                      {renamingId === vault.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleRename(vault.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          onBlur={() => void handleRename(vault.id)}
                          className="min-w-0 flex-1 rounded border border-ring bg-background px-2 py-1 text-sm text-foreground outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => switchVault(vault.id)}
                          onDoubleClick={() => {
                            setRenamingId(vault.id);
                            setRenameValue(vault.name);
                          }}
                          className="min-w-0 flex-1 text-left text-sm text-foreground"
                        >
                          {vault.name}
                          {vault.id === activeVault?.id && (
                            <span className="ml-2 text-xs text-primary">active</span>
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label="Rename vault"
                        title="Rename vault"
                        onClick={() => {
                          setRenamingId(vault.id);
                          setRenameValue(vault.name);
                        }}
                        className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
                      >
                        Rename
                      </button>
                      {vault.name !== "Default" && (
                        <button
                          type="button"
                          aria-label="Delete vault"
                          title="Delete vault"
                          onClick={() => {
                            if (
                              confirm(
                                `Delete vault "${vault.name}" and all its notes?`,
                              )
                            )
                              void deleteVault(vault.id);
                          }}
                          className="shrink-0 rounded p-1 text-muted-foreground hover:text-red-500 hover:bg-muted"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Create new vault */}
                <div className="flex items-center gap-2">
                  <IconPicker
                    value={newVaultIcon}
                    onChange={setNewVaultIcon}
                  />
                  <input
                    value={newVaultName}
                    onChange={(e) => setNewVaultName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleCreate();
                    }}
                    placeholder="New vault name…"
                    className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/40"
                  />
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={!newVaultName.trim()}
                    className="shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>

                <div className="text-xs text-muted-foreground/70">
                  Double-click a vault name to rename. Click to switch active vault.
                </div>
              </div>
            )}

            {activeCategory === "editor" && (
              <div className="flex flex-col gap-3 p-4">
                <SectionHeader icon={<PenLine className="h-4 w-4" />} title="Editor" />

                {/* Autosave */}
                <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 hover:bg-muted/50">
                  <span className="flex flex-col">
                    <span className="text-sm text-foreground">Autosave</span>
                    <span className="text-xs text-muted-foreground">
                      Automatically save while typing
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.autosave}
                    onChange={(e) => updateSettings({ autosave: e.target.checked })}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                </label>

                {/* New-note title template */}
                <div className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2 hover:bg-muted/50">
                  <span className="text-sm text-foreground">New-note title template</span>
                  <span className="text-xs text-muted-foreground">
                    Used when creating a new note. Supports date/time tokens
                    that are replaced with the current value.
                  </span>
                  <input
                    value={settings.titleTemplate}
                    onChange={(e) => updateSettings({ titleTemplate: e.target.value })}
                    placeholder="DAY DD-MM-YYYY HH:mm"
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/40"
                  />
                  <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                    {[
                      ["DAY", "Weekday (Monday)"],
                      ["DDD", "Mon"],
                      ["DD", "Day (12)"],
                      ["MM", "Month (08)"],
                      ["MMM", "Aug"],
                      ["YYYY", "Year (2025)"],
                      ["YY", "Year (25)"],
                      ["HH", "Hour 24h (14)"],
                      ["mm", "Min (30)"],
                    ].map(([token, desc]) => (
                      <span
                        key={token}
                        className="rounded border border-border px-1 py-0.5"
                        title={desc}
                      >
                        {token} <span className="text-muted-foreground/60">{desc}</span>
                      </span>
                    ))}
                  </div>
                  <div className="mt-1.5 text-xs">
                    <span className="text-muted-foreground">Preview: </span>
                    <span className="font-medium text-foreground">
                      {formatTitle(settings.titleTemplate) || "Untitled"}
                    </span>
                  </div>
                </div>

                {/* Editor font size */}
                <div className="rounded-lg border border-border px-3 py-2 hover:bg-muted/50">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-foreground">Editor font size</span>
                    <span className="text-xs text-muted-foreground">
                      {settings.editorFontSize}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={12}
                    max={24}
                    step={1}
                    value={settings.editorFontSize}
                    onChange={(e) =>
                      updateSettings({ editorFontSize: Number(e.target.value) })
                    }
                    className="mt-2 w-full accent-[var(--primary)]"
                  />
                </div>
              </div>
            )}

            {activeCategory === "ai" && (
              <div className="flex flex-col gap-3 p-4">
                <SectionHeader icon={<Zap className="h-4 w-4" />} title="AI" />

                <div className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                  Connect any OpenAI-compatible API (OpenAI, OpenRouter, Ollama,
                  LM Studio…) to power the editor AI button. When no base URL is
                  set the AI button is hidden.
                </div>

                {/* Base URL */}
                <label className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2 hover:bg-muted/50">
                  <span className="text-sm text-foreground">API base URL</span>
                  <span className="text-xs text-muted-foreground">
                    e.g. https://api.openai.com/v1 or http://localhost:11434/v1
                  </span>
                  <input
                    value={settings.aiBaseUrl}
                    onChange={(e) => updateSettings({ aiBaseUrl: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/40"
                  />
                </label>

                {/* API key */}
                <label className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2 hover:bg-muted/50">
                  <span className="text-sm text-foreground">API key</span>
                  <span className="text-xs text-muted-foreground">
                    Optional for local servers like Ollama
                  </span>
                  <input
                    type="password"
                    value={settings.aiApiKey}
                    onChange={(e) => updateSettings({ aiApiKey: e.target.value })}
                    placeholder="sk-…"
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/40"
                  />
                </label>

                {/* Model */}
                <label className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2 hover:bg-muted/50">
                  <span className="text-sm text-foreground">Model</span>
                  <span className="text-xs text-muted-foreground">
                    e.g. gpt-4o-mini, claude-sonnet-4, llama3.2
                  </span>
                  <input
                    value={settings.aiModel}
                    onChange={(e) => updateSettings({ aiModel: e.target.value })}
                    placeholder="gpt-4o-mini"
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/40"
                  />
                </label>

                {/* Test connection */}
                <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                  <button
                    type="button"
                    onClick={() => void handleTestAI()}
                    disabled={aiTestState === "testing" || !settings.aiBaseUrl.trim()}
                    className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {aiTestState === "testing" ? "Testing…" : "Test connection"}
                  </button>
                  {aiTestMessage && (
                    <span
                      className={`text-xs ${
                        aiTestState === "ok" ? "text-green-500" : "text-red-500"
                      }`}
                    >
                      {aiTestMessage}
                    </span>
                  )}
                </div>

                {/* Metadata lookups (Discogs / Google Books) */}
                <div className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                  Keys for collection item lookups, stored server-side only.
                  Free Discogs token: dev.discogs.com. Google Books works
                  key-less but rate-limits hard (HTTP 429) — a free API key
                  raises the quota: console.cloud.google.com → enable "Books
                  API" → create an API key.
                </div>
                <label className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2 hover:bg-muted/50">
                  <span className="text-sm text-foreground">Discogs token</span>
                  <span className="text-xs text-muted-foreground">
                    e.g. aBc123XyZ… (personal access token)
                  </span>
                  <input
                    type="password"
                    value={metadataDraft.discogsToken}
                    onChange={(e) =>
                      setMetadataDraft((d) => ({ ...d, discogsToken: e.target.value }))
                    }
                    onBlur={() =>
                      metadataDraft !== mdConfig &&
                      void api
                        .setMetadataConfig(metadataDraft)
                        .then((cfg) => {
                          setMdConfig(cfg);
                          setMetadataDraft(cfg);
                        })
                        .catch(() => {})
                    }
                    placeholder="Personal access token"
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/40"
                  />
                </label>
                <label className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2 hover:bg-muted/50">
                  <span className="text-sm text-foreground">
                    Google Books <span className="font-mono">API key</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    optional — avoids "429 Too Many Requests" when searching
                    books
                  </span>
                  <input
                    type="password"
                    value={metadataDraft.googleBooksKey ?? ""}
                    onChange={(e) =>
                      setMetadataDraft((d) => ({ ...d, googleBooksKey: e.target.value }))
                    }
                    onBlur={() =>
                      metadataDraft !== mdConfig &&
                      void api
                        .setMetadataConfig(metadataDraft)
                        .then((cfg) => {
                          setMdConfig(cfg);
                          setMetadataDraft(cfg);
                        })
                        .catch(() => {})
                    }
                    placeholder="AIza…"
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/40"
                  />
                </label>
                <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                  <button
                    type="button"
                    onClick={() => void handleTestDiscogs()}
                    disabled={mdTestState === "testing" || !metadataDraft.discogsToken.trim()}
                    className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {mdTestState === "testing" ? "Testing…" : "Test token"}
                  </button>
                  {mdTestMessage && (
                    <span
                      className={`text-xs ${
                        mdTestState === "ok" ? "text-green-500" : "text-red-500"
                      }`}
                    >
                      {mdTestMessage}
                    </span>
                  )}
                </div>
              </div>
            )}

            {activeCategory === "shortcuts" && (
              <div className="flex flex-col gap-3 p-4">
                <SectionHeader icon={<Keyboard className="h-4 w-4" />} title="Shortcuts" />
                <ul className="flex flex-col gap-1">
                  {SHORTCUTS.map((s) => (
                    <li
                      key={s.keys}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                    >
                      <span className="text-sm text-foreground">{s.desc}</span>
                      <kbd
                        className="shrink-0 rounded px-1.5 py-0.5 text-xs"
                        style={{
                          border: "1px solid var(--border)",
                          color: "var(--muted-foreground)",
                        }}
                      >
                        {s.keys}
                      </kbd>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {activeCategory === "sync" && (
              <div className="flex flex-col gap-3 p-4">
                <SectionHeader icon={<GitBranch className="h-4 w-4" />} title="Git Sync" />

                {!gitDraft ? (
                  <div className="text-sm text-muted-foreground">Loading…</div>
                ) : (
                  <>
                    {/* Enable toggle — persists immediately */}
                    <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                      <div>
                        <div className="text-sm font-medium text-foreground">Enable Git Sync</div>
                        <div className="text-xs text-muted-foreground">Auto-commit changes and optionally push to a remote</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={gitDraft.enabled}
                        onChange={async (e) => {
                          const next = { ...gitDraft, enabled: e.target.checked };
                          setGitDraft(next);
                          setGitMsg("");
                          try {
                            await saveGitConfig(next);
                            await refreshGitStatus();
                          } catch (err) {
                            setGitMsg(err instanceof Error ? err.message : "Save failed");
                          }
                        }}
                        className="h-4 w-4"
                      />
                    </label>

                    {gitDraft.enabled && (
                      <>
                        <label className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
                          <span className="text-sm text-foreground">Remote URL</span>
                          <span className="text-xs text-muted-foreground">e.g. https://github.com/user/repo.git</span>
                          <input
                            type="text"
                            value={gitDraft.remote}
                            onChange={(e) => setDraftField({ remote: e.target.value })}
                            onBlur={() => gitDraft !== gitConfig && void saveGitConfig(gitDraft).catch(() => {})}
                            placeholder="https://github.com/user/repo.git"
                            className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/40"
                          />
                        </label>
                        <label className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
                          <span className="text-sm text-foreground">Branch</span>
                          <span className="text-xs text-muted-foreground">Default: main</span>
                          <input
                            type="text"
                            value={gitDraft.branch}
                            onChange={(e) => setDraftField({ branch: e.target.value })}
                            onBlur={() => gitDraft !== gitConfig && void saveGitConfig(gitDraft).catch(() => {})}
                            placeholder="main"
                            className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/40"
                          />
                        </label>
                        <div className="flex gap-3">
                          <label className="flex flex-1 flex-col gap-1 rounded-lg border border-border px-3 py-2">
                            <span className="text-sm text-foreground">Author name</span>
                            <input
                              type="text"
                              value={gitDraft.authorName}
                              onChange={(e) => setDraftField({ authorName: e.target.value })}
                              onBlur={() => gitDraft !== gitConfig && void saveGitConfig(gitDraft).catch(() => {})}
                              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/40"
                            />
                          </label>
                          <label className="flex flex-1 flex-col gap-1 rounded-lg border border-border px-3 py-2">
                            <span className="text-sm text-foreground">Author email</span>
                            <input
                              type="text"
                              value={gitDraft.authorEmail}
                              onChange={(e) => setDraftField({ authorEmail: e.target.value })}
                              onBlur={() => gitDraft !== gitConfig && void saveGitConfig(gitDraft).catch(() => {})}
                              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/40"
                            />
                          </label>
                        </div>

                        {/* Toggles — persist immediately */}
                        <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                          <span className="text-sm text-foreground">Include images in sync</span>
                          <input
                            type="checkbox"
                            checked={gitDraft.includeImages}
                            onChange={async (e) => {
                              const next = { ...gitDraft, includeImages: e.target.checked };
                              setGitDraft(next);
                              try {
                                await saveGitConfig(next);
                              } catch (err) {
                                setGitMsg(err instanceof Error ? err.message : "Save failed");
                              }
                            }}
                            className="h-4 w-4"
                          />
                        </label>
                        <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                          <span className="text-sm text-foreground">Auto-push after each commit</span>
                          <input
                            type="checkbox"
                            checked={gitDraft.autoPush}
                            onChange={async (e) => {
                              const next = { ...gitDraft, autoPush: e.target.checked };
                              setGitDraft(next);
                              try {
                                await saveGitConfig(next);
                              } catch (err) {
                                setGitMsg(err instanceof Error ? err.message : "Save failed");
                              }
                            }}
                            className="h-4 w-4"
                          />
                        </label>

                        {/* Credentials — stored in git.json so manual pushes,
                            the debounced auto-push and the timed auto-sync
                            can all authenticate without re-entering them.
                            Persisted on blur like the other draft fields. */}
                        <div className="rounded-lg border border-border px-3 py-2.5">
                          <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                            Credentials (stored server-side — for HTTPS remotes)
                          </div>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={gitDraft.username ?? ""}
                              onChange={(e) => setDraftField({ username: e.target.value })}
                              onBlur={() => {
                                const d = gitDraft;
                                if (d && d !== gitConfig) void saveGitConfig(d).catch(() => {});
                              }}
                              placeholder="Username / token name"
                              className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/40"
                            />
                            <input
                              type="password"
                              value={gitDraft.password ?? ""}
                              onChange={(e) => setDraftField({ password: e.target.value })}
                              onBlur={() => {
                                const d = gitDraft;
                                if (d && d !== gitConfig) void saveGitConfig(d).catch(() => {});
                              }}
                              placeholder="Password / token"
                              className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/40"
                            />
                          </div>
                        </div>

                        {/* Timed auto-sync interval */}
                        <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                          <span className="text-sm text-foreground">Auto-sync every</span>
                          <select
                            value={gitDraft.autoSyncMinutes ?? 0}
                            onChange={async (e) => {
                              const next = { ...gitDraft, autoSyncMinutes: Number(e.target.value) };
                              setGitDraft(next);
                              try {
                                await saveGitConfig(next);
                              } catch (err) {
                                setGitMsg(err instanceof Error ? err.message : "Save failed");
                              }
                            }}
                            className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                          >
                            <option value={0}>Off</option>
                            <option value={1}>1 minute</option>
                            <option value={3}>3 minutes</option>
                            <option value={5}>5 minutes</option>
                            <option value={10}>10 minutes</option>
                          </select>
                        </label>

                        {/* Readable file names in git */}
                        <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                          <span className="flex flex-col">
                            <span className="text-sm text-foreground">Readable file names in git</span>
                            <span className="text-xs text-muted-foreground">
                              Commit a mirror with real vault/folder/note names instead of internal ids
                            </span>
                          </span>
                          <input
                            type="checkbox"
                            checked={gitDraft.readableNames ?? false}
                            onChange={async (e) => {
                              const next = { ...gitDraft, readableNames: e.target.checked };
                              setGitDraft(next);
                              try {
                                await saveGitConfig(next);
                              } catch (err) {
                                setGitMsg(err instanceof Error ? err.message : "Save failed");
                              }
                            }}
                            className="h-4 w-4"
                          />
                        </label>

                        {/* Actions */}
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={gitBusy}
                            onClick={async () => {
                              setGitBusy(true);
                              setGitMsg("");
                              try {
                                await gitInit();
                                await refreshGitStatus();
                                setGitMsg("Repository initialized.");
                              } catch (e) {
                                setGitMsg(e instanceof Error ? e.message : "Init failed");
                              }
                              setGitBusy(false);
                            }}
                            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted/50"
                          >
                            Init repo
                          </button>
                          <button
                            type="button"
                            disabled={gitBusy}
                            onClick={async () => {
                              setGitBusy(true);
                              setGitMsg("");
                              try {
                                await gitPush(gitDraft?.username ? { username: gitDraft.username, password: gitDraft.password ?? "" } : undefined);
                                setGitMsg("Pushed.");
                              } catch (e) {
                                setGitMsg(e instanceof Error ? e.message : "Push failed");
                              }
                              setGitBusy(false);
                            }}
                            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted/50"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Push
                          </button>
                          <button
                            type="button"
                            disabled={gitBusy}
                            onClick={async () => {
                              setGitBusy(true);
                              setGitMsg("");
                              try {
                                await gitPull(gitDraft?.username ? { username: gitDraft.username, password: gitDraft.password ?? "" } : undefined);
                                setGitMsg("Pulled.");
                              } catch (e) {
                                setGitMsg(e instanceof Error ? e.message : "Pull failed");
                              }
                              setGitBusy(false);
                            }}
                            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted/50"
                          >
                            <RefreshCw className="h-3.5 w-3.5 rotate-180" />
                            Pull
                          </button>
                          <button
                            type="button"
                            onClick={() => void refreshGitStatus()}
                            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted/50"
                          >
                            Refresh status
                          </button>
                        </div>

                        {/* Status */}
                        {gitStatus && (
                          <div className="rounded-lg border border-border px-3 py-2.5 text-sm">
                            {gitStatus.hasRepo ? (
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">Status</span>
                                  <span className="text-foreground">
                                    {gitStatus.clean ? "Clean" : `${gitStatus.dirtyFiles} uncommitted change${gitStatus.dirtyFiles === 1 ? "" : "s"}`}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">Branch</span>
                                  <span className="text-foreground">{gitStatus.branch}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">Remote</span>
                                  <span className="text-foreground truncate ml-2">{gitStatus.remote || "none"}</span>
                                </div>
                                {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
                                  <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Sync</span>
                                    <span className="text-foreground">
                                      {gitStatus.ahead > 0 && `${gitStatus.ahead} ahead`}
                                      {gitStatus.ahead > 0 && gitStatus.behind > 0 && " · "}
                                      {gitStatus.behind > 0 && `${gitStatus.behind} behind`}
                                    </span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-muted-foreground">
                                No repository yet. Click "Init repo" to create one.
                              </div>
                            )}
                          </div>
                        )}

                        {gitMsg && (
                          <div
                            className="text-xs"
                            style={{ color: /failed|error/i.test(gitMsg) ? "#f87171" : "var(--muted-foreground)" }}
                          >
                            {gitMsg}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {activeCategory === "about" && (
              <div className="flex flex-col gap-3 p-4">
                <SectionHeader icon={<Info className="h-4 w-4" />} title="About" />
                <div className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">App</span>
                    <span className="text-foreground">Nexote</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Data location</span>
                    <span className="text-foreground">~/.nexote</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Vaults directory</span>
                    <span className="text-foreground">~/.nexote/vaults</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
    </div>
  );
}

function AppearanceSection({
  theme,
  onThemeChange,
  colorScheme,
  onColorSchemeChange,
}: {
  theme: string;
  onThemeChange: (t: "light" | "dark" | "system") => void;
  colorScheme?: string;
  onColorSchemeChange?: (scheme: string) => void;
}) {
  const options = [
    { value: "light", label: "Light", icon: <Sun className="h-4 w-4" /> },
    { value: "dark", label: "Dark", icon: <Moon className="h-4 w-4" /> },
    { value: "system", label: "System", icon: <Monitor className="h-4 w-4" /> },
  ] as const;

  const schemes = [
    { value: "default", label: "Default", swatch: "#7c3aed" },
    { value: "nord", label: "Nord", swatch: "#5e81ac" },
    { value: "catppuccin-frappe", label: "Catppuccin Frappé", swatch: "#ca9ee6" },
    { value: "catppuccin-macchiato", label: "Catppuccin Macchiato", swatch: "#c6a0f6" },
    { value: "catppuccin-mocha", label: "Catppuccin Mocha", swatch: "#cba6f7" },
    { value: "dracula", label: "Dracula", swatch: "#bd93f9" },
    { value: "gruvbox", label: "Gruvbox", swatch: "#83a598" },
    { value: "pastel-dreams", label: "Pastel Dreams", swatch: "#c0aafd" },
    { value: "amethyst-haze", label: "Amethyst Haze", swatch: "#a995c9" },
  ] as const;

  return (
    <div className="flex flex-col gap-3 p-4">
      <SectionHeader icon={<Palette className="h-4 w-4" />} title="Appearance" />

      {/* Color scheme */}
      <div className="flex flex-col gap-1">
        <span className="text-sm text-foreground">Color scheme</span>
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-border p-1">
          {schemes.map((opt) => {
            const active = (colorScheme ?? "default") === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onColorSchemeChange?.(opt.value)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors"
                style={
                  active
                    ? { background: "var(--primary)", color: "var(--primary-foreground)" }
                    : { color: "var(--foreground)" }
                }
              >
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-full border border-border"
                  style={{ background: active ? "var(--background)" : opt.swatch }}
                />
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Theme (light / dark / system) */}
      <div className="flex flex-col gap-1">
        <span className="text-sm text-foreground">Mode</span>
        <div className="flex gap-1 rounded-lg border border-border p-1">
          {options.map((opt) => {
            const active = theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onThemeChange(opt.value)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors"
                style={
                  active
                    ? { background: "var(--primary)", color: "var(--primary-foreground)" }
                    : { color: "var(--foreground)" }
                }
              >
                {opt.icon}
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const ICON_OPTIONS = SHARED_ICON_OPTIONS;function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (icon: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const CurrentIcon = getIcon(value, Database);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const popW = 4 * 36 + 3 * 4 + 16; // 4 cols * 36px + gaps + padding
    const popH = 3 * 36 + 2 * 4 + 28; // 3 rows * 36px + gaps + header
    const left = Math.min(r.left, window.innerWidth - popW - 8);
    const top = r.bottom + 4 + popH > window.innerHeight ? r.top - popH - 4 : r.bottom + 4;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:bg-muted"
        title="Pick icon"
      >
        <CurrentIcon size={16} />
      </button>
      {open && pos && (
        <div
          ref={popRef}
          className="fixed z-[60] w-[336px] max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-background p-2 shadow-xl"
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="grid grid-cols-8 gap-1">
            {ICON_OPTIONS.map(({ name, icon: Icon }) => (
              <button
                key={name}
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded hover:bg-muted"
                title={name}
                onClick={() => {
                  onChange(name);
                  setOpen(false);
                }}
              >
                <Icon
                  size={18}
                  className={
                    name === value ? "text-primary" : "text-muted-foreground"
                  }
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
