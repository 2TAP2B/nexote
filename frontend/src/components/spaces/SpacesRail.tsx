"use client";

import {
  Eye,
  Lock,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Trash2,
  UserCog,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import ContextMenu, { type MenuItem } from "@/components/ContextMenu";
import { api, type SpaceInfo } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";

import { SpaceAvatar, SpaceBadges, spaceSummary, UserAvatar } from "./SpaceAvatar";
import { NewSpaceDialog } from "./SpaceDialog";
import SpaceSettingsDialog, { type SpaceSettingsSection } from "./SpaceSettingsDialog";

const EXPANDED_KEY = "nexote:spaces-rail-expanded";
const HOVER = "hover:bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)]";

/** Whether the user may leave: not the space's only owner. */
export async function canLeaveSpace(space: SpaceInfo): Promise<boolean> {
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
 * Desktop space switcher at the far left of the shell: space avatars
 * (collapsed) or avatars with names (expanded), a "new space" button, and the
 * signed-in account at the bottom.
 */
export default function SpacesRail() {
  const { spaces, activeSpaceId, switchSpace } = useNotes();
  const { user, logout } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [settingsFor, setSettingsFor] = useState<{ id: string; section?: SpaceSettingsSection } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  // Effect-based restore: a localStorage useState initializer breaks hydration.
  useEffect(() => {
    if (localStorage.getItem(EXPANDED_KEY) === "1") setExpanded(true);
  }, []);
  const toggleExpanded = () => {
    setExpanded((v) => {
      localStorage.setItem(EXPANDED_KEY, v ? "0" : "1");
      return !v;
    });
  };

  const openSpaceMenu = async (space: SpaceInfo, x: number, y: number) => {
    const leavable = await canLeaveSpace(space);
    const items: MenuItem[] = [
      { label: "Space settings…", icon: <Settings size={14} />, onClick: () => setSettingsFor({ id: space.id }) },
    ];
    if (leavable) {
      items.push({
        label: "Leave space",
        icon: <LogOut size={14} />,
        onClick: () => setSettingsFor({ id: space.id, section: "leave" }),
      });
    }
    if (space.role === "owner") {
      items.push({ label: "", onClick: () => {}, separator: true });
      items.push({
        label: "Delete space…",
        icon: <Trash2 size={14} />,
        danger: true,
        onClick: () => setSettingsFor({ id: space.id, section: "delete" }),
      });
    }
    setMenu({ x, y, items });
  };

  const openUserMenu = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu({
      x: r.left + 6,
      y: r.top - 2 * 34 - 14,
      items: [
        {
          label: "Account settings",
          icon: <UserCog size={14} />,
          onClick: () => window.dispatchEvent(new CustomEvent("nexote:open-settings", { detail: "account" })),
        },
        { label: "Sign out", icon: <LogOut size={14} />, onClick: () => void logout() },
      ],
    });
  };

  return (
    <nav
      aria-label="Spaces"
      className="flex h-full shrink-0 flex-col transition-[width] duration-200"
      style={{
        width: expanded ? 224 : 52,
        background: "var(--icon-rail)",
        borderRight: "1px solid var(--border)",
      }}
    >
      <div
        className={"flex h-10 shrink-0 items-center " + (expanded ? "gap-1 pl-3 pr-1.5" : "justify-center")}
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        {expanded && (
          <span className="flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Spaces
          </span>
        )}
        <button
          type="button"
          aria-label={expanded ? "Collapse spaces" : "Expand spaces"}
          title={expanded ? "Collapse spaces" : "Expand spaces"}
          aria-expanded={expanded}
          onClick={toggleExpanded}
          className={"flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground/70 hover:text-foreground " + HOVER}
        >
          {expanded ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
        </button>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden py-2 no-scrollbar">
        {spaces.map((space) => {
          const active = space.id === activeSpaceId;
          return (
            <li key={space.id} className="group relative px-1.5">
              {/* Active marker on the rail's edge. */}
              <span
                aria-hidden
                className="absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full transition-[height,opacity]"
                style={{
                  height: active ? 22 : 8,
                  opacity: active ? 1 : 0,
                  background: "var(--primary)",
                }}
              />
              <button
                type="button"
                aria-current={active ? "true" : undefined}
                aria-label={`${space.name} — ${spaceSummary(space)}`}
                title={expanded ? undefined : `${space.name}\n${spaceSummary(space)}`}
                onClick={() => switchSpace(space.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  void openSpaceMenu(space, e.clientX, e.clientY);
                }}
                className={
                  "flex w-full items-center rounded-lg transition-colors " +
                  (expanded ? "h-10 gap-2.5 pl-1.5 pr-8 " : "h-10 justify-center ") +
                  (active && expanded
                    ? "bg-[color-mix(in_oklab,var(--primary)_12%,transparent)] "
                    : HOVER)
                }
              >
                <span className="relative">
                  <SpaceAvatar space={space} size={expanded ? 28 : 32} active={active && !expanded} />
                  {!expanded && <CornerBadge space={space} />}
                </span>
                {expanded && (
                  <>
                    <span
                      className="min-w-0 flex-1 truncate text-left text-[13px]"
                      style={{ color: active ? "var(--primary)" : "var(--foreground)", fontWeight: active ? 600 : 500 }}
                    >
                      {space.name}
                    </span>
                    <SpaceBadges space={space} />
                  </>
                )}
              </button>
              {expanded && (
                <button
                  type="button"
                  aria-label={`${space.name} options`}
                  title="Options"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    void openSpaceMenu(space, r.left, r.bottom + 4);
                  }}
                  className={
                    "absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 " +
                    HOVER
                  }
                >
                  <MoreHorizontal size={15} />
                </button>
              )}
            </li>
          );
        })}
        <li className="px-1.5">
          <button
            type="button"
            aria-label="New space"
            title={expanded ? undefined : "New space"}
            onClick={() => setNewOpen(true)}
            className={
              "flex h-10 w-full items-center rounded-lg text-muted-foreground transition-colors hover:text-foreground " +
              (expanded ? "gap-2.5 pl-1.5 " : "justify-center ") +
              HOVER
            }
          >
            <span
              className="flex shrink-0 items-center justify-center rounded-[9px] border border-dashed"
              style={{ width: expanded ? 28 : 32, height: expanded ? 28 : 32, borderColor: "var(--muted-foreground)" }}
            >
              <Plus size={16} />
            </span>
            {expanded && <span className="text-[13px] font-medium">New space</span>}
          </button>
        </li>
      </ul>

      <div className="shrink-0 px-1.5 py-2" style={{ borderTop: "1px solid var(--border)" }}>
        <button
          type="button"
          aria-label={`Account: ${user.displayName}`}
          aria-haspopup="menu"
          title={expanded ? undefined : `${user.displayName} (@${user.username})`}
          onClick={(e) => openUserMenu(e.currentTarget)}
          className={
            "flex h-10 w-full items-center rounded-lg transition-colors " +
            (expanded ? "gap-2.5 pl-1.5 pr-2 " : "justify-center ") +
            HOVER
          }
        >
          <UserAvatar name={user.displayName} seed={user.id} size={expanded ? 28 : 30} />
          {expanded && (
            <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
              <span className="truncate text-[13px] font-medium text-foreground">{user.displayName}</span>
              <span className="truncate text-[11px] text-muted-foreground">@{user.username}</span>
            </span>
          )}
        </button>
      </div>

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
    </nav>
  );
}

// Collapsed rail: a tiny lock / members / eye marker on the avatar's corner.
function CornerBadge({ space }: { space: SpaceInfo }) {
  const Icon = space.role === "viewer" ? Eye : space.memberCount > 1 ? Users : Lock;
  return (
    <span
      aria-hidden
      className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground"
      style={{ background: "var(--icon-rail)", boxShadow: "0 0 0 1px var(--border)" }}
    >
      <Icon size={9} strokeWidth={2.5} />
    </span>
  );
}
