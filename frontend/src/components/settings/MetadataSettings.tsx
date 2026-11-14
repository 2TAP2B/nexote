"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { MetadataConfig } from "@/lib/api";
import {
  Button,
  errorText,
  SettingGroup,
  SettingItem,
  SettingLink,
  SettingsPage,
  StatusText,
  TextSetting,
  type Status,
} from "./ui";

const sameConfig = (a: MetadataConfig, b: MetadataConfig) =>
  a.discogsToken === b.discogsToken && (a.googleBooksKey ?? "") === (b.googleBooksKey ?? "");

export function MetadataSettings() {
  // Keys live on the server (metadata.json); fields save on blur.
  const [saved, setSaved] = useState<MetadataConfig | null>(null);
  const [draft, setDraft] = useState<MetadataConfig>({ discogsToken: "" });
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    void api
      .getMetadataConfig()
      .then((cfg) => {
        setSaved(cfg);
        setDraft(cfg);
      })
      .catch(() => setSaved({ discogsToken: "" }));
  }, []);

  const persist = async () => {
    if (!saved || sameConfig(draft, saved)) return;
    try {
      setSaved(await api.setMetadataConfig(draft));
    } catch (err) {
      // Keep the draft so nothing typed is lost.
      setStatus({ tone: "error", text: errorText(err, "Could not save the keys.") });
    }
  };

  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      // Save first so the server probes with the token that was entered.
      setSaved(await api.setMetadataConfig(draft));
      const res = await fetch("/api/metadata/discogs/search?q=test", { cache: "no-store" });
      if (res.ok) {
        setStatus({ tone: "ok", text: "The Discogs token works." });
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setStatus({ tone: "error", text: body?.error ?? `HTTP ${res.status}` });
      }
    } catch (err) {
      setStatus({ tone: "error", text: errorText(err, "Test failed.") });
    }
    setTesting(false);
  };

  return (
    <SettingsPage title="Metadata lookup">
      <SettingGroup
        heading="Collection lookups"
        description="Fill in records and books from online catalogs. The keys are stored on the server only."
      >
        <TextSetting
          name="Discogs token"
          description={
            <>
              Needed for record lookups. Create a free personal access token at{" "}
              <SettingLink href="https://www.discogs.com/settings/developers">discogs.com/settings/developers</SettingLink>.
            </>
          }
          type="password"
          technical
          value={draft.discogsToken}
          onChange={(v) => setDraft((d) => ({ ...d, discogsToken: v }))}
          onCommit={() => void persist()}
          placeholder="Personal access token"
        />
        <TextSetting
          name="Google Books API key"
          description={
            <>
              Optional. Without a key Google soon refuses book searches (HTTP 429). Create one in the{" "}
              <SettingLink href="https://console.cloud.google.com/apis/library/books.googleapis.com">
                Google Cloud console
              </SettingLink>{" "}
              with the Books API enabled.
            </>
          }
          type="password"
          technical
          value={draft.googleBooksKey ?? ""}
          onChange={(v) => setDraft((d) => ({ ...d, googleBooksKey: v }))}
          onCommit={() => void persist()}
          placeholder="AIza…"
        />
        <SettingItem
          name="Test Discogs token"
          description={status ? <StatusText status={status} /> : "Run a sample search with the token."}
        >
          <Button onClick={() => void test()} disabled={testing || !draft.discogsToken.trim()}>
            {testing ? "Testing…" : "Test"}
          </Button>
        </SettingItem>
      </SettingGroup>
    </SettingsPage>
  );
}
