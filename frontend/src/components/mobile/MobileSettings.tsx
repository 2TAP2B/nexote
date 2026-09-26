"use client";

import {
  ChevronRight,
  Database,
  FileText,
  Folder,
  FolderPlus,
  GitBranch,
  Heart,
  Home,
  Info,
  Monitor,
  Moon,
  Music,
  Palette,
  PenLine,
  Plus,
  Shield,
  Sun,
  Trash2,
  Zap,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { formatTitle, useNotes } from "@/lib/notes-context";
import { getIcon, ICON_OPTIONS as SHARED_ICON_OPTIONS } from "@/lib/icons";
import { api, isCollectionsVault } from "@/lib/api";
import type { CollectionMeta, GitConfig, GitStatusInfo, MetadataConfig } from "@/lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  colorScheme: string;
  onColorSchemeChange: (scheme: string) => void;
};

type Page = "root" | "appearance" | "vaults" | "editor" | "ai" | "sync" | "about";

const SCHEMES = [
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

const ICON_OPTIONS = SHARED_ICON_OPTIONS;

export default function MobileSettings({
  open,
  onClose,
  colorScheme,
  onColorSchemeChange,
}: Props) {
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
    saveGitConfig,
    gitInit,
    refreshGitStatus,
    gitPush,
    gitPull,
  } = useNotes();
  const { theme, setTheme } = useTheme();
  const [page, setPage] = useState<Page>("root");
  const [mounted, setMounted] = useState(false);
  const [newVaultName, setNewVaultName] = useState("");
  const [newVaultIcon, setNewVaultIcon] = useState("Database");  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [aiTestState, setAiTestState] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [aiTestMessage, setAiTestMessage] = useState("");
  const [gitBusy, setGitBusy] = useState(false);
  const [gitMsg, setGitMsg] = useState("");

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) {
      setPage("root");
      setNewVaultName("");
      setRenamingId(null);
    }
  }, [open]);

  if (!open) return null;

  const resolvedTheme = mounted ? (theme ?? "system") : "system";

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

  // Run a git action with busy state + a status message on success/failure.
  const runGit = async (action: () => Promise<void>, okMsg: string) => {
    setGitBusy(true);
    setGitMsg("");
    try {
      await action();
      setGitMsg(okMsg);
    } catch (err) {
      setGitMsg(err instanceof Error ? err.message : "Git operation failed");
    }
    setGitBusy(false);
  };

  const pageTitle: Record<Page, string> = {
    root: "Settings",
    appearance: "Appearance",
    vaults: "Vaults",
    editor: "Editor",
    ai: "AI",
    sync: "Git Sync",
    about: "About",
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: "var(--mob-bg)" }}
    >
      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between px-3"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
          paddingBottom: 12,
          borderBottom: "1px solid color-mix(in oklab, var(--mob-muted) 20%, transparent)",
        }}
      >
        {page !== "root" ? (
          <CircleBtn onClick={() => setPage("root")}>
            <ChevronRight size={22} style={{ transform: "rotate(180deg)" }} />
          </CircleBtn>
        ) : (
          <span style={{ width: 40 }} />
        )}
        <span
          className="text-lg font-semibold"
          style={{ color: "var(--mob-text)" }}
        >
          {pageTitle[page]}
        </span>
        <CircleBtn onClick={onClose}>
          <span style={{ fontSize: 22, lineHeight: 1 }}>×</span>
        </CircleBtn>
      </div>

      {/* Body */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ color: "var(--mob-text)" }}
      >
        {page === "root" && (
          <RootPage onNavigate={setPage} resolvedTheme={resolvedTheme} colorScheme={colorScheme} />
        )}
        {page === "appearance" && (
          <AppearancePage
            resolvedTheme={resolvedTheme}
            onThemeChange={setTheme}
            colorScheme={colorScheme}
            onColorSchemeChange={onColorSchemeChange}
          />
        )}
        {page === "vaults" && (
          <VaultsPage
            vaults={vaults}
            activeVault={activeVault}
            switchVault={switchVault}
            setVaultIcon={setVaultIcon}
            renamingId={renamingId}
            setRenamingId={setRenamingId}
            renameValue={renameValue}
            setRenameValue={setRenameValue}
            handleRename={handleRename}
            deleteVault={deleteVault}
            newVaultName={newVaultName}
            setNewVaultName={setNewVaultName}
            newVaultIcon={newVaultIcon}
            setNewVaultIcon={setNewVaultIcon}
            handleCreate={handleCreate}
          />
        )}
        {page === "editor" && (
          <EditorPage
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
        {page === "ai" && (
          <AIPage
            settings={settings}
            updateSettings={updateSettings}
            aiTestState={aiTestState}
            aiTestMessage={aiTestMessage}
            onTest={handleTestAI}
          />
        )}
        {page === "sync" && (
          <SyncPage
            gitConfig={gitConfig}
            gitStatus={gitStatus}
            busy={gitBusy}
            msg={gitMsg}
            onSave={(cfg) => saveGitConfig(cfg)}
            onInit={() =>
              void runGit(async () => {
                await gitInit();
              }, "Repository initialized.")
            }
            onPush={() =>
              void runGit(
                () => gitPush(gitConfig?.username ? { username: gitConfig.username, password: gitConfig.password ?? "" } : undefined),
                "Pushed.",
              )
            }
            onPull={() =>
              void runGit(
                () => gitPull(gitConfig?.username ? { username: gitConfig.username, password: gitConfig.password ?? "" } : undefined),
                "Pulled.",
              )
            }
            onRefresh={() => void refreshGitStatus()}
          />
        )}
        {page === "about" && <AboutPage />}
      </div>
    </div>
  );
}

