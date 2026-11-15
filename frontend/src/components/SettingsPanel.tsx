"use client";

import { Settings, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "./auth/AuthProvider";
import { requestedCategory, settingsNav, type SettingsCategoryId } from "./settings/categories";
import { cx, SettingsPlatformProvider } from "./settings/ui";

type Props = {
  open: boolean;
  onClose: () => void;
  colorScheme?: string;
  onColorSchemeChange?: (scheme: string) => void;
};

// Reopening the dialog shows the page that was open last (per page load).
let lastCategory: SettingsCategoryId = "general";

/** Desktop settings dialog: category sidebar + the shared section pages. */
export default function SettingsPanel({ open, onClose, colorScheme, onColorSchemeChange }: Props) {
  const { user } = useAuth();
  const nav = useMemo(() => settingsNav(user.role, "desktop"), [user.role]);
  const [active, setActive] = useState<SettingsCategoryId>(lastCategory);

  // `nexote:open-settings` with a category (detail) opens at that page; the
  // shell that owns `open` listens to the same event.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = requestedCategory(e);
      if (!id) return;
      lastCategory = id;
      setActive(id);
    };
    window.addEventListener("nexote:open-settings", onOpen);
    return () => window.removeEventListener("nexote:open-settings", onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape first closes an open icon picker or cancels an inline edit.
      if (document.querySelector("[data-settings-popover]")) return;
      if (e.target instanceof Element && e.target.closest("[data-settings-escape]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const categories = nav.flatMap((group) => group.categories);
  // Falls back when the page isn't available to this role.
  const current = categories.find((c) => c.id === active) ?? categories[0];
  const Section = current.Section;
  const select = (id: SettingsCategoryId) => {
    lastCategory = id;
    setActive(id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[7vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="flex h-[86vh] w-[min(920px,100%)] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <Settings size={16} className="text-muted-foreground" />
          <span className="flex-1 text-sm font-medium text-foreground">Settings</span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Settings categories"
            className="flex w-52 shrink-0 flex-col overflow-y-auto border-r border-border bg-muted/20 p-2"
          >
            {nav.map((group, i) => (
              <div key={group.label ?? i} className={i > 0 ? "mt-3" : undefined}>
                {group.label ? (
                  <div className="px-3 pb-1 pt-1 text-xs font-semibold text-muted-foreground">{group.label}</div>
                ) : (
                  <div className="mx-3 mb-2 border-t border-border" />
                )}
                <div className="flex flex-col gap-0.5">
                  {group.categories.map((cat) => {
                    const Icon = cat.icon;
                    const isActive = cat.id === current.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        data-settings-cat={cat.id}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => select(cat.id)}
                        className={cx(
                          "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                          isActive ? "bg-primary/15 font-medium text-primary" : "text-foreground hover:bg-muted",
                        )}
                      >
                        <Icon className={cx("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                        <span className="truncate">{cat.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Keyed so each page starts scrolled to the top. */}
          <div key={current.id} className="min-w-0 flex-1 overflow-y-auto">
            <SettingsPlatformProvider value="desktop">
              <Section colorScheme={colorScheme} onColorSchemeChange={onColorSchemeChange} />
            </SettingsPlatformProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
