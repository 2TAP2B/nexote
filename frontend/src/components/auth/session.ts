"use client";

// What this device remembers about accounts, and how it forgets it. Notes,
// tabs and spaces belong to one account; theme, layout and editor options
// belong to the device and survive signing out.

import { isAuthUser, type AuthUser } from "@/lib/api";
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
  "nexote:folders-open",
  "nexote:vault-expanded",
  "nexote:selected-tag",
];
const USER_KEY_PREFIXES = ["nexote:space-tabs:", "nexote:space-vault:"];

// Fields of nexote:settings that are one person's: the AI connection (an API
// key) …
const AI_SETTINGS = [
  "aiBaseUrl",
  "aiApiKey",
  "aiModel",
  "aiTranscribeModel",
  "aiTranscribeBaseUrl",
  "aiTranscribeApiKey",
  "aiTranscribeLanguage",
];
// … and choices pointing at that account's vaults.
const VAULT_CHOICES = ["startVaultId", "memoNoteVault", "memoNoteFolder", "notepadVault", "notepadFolder"];

/** Which of nexote:settings' personal fields go with the account's data:
 *  "keep" none (signing out), "vault-choices" the ones pointing into its
 *  vaults (the Android app opened another data folder: same person, so the AI
 *  connection stays), "personal" also the AI connection (another person). */
export type SettingsWipe = "keep" | "vault-choices" | "personal";

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

/** Removes the account's data from this device: cached images and data, the
 *  offline database and per-account localStorage keys. The app-shell cache
 *  (no account data) stays, so the app still starts offline. `settings` says
 *  which personal settings go too (see SettingsWipe). */
export async function wipeUserData({ settings }: { settings: SettingsWipe }): Promise<void> {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (USER_KEYS.includes(key) || USER_KEY_PREFIXES.some((p) => key.startsWith(p)))) {
        localStorage.removeItem(key);
      }
    }
    if (settings !== "keep") {
      const dropped = settings === "personal" ? [...AI_SETTINGS, ...VAULT_CHOICES] : VAULT_CHOICES;
      const parsed: unknown = JSON.parse(localStorage.getItem("nexote:settings") ?? "null");
      if (typeof parsed === "object" && parsed !== null) {
        const kept = Object.fromEntries(Object.entries(parsed).filter(([k]) => !dropped.includes(k)));
        localStorage.setItem("nexote:settings", JSON.stringify(kept));
      }
    }
  } catch {
    // storage unavailable or malformed settings: nothing stored to remove
  }
  await Promise.all([
    typeof caches === "undefined"
      ? undefined
      : caches
          .keys()
          .then((keys) => Promise.all(keys.filter((k) => !k.startsWith("nexote-shell-")).map((k) => caches.delete(k)))),
    typeof indexedDB === "undefined" ? undefined : offlineClearAll(),
  ]).catch(() => {
    // Best effort: a browser without storage access has nothing cached.
  });
}
