/**
 * @fileoverview Alert/confirmation dialog primitives for destructive actions.
 *
 * Built on the existing `Dialog` component (which uses `@radix-ui/react-dialog`)
 * so no additional Radix UI dependency is required. Provides the familiar
 * `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`,
 * `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`,
 * `AlertDialogAction`, and `AlertDialogCancel` surface matching the shadcn/ui
 * `alert-dialog` API.
 *
 * Usage:
 * ```tsx
 * <AlertDialog>
 *   <AlertDialogTrigger asChild><Button variant="destructive">Delete</Button></AlertDialogTrigger>
 *   <AlertDialogContent>
 *     <AlertDialogHeader>
 *       <AlertDialogTitle>Are you sure?</AlertDialogTitle>
 *       <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
 *     </AlertDialogHeader>
 *     <AlertDialogFooter>
 *       <AlertDialogCancel>Cancel</AlertDialogCancel>
 *       <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
 *     </AlertDialogFooter>
 *   </AlertDialogContent>
 * </AlertDialog>
 * ```
 *
 * @layer components/ui
 */

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Root alert dialog — delegates to `Dialog` for open/close state management. */
const AlertDialog = Dialog;

/** Trigger slot — same as `DialogTrigger`. */
export { DialogTrigger as AlertDialogTrigger } from '@/components/ui/dialog';

/**
 * Alert dialog overlay + panel. Inherits the `DialogContent` style with an
 * additional `role="alertdialog"` attribute for accessibility.
 *
 * @param className - Additional classes merged onto the panel.
 */
const AlertDialogContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DialogContent>
>(({ className, children, ...props }, ref) => (
  <DialogContent
    ref={ref}
    role="alertdialog"
    className={cn('sm:max-w-[425px]', className)}
    {...props}
  >
    {children}
  </DialogContent>
));
AlertDialogContent.displayName = 'AlertDialogContent';

/** Header wrapper — same as `DialogHeader`. */
const AlertDialogHeader = DialogHeader;

/** Title element — same as `DialogTitle`. */
const AlertDialogTitle = DialogTitle;

/** Description element — same as `DialogDescription`. */
const AlertDialogDescription = DialogDescription;

/** Footer wrapper — same as `DialogFooter`. */
const AlertDialogFooter = DialogFooter;

/**
 * Confirmation button (primary, potentially destructive).
 *
 * Renders as a `variant="destructive"` button by default. Pass `variant`
 * to override when a non-destructive confirmation is needed.
 *
 * @param variant - shadcn/ui button variant. Defaults to `'destructive'`.
 */
const AlertDialogAction = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof Button>
>(({ variant = 'destructive', className, ...props }, ref) => (
  <Button ref={ref} variant={variant} className={cn(className)} {...props} />
));
AlertDialogAction.displayName = 'AlertDialogAction';

/**
 * Cancel button (secondary / outline).
 *
 * @param className - Additional classes merged onto the button.
 */
const AlertDialogCancel = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof Button>
>(({ className, ...props }, ref) => (
  <Button ref={ref} variant="outline" className={cn(className)} {...props} />
));
AlertDialogCancel.displayName = 'AlertDialogCancel';

export {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
