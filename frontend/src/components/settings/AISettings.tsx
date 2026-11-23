"use client";

import { useState } from "react";

import { transcriptionConfig } from "@/lib/ai";
import { api } from "@/lib/api";
import { silentWav16k } from "@/lib/audio-wav";
import type { AppSettings } from "@/lib/notes-context";
import { useNotes } from "@/lib/notes-context";
import { Button, errorText, SettingGroup, SettingItem, SettingsPage, StatusText, TextSetting, type Status } from "./ui";

export function AISettings() {
  const { settings, updateSettings } = useNotes();
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [voiceTesting, setVoiceTesting] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<Status | null>(null);
  const voice = transcriptionConfig(settings);

  // A result is only meaningful for the values it was produced with.
  const update = (patch: Partial<AppSettings>) => {
    setStatus(null);
    setVoiceStatus(null);
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

  // A real transcription request with a second of silence: it checks the
  // address (as the Nexote server sees it), the key and the model at once.
  // A server that unloads idle models may take a few seconds to answer.
  const testVoice = async () => {
    if (!voice) return;
    setVoiceTesting(true);
    setVoiceStatus(null);
    try {
      await api.transcribeAudio(voice, silentWav16k(), "voice-memo.wav");
      setVoiceStatus({ tone: "ok", text: "Transcription works." });
    } catch (err) {
      setVoiceStatus({ tone: "error", text: errorText(err, "Transcription failed.") });
    }
    setVoiceTesting(false);
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

      <SettingGroup
        heading="Voice memos"
        description="Recordings in quick notes and threads become text through an endpoint with /v1/audio/transcriptions: OpenAI, Groq, or a speech-to-text server of your own such as speaches or whisper.cpp."
      >
        <TextSetting
          name="Base URL"
          description="Empty: the connection above. The Nexote server connects to this address — when it runs in Docker, use the machine's LAN or Tailscale address, not 127.0.0.1."
          technical
          value={settings.aiTranscribeBaseUrl}
          onChange={(v) => update({ aiTranscribeBaseUrl: v })}
          placeholder={settings.aiBaseUrl.trim() || "http://192.168.1.20:8000/v1"}
        />
        <TextSetting
          name="API key"
          description="Only sent to this base URL. With the base URL empty, the connection's key is used."
          type="password"
          technical
          value={settings.aiTranscribeApiKey}
          onChange={(v) => update({ aiTranscribeApiKey: v })}
          placeholder="Key of the speech-to-text server"
        />
        <TextSetting
          name="Transcription model"
          description="For example whisper-1 (OpenAI), whisper-large-v3 (Groq) or Systran/faster-whisper-small (speaches)."
          technical
          value={settings.aiTranscribeModel}
          onChange={(v) => update({ aiTranscribeModel: v })}
          placeholder="whisper-1"
        />
        <TextSetting
          name="Language"
          description="What you speak, as a two-letter code such as de or en. Empty: the model guesses, which is less reliable for short memos."
          technical
          value={settings.aiTranscribeLanguage}
          onChange={(v) => update({ aiTranscribeLanguage: v })}
          placeholder="auto"
        />
        <SettingItem
          name="Test transcription"
          description={voiceStatus ? <StatusText status={voiceStatus} /> : "Send a second of silence with these settings."}
        >
          <Button onClick={() => void testVoice()} disabled={voiceTesting || !voice}>
            {voiceTesting ? "Testing…" : "Test"}
          </Button>
        </SettingItem>
      </SettingGroup>
    </SettingsPage>
  );
}
