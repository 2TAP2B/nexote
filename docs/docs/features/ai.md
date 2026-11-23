# AI

Nexote can use any service with an OpenAI-compatible API for writing help, note titles and voice memo transcription. AI features are off until a connection is configured, and nothing is sent anywhere before that.

## Connection

Configure the connection in **Settings › AI › Connection**:

| Field | Example |
| --- | --- |
| Base URL | `https://api.openai.com/v1` or the address of a local server. A trailing `/v1` is optional. |
| API key | The key of your account at the service. Can be empty for local servers that need none. |
| Model | The chat model to use, for example `gpt-4o-mini`. |

**Test connection** checks the address and key: it asks the service for its model list and falls back to a minimal one-token chat request if that route is not supported.

Any service that implements `/v1/chat/completions` works, for example OpenAI, Groq, LocalAI or Ollama. Voice memos additionally need `/v1/audio/transcriptions`.

### How requests travel

Browsers cannot call most AI services directly (cross-origin restrictions), so all AI requests go through the Nexote backend:

1. The browser sends the base URL, API key, model and the request to the backend (`/api/ai/chat`, `/api/ai/test` or `/api/ai/transcribe`).
2. The backend forwards it to the service with the key as a bearer token and streams the answer back unchanged.

The backend does not store the key or the request. The connection settings themselves are saved in the browser's local storage on each device, so a phone needs its own entry. They are removed from the device when a different account signs in there. The offline queue never stores AI requests.

## Ask AI

**Ask AI** works on the selected text. Open it from the editor (desktop) or with the AI button of the mobile toolbar. It offers:

| Group | Commands |
| --- | --- |
| Edit | Improve writing, Fix grammar & spelling, Make shorter, Make longer |
| Change tone | Professional, Casual, Confident, Friendly, Direct, Formal |
| Translate | English, German, French, Spanish, Chinese, Japanese |
| Custom | A free-form prompt |

The answer streams in as it is generated.

## Generate AI title

**Generate AI title** in the note menu (desktop and mobile) asks the model for a title based on the note's content and renames the note.

## Voice memos

In [Quick notes](./quick-notes#voice-memos) and thread replies, recordings are transcribed through `/api/ai/transcribe`, which sends the audio to an endpoint's `/v1/audio/transcriptions`. The browser converts each recording to 16 kHz mono WAV before sending it, a format every compatible service reads. Audio files can be up to 25 MB; only the text is kept.

**Settings › AI › Voice memos** sets where they go:

| Setting | Meaning |
| --- | --- |
| Base URL | A speech-to-text server of their own, for example [speaches](https://speaches.ai/) or whisper.cpp. Empty: the connection above. |
| API key | The key of that server, sent only to it. With the base URL empty, the connection's key is used. |
| Transcription model | Default `whisper-1`; for example `whisper-large-v3` on Groq or `Systran/faster-whisper-small` on speaches. |
| Language | The spoken language as a two-letter code (`de`, `en`). Empty lets the model detect it, which is less reliable for short memos. |

**Test transcription** sends a second of silence with these settings and reports whether the server answered. Like every AI request, transcription goes from the Nexote server, not from the browser: the base URL must be reachable from there. When Nexote runs in Docker, `127.0.0.1` is the container itself; use the speech server's LAN or Tailscale address instead, for example `http://192.168.1.20:8000/v1`.

With **llama.cpp** (`llama-server`) as the endpoint, the model the server has loaded must accept audio: start it with an audio-capable model and its `mmproj` file. A single-model server ignores the model name Nexote sends; with llama-swap or router mode, set the transcription model to the name your server lists. Otherwise the server answers "The current model does not support audio input" — or point voice memos at a speech-to-text server of their own.
