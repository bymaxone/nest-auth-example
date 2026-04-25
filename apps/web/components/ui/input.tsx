/**
 * @fileoverview Input primitive — shadcn/ui new-york style with brand theme.
 *
 * Pill-shaped (rounded-full), 48px height, glass surface background.
 * Focus ring uses brand orange (--ring).
 * Invalid state adds a red-tinted border.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Text input field with brand design system styling.
 *
 * @param className - Additional Tailwind classes.
 * @param type - Input type attribute.
 */
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'border-(--glass-border) bg-(--glass-bg) flex h-12 w-full rounded-full border px-5 py-2 text-sm text-foreground ring-offset-background',
          'placeholder:text-muted-foreground',
          'transition-shadow duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/30',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
