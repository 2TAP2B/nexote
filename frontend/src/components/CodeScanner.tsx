"use client";

import { Camera, Keyboard, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAndroidBack } from "@/lib/android-back";

// Minimal typing for the BarcodeDetector API (Chromium, Android WebView);
// ZXing covers the other browsers.
type DetectedBarcode = { rawValue: string };
interface BarcodeDetector {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = {
  new (opts?: { formats?: string[] }): BarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
};
declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorCtor;
  }
}

export type CodeScannerProps<T> = {
  /** BarcodeDetector format names, e.g. `["qr_code"]` or `["ean_13"]`. */
  formats: string[];
  /** The value in a scanned code, or null to keep looking. */
  parse: (raw: string) => T | null;
  onScan: (value: T) => void;
  onClose: () => void;
  title: string;
  /** What to point the camera at. */
  hint: string;
  /** Shown once a code was accepted (the caller is working on it). */
  detectedHint: string;
  /** Shown after a code that `parse` turned down. */
  rejectedHint?: string;
  /** A way out without the camera (typing the value). */
  manual?: { label: string; onClick: () => void };
  /** Frame shape: wide for barcodes, square for QR codes. */
  frame?: "wide" | "square";
};

const cameraError = (err: unknown): string =>
  err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "NotFoundError")
    ? "No camera available or permission denied."
    : err instanceof Error
      ? err.message
      : "Camera failed to start";

// The platform detector when it reads one of the formats, else null (ZXing).
async function nativeDetector(formats: string[]): Promise<BarcodeDetector | null> {
  const Ctor = window.BarcodeDetector;
  if (!Ctor) return null;
  try {
    const supported = (await Ctor.getSupportedFormats?.()) ?? formats;
    const usable = formats.filter((f) => supported.includes(f));
    return usable.length > 0 ? new Ctor({ formats: usable }) : null;
  } catch {
    return null;
  }
}

/**
 * Full-screen camera scanner: opens the back camera and reads codes with the
 * platform BarcodeDetector where it supports the formats, otherwise with
 * ZXing (dynamically imported). Every reading goes through `parse`; the first
 * accepted value ends the scan. The manual link keeps it from being a dead end.
 */
export default function CodeScanner<T>({
  formats,
  parse,
  onScan,
  onClose,
  title,
  hint,
  detectedHint,
  rejectedHint,
  manual,
  frame = "wide",
}: CodeScannerProps<T>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useAndroidBack(onClose);
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState(false);
  const [rejected, setRejected] = useState(false);
  const doneRef = useRef(false);
  // The effect starts the camera once; it reads the latest callbacks here.
  const latest = useRef({ parse, onScan });
  latest.current = { parse, onScan };
  const formatsKey = formats.join(",");

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let stream: MediaStream | null = null;
    let controls: { stop(): void } | null = null;

    // True when the reading was accepted (scanning stops).
    const handle = (raw: string): boolean => {
      if (cancelled || doneRef.current || !raw) return false;
      const value = latest.current.parse(raw);
      if (value === null) {
        setRejected(true);
        return false;
      }
      doneRef.current = true;
      setDetected(true);
      latest.current.onScan(value);
      return true;
    };

    const start = async () => {
      const video = videoRef.current;
      if (!video) return;
      const wanted = formatsKey.split(",");
      const detector = await nativeDetector(wanted);
      if (cancelled) return;

      if (detector) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" },
            audio: false,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          video.srcObject = stream;
          await video.play();
          timer = window.setInterval(async () => {
            if (cancelled || doneRef.current || video.readyState < 2) return;
            try {
              const codes = await detector.detect(video);
              for (const c of codes) if (handle(c.rawValue)) return;
            } catch {
              // transient decode errors are normal; keep polling
            }
          }, 300);
        } catch (err) {
          if (!cancelled) setError(cameraError(err));
        }
        return;
      }

      // ZXing fallback (Firefox / Safari): imported on demand so the library
      // stays out of the bundle where the platform detector does the work.
      // It manages its own stream and hands back controls for teardown.
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 300 });
        controls = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, video, (result) => {
          if (result) handle(result.getText());
        });
        // Unmounted while the camera was starting.
        if (cancelled) controls.stop();
      } catch (err) {
        if (!cancelled) setError(cameraError(err));
      }
    };

    void start();

    return () => {
      cancelled = true;
      clearInterval(timer);
      try {
        controls?.stop();
      } catch {
        // already detached
      }
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [formatsKey]);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black" onClick={onClose}>
      {/* Camera */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <video ref={videoRef} muted playsInline autoPlay className="h-full w-full object-cover" />
        {/* Frame + dimmed surroundings */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={`relative rounded-2xl border-2 border-white/70 shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)] ${
              frame === "square" ? "h-64 w-64" : "h-40 w-64"
            }`}
          />
        </div>
        {error && (
          <div className="absolute left-0 right-0 top-0 flex items-center justify-center gap-2 bg-black/70 p-4 text-sm text-white">
            <Camera className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Bottom panel */}
      <div
        className="shrink-0 bg-background px-4 pt-3"
        style={{
          paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
          borderTop: "1px solid color-mix(in srgb, var(--primary) 55%, transparent)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Camera className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate text-sm font-medium text-foreground">{title}</span>
            {detected && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
          </div>
          <button
            type="button"
            aria-label="Close scanner"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {detected ? detectedHint : rejected && rejectedHint ? rejectedHint : hint}
        </p>
        {manual && (
          <div className="mt-3 flex justify-center border-t border-border pt-3">
            <button
              type="button"
              onClick={manual.onClick}
              className="flex items-center gap-1.5 text-xs font-medium text-primary active:scale-95"
            >
              <Keyboard className="h-3.5 w-3.5" />
              {manual.label}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
