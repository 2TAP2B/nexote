// Which interface the app shows on this device. One address serves both: the
// touch interface (phones, tablets, narrow windows) and the desktop one.

export type Shell = "touch" | "desktop";

/** Settings › General › Interface. */
export type InterfaceMode = "auto" | Shell;

export const INTERFACE_MODES: Record<InterfaceMode, string> = {
  auto: "Automatic",
  touch: "Touch",
  desktop: "Desktop",
};

/** The shell for a mode. Automatic: a touch screen without a mouse or
 *  trackpad (phone, tablet) or a window narrower than 768 px gets touch. */
export function pickShell(mode: InterfaceMode): Shell {
  if (mode !== "auto") return mode;
  const touchOnly = window.matchMedia("(pointer: coarse) and (hover: none)").matches;
  const narrow = window.matchMedia("(max-width: 767px)").matches;
  return touchOnly || narrow ? "touch" : "desktop";
}

/** The mode saved in this device's settings (read before NotesProvider mounts). */
export function savedInterfaceMode(): InterfaceMode {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem("nexote:settings") ?? "null");
    if (typeof parsed === "object" && parsed !== null && "interface" in parsed) {
      const mode = parsed.interface;
      if (mode === "auto" || mode === "touch" || mode === "desktop") return mode;
    }
  } catch {
    // unreadable settings: automatic
  }
  return "auto";
}
