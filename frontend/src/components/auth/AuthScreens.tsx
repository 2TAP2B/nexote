"use client";

import { KeyRound, Loader2, RotateCw, TriangleAlert } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

import { api, type AuthUser } from "@/lib/api";
import { authenticateWithPasskey, passkeyErrorMessage, passkeyUnsupportedReason, registerPasskey } from "@/lib/webauthn";
import { cx } from "@/components/settings/ui";

// ── Building blocks (shared with the invite page) ──────────────────────

/** Centered card on a plain background; full width on phones. */
export function AuthLayout({
  title,
  subtitle,
  children,
  overlay,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  /** Shown above the still-mounted app (session expired). */
  overlay?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex min-h-dvh w-full items-center justify-center overflow-y-auto px-5 text-foreground",
        overlay ? "fixed inset-0 z-[200] bg-background/85 backdrop-blur-md" : "bg-background",
      )}
      style={{
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 24px)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
      }}
      role={overlay ? "dialog" : undefined}
      aria-modal={overlay ? true : undefined}
      aria-label={overlay ? title : undefined}
    >
      <main className="w-full max-w-[380px]">
        <div className="mb-7 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- static app icon */}
          <img src="/icon.svg" alt="" width={56} height={56} className="mb-4 h-14 w-14 rounded-2xl shadow-sm" />
          <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{subtitle}</p>}
        </div>
        {children}
      </main>
    </div>
  );
}

export function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  technical,
  autoFocus,
  autoComplete,
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Codes and usernames: no autocorrect or capitalization. */
  technical?: boolean;
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete ?? "off"}
        autoCapitalize={technical ? "off" : undefined}
        autoCorrect={technical ? "off" : undefined}
        spellCheck={technical ? false : undefined}
        className="h-11 w-full rounded-lg border border-border bg-muted/40 px-3 text-[15px] outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 sm:h-10 sm:text-sm"
      />
      {hint && <p className="text-xs leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PrimaryButton({
  busy,
  disabled,
  onClick,
  icon = <KeyRound size={17} />,
  children,
  type = "button",
}: {
  busy?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
  children: ReactNode;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-[15px] font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60 sm:h-11 sm:text-sm"
    >
      {busy ? <Loader2 size={17} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function SecondaryButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-[15px] font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/40 sm:h-10 sm:text-sm"
    >
      {children}
    </button>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "error" | "info"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "note"}
      className={cx(
        "flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-snug",
        tone === "warn" && "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
        tone === "error" && "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
        tone === "info" && "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {tone !== "info" && <TriangleAlert size={16} className="mt-px shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Warnings that make passkeys fail before the user even tries: the wrong
 *  address (passkeys are bound to the server's public URL) or no support. */
export function PasskeyEnvironmentNotices({ origin }: { origin?: string }) {
  // Client-only values: read after mount so server and client markup match.
  const [env, setEnv] = useState<{ here: string; unsupported: string | null } | null>(null);
  useEffect(() => {
    setEnv({ here: window.location.origin, unsupported: passkeyUnsupportedReason() });
  }, []);
  if (!env) return null;
  const wrongOrigin = origin && origin !== env.here;
  if (!wrongOrigin && !env.unsupported) return null;
  return (
    <div className="mb-5 flex flex-col gap-2">
      {wrongOrigin && (
        <Notice>
          Passkeys only work at{" "}
          <a href={origin} className="font-medium underline underline-offset-2">
            {origin}
          </a>
          . You opened Nexote at {env.here}.
        </Notice>
      )}
      {env.unsupported && <Notice>{env.unsupported}</Notice>}
    </div>
  );
}

// ── Screens ────────────────────────────────────────────────────────────

/** Full-screen splash while the session is checked (no flash of a form). */
export function AuthSplash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background text-muted-foreground">
      <Loader2 size={22} className="animate-spin" aria-label="Loading" />
    </div>
  );
}

export function LoginScreen({
  origin,
  overlay,
  onSignedIn,
}: {
  origin?: string;
  overlay?: boolean;
  onSignedIn: (user: AuthUser) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const { user } = await authenticateWithPasskey(api.loginBegin, api.loginFinish);
      await onSignedIn(user);
    } catch (e) {
      setError(passkeyErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      overlay={overlay}
      title={overlay ? "Signed out" : "Welcome to Nexote"}
      subtitle={
        overlay
          ? "Your session ended. Sign in again to continue — your open notes stay as they are."
          : "Sign in with the passkey saved on this device or your phone."
      }
    >
      <PasskeyEnvironmentNotices origin={origin} />
      <PrimaryButton busy={busy} onClick={() => void signIn()}>
        Sign in with a passkey
      </PrimaryButton>
      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
        No account yet? Ask an admin for an invite link.
        <br />
        Lost your passkey? An admin can create a recovery link.
      </p>
    </AuthLayout>
  );
}

export function SetupScreen({
  origin,
  onSignedIn,
}: {
  origin?: string;
  onSignedIn: (user: AuthUser) => Promise<void> | void;
}) {
  const [setupCode, setSetupCode] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { user } = await registerPasskey(
        () => api.setupBegin({ setupCode: setupCode.trim(), username: username.trim(), displayName: displayName.trim() }),
        api.setupFinish,
      );
      await onSignedIn(user);
    } catch (e) {
      setError(passkeyErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Set up Nexote" subtitle="Create the first account. It becomes the admin and can invite others.">
      <PasskeyEnvironmentNotices origin={origin} />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Field
          label="Setup code"
          value={setupCode}
          onChange={setSetupCode}
          technical
          autoFocus
          placeholder="From the server log"
          hint={
            <>
              The server prints it when it starts without accounts, e.g. in{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">docker logs nexote</code>.
            </>
          }
        />
        <Field
          label="Username"
          value={username}
          onChange={setUsername}
          technical
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
        <div className="mt-1">
          <PrimaryButton type="submit" busy={busy} disabled={!setupCode.trim() || !username.trim()}>
            Create passkey
          </PrimaryButton>
        </div>
      </form>
      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </AuthLayout>
  );
}

export function AuthErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <AuthLayout title="Can't load Nexote" subtitle={message}>
      <PrimaryButton icon={<RotateCw size={17} />} onClick={onRetry}>
        Retry
      </PrimaryButton>
    </AuthLayout>
  );
}
