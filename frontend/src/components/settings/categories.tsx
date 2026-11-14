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
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { AboutSettings } from "./AboutSettings";
import { AISettings } from "./AISettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { EditorSettings } from "./EditorSettings";
import { FeatureSettings } from "./FeatureSettings";
import { GeneralSettings } from "./GeneralSettings";
import { MetadataSettings } from "./MetadataSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import { SyncSettings } from "./SyncSettings";
import { VaultSettings } from "./VaultSettings";

/** Props every section receives (only Appearance uses them). */
export type SectionProps = {
  colorScheme?: string;
  onColorSchemeChange?: (scheme: string) => void;
};

export type SettingsCategoryId =
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
};

/** Settings navigation, shared by the desktop sidebar and the mobile list. */
export const SETTINGS_NAV: { label?: string; categories: SettingsCategory[] }[] = [
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
      { id: "metadata", label: "Metadata lookup", icon: Music, Section: MetadataSettings },
      { id: "sync", label: "Git sync", icon: GitBranch, Section: SyncSettings },
    ],
  },
  {
    categories: [{ id: "about", label: "About", icon: Info, Section: AboutSettings }],
  },
];