// ── Root page ──────────────────────────────────────────────────────

function RootPage({
  onNavigate,
  resolvedTheme,
  colorScheme,
}: {
  onNavigate: (p: Page) => void;
  resolvedTheme: string;
  colorScheme: string;
}) {
  const schemeLabel = SCHEMES.find((s) => s.value === (colorScheme ?? "default"))?.label ?? "Default";
  return (
    <Group label="General">
      <NavRow icon={<Palette size={18} />} label="Appearance" value={`${schemeLabel} · ${resolvedTheme}`} onClick={() => onNavigate("appearance")} />
      <Divider />
      <NavRow icon={<FolderPlus size={18} />} label="Vaults" onClick={() => onNavigate("vaults")} />
      <Divider />
      <NavRow icon={<PenLine size={18} />} label="Editor" onClick={() => onNavigate("editor")} />
      <Divider />
      <NavRow icon={<Zap size={18} />} label="AI" onClick={() => onNavigate("ai")} />
      <Divider />
      <NavRow icon={<GitBranch size={18} />} label="Git sync" onClick={() => onNavigate("sync")} />
      <Divider />
      <NavRow icon={<Info size={18} />} label="About" onClick={() => onNavigate("about")} />
    </Group>
  );
}

// ── Appearance page ────────────────────────────────────────────────

function AppearancePage({
  resolvedTheme,
  onThemeChange,
  colorScheme,
  onColorSchemeChange,
}: {
  resolvedTheme: string;
  onThemeChange: (t: "light" | "dark" | "system") => void;
  colorScheme: string;
  onColorSchemeChange: (s: string) => void;
}) {
  return (
    <>
      <Group label="Color scheme">
        {SCHEMES.map((s, i) => (
          <div key={s.value}>
            {i > 0 && <Divider />}
            <SelectRow
              label={s.label}
              selected={(colorScheme ?? "default") === s.value}
              onSelect={() => onColorSchemeChange(s.value)}
              swatch={s.swatch}
            />
          </div>
        ))}
      </Group>
      <Group label="Mode">
        {([
          { value: "light", label: "Light", icon: <Sun size={18} /> },
          { value: "dark", label: "Dark", icon: <Moon size={18} /> },
          { value: "system", label: "System", icon: <Monitor size={18} /> },
        ] as const).map((opt, i) => (
          <div key={opt.value}>
            {i > 0 && <Divider />}
            <SelectRow
              label={opt.label}
              icon={opt.icon}
              selected={resolvedTheme === opt.value}
              onSelect={() => onThemeChange(opt.value)}
            />
          </div>
        ))}
      </Group>
    </>
  );
}

// ── Vaults page ─────────────────────────────────────────────────────

