"use client";

import { Check, ChevronRight, LogOut, MoreHorizontal, Plus, UserCog } from "lucide-react";
import { useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useNotes } from "@/lib/notes-context";

import { SpaceAvatar, SpaceBadges, spaceSummary, UserAvatar } from "./SpaceAvatar";
import { NewSpaceDialog } from "./SpaceDialog";
import SpaceSettingsDialog from "./SpaceSettingsDialog";

/**
 * Mobile pager pane left of the note tree: the user's spaces (tap switches
 * and returns to the tree), "New space", per-space settings and the account.
 */
export default function MobileSpacesPane({ onShowTree }: { onShowTree: () => void }) {
  const { spaces, activeSpaceId, switchSpace } = useNotes();
  const { user, logout } = useAuth();
  const [newOpen, setNewOpen] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);

  return (
    <div
      className="relative flex h-full w-1/4 shrink-0 flex-col overflow-hidden"
      style={{ background: "var(--mob-bg)", borderRight: "1px solid var(--mob-surface)" }}
    >
      <div
        className="flex shrink-0 items-center gap-3 px-3"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
          paddingBottom: 8,
          borderBottom: "1px solid var(--mob-surface)",
        }}
      >
        <span className="flex-1 pl-1 text-lg font-semibold" style={{ color: "var(--mob-text)" }}>
          Spaces
        </span>
        <button
          type="button"
          aria-label="Show notes"
          onClick={onShowTree}
          className="flex items-center justify-center rounded-full transition-transform active:scale-95"
          style={{ width: 40, height: 40, background: "var(--mob-surface)", color: "var(--mob-text)" }}
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        <ul className="overflow-hidden rounded-xl" style={{ background: "var(--mob-card)" }}>
          {spaces.map((space, i) => {
            const active = space.id === activeSpaceId;
            return (
              <li
                key={space.id}
                className="flex items-center"
                style={i > 0 ? { borderTop: "1px solid var(--mob-surface)" } : undefined}
              >
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => {
                    switchSpace(space.id);
                    onShowTree();
                  }}
                  className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 text-left transition-colors active:bg-[var(--mob-surface)]"
                >
                  <SpaceAvatar space={space} size={40} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      className="flex items-center gap-1.5 truncate text-[16px]"
                      style={{ color: active ? "var(--mob-accent)" : "var(--mob-text)", fontWeight: active ? 600 : 500 }}
                    >
                      <span className="truncate">{space.name}</span>
                      <SpaceBadges space={space} showCount={false} />
                    </span>
                    <span className="truncate text-[13px]" style={{ color: "var(--mob-muted)" }}>
                      {spaceSummary(space)}
                    </span>
                  </span>
                  {active && <Check size={18} style={{ color: "var(--mob-accent)" }} />}
                </button>
                <button
                  type="button"
                  aria-label={`${space.name} settings`}
                  onClick={() => setSettingsFor(space.id)}
                  className="flex h-16 w-12 shrink-0 items-center justify-center transition-colors active:bg-[var(--mob-surface)]"
                  style={{ color: "var(--mob-muted)" }}
                >
                  <MoreHorizontal size={20} />
                </button>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="mt-3 flex min-h-14 w-full items-center gap-3 rounded-xl px-3 transition-colors active:bg-[var(--mob-surface)]"
          style={{ background: "var(--mob-card)", color: "var(--mob-text)" }}
        >
          <span
            className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-dashed"
            style={{ borderColor: "var(--mob-muted)", color: "var(--mob-muted)" }}
          >
            <Plus size={20} />
          </span>
          <span className="text-[16px] font-medium">New space</span>
        </button>
      </div>

      <div
        className="shrink-0 px-3 pt-3"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
          borderTop: "1px solid var(--mob-surface)",
        }}
      >
        <div className="overflow-hidden rounded-xl" style={{ background: "var(--mob-card)" }}>
          <div className="flex items-center gap-3 px-3 py-3">
            <UserAvatar name={user.displayName} seed={user.id} size={40} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[16px] font-medium" style={{ color: "var(--mob-text)" }}>
                {user.displayName}
              </span>
              <span className="truncate text-[13px]" style={{ color: "var(--mob-muted)" }}>
                @{user.username}
              </span>
            </span>
          </div>
          <div className="flex" style={{ borderTop: "1px solid var(--mob-surface)" }}>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("nexote:open-settings", { detail: "account" }))}
              className="flex min-h-12 flex-1 items-center justify-center gap-2 text-[15px] transition-colors active:bg-[var(--mob-surface)]"
              style={{ color: "var(--mob-text)" }}
            >
              <UserCog size={17} />
              Account
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex min-h-12 flex-1 items-center justify-center gap-2 text-[15px] text-red-500 transition-colors active:bg-[var(--mob-surface)]"
              style={{ borderLeft: "1px solid var(--mob-surface)" }}
            >
              <LogOut size={17} />
              Sign out
            </button>
          </div>
        </div>
      </div>

      {newOpen && <NewSpaceDialog platform="mobile" onClose={() => setNewOpen(false)} onCreated={onShowTree} />}
      {settingsFor && (
        <SpaceSettingsDialog spaceId={settingsFor} platform="mobile" onClose={() => setSettingsFor(null)} />
      )}
    </div>
  );
}
