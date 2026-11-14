"use client";

import { useState } from "react";

import { api } from "@/lib/api";
import type { AppSettings } from "@/lib/notes-context";
import { useNotes } from "@/lib/notes-context";
import {
  Button,
  errorText,
  SettingGroup,
  SettingItem,
  SettingsPage,
  StatusText,
  TextSetting,
  useIsMobileSettings,
  type Status,
} from "./ui";

export function AISettings() {
  const { settings, updateSettings } = useNotes();
  // Voice memos only exist in the mobile app (quick notes).
  const mobile = useIsMobileSettings();
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  // A result is only meaningful for the values it was produced with.
  const update = (patch: Partial<AppSettings>) => {
    setStatus(null);
    updateSettings(patch);
  };

  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const result = await api.testAI({
        baseUrl: settings.aiBaseUrl,
        apiKey: settings.aiApiKey,
        model: settings.aiModel,
      });
      setStatus(
        result.ok
          ? { tone: "ok", text: "Connection works." }
          : { tone: "error", text: result.error ?? "Connection failed." },
      );
    } catch (err) {
      setStatus({ tone: "error", text: errorText(err, "Connection failed.") });
    }
    setTesting(false);
  };

  return (
    <SettingsPage title="AI">
      <SettingGroup
        heading="Connection"
        description="Any OpenAI-compatible API works: OpenAI, OpenRouter, Ollama, LM Studio. The AI button appears once a base URL is set."
      >
        <TextSetting
          name="Base URL"
          description="For example https://api.openai.com/v1 or http://localhost:11434/v1"
          technical
          value={settings.aiBaseUrl}
          onChange={(v) => update({ aiBaseUrl: v })}
          placeholder="https://api.openai.com/v1"
        />
        <TextSetting
          name="API key"
          description="Not needed for local servers such as Ollama."
          type="password"
          technical
          value={settings.aiApiKey}
          onChange={(v) => update({ aiApiKey: v })}
          placeholder="sk-…"
        />
        <TextSetting
          name="Model"
          description="For example gpt-4o-mini or llama3.2"
          technical
          value={settings.aiModel}
          onChange={(v) => update({ aiModel: v })}
          placeholder="gpt-4o-mini"
        />
        <SettingItem
          name="Test connection"
          description={status ? <StatusText status={status} /> : "Send a short request with these settings."}
        >
          <Button onClick={() => void test()} disabled={testing || !settings.aiBaseUrl.trim()}>
            {testing ? "Testing…" : "Test"}
          </Button>
        </SettingItem>
      </SettingGroup>

      {mobile && (
        <SettingGroup
          heading="Voice memos"
          description="Quick notes turn recorded speech into text with this endpoint. It needs to support /v1/audio/transcriptions, as OpenAI, Groq and LocalAI do."
        >
          <TextSetting
            name="Transcription model"
            description="For example whisper-1 (OpenAI) or whisper-large-v3 (Groq)."
            technical
            value={settings.aiTranscribeModel}
            onChange={(v) => update({ aiTranscribeModel: v })}
            placeholder="whisper-1"
          />
        </SettingGroup>
      )}
    </SettingsPage>
  );
}
