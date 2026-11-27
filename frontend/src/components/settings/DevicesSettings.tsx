"use client";

import { Check, CircleCheck, Copy, RefreshCw, Smartphone } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { QrCode } from "@/components/QrCode";
import { ConfirmDialog, ResponsiveDialog } from "@/components/ResponsiveDialog";
import { api, type PairedDevice, type PairingCode } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { timeAgo } from "@/lib/time-ago";
import {
  Button,
  SettingGroup,
  SettingItem,
  SettingsPage,
  StatusText,
  errorText,
  useIsMobileSettings,
  type Status,
} from "./ui";

const dateFormat: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, dateFormat);

const platformLabel = (platform: string) =>
  platform === "android" ? "Android" : platform ? platform[0].toUpperCase() + platform.slice(1) : "Device";

/** Server build: phones paired with the account (the Android app). Pairing
 *  gives the app a token that may only sync; removing a device revokes it. */
export function DevicesSettings() {
  const touch = useIsMobileSettings();
  const [devices, setDevices] = useState<PairedDevice[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [pairing, setPairing] = useState(false);
  const [removing, setRemoving] = useState<PairedDevice | null>(null);

  const load = useCallback(async () => {
    try {
      setDevices(await api.listDevices());
    } catch (e) {
      setStatus({ tone: "error", text: errorText(e, "Couldn't load the devices") });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (device: PairedDevice) => {
    setStatus(null);
    try {
      await api.removeDevice(device.id);
    } catch (e) {
      setStatus({ tone: "error", text: errorText(e, "Couldn't disconnect the device") });
    }
    await load();
  };

  return (
    <SettingsPage title="Devices">
      {status && (
        <p className="mt-4 px-1 text-sm">
          <StatusText status={status} />
        </p>
      )}

      <SettingGroup
        heading="Android app"
        description="Connect the Nexote app on your phone to this server. The phone gets its own key that can only sync your notes; it can't sign in here or change your account."
      >
        <SettingItem name="Connect the Android app" description="Shows a QR code to scan with the app.">
          <Button variant="cta" onClick={() => setPairing(true)}>
            <Smartphone className="h-4 w-4" />
            Connect
          </Button>
        </SettingItem>
      </SettingGroup>

      <SettingGroup heading="Paired devices">
        {devices === null ? (
          <SettingItem name="Loading…" />
        ) : devices.length === 0 ? (
          <SettingItem name="No devices yet" />
        ) : (
          devices.map((d) => (
            <SettingItem
              key={d.id}
              name={d.name}
              description={[
                platformLabel(d.platform),
                `paired ${day(d.createdAt)}`,
                d.lastSyncAt
                  ? `last sync ${timeAgo(d.lastSyncAt)}`
                  : d.lastSeenAt
                    ? `last seen ${timeAgo(d.lastSeenAt)}`
                    : "not used yet",
              ].join(" · ")}
            >
              <Button variant="danger" onClick={() => setRemoving(d)}>
                Disconnect
              </Button>
            </SettingItem>
          ))
        )}
      </SettingGroup>

      {pairing && (
        <PairDialog
          touch={touch}
          known={devices?.map((d) => d.id) ?? null}
          onDevices={setDevices}
          onClose={() => setPairing(false)}
        />
      )}
      {removing && (
        <ConfirmDialog
          touch={touch}
          title={`Disconnect “${removing.name}”?`}
          message="The app on this device stops syncing with the server. The notes on the phone stay."
          confirmLabel="Disconnect"
          onConfirm={() => void remove(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </SettingsPage>
  );
}

const POLL_MS = 2000;

// Seconds left as m:ss.
function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The pairing code as a QR code plus the address and code to type. While it
 * is open the device list is polled, so the phone that redeems the code
 * shows up here right away. The code lives only in this component's state.
 */
function PairDialog({
  touch,
  known,
  onDevices,
  onClose,
}: {
  touch: boolean;
  /** Device ids before pairing (null while the list hasn't loaded). */
  known: string[] | null;
  onDevices: (devices: PairedDevice[]) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState<PairingCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState<PairedDevice | null>(null);
  const baseline = useRef<Set<string> | null>(known ? new Set(known) : null);

  const create = useCallback(async () => {
    setError(null);
    setCopied(false);
    try {
      setCode(await api.createPairing());
      setNow(Date.now());
    } catch (e) {
      setError(errorText(e, "Couldn't create a pairing code"));
    }
  }, []);

  useEffect(() => {
    void create();
  }, [create]);

  // Countdown tick.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Watches for the new device; one request at a time, stops once it's there.
  useEffect(() => {
    if (connected) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const list = await api.listDevices();
        if (cancelled) return;
        if (!baseline.current) {
          baseline.current = new Set(list.map((d) => d.id));
        } else {
          const fresh = list.find((d) => !baseline.current?.has(d.id));
          if (fresh) {
            onDevices(list);
            setConnected(fresh);
            return;
          }
        }
      } catch {
        // A missed poll is harmless; the next one tries again.
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), POLL_MS);
    };
    timer = window.setTimeout(() => void poll(), baseline.current ? POLL_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connected, onDevices]);

  const copy = async () => {
    if (code && (await copyText(code.link))) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  const left = code ? new Date(code.expiresAt).getTime() - now : 0;
  const expired = code !== null && left <= 0;
  const server = code ? new URL(code.link).origin : "";

  return (
    <ResponsiveDialog
      touch={touch}
      title="Connect the Android app"
      onClose={onClose}
      width={440}
      footer={(close) => (
        <Button variant={connected ? "cta" : "default"} className={touch ? "flex-1" : undefined} onClick={close}>
          {connected ? "Done" : "Close"}
        </Button>
      )}
    >
      {connected ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <CircleCheck className="h-12 w-12 text-green-600 dark:text-green-400" />
          <p className="text-base font-semibold">Connected: {connected.name}</p>
          <p className="text-sm text-muted-foreground">The phone now appears under Paired devices.</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm">
            <StatusText status={{ tone: "error", text: error }} />
          </p>
          <Button onClick={() => void create()}>
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
        </div>
      ) : !code ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Creating a code…</p>
      ) : (
        <div className="flex flex-col items-center gap-4 pt-1 text-center">
          <p className="text-sm text-muted-foreground">
            In the Nexote app: Settings › Server › Scan QR code — or paste the link.
          </p>
          <div className={expired ? "opacity-20" : undefined}>
            <QrCode value={code.link} size={touch ? 240 : 220} label="Pairing QR code" />
          </div>
          <div className="w-full space-y-1">
            <p className="text-xs text-muted-foreground">Server</p>
            <p className="select-all break-all font-mono text-sm">{server}</p>
            <p className="pt-2 text-xs text-muted-foreground">Code</p>
            <p className={`select-all font-mono text-2xl font-semibold tracking-wider ${expired ? "line-through opacity-40" : ""}`}>
              {code.code}
            </p>
          </div>
          {expired ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-muted-foreground">This code has expired.</p>
              <Button variant="cta" onClick={() => void create()}>
                <RefreshCw className="h-4 w-4" />
                New code
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Button onClick={() => void copy()}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy link"}
              </Button>
              <p className="text-xs tabular-nums text-muted-foreground">
                Valid for {countdown(left)} · works once
              </p>
            </div>
          )}
        </div>
      )}
    </ResponsiveDialog>
  );
}
