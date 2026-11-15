import {
  FolderPlus,
  GitBranch,
  Home,
  Info,
  Keyboard,
  Music,
  Palette,
  PenLine,
  SlidersHorizontal,
  UserRound,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import type { UserRole } from "@/lib/api";
import { AboutSettings } from "./AboutSettings";
import { AccountSettings } from "./AccountSettings";
import { AISettings } from "./AISettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { EditorSettings } from "./EditorSettings";
import { FeatureSettings } from "./FeatureSettings";
import { GeneralSettings } from "./GeneralSettings";
import { MetadataSettings } from "./MetadataSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import { SyncSettings } from "./SyncSettings";
import { UsersSettings } from "./UsersSettings";
import { VaultSettings } from "./VaultSettings";

/** Props every section receives (only Appearance uses them). */
export type SectionProps = {
  colorScheme?: string;
  onColorSchemeChange?: (scheme: string) => void;
};

export type SettingsCategoryId =
  | "account"
  | "users"
  | "general"
  | "editor"
  | "appearance"
  | "vaults"
  | "features"
  | "shortcuts"
  | "ai"
  | "metadata"
  | "sync"
  | "about";

export type SettingsCategory = {
  id: SettingsCategoryId;
  label: string;
  icon: LucideIcon;
  Section: (props: SectionProps) => ReactNode;
  /** Hidden on touch devices (no keyboard). */
  desktopOnly?: boolean;
  /** Server-wide settings only admins may change. */
  adminOnly?: boolean;
};

type SettingsNav = { label?: string; categories: SettingsCategory[] }[];

const SETTINGS_NAV: SettingsNav = [
  {
    label: "Account",
    categories: [
      { id: "account", label: "Account", icon: UserRound, Section: AccountSettings },
      { id: "users", label: "Users", icon: Users, Section: UsersSettings, adminOnly: true },
    ],
  },
  {
    label: "Options",
    categories: [
      { id: "general", label: "General", icon: Home, Section: GeneralSettings },
      { id: "editor", label: "Editor", icon: PenLine, Section: EditorSettings },
      { id: "appearance", label: "Appearance", icon: Palette, Section: AppearanceSettings },
      { id: "vaults", label: "Vaults", icon: FolderPlus, Section: VaultSettings },
      { id: "features", label: "Features", icon: SlidersHorizontal, Section: FeatureSettings },
      { id: "shortcuts", label: "Shortcuts", icon: Keyboard, Section: ShortcutSettings, desktopOnly: true },
    ],
  },
  {
    label: "Integrations",
    categories: [
      { id: "ai", label: "AI", icon: Zap, Section: AISettings },
      { id: "metadata", label: "Metadata lookup", icon: Music, Section: MetadataSettings, adminOnly: true },
      { id: "sync", label: "Git sync", icon: GitBranch, Section: SyncSettings, adminOnly: true },
    ],
  },
  {
    categories: [{ id: "about", label: "About", icon: Info, Section: AboutSettings }],
  },
];

/** Settings navigation for the desktop sidebar and the mobile list: admin
 *  pages only for admins, keyboard pages only with a keyboard. */
export function settingsNav(role: UserRole, platform: "desktop" | "mobile"): SettingsNav {
  return SETTINGS_NAV.map((group) => ({
    ...group,
    categories: group.categories.filter(
      (c) => (role === "admin" || !c.adminOnly) && (platform === "desktop" || !c.desktopOnly),
    ),
  })).filter((group) => group.categories.length > 0);
}

/** The category asked for by a `nexote:open-settings` event, if any:
 *  `window.dispatchEvent(new CustomEvent("nexote:open-settings", { detail: "account" }))`. */
export function requestedCategory(event: Event): SettingsCategoryId | null {
  if (!(event instanceof CustomEvent)) return null;
  const ids = SETTINGS_NAV.flatMap((g) => g.categories.map((c) => c.id));
  return ids.find((id) => id === event.detail) ?? null;
}
