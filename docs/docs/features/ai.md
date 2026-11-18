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

In [Quick notes](./quick-notes#voice-memos), recordings are transcribed through `/api/ai/transcribe`, which sends the audio to the service's `/v1/audio/transcriptions` endpoint. The model is set in **Settings › AI › Voice memos › Transcription model** (default `whisper-1`). The browser converts each recording to 16 kHz mono WAV before sending it, a format every compatible service reads. Audio files can be up to 25 MB; only the text is kept.

With **llama.cpp** (`llama-server`), the model the server has loaded must accept audio: start it with an audio-capable model and its `mmproj` file. A single-model server ignores the model name Nexote sends; with llama-swap or router mode, set the transcription model to the name your server lists. Otherwise the server answers "The current model does not support audio input".
