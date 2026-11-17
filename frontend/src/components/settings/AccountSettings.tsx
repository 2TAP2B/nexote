"use client";

import { Check, KeyRound, LogOut, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { UserAvatar } from "@/components/spaces/SpaceAvatar";
import { api, type PasskeyInfo } from "@/lib/api";
import { squareImage } from "@/lib/avatar-image";
import { passkeyErrorMessage, registerPasskey } from "@/lib/webauthn";
import {
  Button,
  IconButton,
  SettingGroup,
  SettingItem,
  SettingsPage,
  StatusText,
  TextInput,
  TextSetting,
  errorText,
  type Status,
} from "./ui";

const dateFormat: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };

/** The signed-in account: name, passkeys, sign out. */
export function AccountSettings() {
  const { user, logout, refresh } = useAuth();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [nameStatus, setNameStatus] = useState<Status | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyInfo[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [pictureStatus, setPictureStatus] = useState<Status | null>(null);
  const [pictureBusy, setPictureBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setPasskeys((await api.me()).passkeys);
    } catch (e) {
      setStatus({ tone: "error", text: errorText(e, "Couldn't load your passkeys") });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveName = async () => {
    const name = displayName.trim();
    if (!name || name === user.displayName) {
      setDisplayName(user.displayName);
      return;
    }
    try {
      await api.updateMe({ displayName: name });
      await refresh();
      setNameStatus({ tone: "ok", text: "Saved" });
    } catch (e) {
      setNameStatus({ tone: "error", text: errorText(e, "Couldn't save the name") });
    }
  };

  const uploadPicture = async (file: File) => {
    setPictureBusy(true);
    setPictureStatus(null);
    try {
      await api.setAvatar(await squareImage(file));
      await refresh();
      setPictureStatus({ tone: "ok", text: "Saved" });
    } catch (e) {
      setPictureStatus({ tone: "error", text: errorText(e, "Couldn't save the picture") });
    } finally {
      setPictureBusy(false);
    }
  };

  const removePicture = async () => {
    setPictureBusy(true);
    setPictureStatus(null);
    try {
      await api.removeAvatar();
      await refresh();
    } catch (e) {
      setPictureStatus({ tone: "error", text: errorText(e, "Couldn't remove the picture") });
    } finally {
      setPictureBusy(false);
    }
  };

  const addPasskey = async () => {
    setAdding(true);
    setStatus(null);
    try {
      const added = await registerPasskey(api.addPasskeyBegin, api.addPasskeyFinish);
      setStatus({ tone: "ok", text: `Added “${added.name}”` });
      await load();
    } catch (e) {
      setStatus({ tone: "error", text: passkeyErrorMessage(e) });
    } finally {
      setAdding(false);
    }
  };

  const commitRename = async () => {
    if (!renaming) return;
    const { id, name } = renaming;
    setRenaming(null);
    if (!name.trim()) return;
    try {
      await api.renamePasskey(id, name.trim());
      await load();
    } catch (e) {
      setStatus({ tone: "error", text: errorText(e, "Couldn't rename the passkey") });
    }
  };

  const remove = async (p: PasskeyInfo) => {
    if (!window.confirm(`Remove the passkey “${p.name}”? You can't sign in with it anymore.`)) return;
    try {
      await api.removePasskey(p.id);
      await load();
    } catch (e) {
      setStatus({ tone: "error", text: errorText(e, "Couldn't remove the passkey") });
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await logout();
    } catch (e) {
      setStatus({ tone: "error", text: errorText(e, "Couldn't sign out") });
      setSigningOut(false);
    }
  };

  return (
    <SettingsPage title="Account">
      <SettingGroup heading="Profile">
        <SettingItem
          name="Picture"
          description={pictureStatus ? <StatusText status={pictureStatus} /> : "Shown next to your name in spaces."}
          leading={<UserAvatar name={user.displayName} userId={user.id} avatar={user.avatar} size={48} />}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void uploadPicture(file);
            }}
          />
          <Button disabled={pictureBusy} onClick={() => fileRef.current?.click()}>
            {user.avatar ? "Change" : "Upload"}
          </Button>
          {user.avatar && (
            <Button variant="danger" disabled={pictureBusy} onClick={() => void removePicture()}>
              Remove
            </Button>
          )}
        </SettingItem>
        <SettingItem name="Username" description="Used to add you to spaces. Can't be changed.">
          <span className="font-mono text-[13px] text-muted-foreground">@{user.username}</span>
        </SettingItem>
        <TextSetting
          name="Display name"
          description={nameStatus ? <StatusText status={nameStatus} /> : "Shown to people you share spaces with."}
          value={displayName}
          onChange={(v) => {
            setDisplayName(v);
            setNameStatus(null);
          }}
          onCommit={() => void saveName()}
        />
        <SettingItem name="Role" description={user.role === "admin" ? "Manages users, invites and server settings." : "Member"}>
          <span className="text-[13px] text-muted-foreground">{user.role === "admin" ? "Admin" : "Member"}</span>
        </SettingItem>
      </SettingGroup>

      <SettingGroup
        heading="Passkeys"
        description={
          status ? (
            <StatusText status={status} />
          ) : (
            "You sign in with a passkey (Face ID, Touch ID, Windows Hello, your phone or a security key). Add one per device you use, so losing a device doesn't lock you out."
          )
        }
      >
        {passkeys === null ? (
          <SettingItem name="Loading…" />
        ) : (
          passkeys.map((p) =>
            renaming?.id === p.id ? (
              <SettingItem key={p.id} name={<KeyRound className="h-4 w-4 text-muted-foreground" />}>
                <TextInput
                  value={renaming.name}
                  onChange={(name) => setRenaming({ id: p.id, name })}
                  onCommit={() => void commitRename()}
                  onEscape={() => setRenaming(null)}
                  label="Passkey name"
                  autoFocus
                />
                <IconButton label="Save name" onMouseDown={(e) => e.preventDefault()} onClick={() => void commitRename()}>
                  <Check className="h-4 w-4" />
                </IconButton>
                <IconButton label="Cancel" onMouseDown={(e) => e.preventDefault()} onClick={() => setRenaming(null)}>
                  <X className="h-4 w-4" />
                </IconButton>
              </SettingItem>
            ) : (
              <SettingItem
                key={p.id}
                leading={<KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />}
                name={p.name}
                description={
                  `Added ${new Date(p.createdAt).toLocaleDateString(undefined, dateFormat)}` +
                  (p.lastUsedAt ? ` · last used ${new Date(p.lastUsedAt).toLocaleDateString(undefined, dateFormat)}` : "")
                }
              >
                <IconButton label="Rename" onClick={() => setRenaming({ id: p.id, name: p.name })}>
                  <Pencil className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label={passkeys.length === 1 ? "Your only passkey can't be removed" : "Remove"}
                  danger
                  disabled={passkeys.length === 1}
                  onClick={() => void remove(p)}
                >
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </SettingItem>
            ),
          )
        )}
        <SettingItem name="Add a passkey" description="Creates a passkey on this device or a security key.">
          <Button onClick={() => void addPasskey()} disabled={adding}>
            <Plus className="h-4 w-4" />
            {adding ? "Waiting…" : "Add"}
          </Button>
        </SettingItem>
      </SettingGroup>

      <SettingGroup>
        <SettingItem name="Sign out" description="Signs out on this device and removes your notes cached on it.">
          <Button variant="danger" onClick={() => void signOut()} disabled={signingOut}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </SettingItem>
      </SettingGroup>
    </SettingsPage>
  );
}
