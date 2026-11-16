"use client";

import { LogOut, UserPlus } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  AuthErrorScreen,
  AuthLayout,
  AuthSplash,
  Field,
  Notice,
  PasskeyEnvironmentNotices,
  PrimaryButton,
  SecondaryButton,
} from "@/components/auth/AuthScreens";
import { wipeUserData } from "@/components/auth/session";
import { api, ApiError, type AuthUser, type InviteInfo } from "@/lib/api";
import { passkeyErrorMessage, registerPasskey } from "@/lib/webauthn";

type State =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "error"; message: string }
  | { kind: "signedIn"; user: AuthUser }
  | { kind: "ready"; info: InviteInfo; origin?: string };

/** Public page behind invite (signup) and recovery links. */
export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    // The status only adds the "already signed in" case and the origin
    // check; the link still works without it.
    const status = await api.authStatus().catch(() => null);
    if (status?.user) {
      setState({ kind: "signedIn", user: status.user });
      return;
    }
    try {
      const info = await api.inviteInfo(token);
      setState({ kind: "ready", info, origin: status?.origin });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setState({ kind: "invalid" });
      else setState({ kind: "error", message: passkeyErrorMessage(e) });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  switch (state.kind) {
    case "loading":
      return <AuthSplash />;
    case "error":
      return <AuthErrorScreen message={state.message} onRetry={() => void load()} />;
    case "invalid":
      return (
        <AuthLayout
          title="This link doesn't work"
          subtitle="It's invalid, expired or was already used. Ask an admin for a new one."
        >
          <SecondaryButton onClick={() => window.location.assign("/")}>Go to Nexote</SecondaryButton>
        </AuthLayout>
      );
    case "signedIn":
      return <SignedInNotice user={state.user} onSignedOut={() => void load()} />;
    case "ready":
      return <Redeem token={token} info={state.info} origin={state.origin} />;
  }
}

function SignedInNotice({ user, onSignedOut }: { user: AuthUser; onSignedOut: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.logout();
      await wipeUserData({ personalSettings: false });
      onSignedOut();
    } catch (e) {
      setError(passkeyErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={`Signed in as ${user.displayName}`}
      subtitle="Sign out to use this link — it's meant for a new account or a lost passkey."
    >
      <div className="flex flex-col gap-2.5">
        <PrimaryButton busy={busy} icon={<LogOut size={17} />} onClick={() => void signOut()}>
          Sign out
        </PrimaryButton>
        <SecondaryButton onClick={() => window.location.assign("/")}>Open Nexote</SecondaryButton>
      </div>
      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </AuthLayout>
  );
}

function Redeem({ token, info, origin }: { token: string; info: InviteInfo; origin?: string }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signup = info.kind === "signup";
  const expires = new Date(info.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  const redeem = async () => {
    setBusy(true);
    setError(null);
    try {
      await registerPasskey(
        () =>
          api.inviteBegin(token, signup ? { username: username.trim(), displayName: displayName.trim() } : {}),
        (input) => api.inviteFinish(token, input),
      );
      // Full load: the app's gate takes over.
      window.location.assign("/");
    } catch (e) {
      setError(passkeyErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={signup ? "Join Nexote" : "Add a passkey"}
      subtitle={
        signup ? (
          <>
            {info.invitedBy ? `${info.invitedBy} invited you` : "You're invited"}
            {info.role === "admin" ? " as an admin" : ""}. Pick a username and create a passkey to sign in.
          </>
        ) : (
          <>
            For <span className="font-medium text-foreground">{info.displayName}</span>
            {info.username ? ` (@${info.username})` : ""}. The new passkey signs you in on this device.
          </>
        )
      }
    >
      <PasskeyEnvironmentNotices origin={origin} />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void redeem();
        }}
      >
        {signup && (
          <>
            <Field
              label="Username"
              value={username}
              onChange={setUsername}
              technical
              autoFocus
              autoComplete="username"
              placeholder="e.g. alex"
              hint="3–32 characters: letters, digits, dot, dash or underscore."
            />
            <Field
              label="Display name"
              value={displayName}
              onChange={setDisplayName}
              autoComplete="name"
              placeholder="Optional — defaults to the username"
            />
          </>
        )}
        <div className={signup ? "mt-1" : undefined}>
          <PrimaryButton
            type="submit"
            busy={busy}
            disabled={signup && !username.trim()}
            icon={signup ? <UserPlus size={17} /> : undefined}
          >
            {signup ? "Create passkey" : "Add a passkey"}
          </PrimaryButton>
        </div>
      </form>
      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <p className="mt-6 text-center text-xs text-muted-foreground">Link valid until {expires}.</p>
    </AuthLayout>
  );
}
