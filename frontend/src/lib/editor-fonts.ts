// Editor typefaces. Serif and monospace use the fonts the app already loads
// via next/font (app/layout.tsx: --font-serif = Lora, --font-mono =
// JetBrains Mono); the default is the app font (Inter). Only list fonts that
// are actually available — a missing family silently falls back.
export const EDITOR_FONTS: { value: string; label: string; stack: string }[] = [
  { value: "", label: "Inter (default)", stack: "" },
  { value: "system", label: "System font", stack: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { value: "serif", label: "Lora (serif)", stack: "var(--font-serif), Georgia, serif" },
  { value: "mono", label: "JetBrains Mono", stack: "var(--font-mono), ui-monospace, monospace" },
];

export function editorFontStack(value: string): string {
  return EDITOR_FONTS.find((f) => f.value === value)?.stack ?? "";
}