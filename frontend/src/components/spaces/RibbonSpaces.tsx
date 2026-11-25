"use client";

import { Check, Eye, Lock, LogOut, MoreHorizontal, Plus, Settings, Trash2, UserCog, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useAuth } from "@/components/auth/AuthProvider";
import ContextMenu, { type MenuItem } from "@/components/ContextMenu";
import { useAndroidBack } from "@/lib/android-back";
import { api, type SpaceInfo } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";

import { SpaceAvatar, SpaceBadges, spaceSummary, UserAvatar } from "./SpaceAvatar";
import { NewSpaceDialog } from "./SpaceDialog";
import SpaceSettingsDialog, { type SpaceSettingsSection } from "./SpaceSettingsDialog";

const HOVER = "hover:bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)]";

/** Whether the user may leave: not the space's only owner. */
async function canLeaveSpace(space: SpaceInfo): Promise<boolean> {
  if (space.role !== "owner") return true;
  if (space.memberCount <= 1) return false;
  try {
    const { members } = await api.listMembers(space.id);
    return (members ?? []).filter((m) => m.role === "owner").length > 1;
  } catch {
    return false;
  }
}

/**
 * Bottom of the desktop ribbon, right above the account: the active space's
 * avatar. Clicking it opens a panel beside the ribbon (growing upward) to
 * switch spaces, create one, or open a space's settings (⋯ or right-click).
 */
