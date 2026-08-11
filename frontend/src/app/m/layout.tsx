import type { Viewport } from "next";

import { mobileShellVars } from "@/components/mobile/mobileTheme";

// Mobile viewport: allow horizontal clamping, cover the notch (safe areas),
// and prevent user zoom (feels more app-like). The dark background is set on
// the shell root in MobileApp via --mob-bg.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#1a1d29",
};

// Never statically prerender — the mobile shell depends on client-only APIs
// (navigator, localStorage, touch) and UA-based redirect state.
export const dynamic = "force-dynamic";

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mob-shell-root" style={mobileShellVars as React.CSSProperties}>
      {children}
    </div>
  );
}