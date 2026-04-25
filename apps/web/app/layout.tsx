/**
 * @fileoverview Root layout — HTML shell, font loading, and global providers.
 *
 * Uses Geist Sans + Geist Mono from `next/font/google`. The font CSS variables
 * are injected into `<body>` and consumed by globals.css.
 *
 * Phase 12 will wrap `{children}` with `<AuthProvider>` — keep this shell
 * minimal and decomposition-friendly until then.
 */

import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';

import './globals.css';
import { Toaster } from '@/components/ui/sonner';

/** @see https://nextjs.org/docs/app/building-your-application/optimizing/metadata */
export const metadata: Metadata = {
  title: 'nest-auth-example',
  description:
    'Reference application demonstrating every feature of @bymax-one/nest-auth: JWT refresh rotation, MFA, OAuth, multi-tenancy, platform admin, invitations, sessions, and WebSocket auth.',
};

interface RootLayoutProps {
  children: React.ReactNode;
}

/**
 * Root server component wrapping every page.
 *
 * @param children - Page or nested layout content.
 */
export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} dark`}
      suppressHydrationWarning
    >
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
