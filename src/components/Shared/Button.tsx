/**
 * src/components/Shared/Button.tsx — shared button
 *
 * Description:
 *   Accessible button with variants (primary, secondary, danger) and a
 *   loading state.
 *
 * Layer: components/ (Shared)
 *
 * Tasks:
 *   1. Typed props extending native button attributes; variant; isLoading.
 *   2. type="button" by default; disabled + aria-busy while loading.
 *
 * Dependencies:
 *   External: react.
 *   Internal: ./LoadingSpinner.tsx, ./Button.module.css.
 *   Used by: pages and other shared components.
 *
 * Status: implemented (T39).
 */

import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";
import { LoadingSpinner } from "./LoadingSpinner";

export type ButtonVariant = "primary" | "secondary" | "danger";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  isLoading?: boolean;
};

/** Accessible button; type="button" by default; disabled and aria-busy while loading. */
export function Button({
  variant = "primary",
  isLoading = false,
  type = "button",
  disabled,
  className,
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={[styles.button, styles[variant], className].filter(Boolean).join(" ")}
    >
      {isLoading && <LoadingSpinner size="small" decorative />}
      <span>{children}</span>
    </button>
  );
}
