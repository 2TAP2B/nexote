"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceClip = { blob: Blob; fileName: string };

/** A recording problem worth showing to the user as is. */
export class VoiceError extends Error {}

// Formats MediaRecorder may produce, in order of preference, with the file
// extension speech-to-text APIs expect (they infer the format from the name).
// Chrome/Android record WebM/Opus, Safari MP4/AAC.
const FORMATS = [
  { mime: "audio/webm;codecs=opus", ext: "webm" },
  { mime: "audio/webm", ext: "webm" },
  { mime: "audio/mp4", ext: "m4a" },
  { mime: "audio/ogg;codecs=opus", ext: "ogg" },
];

const extensionFor = (mime: string) =>
  mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : "webm";

type Session = {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  timer: number;
  ext: string;
};

/**
 * Microphone recording for voice memos. `onLimit` fires when a recording
 * reaches `maxMs` (the caller stops and keeps it). The microphone is released
 * on stop, cancel and unmount.
 */
export function useVoiceRecorder({ maxMs, onLimit }: { maxMs: number; onLimit: () => void }) {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const session = useRef<Session | null>(null);
  const stopping = useRef<Promise<VoiceClip | null> | null>(null);
  const onLimitRef = useRef(onLimit);
  useEffect(() => {
    onLimitRef.current = onLimit;
  });

  const release = useCallback(() => {
    const s = session.current;
    if (!s) return;
    window.clearInterval(s.timer);
    s.stream.getTracks().forEach((t) => t.stop());
    session.current = null;
    setRecording(false);
    setElapsedMs(0);
  }, []);

  const start = useCallback(async () => {
    if (session.current) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new VoiceError("The microphone only works over a secure connection: open Nexote via https.");
    }
    if (typeof MediaRecorder === "undefined") throw new VoiceError("This browser can't record audio.");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      throw new VoiceError(
        name === "NotAllowedError"
          ? "Microphone access is blocked. Allow it for this site in the browser settings."
          : name === "NotFoundError"
            ? "No microphone found."
            : "Couldn't start the microphone.",
      );
    }
    const format = FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime));
    const recorder = new MediaRecorder(stream, format ? { mimeType: format.mime } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsedMs(ms);
      if (ms >= maxMs) {
        window.clearInterval(timer);
        onLimitRef.current();
      }
    }, 250);
    session.current = { recorder, stream, chunks, timer, ext: format?.ext ?? extensionFor(recorder.mimeType) };
    recorder.start(1000);
    setRecording(true);
  }, [maxMs]);

  // Finishes the recording; null when nothing was captured.
  const stop = useCallback((): Promise<VoiceClip | null> => {
    const s = session.current;
    if (!s) return Promise.resolve(null);
    // Executor form on purpose: Promise.withResolvers needs iOS 17.4+, and the
    // build (ES2022) doesn't polyfill it.
    stopping.current ??= new Promise<VoiceClip | null>((resolve) => {
      s.recorder.onstop = () => {
        const blob = new Blob(s.chunks, { type: s.recorder.mimeType || s.chunks[0]?.type || "audio/webm" });
        release();
        stopping.current = null;
        resolve(blob.size > 0 ? { blob, fileName: `voice-memo.${s.ext}` } : null);
      };
      s.recorder.stop();
    });
    return stopping.current;
  }, [release]);

  const cancel = useCallback(() => {
    const s = session.current;
    if (!s) return;
    s.recorder.onstop = null;
    if (s.recorder.state !== "inactive") s.recorder.stop();
    stopping.current = null;
    release();
  }, [release]);

  useEffect(() => cancel, [cancel]);

  return { recording, elapsedMs, start, stop, cancel };
}