function VaultsPage({
  vaults,
  activeVault,
  switchVault,
  setVaultIcon,
  renamingId,
  setRenamingId,
  renameValue,
  setRenameValue,
  handleRename,
  deleteVault,
  newVaultName,
  setNewVaultName,
  newVaultIcon,
  setNewVaultIcon,
  handleCreate,
}: {
  vaults: ReturnType<typeof useNotes>["vaults"];
  activeVault: ReturnType<typeof useNotes>["activeVault"];
  switchVault: (id: string) => void;
  setVaultIcon: (id: string, icon: string) => void;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  renameValue: string;
  setRenameValue: (v: string) => void;
  handleRename: (id: string) => void;
  deleteVault: (id: string) => void;
  newVaultName: string;
  setNewVaultName: (v: string) => void;
  newVaultIcon: string;
  setNewVaultIcon: (v: string) => void;
  handleCreate: () => void;
}) {
  const [collections, setCollections] = useState<CollectionMeta[]>([]);
  useEffect(() => {
    void api.listCollections().then((res) => setCollections(res.collections ?? []));
  }, []);

  return (
    <>
      <Group label="Your vaults">
        {vaults.filter((v) => !isCollectionsVault(v)).map((vault, i) => (
          <div key={vault.id}>
            {i > 0 && <Divider />}
            <div
              className="flex items-center gap-3 px-3"
              style={{ minHeight: 56 }}
            >
              <IconPicker value={vault.icon ?? "Database"} onChange={(icon) => void setVaultIcon(vault.id, icon)} />
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
                  className="min-w-0 flex-1 rounded border px-2 py-1 text-sm outline-none"
                  style={{
                    background: "var(--mob-card)",
                    color: "var(--mob-text)",
                    borderColor: "var(--mob-accent)",
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => switchVault(vault.id)}
                  onDoubleClick={() => {
                    setRenamingId(vault.id);
                    setRenameValue(vault.name);
                  }}
                  className="min-w-0 flex-1 text-left text-[15px]"
                  style={{ color: "var(--mob-text)" }}
                >
                  {vault.name}
                  {vault.id === activeVault?.id && (
                    <span className="ml-2 text-xs" style={{ color: "var(--mob-accent)" }}>active</span>
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setRenamingId(vault.id);
                  setRenameValue(vault.name);
                }}
                className="shrink-0 text-xs"
                style={{ color: "var(--mob-muted)" }}
              >
                Rename
              </button>
              {vault.name !== "Default" && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete vault "${vault.name}" and all its notes?`)) void deleteVault(vault.id);
                  }}
                  className="shrink-0"
                  style={{ color: "var(--mob-muted)" }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </Group>

      <Group label="Create new vault">
        <div className="flex flex-col gap-3 px-3 py-3">
          <div className="flex items-center gap-2">
            <IconPicker value={newVaultIcon} onChange={setNewVaultIcon} />
            <input
              value={newVaultName}
              onChange={(e) => setNewVaultName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
              placeholder="New vault name…"
              className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--mob-card)",
                color: "var(--mob-text)",
                borderColor: "var(--mob-surface)",
              }}
            />
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!newVaultName.trim()}
            className="rounded-lg py-2.5 text-sm font-medium transition-opacity disabled:opacity-40"
            style={{
              background: "var(--mob-accent)",
              color: "#fff",
            }}
          >
            Add vault
          </button>
        </div>
      </Group>
      <div className="px-3 py-2 text-xs" style={{ color: "var(--mob-muted)" }}>
        Double-tap a vault name to rename. Tap to switch active vault.
      </div>

      <Group label="Collections">
        {collections.length === 0 ? (
          <div className="px-3 py-2 text-xs" style={{ color: "var(--mob-muted)" }}>
            No collections.
          </div>
        ) : (
          collections.map((col, i) => (
            <div key={col.id}>
              {i > 0 && <Divider />}
              <div className="flex items-center justify-between gap-3 px-3" style={{ minHeight: 56 }}>
                <span className="text-[15px]" style={{ color: "var(--mob-text)" }}>
                  {col.name}
                  {col.builtIn && (
                    <span className="ml-2 text-xs" style={{ color: "var(--mob-muted)" }}>built-in</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void api
                      .setCollectionHidden(col.id, !col.hidden)
                      .then(() => void api.listCollections().then((res) => setCollections(res.collections ?? [])))
                      .catch(() => {})
                  }
                  className="rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity"
                  style={{
                    background: col.hidden ? "var(--mob-surface)" : "var(--mob-accent)",
                    color: col.hidden ? "var(--mob-muted)" : "#fff",
                  }}
                >
                  {col.hidden ? "Hidden" : "Visible"}
                </button>
              </div>
            </div>
          ))
        )}
        <div className="px-3 py-2 text-xs" style={{ color: "var(--mob-muted)" }}>
          Hide a collection to remove it from the app without deleting its notes.
        </div>
      </Group>
    </>
  );
}

// ── Editor page ───────────────────────────────────────────────────

function EditorPage({
  settings,
  updateSettings,
}: {
  settings: ReturnType<typeof useNotes>["settings"];
  updateSettings: (patch: Partial<ReturnType<typeof useNotes>["settings"]>) => void;
}) {
  return (
    <>
      <Group label="Saving">
        <ToggleRow
          label="Autosave"
          desc="Automatically save while typing"
          checked={settings.autosave}
          onChange={(v) => updateSettings({ autosave: v })}
        />
      </Group>
      <Group label="New-note title template">
        <div className="flex flex-col gap-2 px-3 py-3">
          <input
            value={settings.titleTemplate}
            onChange={(e) => updateSettings({ titleTemplate: e.target.value })}
            placeholder="DAY DD-MM-YYYY HH:mm"
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--mob-card)",
              color: "var(--mob-text)",
              borderColor: "var(--mob-surface)",
            }}
          />
          <div className="flex flex-wrap gap-1 text-[11px]" style={{ color: "var(--mob-muted)" }}>
            {[
              ["DAY", "Monday"], ["DDD", "Mon"], ["DD", "12"], ["MM", "08"],
              ["MMM", "Aug"], ["YYYY", "2025"], ["YY", "25"], ["HH", "14"],
              ["mm", "30"], ["ss", "05"],
            ].map(([token, desc]) => (
              <span key={token} className="rounded border px-1 py-0.5" style={{ borderColor: "var(--mob-surface)" }}>
                {token} <span style={{ opacity: 0.6 }}>{desc}</span>
              </span>
            ))}
          </div>
          <div className="text-xs">
            <span style={{ color: "var(--mob-muted)" }}>Preview: </span>
            <span style={{ color: "var(--mob-text)" }}>
              {formatTitle(settings.titleTemplate) || "Untitled"}
            </span>
          </div>
        </div>
      </Group>
      <Group label="Typography">
        <div className="px-3 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[15px]" style={{ color: "var(--mob-text)" }}>Editor font size</span>
            <span className="text-xs" style={{ color: "var(--mob-muted)" }}>{settings.editorFontSize}px</span>
          </div>
          <input
            type="range"
            min={12}
            max={24}
            step={1}
            value={settings.editorFontSize}
            onChange={(e) => updateSettings({ editorFontSize: Number(e.target.value) })}
            className="mt-3 w-full"
            style={{ accentColor: "var(--mob-accent)" }}
          />
        </div>
      </Group>
    </>
  );
}

// ── AI page ────────────────────────────────────────────────────────

function AIPage({
  settings,
  updateSettings,
  aiTestState,
  aiTestMessage,
  onTest,
}: {
  settings: ReturnType<typeof useNotes>["settings"];
  updateSettings: (patch: Partial<ReturnType<typeof useNotes>["settings"]>) => void;
  aiTestState: "idle" | "testing" | "ok" | "error";
  aiTestMessage: string;
  onTest: () => void;
}) {
  return (
    <>
      <Group label="Connection">
        <div className="px-3 py-3 text-xs" style={{ color: "var(--mob-muted)" }}>
          Connect any OpenAI-compatible API (OpenAI, OpenRouter, Ollama, LM Studio…) to power the editor AI button.
        </div>
      </Group>
      <Group label="API settings">
        <FieldInput
          label="API base URL"
          hint="e.g. https://api.openai.com/v1 or http://localhost:11434/v1"
          value={settings.aiBaseUrl}
          onChange={(v) => updateSettings({ aiBaseUrl: v })}
          placeholder="https://api.openai.com/v1"
        />
        <Divider />
        <FieldInput
          label="API key"
          hint="Optional for local servers like Ollama"
          value={settings.aiApiKey}
          onChange={(v) => updateSettings({ aiApiKey: v })}
          placeholder="sk-…"
          password
        />
        <Divider />
        <FieldInput
          label="Model"
          hint="e.g. gpt-4o-mini, claude-sonnet-4, llama3.2"
          value={settings.aiModel}
          onChange={(v) => updateSettings({ aiModel: v })}
          placeholder="gpt-4o-mini"
        />
      </Group>
      <Group label="Test">
        <div className="flex items-center gap-3 px-3 py-3">
          <button
            type="button"
            onClick={onTest}
            disabled={aiTestState === "testing" || !settings.aiBaseUrl.trim()}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-40"
            style={{ background: "var(--mob-accent)", color: "#fff" }}
          >
            {aiTestState === "testing" ? "Testing…" : "Test connection"}
          </button>
          {aiTestMessage && (
            <span
              className="text-xs"
              style={{ color: aiTestState === "ok" ? "#4ade80" : "#f87171" }}
            >
              {aiTestMessage}
            </span>
          )}
        </div>
      </Group>
      <DiscogsSection />
    </>
  );
}

// ── Discogs token (metadata lookups) ───────────────────────────────

function DiscogsSection() {
  const [draft, setDraft] = useState<MetadataConfig>({ discogsToken: "" });
  const [saved, setSaved] = useState<MetadataConfig>({ discogsToken: "" });
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");

  useEffect(() => {
    void api
      .getMetadataConfig()
      .then((cfg) => {
        setSaved(cfg);
        setDraft(cfg);
      })
      .catch(() => {});
  }, []);

  const persist = async () => {
    if (draft === saved) return;
    try {
      const cfg = await api.setMetadataConfig(draft);
      setSaved(cfg);
      setDraft(cfg);
    } catch {
      /* keep the draft so nothing the user typed is lost */
    }
  };

  const handleTest = async () => {
    setTestState("testing");
    setTestMessage("");
    try {
      await api.setMetadataConfig(draft);
      setSaved(draft);
      const res = await fetch("/api/metadata/discogs/search?q=test", {
        cache: "no-store",
      });
      if (res.ok) {
        setTestState("ok");
        setTestMessage("Token works");
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setTestState("error");
        setTestMessage(body?.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setTestState("error");
      setTestMessage(err instanceof Error ? err.message : "Test failed");
    }
  };

  return (
    <>
      <Group label="Metadata lookups">
        <div className="px-3 py-2 text-xs" style={{ color: "var(--mob-muted)" }}>
          Lookup keys, stored server-side only. Free Discogs token:
          dev.discogs.com. Google Books works key-less but rate-limits hard
          (HTTP 429) — a free API key raises the quota.
        </div>
        <FieldInput
          label="Discogs token"
          hint="Personal access token"
          value={draft.discogsToken}
          onChange={(v) => setDraft({ ...draft, discogsToken: v })}
          onBlur={() => void persist()}
          password
          placeholder="Personal access token"
        />
        <FieldInput
          label="Google Books API key"
          hint="Optional — avoids 429 rate limits"
          value={draft.googleBooksKey ?? ""}
          onChange={(v) => setDraft({ ...draft, googleBooksKey: v })}
          onBlur={() => void persist()}
          password
          placeholder="AIza…"
        />
      </Group>
      <Group label="Token test">
        <div className="flex items-center gap-3 px-3 py-3">
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={testState === "testing" || !draft.discogsToken.trim()}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-40"
            style={{ background: "var(--mob-accent)", color: "#fff" }}
          >
            {testState === "testing" ? "Testing…" : "Test token"}
          </button>
          {testMessage && (
            <span
              className="text-xs"
              style={{ color: testState === "ok" ? "#4ade80" : "#f87171" }}
            >
              {testMessage}
            </span>
          )}
        </div>
      </Group>
    </>
  );
}

// ── Git sync page ──────────────────────────────────────────────────

function SyncPage({
  gitConfig,
  gitStatus,
  busy,
  msg,
  onSave,
  onInit,
  onPush,
  onPull,
  onRefresh,
}: {
  gitConfig: GitConfig | null;
  gitStatus: GitStatusInfo | null;
  busy: boolean;
  msg: string;
  onSave: (cfg: GitConfig) => Promise<void>;
  onInit: () => void;
  onPush: () => void;
  onPull: () => void;
  onRefresh: () => void;
}) {
  // Local draft — inputs write here instantly, changes persist on blur
  // (toggles persist immediately). Re-synced whenever the remote config changes.
  const [draft, setDraft] = useState<GitConfig | null>(gitConfig);
  const [saveMsg, setSaveMsg] = useState("");
  useEffect(() => {
    setDraft(gitConfig);
  }, [gitConfig]);
  const setField = (patch: Partial<GitConfig>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };
  const persist = async (cfg: GitConfig) => {
    try {
      await onSave(cfg);
      setSaveMsg("");
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : "Save failed");
    }
  };

  if (!gitConfig || !draft) {
    return (
      <div className="px-6 py-8 text-center" style={{ fontSize: 13, color: "var(--mob-muted)" }}>
        Loading…
      </div>
    );
  }

  return (
    <>
      <Group label="Git sync">
        <ToggleRow
          label="Enable Git Sync"
          desc="Auto-commit changes and optionally push to a remote"
          checked={draft.enabled}
          onChange={async (v) => {
            const next = { ...draft, enabled: v };
            setDraft(next);
            await persist(next);
          }}
        />
      </Group>

      {draft.enabled && (
        <>
          <Group label="Repository">
            <FieldInput
              label="Remote URL"
              hint="e.g. https://github.com/user/repo.git"
              value={draft.remote}
              onChange={(v) => setField({ remote: v })}
              onBlur={() => draft !== gitConfig && void persist(draft)}
              placeholder="https://github.com/user/repo.git"
            />
            <Divider />
            <FieldInput
              label="Branch"
              hint="Default: main"
              value={draft.branch}
              onChange={(v) => setField({ branch: v })}
              onBlur={() => draft !== gitConfig && void persist(draft)}
              placeholder="main"
            />
            <Divider />
            <FieldInput
              label="Author name"
              value={draft.authorName}
              onChange={(v) => setField({ authorName: v })}
              onBlur={() => draft !== gitConfig && void persist(draft)}
            />
            <Divider />
            <FieldInput
              label="Author email"
              value={draft.authorEmail}
              onChange={(v) => setField({ authorEmail: v })}
              onBlur={() => draft !== gitConfig && void persist(draft)}
            />
          </Group>

          <Group label="Options">
            <ToggleRow
              label="Include images"
              desc="Sync uploaded images with notes"
              checked={draft.includeImages}
              onChange={async (v) => {
                const next = { ...draft, includeImages: v };
                setDraft(next);
                await persist(next);
              }}
            />
            <Divider />
            <ToggleRow
              label="Auto-push"
              desc="Push after every commit"
              checked={draft.autoPush}
              onChange={async (v) => {
                const next = { ...draft, autoPush: v };
                setDraft(next);
                await persist(next);
              }}
            />
          </Group>

          <Group label="Credentials (stored on server)">
            <div className="px-3 py-2 text-xs" style={{ color: "var(--mob-muted)" }}>
              Saved to git.json (0600) so timed auto-sync can authenticate.
            </div>
            <FieldInput
              label="Username"
              value={draft.username ?? ""}
              onChange={(v) => void persist({ ...draft, username: v })}
              placeholder="Username / token name"
            />
            <Divider />
            <FieldInput
              label="Password / token"
              value={draft.password ?? ""}
              onChange={(v) => void persist({ ...draft, password: v })}
              password
            />
          </Group>

          <Group label="Auto-sync">
            <div
              className="flex items-center justify-between px-3 py-2.5"
              style={{ minHeight: 52 }}
            >
              <span className="text-[15px]" style={{ color: "var(--mob-text)" }}>
                Auto-sync every
              </span>
              <select
                value={draft.autoSyncMinutes ?? 0}
                onChange={async (e) => {
                  const next = { ...draft, autoSyncMinutes: Number(e.target.value) };
                  setDraft(next);
                  await persist(next);
                }}
                className="rounded px-2 py-1.5 text-sm"
                style={{ background: "var(--mob-card)", color: "var(--mob-text)" }}
              >
                <option value={0}>Off</option>
                <option value={1}>1 min</option>
                <option value={3}>3 min</option>
                <option value={5}>5 min</option>
                <option value={10}>10 min</option>
              </select>
            </div>
            <Divider />
            <ToggleRow
              label="Readable file names"
              desc="Commit real vault/folder/note names instead of internal ids"
              checked={draft.readableNames ?? false}
              onChange={async (v) => {
                const next = { ...draft, readableNames: v };
                setDraft(next);
                await persist(next);
              }}
            />
          </Group>

          <Group label="Actions">
            <div className="flex flex-wrap gap-2 px-3 py-3">
              <ActionBtn label="Init repo" onClick={onInit} disabled={busy} />
              <ActionBtn label="Push" onClick={onPush} disabled={busy} />
              <ActionBtn label="Pull" onClick={onPull} disabled={busy} />
              <ActionBtn label="Refresh" onClick={onRefresh} disabled={busy} subtle />
            </div>
            {(msg || saveMsg) && (
              <div
                className="px-3 pb-3 text-xs"
                style={{ color: /failed|error/i.test(msg + saveMsg) ? "#f87171" : "var(--mob-muted)" }}
              >
                {saveMsg || msg}
              </div>
            )}
          </Group>

          {gitStatus && (
            <Group label="Status">
              {gitStatus.hasRepo ? (
                <>
                  <InfoRow
                    label="State"
                    value={gitStatus.clean ? "Clean" : `${gitStatus.dirtyFiles} uncommitted`}
                  />
                  <Divider />
                  <InfoRow label="Branch" value={gitStatus.branch} />
                  <Divider />
                  <InfoRow label="Remote" value={gitStatus.remote || "none"} />
                  {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
                    <>
                      <Divider />
                      <InfoRow
                        label="Sync"
                        value={`${gitStatus.ahead} ahead · ${gitStatus.behind} behind`}
                      />
                    </>
                  )}
                </>
              ) : (
                <div className="px-3 py-3 text-xs" style={{ color: "var(--mob-muted)" }}>
                  No repository yet. Tap "Init repo" to create one.
                </div>
              )}
            </Group>
          )}
        </>
      )}
    </>
  );
}

function ActionBtn({
  label,
  onClick,
  disabled,
  subtle,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  subtle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg px-3.5 py-2 text-sm font-medium transition-opacity disabled:opacity-40"
      style={
        subtle
          ? {
              background: "transparent",
              color: "var(--mob-text)",
              border: "1px solid color-mix(in oklab, var(--mob-muted) 30%, transparent)",
            }
          : { background: "var(--mob-accent)", color: "#fff" }
      }
    >
      {label}
    </button>
  );
}

// ── About page ─────────────────────────────────────────────────────

function AboutPage() {
  return (
    <Group label="Info">
      <InfoRow label="App" value="Nexote" />
      <Divider />
      <InfoRow label="Data location" value="~/.nexote" />
      <Divider />
      <InfoRow label="Vaults directory" value="~/.nexote/vaults" />
    </Group>
  );
}

// ── Shared building blocks ─────────────────────────────────────────

function Group({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="px-4 pt-5">
      {label && (
        <div
          className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--mob-muted)" }}
        >
          {label}
        </div>
      )}
      <div
        className="overflow-hidden rounded-2xl"
        style={{
          background: "color-mix(in oklab, var(--mob-surface) 50%, var(--mob-bg))",
          border: "1px solid color-mix(in oklab, var(--mob-muted) 25%, transparent)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        height: 1,
        marginLeft: 56,
        background: "color-mix(in oklab, var(--mob-muted) 22%, transparent)",
      }}
    />
  );
}

function NavRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 transition-colors active:bg-white/8"
      style={{ minHeight: 56 }}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{
          background: "color-mix(in oklab, var(--mob-accent) 15%, transparent)",
          color: "var(--mob-accent)",
        }}
      >
        {icon}
      </span>
      <span className="flex-1 text-left text-[15px] font-medium" style={{ color: "var(--mob-text)" }}>{label}</span>
      {value && (
        <span className="truncate text-xs" style={{ color: "var(--mob-muted)" }}>{value}</span>
      )}
      <ChevronRight size={18} style={{ color: "var(--mob-muted)" }} />
    </button>
  );
}

function SelectRow({
  label,
  icon,
  selected,
  onSelect,
  swatch,
}: {
  label: string;
  icon?: React.ReactNode;
  selected: boolean;
  onSelect: () => void;
  swatch?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 px-3 transition-colors active:bg-white/8"
      style={{ minHeight: 56 }}
    >
      {swatch ? (
        <span
          className="h-7 w-7 shrink-0 rounded-full border-2"
          style={{
            background: selected ? "var(--mob-bg)" : swatch,
            borderColor: selected ? "var(--mob-accent)" : "color-mix(in oklab, var(--mob-muted) 30%, transparent)",
          }}
        />
      ) : icon ? (
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{
            background: "color-mix(in oklab, var(--mob-accent) 15%, transparent)",
            color: "var(--mob-accent)",
          }}
        >
          {icon}
        </span>
      ) : (
        <span className="w-8 shrink-0" />
      )}
      <span className="flex-1 text-left text-[15px] font-medium" style={{ color: "var(--mob-text)" }}>{label}</span>
      {selected && (
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full"
          style={{ background: "var(--mob-accent)" }}
        >
          <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>
        </span>
      )}
    </button>
  );
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3" style={{ minHeight: 56 }}>
      <div className="flex flex-1 flex-col">
        <span className="text-[15px] font-medium" style={{ color: "var(--mob-text)" }}>{label}</span>
        {desc && <span className="text-xs" style={{ color: "var(--mob-muted)" }}>{desc}</span>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="relative h-8 w-14 shrink-0 rounded-full transition-colors"
        style={{
          background: checked ? "var(--mob-accent)" : "color-mix(in oklab, var(--mob-muted) 30%, transparent)",
        }}
      >
        <span
          className="absolute left-0.5 top-1 h-6 w-6 rounded-full bg-white shadow-md transition-transform"
          style={{ transform: checked ? "translateX(24px)" : "translateX(0)" }}
        />
      </button>
    </div>
  );
}

function FieldInput({
  label,
  hint,
  value,
  onChange,
  onBlur,
  placeholder,
  password,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  password?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-3">
      <span className="text-sm font-medium" style={{ color: "var(--mob-text)" }}>{label}</span>
      {hint && <span className="text-xs" style={{ color: "var(--mob-muted)" }}>{hint}</span>}
      <input
        type={password ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors"
        style={{
          background: "var(--mob-bg)",
          color: "var(--mob-text)",
          borderColor: "color-mix(in oklab, var(--mob-muted) 25%, transparent)",
        }}
      />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3" style={{ minHeight: 56 }}>
      <span className="text-[15px]" style={{ color: "var(--mob-muted)" }}>{label}</span>
      <span className="text-[15px] font-medium" style={{ color: "var(--mob-text)" }}>{value}</span>
    </div>
  );
}

function CircleBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-full transition-colors active:scale-95"
      style={{
        background: "color-mix(in oklab, var(--mob-surface) 80%, transparent)",
        color: "var(--mob-text)",
      }}
    >
      {children}
    </button>
  );
}

function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  const CurrentIcon = getIcon(value, Database);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border"
        style={{
          background: "var(--mob-card)",
          borderColor: "var(--mob-surface)",
          color: "var(--mob-muted)",
        }}
      >
        <CurrentIcon size={16} />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[70vh] overflow-y-auto rounded-xl p-3"
            style={{ background: "var(--mob-card)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-5 gap-2">
              {ICON_OPTIONS.map(({ name, icon: Icon }) => (
                <button
                  key={name}
                  type="button"
                  className="flex h-11 w-11 items-center justify-center rounded-lg"
                  style={{
                    background: name === value ? "color-mix(in oklab, var(--mob-accent) 20%, transparent)" : "var(--mob-bg)",
                    color: name === value ? "var(--mob-accent)" : "var(--mob-muted)",
                  }}
                  onClick={() => {
                    onChange(name);
                    setOpen(false);
                  }}
                >
                  <Icon size={20} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}