"use client";

import { Eye, Lock, Users } from "lucide-react";
import { useState } from "react";

import { avatarUrl, type SpaceInfo, type SpaceRole } from "@/lib/api";
import { getIcon } from "@/lib/icons";

/** Up to two initials: first letters of the first two words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? Array.from(words[0]).slice(0, 2) : [Array.from(words[0])[0], Array.from(words[1])[0]];
  return letters.join("").toUpperCase();
}

// A stable hue per id, so a space keeps its color across sessions and devices.
function hue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

/** Rounded-square space badge: its icon, else its initials on a colored tile. */
export function SpaceAvatar({
  space,
  size = 32,
  active,
}: {
  space: Pick<SpaceInfo, "id" | "name" | "icon">;
  size?: number;
  active?: boolean;
}) {
  const Icon = space.icon ? getIcon(space.icon, Users) : null;
  const h = hue(space.id);
  return (
    <span
      aria-hidden
      className="flex shrink-0 select-none items-center justify-center font-semibold transition-[border-radius,box-shadow]"
      style={{
        width: size,
        height: size,
        borderRadius: active ? size * 0.32 : size * 0.28,
        fontSize: Math.round(size * 0.38),
        background: Icon ? "color-mix(in oklab, var(--primary) 16%, var(--muted))" : `oklch(0.6 0.11 ${h})`,
        color: Icon ? "var(--primary)" : "#fff",
        boxShadow: active ? "0 0 0 2px var(--background), 0 0 0 4px var(--primary)" : undefined,
      }}
    >
      {Icon ? <Icon size={Math.round(size * 0.52)} /> : initials(space.name)}
    </span>
  );
}

/** Round avatar: the user's profile picture, else (or when it can't load,
 *  e.g. offline) their initials on a color derived from the user id. */
export function UserAvatar({
  name,
  userId,
  avatar,
  size = 28,
}: {
  name: string;
  userId: string;
  /** Picture version from the API; absent without a picture. */
  avatar?: string;
  size?: number;
}) {
  const url = avatar ? avatarUrl(userId, avatar) : null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (url && failedUrl !== url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- small, already-sized API image
      <img
        src={url}
        alt=""
        aria-hidden
        width={size}
        height={size}
        draggable={false}
        onError={() => setFailedUrl(url)}
        className="shrink-0 select-none rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 select-none items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: `oklch(0.55 0.09 ${hue(userId)})`,
        color: "#fff",
      }}
    >
      {initials(name)}
    </span>
  );
}

export const ROLE_LABELS: Record<SpaceRole, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

/** "Private" for a space with only its owner, else "Shared · N members", plus the viewer hint. */
export function spaceSummary(space: SpaceInfo): string {
  const shared = space.memberCount > 1 ? `Shared · ${space.memberCount} members` : "Private";
  return space.role === "viewer" ? `${shared} · view only` : shared;
}

/** Lock for private spaces, members icon (+count) for shared ones, eye for view-only. */
export function SpaceBadges({ space, showCount = true }: { space: SpaceInfo; showCount?: boolean }) {
  const shared = space.memberCount > 1;
  return (
    <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
      {space.role === "viewer" && <Eye size={12} aria-label="View only" />}
      {shared ? (
        <span className="flex items-center gap-0.5 text-[11px] tabular-nums" aria-label={`${space.memberCount} members`}>
          <Users size={12} />
          {showCount && space.memberCount}
        </span>
      ) : (
        <Lock size={12} aria-label="Private" />
      )}
    </span>
  );
}
