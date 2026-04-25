/**
 * @fileoverview Reusable semantic table primitives styled for the dark design system.
 *
 * Components: `Table`, `TableHeader`, `TableBody`, `TableFooter`,
 * `TableHead`, `TableRow`, `TableCell`, `TableCaption`.
 *
 * All primitives are thin wrappers around the native HTML table elements with
 * Tailwind utility classes applied. They accept `className` overrides via `cn()`
 * so callers can adjust spacing or colours as needed.
 *
 * @layer components/ui
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Outer scroll wrapper + `<table>` element.
 *
 * @param className - Additional classes merged onto the `<table>`.
 */
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  ),
);
Table.displayName = 'Table';

/**
 * `<thead>` wrapper with a bottom border.
 *
 * @param className - Additional classes merged onto the `<thead>`.
 */
const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn('[&_tr]:border-b [&_tr]:border-[rgba(255,255,255,0.06)]', className)}
    {...props}
  />
));
TableHeader.displayName = 'TableHeader';

/**
 * `<tbody>` wrapper — applies alternating row highlighting via CSS.
 *
 * @param className - Additional classes merged onto the `<tbody>`.
 */
const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

/**
 * `<tfoot>` element.
 *
 * @param className - Additional classes merged onto the `<tfoot>`.
 */
const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      'border-t border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] font-medium [&>tr]:last:border-b-0',
      className,
    )}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

/**
 * `<tr>` element with hover highlight and border-bottom.
 *
 * @param className - Additional classes merged onto the `<tr>`.
 */
const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b border-[rgba(255,255,255,0.06)] transition-colors hover:bg-[rgba(255,255,255,0.02)] data-[state=selected]:bg-[rgba(255,98,36,0.05)]',
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

/**
 * `<th>` header cell with muted uppercase label styling.
 *
 * @param className - Additional classes merged onto the `<th>`.
 */
const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-10 px-4 text-left align-middle text-xs font-medium uppercase tracking-wider text-[rgba(255,255,255,0.4)] [&:has([role=checkbox])]:pr-0',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

/**
 * `<td>` data cell.
 *
 * @param className - Additional classes merged onto the `<td>`.
 */
const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'px-4 py-3 align-middle text-sm text-[rgba(255,255,255,0.7)] [&:has([role=checkbox])]:pr-0',
      className,
    )}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

/**
 * `<caption>` element rendered below the table.
 *
 * @param className - Additional classes merged onto the `<caption>`.
 */
const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn('mt-4 text-xs text-[rgba(255,255,255,0.35)]', className)}
    {...props}
  />
));
TableCaption.displayName = 'TableCaption';

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
