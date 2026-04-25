/**
 * @fileoverview Shared utility helpers for apps/web.
 *
 * `cn` merges Tailwind class names, resolving conflicts via tailwind-merge.
 * Imported by every shadcn/ui component and by any component that needs
 * conditional class composition.
 */

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind CSS class names, deduplicating conflicting utilities.
 *
 * @param inputs - Any number of class values (strings, objects, arrays).
 * @returns Merged class string with Tailwind conflicts resolved.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
