/**
 * @fileoverview Button primitive — shadcn/ui new-york style with brand theme.
 *
 * Variants:
 *   default   — brand orange gradient, pill hover glow
 *   destructive — red semantic action
 *   outline   — transparent with border
 *   secondary — muted surface
 *   ghost     — no background, low-emphasis
 *   link      — underline text action
 *
 * Sizes: default | sm | lg | icon
 */

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-sm hover:scale-[1.02] hover:shadow-(--shadow-primary) active:scale-[0.98]',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline:
          'border border-(--glass-border) bg-(--glass-bg) text-foreground hover:bg-(--glass-bg-hover) hover:text-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
        ghost: 'hover:bg-(--glass-bg) hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-6 py-2',
        sm: 'h-8 rounded-full px-4 text-xs',
        lg: 'h-12 rounded-full px-8 text-base',
        icon: 'h-10 w-10 rounded-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Renders the button as a child element (useful for Next.js Link). */
  asChild?: boolean;
}

/**
 * Brand-styled button with pill shape and orange gradient default.
 *
 * @param asChild - When true, renders as the child element via Radix Slot.
 * @param variant - Visual style variant.
 * @param size - Size variant.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
