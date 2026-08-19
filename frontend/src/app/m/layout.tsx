import type { Viewport } from "next";

// Mobile viewport: allow horizontal clamping, cover the notch (safe areas),
// and prevent user zoom (feels more app-like). The mobile shell colors are
// derived from the active color scheme via CSS variables in globals.css
// (.mob-shell-root maps --background etc. to --mob-*). We don't hardcode
// inline color vars here so light/dark themes work correctly on mobile.
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
    <div className="mob-shell-root">
      {children}
    </div>
  );
}