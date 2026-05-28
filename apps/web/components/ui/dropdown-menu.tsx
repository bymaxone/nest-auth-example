/**
 * @fileoverview DropdownMenu primitive — Radix DropdownMenu with glass panel.
 *
 * Panel uses the glass surface pattern and brand orange focus ring.
 * Used by the user menu in the app shell topbar.
 */

'use client';

import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight, Circle } from 'lucide-react';

import { cn } from '@/lib/utils';

/*
 * Tailwind class strings are extracted into module-level constants so the
 * Stryker disable directives below land on a single AST node. A directive
 * placed inside a JSX attribute or inside `cn(...)` does not apply because
 * Stryker attributes StringLiteral mutants to the parent JSX expression's
 * start line, several lines above.
 *
 * Every string below is **pure visual styling** (Tailwind tokens + Radix
 * `data-state=...` selectors). The behaviourally-distinguishing tokens
 * (`pl-8` from `inset`, `aria-checked`, `tagName === 'SPAN'`) are pinned by
 * the unit-test suite. Per ADR 0001, mutating these visual strings would
 * only be caught by a styling-snapshot regime which is out of scope.
 */

// Stryker disable StringLiteral
const SUB_TRIGGER_CLASS =
  'focus:bg-(--glass-bg-hover) data-[state=open]:bg-(--glass-bg-hover) flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0';
const CHEVRON_RIGHT_CLASS = 'ml-auto';
const SUB_CONTENT_BASE_CLASSES = [
  // z-300 sits above the dashboard topbar (z-200) so dropdowns whose
  // trigger lives inside the fixed top bar do not get clipped by the
  // bar's stacking context. See `components/layout/topbar.tsx`.
  'border-(--glass-border) bg-(--color-bg-primary) z-300 min-w-32 overflow-hidden rounded-xl border p-1 shadow-lg backdrop-blur-md',
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
  'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
  'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
  'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
] as const;
const CONTENT_BASE_CLASSES = [
  // z-300 sits above the dashboard topbar (z-200) so dropdowns anchored
  // inside the topbar (TenantSwitcher, sign-out, user menu) are not
  // clipped by the topbar's stacking context. See
  // `components/layout/topbar.tsx`.
  'border-(--glass-border) bg-(--color-bg-primary) z-300 min-w-32 overflow-hidden rounded-xl border p-1 shadow-md backdrop-blur-md',
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
  'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
  'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
  'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
] as const;
const ITEM_BASE_CLASSES = [
  'relative flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none transition-colors',
  'focus:bg-(--glass-bg-hover) focus:text-foreground',
  'data-disabled:pointer-events-none data-disabled:opacity-50',
  '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
] as const;
const CHECKBOX_ITEM_CLASS =
  'focus:bg-(--glass-bg-hover) relative flex cursor-default select-none items-center rounded-lg py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
const RADIO_ITEM_CLASS =
  'focus:bg-(--glass-bg-hover) relative flex cursor-default select-none items-center rounded-lg py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
const LABEL_BASE_CLASS = 'px-2 py-1.5 text-xs font-semibold text-muted-foreground';
const SEPARATOR_CLASS = 'bg-(--glass-border) -mx-1 my-1 h-px';
const SHORTCUT_CLASS = 'ml-auto text-xs tracking-widest opacity-60';
// Stryker restore StringLiteral

/** Inset padding class — extracted so its StringLiteral mutant lives OUTSIDE
 * the disable block. The truthy-arm test asserts `pl-8` is on the rendered
 * element when `inset` is set; mutating the literal to `""` makes the
 * assertion fail. */
const INSET_CLASS = 'pl-8';

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
const DropdownMenuSub = DropdownMenuPrimitive.Sub;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuSubTrigger = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(SUB_TRIGGER_CLASS, inset && INSET_CLASS, className)}
    {...props}
  >
    {children}
    <ChevronRight className={CHEVRON_RIGHT_CLASS} />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownMenuSubContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(...SUB_CONTENT_BASE_CLASSES, className)}
    {...props}
  />
));
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName;

/**
 * Glass dropdown panel.
 */
const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(...CONTENT_BASE_CLASSES, className)}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(...ITEM_BASE_CLASSES, inset && INSET_CLASS, className)}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked = false, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(CHECKBOX_ITEM_CLASS, className)}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4 text-brand-500" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName;

const DropdownMenuRadioItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem ref={ref} className={cn(RADIO_ITEM_CLASS, className)} {...props}>
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-brand-500 text-brand-500" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

const DropdownMenuLabel = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(LABEL_BASE_CLASS, inset && INSET_CLASS, className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn(SEPARATOR_CLASS, className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return <span className={cn(SHORTCUT_CLASS, className)} {...props} />;
};
DropdownMenuShortcut.displayName = 'DropdownMenuShortcut';

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
};
