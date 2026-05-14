import type { HTMLAttributes } from "react";

import { cn } from "./utils";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  readonly variant?: "default" | "secondary" | "outline";
};

/**
 * Badge — the inline pill rendered alongside thread metadata on /inbox
 * (message count, "+N others" sender suffix, etc).
 *
 * Hand-rolled in shadcn's component shape so future shadcn CLI invocations
 * can replace or extend it without touching the import surface. `cn()` from
 * ./utils is the same merger every shadcn component uses.
 */
export const Badge = ({ variant = "default", className, ...props }: BadgeProps) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
      variant === "default" && "border-transparent bg-neutral-900 text-neutral-50",
      variant === "secondary" && "border-transparent bg-neutral-100 text-neutral-700",
      variant === "outline" && "border-neutral-200 text-neutral-700",
      className,
    )}
    {...props}
  />
);
