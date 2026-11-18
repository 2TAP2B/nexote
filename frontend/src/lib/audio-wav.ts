// Voice memos are recorded as whatever the browser's MediaRecorder makes:
// WebM/Opus (Chrome, Android), MP4/AAC (Safari). Not every speech-to-text
// server decodes those — llama.cpp's /v1/audio/transcriptions only reads WAV,
// MP3 and FLAC. 16 kHz mono 16-bit PCM WAV is what speech models work on
// anyway and every OpenAI-compatible endpoint accepts it; 10 minutes are
// ~19 MB, under the 25 MB upload cap.

const SAMPLE_RATE = 16_000;

/** The recording as 16 kHz mono WAV; null if the browser can't decode it. */
export async function toWav16k(audio: Blob): Promise<Blob | null> {
  if (typeof window === "undefined" || typeof OfflineAudioContext === "undefined") return null;
  try {
    const bytes = await audio.arrayBuffer();
    // decodeAudioData needs a context; the offline one below does the resampling.
    const probe = new OfflineAudioContext(1, 1, SAMPLE_RATE);
    const decoded = await probe.decodeAudioData(bytes);
    const frames = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination); // a mono destination downmixes the channels
    source.start();
    const pcm = (await offline.startRendering()).getChannelData(0);
    return new Blob([wavHeader(pcm.length), floatTo16(pcm)], { type: "audio/wav" });
  } catch {
    return null;
  }
}

function floatTo16(samples: Float32Array): ArrayBuffer {
  const out = new DataView(new ArrayBuffer(samples.length * 2));
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out.buffer;
}

function wavHeader(frames: number): ArrayBuffer {
  const dataBytes = frames * 2;
  const h = new DataView(new ArrayBuffer(44));
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) h.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  h.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  h.setUint32(16, 16, true); // fmt chunk size
  h.setUint16(20, 1, true); // PCM
  h.setUint16(22, 1, true); // mono
  h.setUint32(24, SAMPLE_RATE, true);
  h.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  h.setUint16(32, 2, true); // block align
  h.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  h.setUint32(40, dataBytes, true);
  return h.buffer;
}
