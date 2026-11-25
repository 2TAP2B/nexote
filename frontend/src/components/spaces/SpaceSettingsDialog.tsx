"use client";

import { LayoutGrid, LogOut, Trash2, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { IconPicker } from "@/components/settings/IconPicker";
import {
  Button,
  Dropdown,
  errorText,
  IconButton,
  SettingGroup,
  SettingItem,
  SettingRow,
  StatusText,
  TextInput,
  cx,
  useIsMobileSettings,
  type Option,
} from "@/components/settings/ui";
import { api, type DirectoryUser, type SpaceMember, type SpaceRole } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";

import { SpaceDialogShell, type SpacePlatform } from "./SpaceDialog";
import { ROLE_LABELS, SpaceAvatar, spaceSummary, UserAvatar } from "./SpaceAvatar";

export type SpaceSettingsSection = "leave" | "delete";

const ROLE_OPTIONS: readonly Option<SpaceRole>[] = [
  { value: "owner", label: "Owner" },
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
];
const ADD_ROLE_OPTIONS: readonly Option<"editor" | "viewer">[] = [
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
];

/**
 * A space's name/icon, members and leave/delete. Owners edit everything;
 * other members see the member list read-only and can leave. Server
 * refusals (e.g. the last owner leaving) show inline next to the action.
 * Local mode (one account, the owner of everything) has only name, icon and
 * delete.
 */
export default function SpaceSettingsDialog({
  spaceId,
  platform,
  initialSection,
  onClose,
}: {
  spaceId: string;
  platform: SpacePlatform;
  /** Opens with that section in view (leave: already asking to confirm). */
  initialSection?: SpaceSettingsSection;
  onClose: () => void;
}) {
  const { spaces } = useNotes();
  const space = spaces.find((s) => s.id === spaceId) ?? null;

  // Gone (deleted, left, or removed by an owner elsewhere): nothing to show.
  useEffect(() => {
    if (!space) onClose();
  }, [space, onClose]);
  if (!space) return null;

  return (
    <SpaceDialogShell platform={platform} title="Space settings" onClose={onClose}>
      <SpaceSettingsBody spaceId={space.id} initialSection={initialSection} onClose={onClose} />
    </SpaceDialogShell>
  );
}

function SpaceSettingsBody({
  spaceId,
  initialSection,
  onClose,
}: {
  spaceId: string;
  initialSection?: SpaceSettingsSection;
  onClose: () => void;
}) {
  const { spaces, updateSpace, deleteSpace, leaveSpace, refreshSpaces } = useNotes();
  const { user, local } = useAuth();
  const mobile = useIsMobileSettings();
  const space = spaces.find((s) => s.id === spaceId);
  const isOwner = space?.role === "owner";

  // --- Name + icon (owners) ---
  const [name, setName] = useState(space?.name ?? "");
  const [generalStatus, setGeneralStatus] = useState<string | null>(null);
  const savedName = space?.name ?? "";
  useEffect(() => setName(savedName), [savedName]);
  const saveName = async () => {
    const next = name.trim();
    if (!next) {
      setName(savedName);
      return;
    }
    if (next === savedName) return;
    try {
      await updateSpace(spaceId, { name: next });
      setGeneralStatus(null);
    } catch (err) {
      setGeneralStatus(errorText(err, "Couldn't rename the space."));
      setName(savedName);
    }
  };
  const saveIcon = async (icon: string) => {
    try {
      await updateSpace(spaceId, { icon });
      setGeneralStatus(null);
    } catch (err) {
      setGeneralStatus(errorText(err, "Couldn't change the icon."));
    }
  };

  // --- Members ---
  const [members, setMembers] = useState<SpaceMember[] | null>(null);
  const [membersStatus, setMembersStatus] = useState<string | null>(null);
  const loadMembers = useCallback(async () => {
    if (local) return;
    try {
      const res = await api.listMembers(spaceId);
      setMembers(res.members ?? []);
    } catch (err) {
      setMembersStatus(errorText(err, "Couldn't load the members."));
    }
  }, [spaceId, local]);
  // Reload when someone else changes the membership (SSE spaces-change
  // updates memberCount and fires nexote:refresh-data, which also covers
  // role changes that keep the count).
  const memberCount = space?.memberCount;
  useEffect(() => {
    void loadMembers();
  }, [loadMembers, memberCount]);
  useEffect(() => {
    const onRefresh = () => void loadMembers();
    window.addEventListener("nexote:refresh-data", onRefresh);
    return () => window.removeEventListener("nexote:refresh-data", onRefresh);
  }, [loadMembers]);

  const changeRole = async (member: SpaceMember, role: SpaceRole) => {
    setMembersStatus(null);
    try {
      const res = await api.setMember(spaceId, member.userId, role);
      setMembers(res.members ?? []);
    } catch (err) {
      setMembersStatus(errorText(err, "Couldn't change the role."));
    }
  };
  const removeMember = async (member: SpaceMember) => {
    setMembersStatus(null);
    try {
      await api.removeMember(spaceId, member.userId);
      await loadMembers();
      await refreshSpaces();
    } catch (err) {
      setMembersStatus(errorText(err, `Couldn't remove ${member.displayName}.`));
    }
  };

  // --- Adding people (owners) ---
  const [directory, setDirectory] = useState<DirectoryUser[] | null>(null);
  const [query, setQuery] = useState("");
  const [addRole, setAddRole] = useState<"editor" | "viewer">("editor");
  const [addStatus, setAddStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!isOwner || local) return;
    api
      .listUsers()
      .then((res) => setDirectory(res.users ?? []))
      .catch((err: unknown) => setAddStatus(errorText(err, "Couldn't load the accounts.")));
  }, [isOwner, local]);
  const candidates = useMemo(() => {
    if (!directory || !members) return [];
    const taken = new Set(members.map((m) => m.userId));
    const q = query.trim().toLowerCase();
    return directory.filter(
      (u) =>
        !taken.has(u.id) &&
        (!q || u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)),
    );
  }, [directory, members, query]);
  const addMember = async (u: DirectoryUser) => {
    setAddStatus(null);
    try {
      const res = await api.setMember(spaceId, u.id, addRole);
      setMembers(res.members ?? []);
      setQuery("");
      await refreshSpaces();
    } catch (err) {
      setAddStatus(errorText(err, `Couldn't add ${u.displayName}.`));
    }
  };

  // --- Leave ---
  const ownerCount = members?.filter((m) => m.role === "owner").length ?? 0;
  const soleOwner = isOwner && ownerCount <= 1;
  const [confirmLeave, setConfirmLeave] = useState(initialSection === "leave");
  const [leaveStatus, setLeaveStatus] = useState<string | null>(null);
  const leave = async () => {
    setLeaveStatus(null);
    try {
      await leaveSpace(spaceId);
      onClose();
    } catch (err) {
      setLeaveStatus(errorText(err, "Couldn't leave the space."));
    }
  };

  // --- Delete (owners) ---
  const [confirmName, setConfirmName] = useState("");
  const [deleteStatus, setDeleteStatus] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const confirmId = useId();
  const remove = async () => {
    if (!space || confirmName !== space.name) return;
    setDeleting(true);
    setDeleteStatus(null);
    try {
      await deleteSpace(spaceId);
      onClose();
    } catch (err) {
      setDeleteStatus(errorText(err, "Couldn't delete the space."));
      setDeleting(false);
    }
  };

  // Bring the requested section into view once (context-menu shortcuts).
  const leaveRef = useRef<HTMLDivElement>(null);
  const deleteRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    // Without members (local mode) the sections are there from the start.
    if (scrolled.current || !initialSection || (!members && !local)) return;
    scrolled.current = true;
    const el = initialSection === "delete" ? deleteRef.current : leaveRef.current;
    el?.scrollIntoView({ block: "center" });
    if (initialSection === "delete" && !mobile) {
      document.getElementById(confirmId)?.focus({ preventScroll: true });
    }
  }, [initialSection, members, local, confirmId, mobile]);

  if (!space) return null;
  const text = mobile ? "text-[15px]" : "text-sm";
  const small = mobile ? "text-[13px]" : "text-xs";

  return (
    <div className={mobile ? "px-4 pb-12 pt-1" : "px-5 pb-6 pt-0"}>
      {isOwner ? (
        <SettingGroup heading="General">
          <SettingItem
            name="Name and icon"
            description={generalStatus ? <StatusText status={{ tone: "error", text: generalStatus }} /> : spaceSummary(space)}
            stacked={mobile}
          >
            <span className={cx("flex items-center gap-2", mobile && "w-full")}>
              <IconPicker
                value={space.icon ?? ""}
                onChange={(icon) => void saveIcon(icon)}
                label="Space icon"
                fallback={LayoutGrid}
              />
              <TextInput
                value={name}
                onChange={setName}
                onCommit={() => void saveName()}
                onEscape={() => setName(savedName)}
                label="Space name"
                full={mobile}
              />
            </span>
          </SettingItem>
          {space.icon && (
            <SettingItem name="Icon" description="Without an icon the space shows its initials.">
              <Button onClick={() => void saveIcon("")}>Use initials</Button>
            </SettingItem>
          )}
        </SettingGroup>
      ) : (
        <SettingGroup>
          <SettingItem
            name={space.name}
            description={`${spaceSummary(space)} · you're ${ROLE_LABELS[space.role].toLowerCase()}`}
            leading={<SpaceAvatar space={space} size={mobile ? 40 : 34} />}
          />
        </SettingGroup>
      )}

      {!local && (
        <SettingGroup
          heading="Members"
          description={
            membersStatus ? (
              <StatusText status={{ tone: "error", text: membersStatus }} />
            ) : isOwner ? (
              "Editors can change notes, viewers can only read. Owners also manage members and the space."
            ) : undefined
          }
        >
          {members === null ? (
            <SettingRow>
              <span className={cx("text-muted-foreground", small)}>Loading…</span>
            </SettingRow>
          ) : (
            members.map((m) => {
              const self = m.userId === user.id;
              return (
                <SettingRow key={m.userId}>
                  <UserAvatar name={m.displayName} userId={m.userId} avatar={m.avatar} size={mobile ? 36 : 30} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cx("truncate text-foreground", text)}>
                      {m.displayName}
                      {self && <span className={cx("ml-1.5 text-muted-foreground", small)}>(you)</span>}
                    </span>
                    <span className={cx("truncate text-muted-foreground", small)}>@{m.username}</span>
                  </span>
                  {isOwner && !self ? (
                    <>
                      <Dropdown
                        value={m.role}
                        options={ROLE_OPTIONS}
                        onChange={(role) => void changeRole(m, role)}
                        label={`Role of ${m.displayName}`}
                      />
                      <IconButton label={`Remove ${m.displayName}`} danger onClick={() => void removeMember(m)}>
                        <X size={16} />
                      </IconButton>
                    </>
                  ) : (
                    <span className={cx("shrink-0 text-muted-foreground", small)}>{ROLE_LABELS[m.role]}</span>
                  )}
                </SettingRow>
              );
            })
          )}
        </SettingGroup>
      )}

      {isOwner && !local && (
        <SettingGroup
          heading="Add people"
          description={addStatus ? <StatusText status={{ tone: "error", text: addStatus }} /> : undefined}
        >
          <SettingRow className={mobile ? "flex-wrap" : undefined}>
            <TextInput
              value={query}
              onChange={setQuery}
              onEscape={() => setQuery("")}
              placeholder="Search by name or username"
              label="Search people"
              technical
              full
              className="flex-1"
            />
            <Dropdown value={addRole} options={ADD_ROLE_OPTIONS} onChange={setAddRole} label="Role for new members" />
          </SettingRow>
          {directory === null || members === null ? (
            <SettingRow>
              <span className={cx("text-muted-foreground", small)}>Loading…</span>
            </SettingRow>
          ) : candidates.length === 0 ? (
            <SettingRow>
              <span className={cx("text-muted-foreground", small)}>
                {query.trim() ? "No matching accounts." : "Everyone is already a member."}
              </span>
            </SettingRow>
          ) : (
            <div className="max-h-56 divide-y divide-border overflow-y-auto">
              {candidates.map((u) => (
                <SettingRow key={u.id}>
                  <UserAvatar name={u.displayName} userId={u.id} avatar={u.avatar} size={mobile ? 36 : 30} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cx("truncate text-foreground", text)}>{u.displayName}</span>
                    <span className={cx("truncate text-muted-foreground", small)}>@{u.username}</span>
                  </span>
                  <Button onClick={() => void addMember(u)}>
                    <UserPlus size={14} />
                    Add as {addRole}
                  </Button>
                </SettingRow>
              ))}
            </div>
          )}
        </SettingGroup>
      )}

      {members !== null && !local && (
        <div ref={leaveRef}>
          <SettingGroup>
            <SettingItem
              name="Leave space"
              description={
                leaveStatus ? (
                  <StatusText status={{ tone: "error", text: leaveStatus }} />
                ) : soleOwner ? (
                  "You're the only owner. Make someone else an owner first, or delete the space."
                ) : confirmLeave ? (
                  "You lose access until an owner adds you again."
                ) : (
                  "Removes the space from your list."
                )
              }
            >
              {confirmLeave && !soleOwner ? (
                <>
                  <Button onClick={() => setConfirmLeave(false)}>Cancel</Button>
                  <Button variant="danger" onClick={() => void leave()}>
                    <LogOut size={14} />
                    Leave
                  </Button>
                </>
              ) : (
                <Button disabled={soleOwner} onClick={() => setConfirmLeave(true)}>
                  Leave…
                </Button>
              )}
            </SettingItem>
          </SettingGroup>
        </div>
      )}

      {isOwner && (
        <div ref={deleteRef}>
          <SettingGroup heading="Delete space">
            <SettingItem
              stacked
              name={
                <>
                  Type <strong className="font-semibold">{space.name}</strong> to confirm
                </>
              }
              description={
                deleteStatus ? (
                  <StatusText status={{ tone: "error", text: deleteStatus }} />
                ) : (
                  local
                    ? "Deletes the space with all its vaults and notes. This can't be undone."
                    : "Deletes the space with all its vaults and notes, for every member. This can't be undone."
                )
              }
              htmlFor={confirmId}
            >
              <span className={cx("flex gap-2", mobile ? "flex-col" : "items-center")}>
                <TextInput
                  id={confirmId}
                  value={confirmName}
                  onChange={setConfirmName}
                  onEnter={() => void remove()}
                  onEscape={() => setConfirmName("")}
                  placeholder={space.name}
                  label="Space name to confirm"
                  full
                  className="flex-1"
                />
                <Button variant="danger" disabled={confirmName !== space.name || deleting} onClick={() => void remove()}>
                  <Trash2 size={14} />
                  {deleting ? "Deleting…" : "Delete space"}
                </Button>
              </span>
            </SettingItem>
          </SettingGroup>
        </div>
      )}
    </div>
  );
}
