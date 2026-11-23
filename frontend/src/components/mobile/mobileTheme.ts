// The touch shell's palette (--mob-*), mapped to the theme variables. The
// shell root (.mob-shell-root in globals.css) defines the same mapping; views
// that also render outside it (the desktop main area: quick notes, a thread,
// a collection) set it on their root so their --mob-* colors resolve there
// too, in every color scheme.
export const SHELL_PALETTE = {
  "--mob-bg": "var(--background)",
  "--mob-surface": "var(--muted)",
  "--mob-card": "var(--sidebar)",
  "--mob-text": "var(--foreground)",
  "--mob-muted": "var(--muted-foreground)",
  "--mob-accent": "var(--primary)",
} as React.CSSProperties;
