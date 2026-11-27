"use client";

import { Link2, RefreshCw, ScanQrCode, Unplug } from "lucide-react";
import { useCallback, useState } from "react";

import CodeScanner from "@/components/CodeScanner";
import { ConfirmDialog } from "@/components/ResponsiveDialog";
import { api, type LocalSyncStatus } from "@/lib/api";
import { refreshLocalSync, setLocalSync, useLocalSync } from "@/lib/local-sync";
import { parsePairingLink } from "@/lib/pairing";
import { timeAgo } from "@/lib/time-ago";
import {
  Button,
  InfoItem,
  SettingGroup,
  SettingItem,
  SettingsPage,
  StatusText,
  TextInput,
  errorText,
  useIsMobileSettings,
  type Status,
} from "./ui";

type PairInput = { link: string } | { server: string; code: string };

/** Android app: pairs this phone with a Nexote server (a QR code or link
 *  from the server's Settings › Devices) and shows how syncing goes. The
 *  engine does the exchange, keeps the credentials in the phone's protected
 *  storage and syncs on its own. */
export function ServerSettings() {
  const touch = useIsMobileSettings();
  // Shared with the header sync dots: one polling loop follows syncs (and a
  // revoke on the server) while the page is open.
  const { status: sync, loadError } = useLocalSync();
  const [actionStatus, setStatus] = useState<Status | null>(null);
  const status: Status | null = actionStatus ?? (loadError && !sync ? { tone: "error", text: loadError } : null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // A revoked phone shows the pairing form again on request.
  const [repairing, setRepairing] = useState(false);

  const pair = useCallback(async (input: PairInput) => {
    setBusy(true);
    setStatus(null);
    try {
      setLocalSync(await api.localSyncPair(input));
      setRepairing(false);
    } catch (e) {
      // The engine's sentences are written for the user: show them as they are.
      setStatus({ tone: "error", text: errorText(e, "Couldn't connect to the server") });
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = async () => {
    setBusy(true);
    setStatus(null);
    try {
      setLocalSync(await api.localSyncDisconnect());
    } catch (e) {
      setStatus({ tone: "error", text: errorText(e, "Couldn't disconnect") });
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await api.localSyncNow();
    } catch (e) {
      setStatus({ tone: "error", text: errorText(e, "Couldn't start the sync") });
    } finally {
      setBusy(false);
    }
    await refreshLocalSync();
  };

  const scanned = (link: { server: string; code: string }) => {
    setScanning(false);
    void pair(link);
  };

  const connected = sync?.connected ? sync : null;

  return (
    <SettingsPage title="Server">
      {status && (
        <p className="mt-4 px-1 text-sm">
          <StatusText status={status} />
        </p>
      )}

      {sync === null ? (
        !status && <p className="mt-6 px-1 text-sm text-muted-foreground">Loading…</p>
      ) : connected ? (
        <>
          <SettingGroup
            heading="Connected server"
            description={
              connected.revoked
                ? "The server disconnected this phone. Pair it again with a new code from the server — the notes on this phone stay."
                : "This phone keeps its notes in sync with your account on the server, both ways."
            }
          >
            <InfoItem name="Server" value={connected.server} mono />
            <InfoItem
              name="Account"
              value={
                connected.user.displayName && connected.user.displayName !== connected.user.username
                  ? `${connected.user.displayName} (@${connected.user.username})`
                  : `@${connected.user.username}`
              }
            />
            <InfoItem name="This device" value={connected.device.name} />
            <SettingItem
              name="Disconnect"
              description="Unpairs this phone from the server. The notes on the phone stay."
            >
              <Button variant="danger" disabled={busy} onClick={() => setConfirming(true)}>
                <Unplug className="h-4 w-4" />
                Disconnect
              </Button>
            </SettingItem>
          </SettingGroup>
          {!connected.revoked && <SyncGroup sync={connected} busy={busy} onSyncNow={() => void syncNow()} />}
          {connected.revoked && !repairing && (
            <SettingGroup heading="Pair again">
              <SettingItem name="Pair this phone again" description="Needs a new code from the server's Settings › Devices.">
                <Button variant="cta" onClick={() => setRepairing(true)}>
                  Pair again
                </Button>
              </SettingItem>
            </SettingGroup>
          )}
          {connected.revoked && repairing && (
            <PairForm busy={busy} onScan={() => setScanning(true)} onPair={(input) => void pair(input)} />
          )}
        </>
      ) : (
        <PairForm
          intro="Pairing keeps the notes on this phone and your account's notes on a Nexote server in sync, both ways. The first sync merges both sides; nothing is deleted."
          busy={busy}
          onScan={() => setScanning(true)}
          onPair={(input) => void pair(input)}
        />
      )}

      {scanning && (
        <CodeScanner
          formats={["qr_code"]}
          parse={parsePairingLink}
          onScan={scanned}
          onClose={() => setScanning(false)}
          title="Scan QR code"
          hint="Point the camera at the QR code in the server's Settings › Devices"
          detectedHint="Code found — connecting…"
          rejectedHint="That's not a Nexote pairing code. Open Settings › Devices on the server."
          frame="square"
        />
      )}
      {confirming && (
        <ConfirmDialog
          touch={touch}
          title="Disconnect from the server?"
          message="This phone stops syncing with the server. The notes on the phone stay."
          confirmLabel="Disconnect"
          onConfirm={() => void disconnect()}
          onClose={() => setConfirming(false)}
        />
      )}
    </SettingsPage>
  );
}

type ConnectedSync = Extract<LocalSyncStatus, { connected: true }>;

/** How syncing goes: when it last ran, what's waiting, the last problem. */
function SyncGroup({ sync, busy, onSyncNow }: { sync: ConnectedSync; busy: boolean; onSyncNow: () => void }) {
  const { syncing, lastSyncAt, lastError, lastConflicts, pending } = sync;
  return (
    <SettingGroup heading="Sync">
      <SettingItem
        name={syncing ? "Syncing…" : lastSyncAt ? `Synced ${timeAgo(lastSyncAt)}` : "Not synced yet"}
        description={
          pending > 0 ? `${pending} change${pending === 1 ? "" : "s"} on this phone waiting to be sent.` : undefined
        }
      >
        <Button disabled={busy || syncing} onClick={onSyncNow}>
          <RefreshCw className={syncing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Sync now
        </Button>
      </SettingItem>
      {lastError && (
        <SettingItem
          name="The last sync failed"
          description={
            <>
              <StatusText status={{ tone: "error", text: lastError }} /> Check the phone's internet connection and
              that the server is reachable.
            </>
          }
        />
      )}
      {lastConflicts > 0 && (
        <SettingItem
          name="Edited on both sides"
          description={
            lastConflicts === 1
              ? "1 note was edited on both sides; the phone's version was saved as “(offline copy)”."
              : `${lastConflicts} notes were edited on both sides; the phone's versions were saved as “(offline copy)”.`
          }
        />
      )}
    </SettingGroup>
  );
}

/** Scan, paste the link, or type the address and code. */
function PairForm({
  intro,
  busy,
  onScan,
  onPair,
}: {
  /** Shown before the instructions. */
  intro?: string;
  busy: boolean;
  onScan: () => void;
  onPair: (input: PairInput) => void;
}) {
  const [manual, setManual] = useState(false);
  const [link, setLink] = useState("");
  const [server, setServer] = useState("");
  const [code, setCode] = useState("");

  const submitLink = () => {
    if (link.trim()) onPair({ link: link.trim() });
  };
  const submitManual = () => {
    if (server.trim() && code.trim()) onPair({ server: server.trim(), code: code.trim() });
  };

  return (
    <SettingGroup
      heading="Pair with a server"
      description={`${intro ? `${intro} ` : ""}On the server, open Settings › Devices › Connect. It shows a QR code and a link, valid for 10 minutes.`}
    >
      <SettingItem name="Scan QR code" description="Uses the camera.">
        <Button variant="cta" disabled={busy} onClick={onScan}>
          <ScanQrCode className="h-4 w-4" />
          Scan QR code
        </Button>
      </SettingItem>
      {manual ? (
        <SettingItem stacked name="Enter address and code">
          <div className="flex flex-col gap-2">
            <TextInput
              value={server}
              onChange={setServer}
              placeholder="https://notes.example.com"
              label="Server address"
              technical
              full
            />
            <TextInput
              value={code}
              onChange={setCode}
              onEnter={submitManual}
              placeholder="ABCD-EFGH-JKMN-PQRS"
              label="Pairing code"
              technical
              full
              className="font-mono uppercase"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setManual(false)}
                className="text-xs font-medium text-primary"
              >
                Paste the link instead
              </button>
              <Button variant="cta" disabled={busy || !server.trim() || !code.trim()} onClick={submitManual}>
                {busy ? "Connecting…" : "Connect"}
              </Button>
            </div>
          </div>
        </SettingItem>
      ) : (
        <SettingItem stacked name="Paste the link">
          <div className="flex flex-col gap-2">
            <TextInput
              value={link}
              onChange={setLink}
              onEnter={submitLink}
              placeholder="https://notes.example.com/pair#…"
              label="Pairing link"
              technical
              full
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={() => setManual(true)} className="text-xs font-medium text-primary">
                Enter address and code
              </button>
              <Button variant="cta" disabled={busy || !link.trim()} onClick={submitLink}>
                <Link2 className="h-4 w-4" />
                {busy ? "Connecting…" : "Connect"}
              </Button>
            </div>
          </div>
        </SettingItem>
      )}
    </SettingGroup>
  );
}
