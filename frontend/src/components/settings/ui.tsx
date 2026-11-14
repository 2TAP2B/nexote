"use client";

import { ChevronDown } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

/*
 * Obsidian-style settings building blocks, shared by the desktop settings
 * dialog (SettingsPanel) and the mobile settings screen (MobileSettings).
 * Sections render the same markup on both; the platform only changes sizes
 * (touch targets and type are larger on mobile).
 *
 * A page holds groups; a group is an optional heading plus one rounded card;
 * the card holds setting items: name and description on the left, the
 * control on the right (or below the text when `stacked`). Changes apply
 * immediately, there is no save button.
 */

export type SettingsPlatform = "desktop" | "mobile";

const PlatformContext = createContext<SettingsPlatform>("desktop");
export const SettingsPlatformProvider = PlatformContext.Provider;

export function useIsMobileSettings(): boolean {
  return useContext(PlatformContext) === "mobile";
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Live `matchMedia` result; false while rendering on the server. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// ── Layout ───────────────────────────────────────────────────────────

export function SettingsPage({ title, children }: { title: string; children: ReactNode }) {
  const mobile = useIsMobileSettings();
  // On mobile the screen header already shows the title.
  if (mobile) return <div className="px-4 pb-12 pt-1">{children}</div>;
  return (
    <div className="mx-auto w-full max-w-[680px] px-8 pb-12 pt-7">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      {children}
    </div>
  );
}

export function SettingGroup({
  heading,
  description,
  children,
}: {
  heading?: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const mobile = useIsMobileSettings();
  return (
    <section className={mobile ? "mt-6" : "mt-7"}>
      {heading && (
        <h3
          className={
            mobile
              ? "mb-1.5 px-4 text-[13px] font-semibold text-muted-foreground"
              : "mb-2 px-1 text-[13px] font-semibold text-foreground"
          }
        >
          {heading}
        </h3>
      )}
      {description && (
        <div
          className={
            mobile
              ? "mb-2 px-4 text-[13px] leading-snug text-muted-foreground"
              : "mb-2.5 px-1 text-xs leading-relaxed text-muted-foreground"
          }
        >
          {description}
        </div>
      )}
      <div
        className={
          mobile
            ? "divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70 bg-muted/40"
            : "divide-y divide-border overflow-hidden rounded-lg border border-border bg-muted/30"
        }
      >
        {children}
      </div>
    </section>
  );
}

/** A bare row with the standard padding, for custom content. */
export function SettingRow({ children, className }: { children: ReactNode; className?: string }) {
  const mobile = useIsMobileSettings();
  return (
    <div className={cx("flex min-h-[52px] items-center px-4 py-3", mobile ? "gap-3" : "gap-4", className)}>
      {children}
    </div>
  );
}

function useTextClasses() {
  const mobile = useIsMobileSettings();
  return {
    name: cx("leading-snug text-foreground", mobile ? "text-[15px]" : "text-sm"),
    desc: cx("mt-0.5 leading-snug text-muted-foreground", mobile ? "text-[13px]" : "text-xs"),
  };
}

export function SettingItem({
  name,
  description,
  children,
  stacked,
  htmlFor,
  clickable,
  leading,
  onClick,
}: {
  name: ReactNode;
  description?: ReactNode;
  /** The control(s). */
  children?: ReactNode;
  /** Put the control below the text at full width (long text fields, grids). */
  stacked?: boolean;
  /** Id of the control the name labels. */
  htmlFor?: string;
  /** With `htmlFor`: clicking the text activates the control (toggles). */
  clickable?: boolean;
  /** Shown before the text, e.g. an icon picker. */
  leading?: ReactNode;
  /** Makes the text a button, e.g. "switch to this vault". */
  onClick?: () => void;
}) {
  const mobile = useIsMobileSettings();
  const text = useTextClasses();
  const body = (
    <>
      <span className={text.name}>{name}</span>
      {description && <span className={text.desc}>{description}</span>}
    </>
  );
  const textClass = "flex min-w-0 flex-1 flex-col text-left";
  const info = onClick ? (
    <button type="button" onClick={onClick} className={cx(textClass, "rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary/40")}>
      {body}
    </button>
  ) : htmlFor ? (
    <label htmlFor={htmlFor} className={cx(textClass, clickable && "cursor-pointer select-none")}>
      {body}
    </label>
  ) : (
    <div className={textClass}>{body}</div>
  );

  if (stacked) {
    return (
      <div className="flex flex-col gap-2.5 px-4 py-3">
        {info}
        {children !== undefined && <div className="w-full">{children}</div>}
      </div>
    );
  }
  return (
    <div className={cx("flex min-h-[52px] items-center px-4 py-3", mobile ? "gap-3" : "gap-4")}>
      {leading}
      {info}
      {children !== undefined && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/** A read-only value on the right (status, paths). Long values truncate. */
export function InfoItem({ name, value, mono }: { name: ReactNode; value: ReactNode; mono?: boolean }) {
  const mobile = useIsMobileSettings();
  const text = useTextClasses();
  return (
    <div className="flex min-h-[52px] items-center gap-4 px-4 py-3">
      <span className={cx(text.name, "shrink-0")}>{name}</span>
      <span
        title={typeof value === "string" ? value : undefined}
        className={cx(
          "min-w-0 flex-1 truncate text-right text-muted-foreground",
          mono ? "font-mono text-xs" : mobile ? "text-[15px]" : "text-[13px]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ── Controls ─────────────────────────────────────────────────────────

export function Toggle({
  id,
  checked,
  onChange,
  disabled,
  label,
}: {
  id?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  /** Accessible name when no <label> points at the toggle. */
  label?: string;
}) {
  const mobile = useIsMobileSettings();
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative shrink-0 rounded-full outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50",
        mobile ? "h-7 w-12" : "h-5 w-9",
        checked ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cx(
          "absolute left-0.5 top-0.5 rounded-full bg-white shadow-sm transition-transform duration-150",
          mobile ? "h-6 w-6" : "h-4 w-4",
          checked && (mobile ? "translate-x-5" : "translate-x-4"),
        )}
      />
    </button>
  );
}

export function ToggleSetting({
  name,
  description,
  checked,
  onChange,
  disabled,
}: {
  name: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <SettingItem name={name} description={description} htmlFor={id} clickable={!disabled}>
      <Toggle id={id} checked={checked} onChange={onChange} disabled={disabled} />
    </SettingItem>
  );
}

export type Option<T extends string | number> = { value: T; label: string };

export function Dropdown<T extends string | number>({
  id,
  value,
  options,
  onChange,
  label,
}: {
  id?: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  label?: string;
}) {
  const mobile = useIsMobileSettings();
  return (
    <span className="relative inline-flex shrink-0">
      <select
        id={id}
        aria-label={label}
        value={String(value)}
        onChange={(e) => {
          const picked = options.find((o) => String(o.value) === e.target.value);
          if (picked) onChange(picked.value);
        }}
        className={cx(
          "cursor-pointer appearance-none border bg-background text-foreground outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/40",
          mobile ? "h-10 rounded-lg border-border/80 pl-3 pr-9 text-[15px]" : "h-8 rounded-md border-border pl-2.5 pr-8 text-[13px]",
        )}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className={cx(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground",
          mobile ? "right-3 h-4 w-4" : "right-2.5 h-3.5 w-3.5",
        )}
      />
    </span>
  );
}

export function DropdownSetting<T extends string | number>({
  name,
  description,
  value,
  options,
  onChange,
}: {
  name: ReactNode;
  description?: ReactNode;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <SettingItem name={name} description={description} htmlFor={id}>
      <Dropdown id={id} value={value} options={options} onChange={onChange} />
    </SettingItem>
  );
}

export function TextInput({
  id,
  value,
  onChange,
  onCommit,
  onEnter,
  placeholder,
  type = "text",
  full,
  technical,
  label,
  autoFocus,
  className,
  onEscape,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Runs on blur and on Enter: persist server-backed values here. */
  onCommit?: () => void;
  /** Replaces the default Enter behavior (blur, i.e. commit). */
  onEnter?: () => void;
  placeholder?: string;
  type?: "text" | "password";
  /** Full width (stacked rows); otherwise a fixed width on desktop. */
  full?: boolean;
  /** URLs, keys, branch names: no autocorrect or capitalization. */
  technical?: boolean;
  label?: string;
  autoFocus?: boolean;
  className?: string;
  /** Escape runs this and blurs the field instead of closing the settings. */
  onEscape?: () => void;
}) {
  const mobile = useIsMobileSettings();
  return (
    <input
      id={id}
      type={type}
      value={value}
      aria-label={label}
      placeholder={placeholder}
      autoFocus={autoFocus}
      autoComplete={type === "password" ? "new-password" : "off"}
      autoCapitalize={technical ? "off" : undefined}
      autoCorrect={technical ? "off" : undefined}
      spellCheck={technical ? false : undefined}
      data-settings-escape={onEscape ? "" : undefined}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Escape" && onEscape) {
          onEscape();
          e.currentTarget.blur();
          return;
        }
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (onEnter) onEnter();
        else e.currentTarget.blur();
      }}
      className={cx(
        "min-w-0 border bg-background text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20",
        mobile ? "h-10 rounded-lg border-border/80 px-3 text-[15px]" : "h-8 rounded-md border-border px-2.5 text-[13px]",
        full || mobile ? "w-full" : "w-60",
        className,
      )}
    />
  );
}

export function TextSetting({
  name,
  description,
  value,
  onChange,
  onCommit,
  placeholder,
  type,
  technical,
}: {
  name: ReactNode;
  description?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  onCommit?: () => void;
  placeholder?: string;
  type?: "text" | "password";
  technical?: boolean;
}) {
  const mobile = useIsMobileSettings();
  const id = useId();
  // A phone is too narrow for a field beside the text: put it below.
  return (
    <SettingItem name={name} description={description} htmlFor={id} stacked={mobile}>
      <TextInput
        id={id}
        value={value}
        onChange={onChange}
        onCommit={onCommit}
        placeholder={placeholder}
        type={type}
        technical={technical}
        full={mobile}
      />
    </SettingItem>
  );
}

export function SliderSetting({
  name,
  description,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  name: ReactNode;
  description?: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const mobile = useIsMobileSettings();
  const id = useId();
  return (
    <SettingItem name={name} description={description} htmlFor={id} stacked={mobile}>
      <span className={cx("flex items-center gap-3", mobile && "w-full")}>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={cx("cursor-pointer accent-[var(--primary)]", mobile ? "min-w-0 flex-1" : "w-40")}
        />
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {format ? format(value) : value}
        </span>
      </span>
    </SettingItem>
  );
}

type ButtonVariant = "default" | "cta" | "danger";

export function Button({
  variant = "default",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const mobile = useIsMobileSettings();
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50",
        mobile ? "h-10 rounded-lg px-4 text-[15px]" : "h-8 rounded-md px-3 text-[13px]",
        variant === "cta" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "default" && "border border-border bg-background text-foreground hover:bg-muted",
        variant === "danger" && "border border-red-500/40 bg-background text-red-600 hover:bg-red-500/10 dark:text-red-400",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  danger,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean }) {
  const mobile = useIsMobileSettings();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cx(
        "inline-flex shrink-0 items-center justify-center text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50",
        mobile ? "h-10 w-10 rounded-lg" : "h-8 w-8 rounded-md",
        danger ? "hover:text-red-500" : "hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── Text helpers ─────────────────────────────────────────────────────

export type Status = { tone: "ok" | "error" | "info"; text: string };

/** Result of an action (test, push…), shown in place of a description. */
export function StatusText({ status }: { status: Status }) {
  return (
    <span
      role={status.tone === "error" ? "alert" : "status"}
      className={cx(
        status.tone === "ok" && "text-green-600 dark:text-green-400",
        status.tone === "error" && "text-red-600 dark:text-red-400",
        status.tone === "info" && "text-muted-foreground",
      )}
    >
      {status.text}
    </span>
  );
}

export function SettingLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

export function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
