import type { ButtonHTMLAttributes } from "react";

import { cn } from "./utils";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: "default" | "outline";
};

/**
 * Button — the /inbox "Sync now" trigger and any future action control.
 *
 * Hand-rolled in shadcn's component shape (see badge.tsx) so a later
 * shadcn CLI invocation can replace it without touching the import
 * surface. `type` defaults to "button" so a Button inside a form never
 * submits it by accident.
 */
export const Button = ({
  variant = "default",
  className,
  type = "button",
  ...props
}: ButtonProps) => (
  <button
    type={type}
    className={cn(
      "inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400",
      "disabled:pointer-events-none disabled:opacity-50",
      variant === "default" && "bg-neutral-900 text-neutral-50 hover:bg-neutral-700",
      variant === "outline" &&
        "border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50",
      className,
    )}
    {...props}
  />
);
