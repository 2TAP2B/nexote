"use client";

import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

// Form pieces for the collection and item editors, sized for the finger in
// the touch shell (44px rows, 16px text so iOS doesn't zoom) and compact on
// the desktop. Same look as InputSheet's field and buttons.

export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted-foreground">
      {children}
    </label>
  );
}

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & { touch: boolean };

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { touch, className = "", ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      {...props}
      className={
        "w-full min-w-0 border border-border bg-muted/40 px-3 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:bg-background disabled:opacity-50 " +
        (touch ? "h-11 rounded-xl text-base" : "h-9 rounded-lg text-sm") +
        " " +
        className
      }
    />
  );
});

/** A row of choices, one selected (Yes / No, a field's type). */
export function Segmented<T extends string>({
  touch,
  value,
  options,
  onChange,
  label,
}: {
  touch: boolean;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-xl bg-muted/60 p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={
              "min-w-0 flex-1 truncate rounded-lg px-2 font-medium transition-colors " +
              (touch ? "h-9 text-[15px]" : "h-7 text-sm") +
              (on ? " bg-background text-foreground shadow-sm" : " text-muted-foreground hover:text-foreground")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

type DialogButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  touch: boolean;
  tone?: "primary" | "secondary" | "danger";
  busy?: boolean;
};

/**
 * Footer buttons. On touch they share the row (Cancel | Save, like
 * InputSheet); on the desktop they keep their width, right-aligned — a
 * danger button gets `className="mr-auto"` to sit on the left.
 */
export function DialogButton({ touch, tone = "secondary", busy = false, className = "", children, disabled, ...props }: DialogButtonProps) {
  const toneClass =
    tone === "primary"
      ? "bg-primary text-primary-foreground font-semibold hover:opacity-90"
      : tone === "danger"
        ? "text-red-600 dark:text-red-400 hover:bg-red-500/10 font-medium"
        : touch
          ? "bg-muted/60 font-medium active:bg-muted"
          : "border border-border font-medium hover:bg-muted";
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || busy}
      className={
        "inline-flex items-center justify-center gap-1.5 rounded-xl transition-[opacity,background-color] disabled:opacity-40 " +
        (touch ? "h-11 flex-1 px-3 text-[15px]" : "h-9 px-4 text-sm") +
        " " +
        toneClass +
        " " +
        className
      }
    >
      {busy && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}
