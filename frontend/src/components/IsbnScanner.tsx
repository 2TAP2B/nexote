"use client";

import { Camera, Keyboard, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAndroidBack } from "@/lib/android-back";

type Props = {
  onScan: (isbn: string) => void;
  onManual: () => void;
  onClose: () => void;
};

// Minimal typing for the (Chrome-only) BarcodeDetector API; fall back to
// ZXing everywhere else.
type DetectedBarcode = { rawValue: string };
interface BarcodeDetector {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetector;
// IScannerControls from @zxing/browser — inline-type it to avoid pulling the
// library into the initial bundle (it is dynamically imported).
interface ZxingControls {
  stop(): void;
}

const BarcodeFormats = ["ean_13", "ean_8", "upc_a", "upc_e"];

// digits-only, optionally trailing X (ISBN-10); accept 10 or 13 digits.
function extractISBN(raw: string): string | null {
  const v = raw.replace(/[- ]/g, "").toUpperCase();
  if (v.length === 10 && /^(979)?\d{9}[\dX]$/.test(v)) return v;
  if (v.length === 13 && /^(978|979)\d{10}$/.test(v)) return v;
  return null;
}

// Camera-first ISBN scanner: opens the camera, detects the barcode with the
// platform BarcodeDetector where available and falls back to ZXing (ES
// module, dynamically imported) elsewhere. A manual-entry link stays at the
// bottom so scanning is never a dead end.
export default function IsbnScanner({ onScan, onManual, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useAndroidBack(onClose);
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState(false);
  const doneRef = useRef(false);

  const finish = (isbn: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setDetected(true);
    onScan(isbn);
  };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stream: MediaStream | null = null;
    let controls: { stop(): void } | null = null;

    const cameraError = (err: unknown): string =>
      err instanceof DOMException &&
      (err.name === "NotAllowedError" || err.name === "NotFoundError")
        ? "No camera available or permission denied."
        : err instanceof Error
          ? err.message
          : "Camera failed to start";

    const start = async () => {
      const video = videoRef.current;
      if (!video) return;
      const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
        .BarcodeDetector;

      if (Ctor) {
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
          const detector = new Ctor({ formats: [...BarcodeFormats] });
          timer = setInterval(async () => {
            if (cancelled || doneRef.current) return;
            if (video.readyState < 2) return;
            try {
              const codes = await detector.detect(video);
              for (const c of codes) {
                const isbn = extractISBN(c.rawValue);
                if (isbn) {
                  finish(isbn);
                  return;
                }
              }
            } catch {
              // transient decode errors are normal; keep polling
            }
          }, 300);
          return;
        } catch (err) {
          if (cancelled) return;
          setError(cameraError(err));
          return;
        }
      }

      // ZXing fallback (Firefox / Safari): it manages its own stream and
      // hands back IScannerControls for teardown.
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader(
          undefined,
          { delayBetweenScanAttempts: 300 },
        );
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: "environment" } },
          video,
          (result) => {
            if (cancelled || doneRef.current || !result) return;
            const isbn = extractISBN(result.getText());
            if (isbn) finish(isbn);
          },
        );
      } catch (err) {
        if (cancelled) return;
        setError(cameraError(err));
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      try {
        controls?.stop();
      } catch {
        // already detached
      }
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black" onClick={onClose}>
      {/* Camera */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="h-full w-full object-cover"
        />
        {/* Reticle + dimmed surroundings */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-40 w-64 rounded-2xl border-2 border-white/70 shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]" />
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
            <span className="truncate text-sm font-medium text-foreground">Scan ISBN</span>
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
          {detected ? "ISBN detected — fetching…" : "Hold the barcode on the back cover in the frame"}
        </p>
        <div className="mt-3 flex justify-center border-t border-border pt-3">
          <button
            type="button"
            onClick={onManual}
            className="flex items-center gap-1.5 text-xs font-medium text-primary active:scale-95"
          >
            <Keyboard className="h-3.5 w-3.5" />
            Enter ISBN manually
          </button>
        </div>
      </div>
    </div>
  );
}
