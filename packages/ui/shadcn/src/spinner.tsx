import type { HTMLAttributes } from "react";

import { cn } from "./utils";

/**
 * Spinner — a CSS-only in-flight indicator. Rendered inside the /inbox
 * "Sync now" Button while a Run is in progress. `currentColor` borders
 * let it inherit the surrounding text colour; `role="status"` keeps it
 * announced to assistive tech.
 */
export const Spinner = ({ className, ...props }: HTMLAttributes<HTMLSpanElement>) => (
  <span
    role="status"
    aria-label="Loading"
    className={cn(
      "inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent",
      className,
    )}
    {...props}
  />
);
