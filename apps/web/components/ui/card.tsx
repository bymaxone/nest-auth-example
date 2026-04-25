/**
 * @fileoverview Card primitive — glassmorphism style matching design system.
 *
 * All card sub-components use the glass surface pattern:
 *   bg: var(--glass-card-bg), border: var(--glass-border), backdrop-blur
 *
 * An optional top accent gradient line (brand orange) can be added via the
 * `accent` prop on CardHeader.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Glassmorphism card container.
 */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'border-(--glass-border) bg-(--glass-card-bg) relative overflow-hidden rounded-2xl border text-card-foreground shadow-sm backdrop-blur-md',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

/**
 * Card header region — contains title and description.
 */
const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    /** When true, renders a brand orange top accent line. */
    accent?: boolean;
  }
>(({ className, accent = false, children, ...props }, ref) => (
  <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props}>
    {accent && (
      <span
        aria-hidden="true"
        className="bg-linear-to-r absolute inset-x-0 top-0 h-px from-transparent via-[rgba(255,98,36,0.4)] to-transparent"
      />
    )}
    {children}
  </div>
));
CardHeader.displayName = 'CardHeader';

/**
 * Card title — monospace font, bold.
 */
const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('font-mono text-xl font-bold leading-none tracking-tight', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

/**
 * Card description — muted secondary text.
 */
const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

/**
 * Card content region.
 */
const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

/**
 * Card footer region — typically holds actions.
 */
const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
