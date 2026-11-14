"use client";

import { useId } from "react";

import { EDITOR_FONTS } from "@/lib/editor-fonts";
import { formatTitle, useNotes } from "@/lib/notes-context";
import {
  DropdownSetting,
  SettingGroup,
  SettingItem,
  SettingsPage,
  SliderSetting,
  TextInput,
  ToggleSetting,
  useIsMobileSettings,
  useMediaQuery,
} from "./ui";

// Codes understood by formatTitle, shown with today's value as a cheat sheet.
const TITLE_CODES = ["YYYY", "YY", "MMM", "MM", "DD", "DDD", "DAY", "HH", "mm", "ss"] as const;

export function EditorSettings() {
  const { settings, updateSettings } = useNotes();
  const mobile = useIsMobileSettings();
  // The readable column is 750px wide: a phone screen never exceeds it, so
  // the toggle would change nothing there. Tablets (also routed to the
  // mobile app) do get it.
  const wideScreen = useMediaQuery("(min-width: 800px)");
  // Fonts that were removed from the list fall back to the default.
  const font = EDITOR_FONTS.some((f) => f.value === settings.editorFontFamily) ? settings.editorFontFamily : "";

  return (
    <SettingsPage title="Editor">
      <SettingGroup heading="Display">
        <DropdownSetting
          name="Font"
          description="Typeface of the rendered view. Raw markdown always uses a monospace font."
          value={font}
          options={EDITOR_FONTS.map(({ value, label }) => ({ value, label }))}
          onChange={(v) => updateSettings({ editorFontFamily: v })}
        />
        {(!mobile || wideScreen) && (
          <ToggleSetting
            name="Readable line length"
            description="Keep lines at a comfortable width on wide screens instead of filling the window."
            checked={settings.readableLineLength}
            onChange={(v) => updateSettings({ readableLineLength: v })}
          />
        )}
      </SettingGroup>

      <SettingGroup heading="Editing">
        <DropdownSetting
          name="Default view"
          description="How notes open, including the one that is open now. The Raw markdown button in the toolbar switches a single note."
          value={settings.defaultRawMode ? "raw" : "rendered"}
          options={[
            { value: "rendered", label: "Rendered view" },
            { value: "raw", label: "Raw markdown" },
          ]}
          onChange={(v) => updateSettings({ defaultRawMode: v === "raw" })}
        />
      </SettingGroup>

      <SettingGroup heading="Raw markdown">
        <SliderSetting
          name="Font size"
          description="Only for notes shown as raw markdown. The rendered view keeps the theme's text sizes."
          value={settings.editorFontSize}
          min={12}
          max={24}
          format={(v) => `${v}px`}
          onChange={(v) => updateSettings({ editorFontSize: v })}
        />
      </SettingGroup>

      <SettingGroup heading="New notes">
        <TitleTemplateSetting />
        <ToggleSetting
          name="Title as heading"
          description="Start new notes with their title as a heading. Off: start with an empty line."
          checked={settings.headingOnNewNote}
          onChange={(v) => updateSettings({ headingOnNewNote: v })}
        />
      </SettingGroup>
    </SettingsPage>
  );
}

function TitleTemplateSetting() {
  const { settings, updateSettings } = useNotes();
  const id = useId();
  const now = new Date();
  const preview = formatTitle(settings.titleTemplate, now).trim() || "Untitled";
  return (
    <SettingItem
      stacked
      htmlFor={id}
      name="Title"
      description="Codes like YYYY or HH are replaced with the date and time the note is created. Leave empty for “Untitled”."
    >
      <TextInput
        id={id}
        full
        value={settings.titleTemplate}
        placeholder="Untitled"
        onChange={(v) => updateSettings({ titleTemplate: v })}
      />
      <p className="mt-2 text-xs text-muted-foreground">
        A note created now would be called <span className="font-medium text-foreground">{preview}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {TITLE_CODES.map((code) => (
          <span
            key={code}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px]"
          >
            <code className="font-mono text-foreground">{code}</code>
            <span className="text-muted-foreground">{formatTitle(code, now)}</span>
          </span>
        ))}
      </div>
    </SettingItem>
  );
}
