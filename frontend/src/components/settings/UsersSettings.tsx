"use client";

import { Check, Copy, LifeBuoy, Link2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { api, type AdminInvite, type AdminUser, type UserRole } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import {
  Button,
  Dropdown,
  IconButton,
  SettingGroup,
  SettingItem,
  SettingRow,
  SettingsPage,
  StatusText,
  errorText,
  type Status,
} from "./ui";

const ROLES = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
] as const satisfies readonly { value: UserRole; label: string }[];

const dateFormat: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, dateFormat);

/** A link that is only shown once (its token isn't stored readably). */
type FreshLink = { title: string; url: string; expiresAt: string };

/** Admins: accounts, invite links, recovery links. */
export function UsersSettings() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [invites, setInvites] = useState<AdminInvite[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [inviteRole, setInviteRole] = useState<UserRole>("member");
  const [fresh, setFresh] = useState<FreshLink | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [u, i] = await Promise.all([api.adminListUsers(), api.adminListInvites()]);
      setUsers(u.users);
      setInvites(i.invites);
    } catch (e) {
      setStatus({ tone: "error", text: errorText(e, "Couldn't load users") });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: () => Promise<unknown>, failure: string) => {
    setStatus(null);
    try {
      await action();
    } catch (e) {
      setStatus({ tone: "error", text: errorText(e, failure) });
    }
    await load();
  };

  const showLink = (link: FreshLink) => {
    setCopied(false);
    setFresh(link);
  };

  const createInvite = () =>
    act(async () => {
      const inv = await api.adminCreateInvite(inviteRole);
      showLink({ title: `Invite link (${inviteRole})`, url: inv.url, expiresAt: inv.expiresAt });
    }, "Couldn't create the invite");

  const createRecovery = (u: AdminUser) =>
    act(async () => {
      const link = await api.adminCreateRecovery(u.id);
      showLink({ title: `Recovery link for ${u.displayName}`, url: link.url, expiresAt: link.expiresAt });
    }, "Couldn't create the recovery link");

  const copy = async () => {
    if (fresh && (await copyText(fresh.url))) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <SettingsPage title="Users">
      {status && (
        <p className="mt-4 px-1 text-sm">
          <StatusText status={status} />
        </p>
      )}

      {fresh && (
        <SettingGroup
          heading={fresh.title}
          description={`Single use, valid until ${day(fresh.expiresAt)}. Send it privately — it's shown only now.`}
        >
          <SettingRow>
            <span className="min-w-0 flex-1 select-all break-all font-mono text-[12px] text-foreground">{fresh.url}</span>
            <Button onClick={() => void copy()}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </SettingRow>
        </SettingGroup>
      )}

      <SettingGroup
        heading="Invite someone"
        description="New accounts can only be created with an invite link. The person opens it and creates a passkey."
      >
        <SettingItem name="Role" description="Admins manage users, invites, git sync and lookup keys.">
          <Dropdown label="Role for the invite" value={inviteRole} options={ROLES} onChange={setInviteRole} />
          <Button variant="cta" onClick={() => void createInvite()}>
            <Link2 className="h-4 w-4" />
            Create link
          </Button>
        </SettingItem>
      </SettingGroup>

      <SettingGroup heading="Accounts">
        {users === null ? (
          <SettingItem name="Loading…" />
        ) : (
          users.map((u) => {
            const self = u.id === me.id;
            const details = [
              `@${u.username}`,
              `${u.passkeys} passkey${u.passkeys === 1 ? "" : "s"}`,
              u.lastSeenAt ? `active ${day(u.lastSeenAt)}` : `joined ${day(u.createdAt)}`,
            ];
            return (
              <SettingItem
                key={u.id}
                name={
                  <span className={u.disabled ? "text-muted-foreground line-through" : undefined}>
                    {u.displayName}
                    {self && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
                  </span>
                }
                description={u.disabled ? `Deactivated · ${details.join(" · ")}` : details.join(" · ")}
              >
                <Dropdown
                  label={`Role of ${u.displayName}`}
                  value={u.role}
                  options={ROLES}
                  onChange={(role) => void act(() => api.adminUpdateUser(u.id, { role }), "Couldn't change the role")}
                />
                <IconButton label="Create a recovery link (adds a passkey)" onClick={() => void createRecovery(u)}>
                  <LifeBuoy className="h-4 w-4" />
                </IconButton>
                {!self && (
                  <Button
                    variant={u.disabled ? "default" : "danger"}
                    onClick={() =>
                      void act(
                        () => api.adminUpdateUser(u.id, { disabled: !u.disabled }),
                        u.disabled ? "Couldn't reactivate" : "Couldn't deactivate",
                      )
                    }
                  >
                    {u.disabled ? "Reactivate" : "Deactivate"}
                  </Button>
                )}
              </SettingItem>
            );
          })
        )}
      </SettingGroup>

      <SettingGroup heading="Links" description="Invite and recovery links you created. Pending links can be revoked.">
        {invites === null ? (
          <SettingItem name="Loading…" />
        ) : invites.length === 0 ? (
          <SettingItem name="No links yet" />
        ) : (
          invites.map((inv) => (
            <SettingItem
              key={inv.id}
              name={inv.kind === "recovery" ? `Recovery for ${inv.user ?? "a deleted account"}` : `Invite · ${inv.role === "admin" ? "Admin" : "Member"}`}
              description={
                inv.status === "used"
                  ? `Used${inv.usedBy ? ` by ${inv.usedBy}` : ""}${inv.usedAt ? ` on ${day(inv.usedAt)}` : ""}`
                  : inv.status === "expired"
                    ? `Expired ${day(inv.expiresAt)}`
                    : `Pending · valid until ${day(inv.expiresAt)}${inv.createdBy ? ` · by ${inv.createdBy}` : ""}`
              }
            >
              <IconButton label="Revoke" danger onClick={() => void act(() => api.adminDeleteInvite(inv.id), "Couldn't revoke")}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </SettingItem>
          ))
        )}
      </SettingGroup>
    </SettingsPage>
  );
}
