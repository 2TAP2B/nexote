"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { api, ApiError, AUTH_REQUIRED_EVENT, type AuthUser } from "@/lib/api";
import { offlineOutboxCount } from "@/lib/offline-db";
import { AuthErrorScreen, AuthSplash, LoginScreen, SetupScreen } from "./AuthScreens";
import { isDifferentAccount, readLastUser, rememberUser, wipeUserData } from "./session";

export type AuthContextValue = {
  user: AuthUser;
  /** Ends the session, removes the account's data from this device and
   *  returns to the login screen. Rejects with the server's message. */
  logout: () => Promise<void>;
  /** Re-reads the signed-in account (e.g. after a display name change). */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** The signed-in account. Only usable inside <AuthGate>. */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthGate>");
  return value;
}

type Phase =
  | { kind: "loading" }
  | { kind: "setup"; origin: string }
  | { kind: "login"; origin: string }
  | { kind: "error"; message: string }
  | { kind: "ready" };

/** Shows setup/login until an account is signed in, then renders the app.
 *  The app (NotesProvider) never mounts without a known user. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [user, setUser] = useState<AuthUser | null>(null);
  // Session lost while the app is open: login shown above it, drafts intact.
  const [overlayOrigin, setOverlayOrigin] = useState<string | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  const overlayRef = useRef(false);
  const checking = useRef(false);

  const showOverlay = useCallback((origin: string | null) => {
    overlayRef.current = origin !== null;
    setOverlayOrigin(origin);
  }, []);

  // Before the app mounts: a different account than last time first gets a
  // clean device (no previous person's tabs, offline data or AI key).
  const enter = useCallback(async (next: AuthUser) => {
    if (isDifferentAccount(next)) await wipeUserData({ personalSettings: true });
    rememberUser(next);
    userRef.current = next;
    setUser(next);
    setPhase({ kind: "ready" });
  }, []);

  // While the app is mounted: the same account just continues; another
  // account reloads so no state of the previous one survives in memory.
  const resume = useCallback(
    async (next: AuthUser) => {
      if (next.id !== userRef.current?.id) {
        // Changes the previous account queued offline can't be synced by
        // this one and go with its data.
        const pending = await offlineOutboxCount().catch(() => 0);
        if (
          pending > 0 &&
          !window.confirm(
            `${pending} offline ${pending === 1 ? "change" : "changes"} of ${userRef.current?.displayName || "the previous account"} haven't synced yet and will be lost. Continue as ${next.displayName || next.username}?`,
          )
        ) {
          await api.logout().catch(() => {});
          return;
        }
        await wipeUserData({ personalSettings: true });
        rememberUser(next);
        window.location.reload();
        return;
      }
      rememberUser(next);
      userRef.current = next;
      setUser(next);
      if (overlayRef.current) {
        showOverlay(null);
        window.dispatchEvent(new CustomEvent("nexote:refresh-data"));
        // Changes queued while signed out wait in the outbox (the worker
        // stops replaying on 401); send them now.
        navigator.serviceWorker?.controller?.postMessage({ type: "nexote:flush" });
      }
    },
    [showOverlay],
  );

  const start = useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      const status = await api.authStatus();
      if (status.user) await enter(status.user);
      else if (status.setupRequired) setPhase({ kind: "setup", origin: status.origin });
      else setPhase({ kind: "login", origin: status.origin });
    } catch (e) {
      // An HTTP error means the server answered but can't be used (old
      // backend, crash): never show the app then. A failed fetch means no
      // connection: the offline app still works for the last account.
      const cached = e instanceof ApiError ? null : readLastUser();
      if (cached) {
        userRef.current = cached;
        setUser(cached);
        setPhase({ kind: "ready" });
        return;
      }
      setPhase({
        kind: "error",
        message:
          e instanceof ApiError
            ? `The server answered with an error (${e.status}${e.message ? `: ${e.message}` : ""}).`
            : "Can't reach the server. Check your connection and try again.",
      });
    }
  }, [enter]);

  // Re-reads the session while the app is mounted. Network errors keep the
  // app as it is (offline); a signed-out answer shows the login overlay.
  const recheck = useCallback(async () => {
    if (checking.current || overlayRef.current) return;
    checking.current = true;
    try {
      const status = await api.authStatus();
      if (status.user) await resume(status.user);
      else showOverlay(status.origin);
    } catch {
      // offline or server trouble: try again on the next trigger
    } finally {
      checking.current = false;
    }
  }, [resume, showOverlay]);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    if (phase.kind !== "ready") return;
    const onAuthRequired = () => void recheck();
    // Started offline from the cached account: confirm it once back online.
    const onOnline = () => void recheck();
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
      window.removeEventListener("online", onOnline);
    };
  }, [phase.kind, recheck]);

  const logout = useCallback(async () => {
    const pending = await offlineOutboxCount().catch(() => 0);
    if (
      pending > 0 &&
      !window.confirm(
        `${pending} offline ${pending === 1 ? "change hasn't" : "changes haven't"} synced yet and will be lost. Sign out anyway?`,
      )
    ) {
      return;
    }
    try {
      await api.logout();
    } catch (e) {
      // Already signed out on the server: just clean up here.
      if (!(e instanceof ApiError && e.status === 401)) throw e;
    }
    await wipeUserData({ personalSettings: false });
    window.location.assign("/");
  }, []);

  const value = useMemo<AuthContextValue | null>(
    () => (user ? { user, logout, refresh: recheck } : null),
    [user, logout, recheck],
  );

  switch (phase.kind) {
    case "loading":
      return <AuthSplash />;
    case "setup":
      return <SetupScreen origin={phase.origin} onSignedIn={enter} />;
    case "login":
      return <LoginScreen origin={phase.origin} onSignedIn={enter} />;
    case "error":
      return <AuthErrorScreen message={phase.message} onRetry={() => void start()} />;
    case "ready":
      return (
        <AuthContext.Provider value={value}>
          {children}
          {overlayOrigin !== null && <LoginScreen overlay origin={overlayOrigin} onSignedIn={resume} />}
        </AuthContext.Provider>
      );
  }
}
