"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useTheme } from "next-themes";
import { Fragment, useEffect, useState } from "react";

import { COLOR_SCHEMES, THEME_MODES } from "@/components/settings/AppearanceSettings";
import {
  SETTINGS_NAV,
  type SettingsCategory,
  type SettingsCategoryId,
} from "@/components/settings/categories";
import { SettingsPlatformProvider } from "@/components/settings/ui";

type Props = {
  open: boolean;
  onClose: () => void;
  colorScheme: string;
  onColorSchemeChange: (scheme: string) => void;
};

// Touch devices have no keyboard shortcuts.
const NAV = SETTINGS_NAV.map((group) => ({
  ...group,
  categories: group.categories.filter((c) => !c.desktopOnly),
}));
const CATEGORIES = NAV.flatMap((group) => group.categories);

/** Mobile settings: a list of categories, each opening the shared section page. */
export default function MobileSettings({ open, onClose, colorScheme, onColorSchemeChange }: Props) {
  const { theme } = useTheme();
  const [page, setPage] = useState<SettingsCategoryId | null>(null);

  useEffect(() => {
    if (!open) setPage(null);
  }, [open]);

  if (!open) return null;

  const current = page ? CATEGORIES.find((c) => c.id === page) : undefined;
  const scheme = COLOR_SCHEMES.find((s) => s.value === (colorScheme || "default"))?.label ?? "Default";
  const mode = THEME_MODES.find((m) => m.value === theme)?.label ?? "Adapt to system";
  const values: Partial<Record<SettingsCategoryId, string>> = { appearance: `${scheme} · ${mode}` };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background text-foreground">
      <div
        className="flex shrink-0 items-center justify-between border-b border-border/70 px-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)", paddingBottom: 12 }}
      >
        {current ? (
          <CircleBtn label="Back" onClick={() => setPage(null)}>
            <ChevronLeft size={22} />
          </CircleBtn>
        ) : (
          <span className="w-10" />
        )}
        <span className="text-lg font-semibold">{current?.label ?? "Settings"}</span>
        <CircleBtn label="Close settings" onClick={onClose}>
          <X size={20} />
        </CircleBtn>
      </div>

      {/* Keyed so every page opens at the top (and slides in). */}
      <div key={page ?? "root"} className="flex-1 overflow-y-auto overscroll-contain">
        <div className={current ? "nx-settings-page-in" : undefined}>
          {current ? (
            <SettingsPlatformProvider value="mobile">
              <current.Section colorScheme={colorScheme} onColorSchemeChange={onColorSchemeChange} />
            </SettingsPlatformProvider>
          ) : (
            <div className="px-4 pb-12 pt-1">
              {NAV.map((group, i) => (
                <section key={group.label ?? i} className="mt-6">
                  {group.label && (
                    <h3 className="mb-1.5 px-4 text-[13px] font-semibold text-muted-foreground">{group.label}</h3>
                  )}
                  <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/40">
                    {group.categories.map((cat, j) => (
                      <Fragment key={cat.id}>
                        {j > 0 && <div className="ml-14 h-px bg-border/70" />}
                        <NavRow category={cat} value={values[cat.id]} onClick={() => setPage(cat.id)} />
                      </Fragment>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NavRow({ category, value, onClick }: { category: SettingsCategory; value?: string; onClick: () => void }) {
  const Icon = category.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 px-3 transition-colors active:bg-muted"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Icon size={18} />
      </span>
      <span className="flex-1 text-left text-[15px] font-medium">{category.label}</span>
      {value && <span className="truncate text-xs text-muted-foreground">{value}</span>}
      <ChevronRight size={18} className="shrink-0 text-muted-foreground" />
    </button>
  );
}

function CircleBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/80 text-foreground transition-transform active:scale-95"
    >
      {children}
    </button>
  );
}
