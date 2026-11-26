"use client";

import { useMemo } from "react";
import { encode } from "uqr";

/** A QR code drawn as SVG in the browser: nothing about the encoded text
 *  leaves the page. Always dark on white with a quiet zone, whatever the
 *  theme — inverted codes scan badly on many phones. */
export function QrCode({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const { path, modules } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 4 });
    // One horizontal run per row segment keeps the path short.
    let d = "";
    qr.data.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        if (!row[x]) {
          x++;
          continue;
        }
        const start = x;
        while (x < row.length && row[x]) x++;
        d += `M${start} ${y}h${x - start}v1h${start - x}z`;
      }
    });
    return { path: d, modules: qr.size };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${modules} ${modules}`}
      shapeRendering="crispEdges"
      className="rounded-lg"
    >
      <rect width={modules} height={modules} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
