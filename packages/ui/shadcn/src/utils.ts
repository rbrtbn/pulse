import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn's canonical class-name merger: combines clsx's conditional handling
 * with tailwind-merge's de-duplication of conflicting Tailwind utilities.
 * Every shadcn primitive uses this; future-installed components will too.
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
