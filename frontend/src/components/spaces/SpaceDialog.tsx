"use client";

import { LayoutGrid, X } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useAuth } from "@/components/auth/AuthProvider";
import { IconPicker } from "@/components/settings/IconPicker";
import { Button, errorText, SettingsPlatformProvider, StatusText, TextInput, cx } from "@/components/settings/ui";
import { useAndroidBack } from "@/lib/android-back";
import type { SpaceInfo } from "@/lib/api";
import { useNotes } from "@/lib/notes-context";

export type SpacePlatform = "desktop" | "mobile";

/**
 * Space dialogs' frame: a centered modal on desktop, a full-screen sheet on
 * mobile. Portaled to <body> because the mobile pager track is transformed
 * (it would break position:fixed), and marked data-no-swipe so drags inside
 * the sheet don't pan the pager behind it.
 */
export function SpaceDialogShell({
  platform,
  title,
  onClose,
  footer,
  children,
}: {
  platform: SpacePlatform;
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useAndroidBack(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape first closes an open icon picker or cancels an inline edit.
      if (document.querySelector("[data-settings-popover]")) return;
      if (e.target instanceof Element && e.target.closest("[data-settings-escape]")) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const mobile = platform === "mobile";
  const body = mobile ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-no-swipe=""
      className="fixed inset-0 z-[60] flex flex-col bg-background text-foreground"
    >
      <div
        className="flex shrink-0 items-center justify-between border-b border-border/70 px-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)", paddingBottom: 12 }}
      >
        <span className="w-10" />
        <span className="truncate text-lg font-semibold">{title}</span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/80 text-foreground transition-transform active:scale-95"
        >
          <X size={20} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
      {footer && (
        <div
          className="flex shrink-0 justify-end gap-2 border-t border-border/70 px-4 pt-3"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          {footer}
        </div>
      )}
    </div>
  ) : (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[9vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[82vh] w-[min(560px,100%)] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <LayoutGrid size={16} className="text-muted-foreground" />
          <span className="flex-1 truncate text-sm font-medium text-foreground">{title}</span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
  return createPortal(<SettingsPlatformProvider value={platform}>{body}</SettingsPlatformProvider>, document.body);
}

/** Name + optional icon → a new private space, which becomes the active one. */
export function NewSpaceDialog({
  platform,
  onClose,
  onCreated,
}: {
  platform: SpacePlatform;
  onClose: () => void;
  onCreated?: (space: SpaceInfo) => void;
}) {
  const { createSpace } = useNotes();
  const { local } = useAuth();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const mobile = platform === "mobile";

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const space = await createSpace(trimmed, icon || undefined);
      onCreated?.(space);
      onClose();
    } catch (err) {
      setError(errorText(err, "Couldn't create the space."));
      setBusy(false);
    }
  };

  return (
    <SpaceDialogShell
      platform={platform}
      title="New space"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="cta" disabled={!name.trim() || busy} onClick={() => void submit()}>
            {busy ? "Creating…" : "Create space"}
          </Button>
        </>
      }
    >
      <div className={cx("flex flex-col gap-3", mobile ? "px-4 py-5" : "px-5 py-5")}>
        <label htmlFor={nameId} className={cx("font-medium text-foreground", mobile ? "text-[15px]" : "text-sm")}>
          Name
        </label>
        <div className="flex items-center gap-2">
          <IconPicker value={icon} onChange={setIcon} label="Space icon" fallback={LayoutGrid} />
          <TextInput
            id={nameId}
            value={name}
            onChange={setName}
            onEnter={() => void submit()}
            placeholder="e.g. Family, Work, Book club"
            autoFocus={!mobile}
            full
          />
        </div>
        {icon && (
          <button
            type="button"
            onClick={() => setIcon("")}
            className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Use initials instead of an icon
          </button>
        )}
        <p className={cx("leading-snug text-muted-foreground", mobile ? "text-[13px]" : "text-xs")}>
          {local
            ? "A space has its own vaults, notes and collections."
            : "A space has its own vaults, notes and collections. It stays private until you add members."}
        </p>
        {error && (
          <p className="text-sm">
            <StatusText status={{ tone: "error", text: error }} />
          </p>
        )}
      </div>
    </SpaceDialogShell>
  );
}
