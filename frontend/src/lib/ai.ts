"use client";

export type AIConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

const TITLE_SYSTEM_PROMPT = `You are an assistant that names markdown notes.

Rules:
- Output a single concise title for the note.
- Return only the title text — no markdown heading markers (#), no quotes, no numbering, no bullets, no preamble, no explanations.
- Prefer 3 to 8 words; never exceed ~80 characters.
- Reflect the note's actual content, not generic labels.`;

type ChatMessage = { role: "system" | "user"; content: string };

// Streams an OpenAI-compatible chat completion through the local backend
// (/api/ai/chat → Go proxy). The browser never talks to the upstream API
// directly, which avoids CORS failures and keeps the API key server-side.
export async function streamAIChat(
  config: AIConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const baseUrl = config.baseUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1$/i, "");

  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      baseUrl,
      apiKey: config.apiKey.trim() || undefined,
      model: config.model.trim(),
      messages,
    }),
  });

  if (!res.ok || !res.body) {
    let message = `AI request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore — fall back to the status-based message
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  while (true) {
    if (signal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return output;
      try {
        const event = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) output += delta;
      } catch {
        // ignore non-JSON keep-alive lines
      }
    }
  }
  return output;
}

function cleanTitle(raw: string): string | null {
  let t = raw
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/^["'“”‘’]+/, "")
    .replace(/["'“”‘’]+$/, "")
    .trim();
  if (!t) return null;
  if (t.length > 80) {
    const cut = t.slice(0, 80);
    const lastSpace = cut.lastIndexOf(" ");
    t = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
  }
  return t || null;
}

// Generates a concise title for a note body. Returns null when the model
// produced nothing usable.
export async function generateNoteTitle(
  config: AIConfig,
  body: string,
  signal?: AbortSignal,
): Promise<string | null> {
  // Strip the existing title heading so it doesn't bias the model.
  const content = body.replace(/^##? .+\n?/, "").trim();
  const prompt = `<document>\n${content || body}\n</document>\n\n<instruction>\nGenerate a concise title for this note.\n</instruction>`;
  const raw = await streamAIChat(
    config,
    [
      { role: "system", content: TITLE_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    signal,
  );
  return cleanTitle(raw);
}
