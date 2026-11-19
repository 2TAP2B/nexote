"use client";

import { useEffect, useRef, useState } from "react";

import { BottomSheet } from "./BottomSheet";

/**
 * A bottom sheet asking for one line of text: rename a note, folder or
 * vault, name a new folder. The field is focused with preventScroll and the
 * sheet lives outside the pager, so the keyboard never drags the panes
 * sideways (the inline tree field did: half tree, half note).
 */
export function InputSheet({
  title,
  initial = "",
  placeholder,
  submitLabel = "Save",
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: string;
  placeholder?: string;
  submitLabel?: string;
  /** Called with the trimmed value when it is non-empty and changed. */
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // After the slide-in frame, so iOS opens the keyboard for this field.
    const id = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const trimmed = value.trim();
  const canSubmit = trimmed !== "" && trimmed !== initial.trim();

  return (
    <BottomSheet title={title} onClose={onClose}>
      {({ dismiss, closeNow }) => {
        const submit = () => {
          if (!canSubmit) {
            if (trimmed === initial.trim()) dismiss();
            return;
          }
          closeNow();
          onSubmit(trimmed);
        };
        return (
          <form
            className="flex flex-col gap-3 px-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              aria-label={title}
              enterKeyHint="done"
              autoCapitalize="sentences"
              // 16px: iOS zooms into smaller fields on focus.
              className="h-12 w-full rounded-xl border border-border bg-muted/60 px-3.5 text-base outline-none focus:border-primary"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={dismiss}
                className="h-11 flex-1 rounded-xl bg-muted/60 text-[15px] font-medium active:bg-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="h-11 flex-1 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
              >
                {submitLabel}
              </button>
            </div>
          </form>
        );
      }}
    </BottomSheet>
  );
}
