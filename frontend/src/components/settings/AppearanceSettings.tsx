"use client";

import { Check } from "lucide-react";
import { useTheme } from "next-themes";

import type { SectionProps } from "./categories";
import { cx, DropdownSetting, SettingGroup, SettingItem, SettingsPage, useIsMobileSettings } from "./ui";

export const COLOR_SCHEMES = [
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

export const THEME_MODES = [
  { value: "system", label: "Adapt to system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

type ThemeMode = (typeof THEME_MODES)[number]["value"];

export function AppearanceSettings({ colorScheme, onColorSchemeChange }: SectionProps) {
  const { theme, setTheme } = useTheme();
  const mobile = useIsMobileSettings();
  const mode: ThemeMode = THEME_MODES.some((m) => m.value === theme) ? (theme as ThemeMode) : "system";
  const scheme = colorScheme ?? "default";

  return (
    <SettingsPage title="Appearance">
      <SettingGroup heading="Theme">
        <DropdownSetting
          name="Base color scheme"
          description="Light, dark, or follow your system setting."
          value={mode}
          options={THEME_MODES}
          onChange={(v) => setTheme(v)}
        />
        <SettingItem name="Color scheme" description="Colors of the whole app." stacked>
          <div
            role="radiogroup"
            aria-label="Color scheme"
            className={cx("grid gap-2", mobile ? "grid-cols-1" : "grid-cols-3")}
          >
            {COLOR_SCHEMES.map((s) => {
              const active = scheme === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onColorSchemeChange?.(s.value)}
                  className={cx(
                    "flex min-w-0 items-center gap-2 rounded-lg border px-2.5 text-left text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
                    mobile ? "h-11 text-[14px]" : "h-9 text-[13px]",
                    active ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted/60",
                  )}
                >
                  <span
                    className="h-4 w-4 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
                    style={{ background: s.swatch }}
                  />
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        </SettingItem>
      </SettingGroup>
    </SettingsPage>
  );
}
