/**
 * @fileoverview Label primitive — shadcn/ui new-york style.
 *
 * Pairs with form fields. Inherits brand typography and muted foreground color.
 */

'use client';

import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const labelVariants = cva(
  // `block` is load-bearing, not cosmetic. A <label> is inline by default, so in
  // a `space-y-*` group (which spaces siblings with margin-top) it does not
  // start a new line and the vertical spacing silently does nothing — the label
  // ends up beside its control instead of above it. Flex-column groups blockify
  // their children and hid this, which is why only some screens looked wrong.
  'block text-sm leading-snug font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
);

/**
 * Accessible label linked to a form control via `htmlFor`.
 */
const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props} />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
