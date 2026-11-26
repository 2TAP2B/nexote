import {
  FolderPlus,
  FolderOpen,
  GitBranch,
  Home,
  Info,
  Keyboard,
  LayoutDashboard,
  Music,
  Palette,
  PenLine,
  Server,
  SlidersHorizontal,
  Smartphone,
  UserRound,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import type { UserRole } from "@/lib/api";
import { isAndroidApp } from "@/lib/app-info";
import { AboutSettings } from "./AboutSettings";
import { AccountSettings } from "./AccountSettings";
import { AISettings } from "./AISettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { DashboardSettings } from "./DashboardSettings";
import { DevicesSettings } from "./DevicesSettings";
import { EditorSettings } from "./EditorSettings";
import { FeatureSettings } from "./FeatureSettings";
import { GeneralSettings } from "./GeneralSettings";
import { MetadataSettings } from "./MetadataSettings";
import { ServerSettings } from "./ServerSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import { StorageSettings } from "./StorageSettings";
import { SyncSettings } from "./SyncSettings";
import { UsersSettings } from "./UsersSettings";
import { VaultSettings } from "./VaultSettings";

/** Props every section receives (only Appearance uses them). */
export type SectionProps = {
  colorScheme?: string;
  onColorSchemeChange?: (scheme: string) => void;
};

export type SettingsCategoryId =
  | "storage"
  | "server"
  | "account"
  | "devices"
  | "users"
  | "general"
  | "editor"
  | "appearance"
  | "vaults"
  | "features"
  | "dashboard"
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
  /** Only with a server: hidden in local mode and in the Android app's
   *  build (the app's engine has one account, no passkeys, no git sync and
   *  no paired devices). */
  serverOnly?: boolean;
  /** Only in the Android app's build. */
  appOnly?: boolean;
};

type SettingsNav = { label?: string; categories: SettingsCategory[] }[];

const SETTINGS_NAV: SettingsNav = [
  {
    categories: [
      { id: "storage", label: "Storage", icon: FolderOpen, Section: StorageSettings, appOnly: true },
      { id: "server", label: "Server", icon: Server, Section: ServerSettings, appOnly: true },
    ],
  },
  {
    label: "Account",
    categories: [
      // Without other accounts only server things remain: the name and
      // picture are for the other members, the rest is passkeys and sign-out.
      { id: "account", label: "Account", icon: UserRound, Section: AccountSettings, serverOnly: true },
      { id: "devices", label: "Devices", icon: Smartphone, Section: DevicesSettings, serverOnly: true },
      { id: "users", label: "Users", icon: Users, Section: UsersSettings, adminOnly: true, serverOnly: true },
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
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, Section: DashboardSettings },
      { id: "shortcuts", label: "Shortcuts", icon: Keyboard, Section: ShortcutSettings, desktopOnly: true },
    ],
  },
  {
    label: "Integrations",
    categories: [
      { id: "ai", label: "AI", icon: Zap, Section: AISettings },
      { id: "metadata", label: "Metadata lookup", icon: Music, Section: MetadataSettings, adminOnly: true },
      { id: "sync", label: "Git sync", icon: GitBranch, Section: SyncSettings, adminOnly: true, serverOnly: true },
    ],
  },
  {
    categories: [{ id: "about", label: "About", icon: Info, Section: AboutSettings }],
  },
];

/** Settings navigation for the desktop sidebar and the mobile list: admin
 *  pages only for admins, keyboard pages only with a keyboard, server pages
 *  not in local mode, app pages only in the app. */
export function settingsNav(role: UserRole, platform: "desktop" | "mobile", local: boolean): SettingsNav {
  return SETTINGS_NAV.map((group) => ({
    ...group,
    categories: group.categories.filter(
      (c) =>
        (role === "admin" || !c.adminOnly) &&
        (platform === "desktop" || !c.desktopOnly) &&
        (!(local || isAndroidApp) || !c.serverOnly) &&
        (isAndroidApp || !c.appOnly),
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
