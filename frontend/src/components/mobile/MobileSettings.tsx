"use client";

import {
  ChevronRight,
  Database,
  FileText,
  Folder,
  FolderPlus,
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
import { api } from "@/lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  colorScheme: string;
  onColorSchemeChange: (scheme: string) => void;
};

type Page = "root" | "appearance" | "vaults" | "editor" | "ai" | "about";

const SCHEMES = [
  { value: "default", label: "Default", swatch: "#7c3aed" },
  { value: "nord", label: "Nord", swatch: "#5e81ac" },
  { value: "catppuccin-frappe", label: "Catppuccin Frappé", swatch: "#ca9ee6" },
  { value: "catppuccin-macchiato", label: "Catppuccin Macchiato", swatch: "#c6a0f6" },
  { value: "catppuccin-mocha", label: "Catppuccin Mocha", swatch: "#cba6f7" },
  { value: "dracula", label: "Dracula", swatch: "#bd93f9" },
  { value: "gruvbox", label: "Gruvbox", swatch: "#83a598" },
] as const;

const ICON_OPTIONS = [
  { name: "Database", icon: Database },
  { name: "Folder", icon: Folder },
  { name: "FileText", icon: FileText },
  { name: "Heart", icon: Heart },
  { name: "Home", icon: Home },
  { name: "Music", icon: Music },
  { name: "Shield", icon: Shield },
  { name: "Zap", icon: Zap },
];

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
  } = useNotes();
  const { theme, setTheme } = useTheme();
  const [page, setPage] = useState<Page>("root");
  const [mounted, setMounted] = useState(false);
  const [newVaultName, setNewVaultName] = useState("");
  const [newVaultIcon, setNewVaultIcon] = useState("Database");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [aiTestState, setAiTestState] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [aiTestMessage, setAiTestMessage] = useState("");

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

  const pageTitle: Record<Page, string> = {
    root: "Settings",
    appearance: "Appearance",
    vaults: "Vaults",
    editor: "Editor",
    ai: "AI",
    about: "About",
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: "var(--mob-bg)" }}
    >
      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between px-4"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
          paddingBottom: 12,
          borderBottom: "1px solid var(--mob-surface)",
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
  return (
    <>
      <Group label="Your vaults">
        {vaults.map((vault, i) => (
          <div key={vault.id}>
            {i > 0 && <Divider />}
            <div
              className="flex items-center gap-3 px-4"
              style={{ minHeight: 52 }}
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
        <div className="flex flex-col gap-3 px-4 py-3">
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
      <div className="px-4 py-2 text-xs" style={{ color: "var(--mob-muted)" }}>
        Double-tap a vault name to rename. Tap to switch active vault.
      </div>
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
        <div className="flex flex-col gap-2 px-4 py-3">
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
        <div className="px-4 py-3">
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
        <div className="px-4 py-3 text-xs" style={{ color: "var(--mob-muted)" }}>
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
        <div className="flex items-center gap-3 px-4 py-3">
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
    </>
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
    <div className="px-4 pt-4">
      {label && (
        <div
          className="mb-1.5 px-1 text-xs font-medium uppercase tracking-wide"
          style={{ color: "var(--mob-muted)" }}
        >
          {label}
        </div>
      )}
      <div
        className="mob-settings-group overflow-hidden rounded-xl"
        style={{
          background: "color-mix(in oklab, var(--mob-card) 60%, var(--mob-bg))",
          border: "1px solid color-mix(in oklab, var(--mob-muted) 18%, transparent)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="mob-settings-divider" />;
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
      className="flex w-full items-center gap-3 px-4 transition-colors active:bg-white/5"
      style={{ minHeight: 52 }}
    >
      <span className="shrink-0" style={{ color: "var(--mob-accent)" }}>{icon}</span>
      <span className="flex-1 text-left text-[15px]" style={{ color: "var(--mob-text)" }}>{label}</span>
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
      className="flex w-full items-center gap-3 px-4 transition-colors active:bg-white/5"
      style={{ minHeight: 52 }}
    >
      {swatch ? (
        <span
          className="h-5 w-5 shrink-0 rounded-full border"
          style={{
            background: selected ? "var(--mob-bg)" : swatch,
            borderColor: "var(--mob-surface)",
          }}
        />
      ) : icon ? (
        <span className="shrink-0" style={{ color: "var(--mob-accent)" }}>{icon}</span>
      ) : (
        <span className="w-5 shrink-0" />
      )}
      <span className="flex-1 text-left text-[15px]" style={{ color: "var(--mob-text)" }}>{label}</span>
      {selected && (
        <span
          className="flex h-5 w-5 items-center justify-center rounded-full"
          style={{ background: "var(--mob-accent)" }}
        >
          <span style={{ color: "#fff", fontSize: 12, lineHeight: 1 }}>✓</span>
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
    <div className="flex items-center gap-3 px-4" style={{ minHeight: 52 }}>
      <div className="flex flex-1 flex-col">
        <span className="text-[15px]" style={{ color: "var(--mob-text)" }}>{label}</span>
        {desc && <span className="text-xs" style={{ color: "var(--mob-muted)" }}>{desc}</span>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="relative h-7 w-12 shrink-0 rounded-full transition-colors"
        style={{ background: checked ? "var(--mob-accent)" : "var(--mob-surface)" }}
      >
        <span
          className="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform"
          style={{ transform: checked ? "translateX(22px)" : "translateX(2px)" }}
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
  placeholder,
  password,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  password?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <span className="text-sm" style={{ color: "var(--mob-text)" }}>{label}</span>
      {hint && <span className="text-xs" style={{ color: "var(--mob-muted)" }}>{hint}</span>}
      <input
        type={password ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
        style={{
          background: "var(--mob-bg)",
          color: "var(--mob-text)",
          borderColor: "var(--mob-surface)",
        }}
      />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4" style={{ minHeight: 52 }}>
      <span className="text-[15px]" style={{ color: "var(--mob-muted)" }}>{label}</span>
      <span className="text-[15px]" style={{ color: "var(--mob-text)" }}>{value}</span>
    </div>
  );
}

function CircleBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-full"
      style={{ background: "var(--mob-surface)", color: "var(--mob-text)" }}
    >
      {children}
    </button>
  );
}

function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  const CurrentIcon = ICON_OPTIONS.find((o) => o.name === value)?.icon ?? Database;

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
            className="rounded-xl p-3"
            style={{ background: "var(--mob-card)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-4 gap-2">
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