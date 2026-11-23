"use client";

import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";

import { DASH_SECTIONS, dashLayout, moveSection, type DashSection, type DashSectionId, type DashShell } from "@/lib/dashboard";
import { useNotes } from "@/lib/notes-context";
import { Button, cx, IconButton, SettingGroup, SettingsPage, Toggle, useIsMobileSettings } from "./ui";

type Group = { heading: string; description: string; ids: DashSectionId[] };

export function DashboardSettings() {
  const { settings, updateSettings } = useNotes();
  const mobile = useIsMobileSettings();
  // The phone and the desktop dashboards differ (one column vs. a main and
  // a side column): this page edits the one of the interface in use.
  const shell: DashShell = mobile ? "touch" : "desktop";
  const layout = dashLayout(shell === "desktop" ? settings.dashboardDesktop : settings.dashboardTouch, shell);
  const save = (next: DashSection[] | null) =>
    updateSettings(shell === "desktop" ? { dashboardDesktop: next } : { dashboardTouch: next });
  const change = (id: DashSectionId, patch: Partial<Omit<DashSection, "id">>) =>
    save(layout.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const idsIn = (column: "main" | "side") => layout.filter((s) => DASH_SECTIONS[s.id].column === column).map((s) => s.id);
  const groups: Group[] =
    shell === "desktop"
      ? [
          { heading: "Main column", description: "The wide column under the search bar, top to bottom.", ids: idsIn("main") },
          { heading: "Side column", description: "The narrow column on the right, top to bottom.", ids: idsIn("side") },
        ]
      : [{ heading: "Sections", description: "Top to bottom. The desktop dashboard has its own layout.", ids: layout.map((s) => s.id) }];

  return (
    <SettingsPage title="Dashboard">
      {groups.map((group) => (
        <SettingGroup key={group.heading} heading={group.heading} description={group.description}>
          {group.ids.map((id, i) => {
            const s = layout.find((x) => x.id === id);
            if (!s) return null;
            return (
              <SectionRow
                key={id}
                section={s}
                first={i === 0}
                last={i === group.ids.length - 1}
                onMove={(step) => save(moveSection(layout, id, step, group.ids))}
                onChange={(patch) => change(id, patch)}
              />
            );
          })}
        </SettingGroup>
      ))}
      <div className={cx("flex justify-end", mobile ? "mt-5" : "mt-4")}>
        <Button onClick={() => save(null)}>
          <RotateCcw className={mobile ? "h-4 w-4" : "h-3.5 w-3.5"} />
          Reset to default
        </Button>
      </div>
    </SettingsPage>
  );
}

function SectionRow({
  section,
  first,
  last,
  onMove,
  onChange,
}: {
  section: DashSection;
  first: boolean;
  last: boolean;
  onMove: (step: -1 | 1) => void;
  onChange: (patch: Partial<Omit<DashSection, "id">>) => void;
}) {
  const mobile = useIsMobileSettings();
  const info = DASH_SECTIONS[section.id];
  const moves = (
    <span className="flex shrink-0 items-center">
      <IconButton label={`Move ${info.name} up`} disabled={first} onClick={() => onMove(-1)}>
        <ChevronUp className={mobile ? "h-5 w-5" : "h-4 w-4"} />
      </IconButton>
      <IconButton label={`Move ${info.name} down`} disabled={last} onClick={() => onMove(1)}>
        <ChevronDown className={mobile ? "h-5 w-5" : "h-4 w-4"} />
      </IconButton>
    </span>
  );
  const modes = info.modes && (
    <ModeSwitch compact={section.compact} disabled={!section.shown} name={info.name} onChange={(compact) => onChange({ compact })} />
  );
  const text = (
    <span className={cx("flex min-w-0 flex-1 flex-col", !section.shown && "opacity-55")}>
      <span className={cx("leading-snug text-foreground", mobile ? "text-[15px]" : "text-sm")}>{info.name}</span>
      <span className={cx("mt-0.5 leading-snug text-muted-foreground", mobile ? "text-[13px]" : "text-xs")}>{info.description}</span>
    </span>
  );
  const toggle = <Toggle checked={section.shown} onChange={(shown) => onChange({ shown })} label={`Show ${info.name}`} />;

  // Phone: the name with its switch, then the look and the arrows below —
  // one line would leave the name no room.
  if (mobile) {
    return (
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-start gap-3">
          {text}
          {toggle}
        </div>
        <div className="flex items-center gap-2">
          {modes}
          <span className="flex-1" />
          {moves}
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
      {text}
      {modes}
      {moves}
      {toggle}
    </div>
  );
}

/** Detailed or compact, for the sections that have both looks. */
function ModeSwitch({
  compact,
  disabled,
  name,
  onChange,
}: {
  compact: boolean;
  disabled: boolean;
  name: string;
  onChange: (compact: boolean) => void;
}) {
  const mobile = useIsMobileSettings();
  return (
    <span
      role="radiogroup"
      aria-label={`${name} look`}
      className={cx("inline-flex shrink-0 rounded-lg border border-border bg-background p-0.5", disabled && "pointer-events-none opacity-50")}
    >
      {[
        { value: false, label: "Detailed" },
        { value: true, label: "Compact" },
      ].map((o) => (
        <button
          key={o.label}
          type="button"
          role="radio"
          aria-checked={compact === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-md font-medium transition-colors",
            mobile ? "h-8 px-3 text-[13px]" : "h-6 px-2.5 text-xs",
            compact === o.value ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}
