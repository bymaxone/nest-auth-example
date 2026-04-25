/**
 * @fileoverview Sonner toast wrapper — dark theme matching design system.
 *
 * The Toaster is placed in the root layout. Individual toasts are triggered
 * via `toast()` from the `sonner` package.
 */

'use client';

import { Toaster as SonnerToaster } from 'sonner';

type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

/**
 * App-wide toast container styled for the dark design system.
 *
 * Place this once inside RootLayout, after the main content.
 */
function Toaster({ ...props }: ToasterProps) {
  return (
    <SonnerToaster
      theme="dark"
      position="bottom-right"
      toastOptions={{
        style: {
          background: 'var(--glass-card-bg)',
          border: '1px solid var(--glass-border)',
          backdropFilter: 'blur(16px)',
          color: 'var(--color-text-primary)',
          fontFamily: 'var(--font-mono)',
          borderRadius: '12px',
        },
        classNames: {
          success: 'border-l-4 border-l-green-500',
          error: 'border-l-4 border-l-red-500',
          info: 'border-l-4 border-l-blue-400',
          warning: 'border-l-4 border-l-amber-500',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
