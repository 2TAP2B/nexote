"use client";

import CodeScanner from "./CodeScanner";

type Props = {
  onScan: (isbn: string) => void;
  onManual: () => void;
  onClose: () => void;
};

// digits-only, optionally trailing X (ISBN-10); accept 10 or 13 digits.
function extractISBN(raw: string): string | null {
  const v = raw.replace(/[- ]/g, "").toUpperCase();
  if (v.length === 10 && /^(979)?\d{9}[\dX]$/.test(v)) return v;
  if (v.length === 13 && /^(978|979)\d{10}$/.test(v)) return v;
  return null;
}

// Camera-first ISBN scanner (the barcode on a book's back cover). A
// manual-entry link stays at the bottom so scanning is never a dead end.
export default function IsbnScanner({ onScan, onManual, onClose }: Props) {
  return (
    <CodeScanner
      formats={["ean_13", "ean_8", "upc_a", "upc_e"]}
      parse={extractISBN}
      onScan={onScan}
      onClose={onClose}
      title="Scan ISBN"
      hint="Hold the barcode on the back cover in the frame"
      detectedHint="ISBN detected — fetching…"
      manual={{ label: "Enter ISBN manually", onClick: onManual }}
    />
  );
}
