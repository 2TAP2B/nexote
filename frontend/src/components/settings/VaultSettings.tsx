"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api, isCollectionsVault } from "@/lib/api";
import type { CollectionMeta, VaultMeta } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";
import { IconPicker } from "./IconPicker";
import {
  Button,
  IconButton,
  SettingGroup,
  SettingItem,
  SettingRow,
  SettingsPage,
  TextInput,
  ToggleSetting,
} from "./ui";

export function VaultSettings() {
  const { vaults, createVault, activeSpace } = useNotes();
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("Database");
  const canEdit = activeSpace?.role !== "viewer";
  const regular = vaults.filter((v) => !isCollectionsVault(v));

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    await createVault(name, newIcon);
    setNewName("");
    setNewIcon("Database");
  };

  return (
    <SettingsPage title="Vaults">
      <SettingGroup
        heading={activeSpace ? `Vaults in “${activeSpace.name}”` : "Your vaults"}
        description={
          canEdit
            ? "Each vault is its own folder of notes. Click a vault to switch to it. Other spaces have their own vaults."
            : "You can view this space's vaults; only its editors and owners change them."
        }
      >
        {regular.map((vault) => (
          <VaultRow key={vault.id} vault={vault} onlyVault={regular.length === 1} />
        ))}
      </SettingGroup>

      {canEdit && <SettingGroup heading="New vault">
        <SettingRow>
          <IconPicker value={newIcon} onChange={setNewIcon} label="Icon for the new vault" />
          <TextInput
            value={newName}
            onChange={setNewName}
            onEnter={() => void create()}
            placeholder="Vault name"
            label="Vault name"
            className="flex-1"
          />
          <Button variant="cta" disabled={!newName.trim()} onClick={() => void create()}>
            Create
          </Button>
        </SettingRow>
      </SettingGroup>}

      <CollectionVisibility />
    </SettingsPage>
  );
}

function VaultRow({ vault, onlyVault }: { vault: VaultMeta; onlyVault: boolean }) {
  const { activeVault, switchVault, renameVault, deleteVault, setVaultIcon } = useNotes();
  // Editors rename and restyle vaults; deleting one (and its notes) is the owners' call.
  const canEdit = vault.role !== "viewer";
  const canDelete = vault.role === "owner" && !onlyVault;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  // Escape cancels the rename; the blur that follows must not save it.
  const cancelRef = useRef(false);
  const active = vault.id === activeVault?.id;

  const startRename = () => {
    setDraft(vault.name);
    setRenaming(true);
  };
  const finishRename = () => {
    const name = draft.trim();
    const cancelled = cancelRef.current;
    cancelRef.current = false;
    setRenaming(false);
    if (!cancelled && name && name !== vault.name) void renameVault(vault.id, name);
  };

  return (
    <SettingItem
      leading={
        canEdit ? (
          <IconPicker
            value={vault.icon ?? "Database"}
            onChange={(icon) => void setVaultIcon(vault.id, icon)}
            label={`Icon for ${vault.name}`}
          />
        ) : undefined
      }
      name={
        renaming ? (
          <TextInput
            autoFocus
            full
            value={draft}
            onChange={setDraft}
            onCommit={finishRename}
            onEscape={() => {
              cancelRef.current = true;
            }}
            label={`New name for ${vault.name}`}
          />
        ) : (
          vault.name
        )
      }
      description={active && !renaming ? "Active vault" : undefined}
      onClick={renaming || active ? undefined : () => switchVault(vault.id)}
    >
      {canEdit && !renaming && (
        <IconButton label={`Rename ${vault.name}`} onClick={startRename}>
          <Pencil size={15} />
        </IconButton>
      )}
      {canDelete && !renaming && (
        <IconButton
          label={`Delete ${vault.name}`}
          danger
          onClick={() => {
            if (confirm(`Delete the vault "${vault.name}" and all its notes?`)) void deleteVault(vault.id);
          }}
        >
          <Trash2 size={15} />
        </IconButton>
      )}
    </SettingItem>
  );
}

function CollectionVisibility() {
  const { listCollections, activeSpaceId } = useNotes();
  const [collections, setCollections] = useState<CollectionMeta[] | null>(null);

  const reload = () =>
    listCollections()
      .then(setCollections)
      .catch(() => setCollections((c) => c ?? []));

  // Collections belong to the active space: reload when it changes.
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSpaceId]);

  const setVisible = (col: CollectionMeta, visible: boolean) => {
    if (!activeSpaceId) return;
    // Flip right away; the reload settles it (and undoes a failed change).
    setCollections((cs) => cs?.map((c) => (c.id === col.id ? { ...c, hidden: !visible } : c)) ?? cs);
    void api
      .setCollectionHidden(activeSpaceId, col.id, !visible)
      .catch(() => {})
      .finally(() => void reload());
  };

  return (
    <SettingGroup
      heading="Collections"
      description="A hidden collection disappears from the app. Its notes stay on disk."
    >
      {collections === null ? (
        <SettingRow>
          <span className="text-sm text-muted-foreground">Loading…</span>
        </SettingRow>
      ) : collections.length === 0 ? (
        <SettingRow>
          <span className="text-sm text-muted-foreground">No collections yet.</span>
        </SettingRow>
      ) : (
        collections.map((col) => (
          <ToggleSetting
            key={col.id}
            name={col.name}
            description={col.builtIn ? "Built-in" : undefined}
            checked={!col.hidden}
            onChange={(visible) => setVisible(col, visible)}
          />
        ))
      )}
    </SettingGroup>
  );
}
