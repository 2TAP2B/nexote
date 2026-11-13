"use client";

import { forwardRef } from "react";

type RawMarkdownTextareaProps = {
  value: string;
  onChange: (value: string) => void;
  fontSize: number;
};

// Raw markdown editor: a plain monospace textarea that replaces the rendered
// Crepe editor while "raw mode" is active. Edits flow through the same
// body/autosave pipeline, so saving and live sync keep working.
const RawMarkdownTextarea = forwardRef<
  HTMLTextAreaElement,
  RawMarkdownTextareaProps
>(function RawMarkdownTextarea({ value, onChange, fontSize }, ref) {
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      wrap="off"
      className="milkdown-raw-textarea block h-full w-full resize-none bg-transparent outline-none"
      style={{
        maxWidth: "var(--editor-max-width, 960px)",
        margin: "0 auto",
        padding: "64px 64px 120px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize,
        lineHeight: 1.75,
        color: "var(--foreground)",
      }}
    />
  );
});

export default RawMarkdownTextarea;
