"use client";

import {
  Bookmark,
  Database,
  FileText,
  Folder,
  FolderPlus,
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

import { useNotes } from "@/lib/notes-context";

type Props = {
  open: boolean;
  onClose: () => void;
};

type CategoryId = "appearance" | "vaults" | "editor" | "shortcuts" | "about";

const CATEGORIES: {
  id: CategoryId;
  label: string;
  icon: React.ReactNode;
}[] = [
  { id: "appearance", label: "Appearance", icon: <Palette className="h-4 w-4" /> },
  { id: "vaults", label: "Vaults", icon: <FolderPlus className="h-4 w-4" /> },
  { id: "editor", label: "Editor", icon: <PenLine className="h-4 w-4" /> },
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

export default function SettingsPanel({ open, onClose }: Props) {
  const {
    vaults,
    activeVault,
    switchVault,
    createVault,
    renameVault,
    deleteVault,
    setVaultIcon,
    treeMode,
    setTreeMode,
    settings,
    updateSettings,
  } = useNotes();
  const { theme, setTheme } = useTheme();
  const [activeCategory, setActiveCategory] = useState<CategoryId>("appearance");
  const [newVaultName, setNewVaultName] = useState("");
  const [newVaultIcon, setNewVaultIcon] = useState("Database");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [mounted, setMounted] = useState(false);

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
        className="flex h-[84vh] w-[768px] max-w-none flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl"
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

        <div className="flex min-h-0 flex-1">
          {/* Category sidebar */}
          <nav
            className="flex w-48 shrink-0 flex-col gap-1 border-r border-border p-2"
            aria-label="Settings categories"
          >
            {CATEGORIES.map((cat) => {
              const active = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
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
          <div className="min-w-0 flex-1 overflow-y-auto">
            {activeCategory === "appearance" && (
              <AppearanceSection
                theme={resolvedTheme}
                onThemeChange={setTheme}
                treeMode={treeMode}
                setTreeMode={setTreeMode}
              />
            )}

            {activeCategory === "vaults" && (
              <div className="flex flex-col gap-3 p-4">
                <SectionHeader icon={<FolderPlus className="h-4 w-4" />} title="Vaults" />

                {/* Vault list */}
                <div className="flex flex-col gap-1">
                  {vaults.map((vault) => (
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

                {/* Default new-note title */}
                <label className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2 hover:bg-muted/50">
                  <span className="text-sm text-foreground">Default new-note title</span>
                  <span className="text-xs text-muted-foreground">
                    Used when creating a note with Ctrl+Shift+N
                  </span>
                  <input
                    value={settings.defaultTitle}
                    onChange={(e) => updateSettings({ defaultTitle: e.target.value })}
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/40"
                  />
                </label>

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
  treeMode,
  setTreeMode,
}: {
  theme: string;
  onThemeChange: (t: "light" | "dark" | "system") => void;
  treeMode: "simple" | "advanced";
  setTreeMode: (mode: "simple" | "advanced") => void;
}) {
  const options = [
    { value: "light", label: "Light", icon: <Sun className="h-4 w-4" /> },
    { value: "dark", label: "Dark", icon: <Moon className="h-4 w-4" /> },
    { value: "system", label: "System", icon: <Monitor className="h-4 w-4" /> },
  ] as const;

  return (
    <div className="flex flex-col gap-3 p-4">
      <SectionHeader icon={<Palette className="h-4 w-4" />} title="Appearance" />

      {/* Theme */}
      <div className="flex flex-col gap-1">
        <span className="text-sm text-foreground">Theme</span>
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

      {/* Note tree style */}
      <div className="flex flex-col gap-1">
        <span className="text-sm text-foreground">Note tree style</span>
        <div className="flex flex-col gap-2">
          {(
            [
              {
                value: "advanced",
                label: "Advanced",
                desc: "Shortcuts, recent files, and all vaults",
              },
              {
                value: "simple",
                label: "Simple",
                desc: "Only the active vault's folders",
              },
            ] as const
          ).map((opt) => (
            <label
              key={opt.value}
              className={[
                "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition-colors",
                treeMode === opt.value
                  ? "border-primary/40 bg-primary/10"
                  : "border-border hover:bg-muted/50",
              ].join(" ")}
            >
              <input
                type="radio"
                name="tree-mode"
                checked={treeMode === opt.value}
                onChange={() => setTreeMode(opt.value)}
                className="accent-[var(--primary)]"
              />
              <span className="flex flex-col">
                <span className="text-sm text-foreground">{opt.label}</span>
                <span className="text-xs text-muted-foreground">
                  {opt.desc}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

const ICON_OPTIONS = [
  { name: "Database", icon: Database },
  { name: "Folder", icon: Folder },
  { name: "Star", icon: Star },
  { name: "Bookmark", icon: Bookmark },
  { name: "FileText", icon: FileText },
  { name: "Settings", icon: Settings2 },
  { name: "GraduationCap", icon: GraduationCap },
  { name: "Heart", icon: Heart },
  { name: "Home", icon: Home },
  { name: "Music", icon: Music },
  { name: "Shield", icon: Shield },
  { name: "Zap", icon: Zap },
];

function IconPicker({
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
  const CurrentIcon =
    ICON_OPTIONS.find((o) => o.name === value)?.icon ?? Database;

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
          className="fixed z-[60] rounded-lg border border-border bg-background p-2 shadow-xl"
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="grid grid-cols-4 gap-1">
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
