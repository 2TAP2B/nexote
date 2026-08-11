// Mobile shell color palette. Scoped to the mobile UI via inline CSS variables
// on the shell root so they don't leak into / override the desktop theme vars.
export const mobileShellVars: React.CSSProperties = {
  "--mob-bg": "#1a1d29",
  "--mob-surface": "#2e3140",
  "--mob-card": "#22252f",
  "--mob-text": "#d8d8dc",
  "--mob-muted": "#5c5f6b",
  "--mob-accent": "#7c6ff0",
  "--mob-fab": "#3b6fe0",
  "--mob-done": "#c9c5f5",
} as React.CSSProperties;