"use client";

// What this device remembers about accounts, and how it forgets it. Notes,
// tabs and spaces belong to one account; theme, layout and editor options
// belong to the device and survive signing out.

import type { AuthUser } from "@/lib/api";
import { offlineClearAll } from "@/lib/offline-db";

/** The last signed-in account (JSON), for starting offline. */
const LAST_USER_KEY = "nexote:last-user";
/** Id of the account whose AI credentials are stored in nexote:settings.
 *  Kept across sign-out so the next person's sign-in can drop them. */
const SETTINGS_OWNER_KEY = "nexote:settings-owner";

// Per-account state (ids of that account's spaces, vaults, notes, folders).
const USER_KEYS = [
  LAST_USER_KEY,
  "nexote:active-space",
  "nexote:active-vault",
  "nexote:active-id",
  "nexote:open-tabs",
  "nexote:folder-open",
  "nexote:vault-expanded",
  "nexote:selected-tag",
];
const USER_KEY_PREFIXES = ["nexote:space-tabs:", "nexote:space-vault:"];

// Fields of nexote:settings that are one person's: the AI connection (an API
// key) and choices pointing at that account's vaults.
const PERSONAL_SETTINGS = [
  "aiBaseUrl",
  "aiApiKey",
  "aiModel",
  "aiTranscribeModel",
  "startVaultId",
  "memoNoteVault",
  "memoNoteFolder",
  "notepadVault",
  "notepadFolder",
];

const isAuthUser = (v: unknown): v is AuthUser =>
  typeof v === "object" &&
  v !== null &&
  "id" in v &&
  typeof v.id === "string" &&
  "username" in v &&
  typeof v.username === "string" &&
  "displayName" in v &&
  typeof v.displayName === "string" &&
  "role" in v &&
  (v.role === "admin" || v.role === "member");

export function readLastUser(): AuthUser | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LAST_USER_KEY) ?? "null");
    return isAuthUser(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** True when `user` isn't the account this device's data belongs to. */
export function isDifferentAccount(user: AuthUser): boolean {
  let previous: string | null = null;
  try {
    previous = readLastUser()?.id ?? localStorage.getItem(SETTINGS_OWNER_KEY);
  } catch {
    // storage unavailable: nothing to protect
  }
  return previous !== null && previous !== user.id;
}

/** Records `user` as this device's account. */
export function rememberUser(user: AuthUser): void {
  try {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
    localStorage.setItem(SETTINGS_OWNER_KEY, user.id);
  } catch {
    // storage unavailable: offline start just won't work
  }
}

/** Removes the account's data from this device: service-worker caches, the
 *  offline database and per-account localStorage keys. `personalSettings`
 *  also drops the AI credentials (another person is signing in). */
export async function wipeUserData({ personalSettings }: { personalSettings: boolean }): Promise<void> {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (USER_KEYS.includes(key) || USER_KEY_PREFIXES.some((p) => key.startsWith(p)))) {
        localStorage.removeItem(key);
      }
    }
    if (personalSettings) {
      const parsed: unknown = JSON.parse(localStorage.getItem("nexote:settings") ?? "null");
      if (typeof parsed === "object" && parsed !== null) {
        const kept = Object.fromEntries(Object.entries(parsed).filter(([k]) => !PERSONAL_SETTINGS.includes(k)));
        localStorage.setItem("nexote:settings", JSON.stringify(kept));
      }
    }
  } catch {
    // storage unavailable or malformed settings: nothing stored to remove
  }
  await Promise.all([
    typeof caches === "undefined"
      ? undefined
      : caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))),
    typeof indexedDB === "undefined" ? undefined : offlineClearAll(),
  ]).catch(() => {
    // Best effort: a browser without storage access has nothing cached.
  });
}
