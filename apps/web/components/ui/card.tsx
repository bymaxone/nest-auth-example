/**
 * @fileoverview Card primitive — the shared Bymax glassmorphism card.
 *
 * Values match the glass card the sibling dashboards use:
 *   rounded-[24px], border rgba(255,255,255,0.1), bg rgba(255,255,255,0.06),
 *   backdrop-blur-lg, and a brand-orange top accent hairline.
 *
 * The radius is written as an explicit length rather than `rounded-2xl` or
 * `rounded-xl`: the design system redefines Tailwind's `--radius-*` scale in
 * `globals.css`, so those utilities no longer mean what their names suggest.
 *
 * The accent hairline belongs to the card, not to its header, so every card
 * carries it whether or not it has a header. The title is a muted uppercase
 * monospace section label; a card whose title is real content overrides the
 * case and size at its own call site via {@link CARD_TITLE_CONTENT_CLASS}.
 *
 * See docs/DESIGN_SYSTEM.md §6 in nest-config-example for the full contract.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The brand-orange hairline drawn across the top edge of every card.
 *
 * Exported so a surface that must render as a different element than `Card`'s
 * `div` — a landmark `<section aria-labelledby>`, say — can reproduce the card
 * exactly without the recipe being written out a second time.
 */
export const CARD_ACCENT_LINE_CLASS =
  'bg-linear-to-r pointer-events-none absolute inset-x-0 top-0 h-px from-transparent via-[rgba(255,98,36,0.4)] to-transparent';

/** The glass surface itself. Exported for the same reason as the hairline. */
export const CARD_SURFACE_CLASS =
  'relative overflow-hidden rounded-[24px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.06)] text-card-foreground backdrop-blur-lg';

/**
 * Glassmorphism card container with the brand top accent line.
 */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={cn(CARD_SURFACE_CLASS, className)} {...props}>
      <span aria-hidden="true" className={CARD_ACCENT_LINE_CLASS} />
      {children}
    </div>
  ),
);
Card.displayName = 'Card';

/**
 * Card header region — contains title and description.
 */
const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6 pb-4', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

/**
 * Card title — muted uppercase monospace section label.
 */
const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'font-mono text-sm font-semibold tracking-widest text-[rgba(255,255,255,0.4)] uppercase',
        className,
      )}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

/**
 * The override a card whose title is real content applies, restoring a
 * readable display heading in place of the muted section label.
 */
const CARD_TITLE_CONTENT_CLASS = 'normal-case tracking-tight text-[rgba(255,255,255,0.9)]';

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

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
  CARD_TITLE_CONTENT_CLASS,
};