export function SpaceSwitcher() {
  const { spaces, activeSpace, switchSpace } = useNotes();
  const { local } = useAuth();
  const [panel, setPanel] = useState<{ bottom: number; left: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [settingsFor, setSettingsFor] = useState<{ id: string; section?: SpaceSettingsSection } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useAndroidBack(() => setPanel(null), panel !== null);

  // Close on outside click / Escape (the ⋯ menu handles its own clicks).
  useEffect(() => {
    if (!panel) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      if (menu) return;
      setPanel(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !menu) setPanel(null);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [panel, menu]);

  const toggle = () => {
    if (panel) {
      setPanel(null);
      return;
    }
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setPanel({ bottom: window.innerHeight - r.bottom, left: r.right + 8 });
  };

  const openSpaceMenu = async (space: SpaceInfo, x: number, y: number) => {
    // Local mode: the only account owns every space; leaving one would just
    // lose it.
    const leavable = !local && (await canLeaveSpace(space));
    const open = (section?: SpaceSettingsSection) => () => {
      setPanel(null);
      setSettingsFor({ id: space.id, section });
    };
    const items: MenuItem[] = [{ label: "Space settings…", icon: <Settings size={14} />, onClick: open() }];
    if (leavable) items.push({ label: "Leave space", icon: <LogOut size={14} />, onClick: open("leave") });
    if (space.role === "owner") {
      items.push({ label: "", onClick: () => {}, separator: true });
      items.push({ label: "Delete space…", icon: <Trash2 size={14} />, danger: true, onClick: open("delete") });
    }
    setMenu({ x, y, items });
  };

  const CornerIcon = !activeSpace ? null : activeSpace.role === "viewer" ? Eye : activeSpace.memberCount > 1 ? Users : Lock;

  return (
    <>
      {/* Separates the space and account from the views above. */}
      <span aria-hidden className="mb-1 h-px w-6" style={{ background: "var(--border)" }} />
      <button
        ref={buttonRef}
        type="button"
        aria-label={activeSpace ? `Space: ${activeSpace.name} — ${spaceSummary(activeSpace)}. Switch space` : "Switch space"}
        aria-haspopup="dialog"
        aria-expanded={panel !== null}
        title={activeSpace ? `${activeSpace.name}\n${spaceSummary(activeSpace)}` : "Spaces"}
        onClick={toggle}
        className={"relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors " + HOVER}
      >
        {activeSpace && <SpaceAvatar space={activeSpace} size={26} />}
        {CornerIcon && (
          <span
            aria-hidden
            className="absolute bottom-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground"
            style={{ background: "var(--icon-rail)", boxShadow: "0 0 0 1px var(--border)" }}
          >
            <CornerIcon size={8} strokeWidth={2.5} />
          </span>
        )}
      </button>

      {panel &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Spaces"
            className="fixed z-50 w-72 overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-xl"
            style={{ bottom: panel.bottom, left: panel.left }}
          >
            <div className="px-3 pb-1.5 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Spaces
            </div>
            <ul className="max-h-[60vh] overflow-y-auto px-1.5 pb-1.5">
              {spaces.map((space) => {
                const active = space.id === activeSpace?.id;
                return (
                  <li key={space.id} className="group relative">
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => {
                        switchSpace(space.id);
                        setPanel(null);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        void openSpaceMenu(space, e.clientX, e.clientY);
                      }}
                      className={
                        "flex w-full items-center gap-2.5 rounded-lg py-1.5 pl-1.5 pr-16 text-left transition-colors " +
                        (active ? "bg-[color-mix(in_oklab,var(--primary)_10%,transparent)]" : HOVER)
                      }
                    >
                      <SpaceAvatar space={space} size={30} />
                      <span className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span
                          className="truncate text-[13px]"
                          style={{ color: active ? "var(--primary)" : "var(--foreground)", fontWeight: active ? 600 : 500 }}
                        >
                          {space.name}
                        </span>
                        <span className="truncate text-[11px] text-muted-foreground">{spaceSummary(space)}</span>
                      </span>
                    </button>
                    <span className="pointer-events-none absolute right-8 top-1/2 flex -translate-y-1/2 items-center">
                      {active ? <Check size={15} className="text-primary" /> : <SpaceBadges space={space} showCount={false} />}
                    </span>
                    <button
                      type="button"
                      aria-label={`${space.name} options`}
                      title="Options"
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        void openSpaceMenu(space, r.left, r.bottom + 4);
                      }}
                      className={
                        "absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 " +
                        HOVER
                      }
                    >
                      <MoreHorizontal size={15} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-border p-1.5">
              <button
                type="button"
                onClick={() => {
                  setPanel(null);
                  setNewOpen(true);
                }}
                className={"flex w-full items-center gap-2.5 rounded-lg py-1.5 pl-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground " + HOVER}
              >
                <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] border border-dashed border-muted-foreground/60">
                  <Plus size={15} />
                </span>
                New space
              </button>
            </div>
          </div>,
          document.body,
        )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {newOpen && <NewSpaceDialog platform="desktop" onClose={() => setNewOpen(false)} />}
      {settingsFor && (
        <SpaceSettingsDialog
          key={`${settingsFor.id}:${settingsFor.section ?? ""}`}
          spaceId={settingsFor.id}
          platform="desktop"
          initialSection={settingsFor.section}
          onClose={() => setSettingsFor(null)}
        />
      )}
    </>
  );
}

/** Bottom of the desktop ribbon: the signed-in account (settings, sign out).
 *  None in local mode: one account, nothing to manage or sign out of. */
export function AccountButton() {
  const { user, local, logout } = useAuth();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  if (local) return null;
  return (
    <>
      <button
        type="button"
        aria-label={`Account: ${user.displayName}`}
        aria-haspopup="menu"
        title={`${user.displayName} (@${user.username})`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.right + 6, y: r.bottom - 2 * 34 - 8 });
        }}
        className={"flex h-9 w-9 items-center justify-center rounded-md transition-colors " + HOVER}
      >
        <UserAvatar name={user.displayName} userId={user.id} avatar={user.avatar} size={24} />
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Account settings",
              icon: <UserCog size={14} />,
              onClick: () => window.dispatchEvent(new CustomEvent("nexote:open-settings", { detail: "account" })),
            },
            { label: "Sign out", icon: <LogOut size={14} />, onClick: () => void logout() },
          ]}
        />
      )}
    </>
  );
}
