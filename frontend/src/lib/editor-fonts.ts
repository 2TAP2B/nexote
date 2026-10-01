export const EDITOR_FONTS: { value: string; label: string; stack: string }[] = [
  { value: "", label: "Default", stack: "" },
  { value: "system", label: "System UI", stack: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { value: "geist", label: "Geist Sans", stack: "'Geist', system-ui, sans-serif" },
  { value: "inter", label: "Inter", stack: "'Inter', system-ui, sans-serif" },
  { value: "serif", label: "Serif", stack: "Georgia, 'Times New Roman', serif" },
  { value: "mono", label: "Monospace", stack: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
];

export function editorFontStack(value: string): string {
  return EDITOR_FONTS.find((f) => f.value === value)?.stack ?? "";
}