import clsx from "clsx";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { Check, Minus } from "lucide-react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
}

export function Button({ variant = "secondary", size = "md", icon, className, children, ...props }: ButtonProps) {
  return (
    <button className={clsx("button", `button--${variant}`, `button--${size}`, className)} {...props}>
      {icon ? <span className="button__icon">{icon}</span> : null}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
}

export function IconButton({ label, active, className, children, ...props }: IconButtonProps) {
  return (
    <button aria-label={label} title={label} className={clsx("icon-button", active && "is-active", className)} {...props}>
      {children}
    </button>
  );
}

export function CheckBox({ checked, mixed = false, label, onChange }: { checked: boolean; mixed?: boolean; label: string; onChange: () => void }) {
  return (
    <button type="button" className={clsx("check-box", checked && "is-checked")} aria-label={label} aria-pressed={checked} onClick={onChange}>
      {mixed ? <Minus size={13} strokeWidth={2.4} /> : checked ? <Check size={13} strokeWidth={2.4} /> : null}
    </button>
  );
}

export function StatusDot({ tone = "muted" }: { tone?: "success" | "danger" | "warning" | "local" | "accent" | "muted" }) {
  return <span className={clsx("status-dot", `status-dot--${tone}`)} aria-hidden="true" />;
}

export function ProgressBar({ value, tone = "accent" }: { value: number; tone?: "accent" | "success" | "danger" | "local" }) {
  return (
    <span className="progress" aria-label={`${value}%`}>
      <span className={clsx("progress__value", `progress__value--${tone}`)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </span>
  );
}

export function SectionTitle({ children, className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={clsx("section-title", className)} {...props}>{children}</h2>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button type="button" className={clsx("toggle", checked && "is-on")} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}>
      <span className="toggle__thumb" />
    </button>
  );
}

