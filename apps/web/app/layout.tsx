/**
 * @fileoverview Root layout — HTML shell, font loading, and the global toaster.
 *
 * Uses Geist Sans + Geist Mono from `next/font/google`. The font CSS variables
 * are injected into `<body>` and consumed by globals.css.
 *
 * The auth boundary is deliberately NOT mounted here. `<Providers>`
 * (`app/providers.tsx`) probes the session as soon as it mounts, so wrapping
 * every route in it made the public landing page issue an identity request and
 * a token refresh that can only ever be refused. It is mounted by the two
 * layouts whose routes actually need a session — `app/auth/layout.tsx` and
 * `app/dashboard/layout.tsx`; a new authenticated segment has to mount it too.
 *
 * `<Toaster>` stays here, because every area toasts and it needs no session.
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
      // `globals.css` sets `scroll-behavior: smooth` on <html>. Next needs this
      // attribute to know the smoothing is deliberate, so it can suppress it for
      // route transitions (which would otherwise animate the scroll reset) and
      // stop warning about it in development.
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body>
        {/* The auth provider is mounted by the /auth and /dashboard layouts
            rather than here. It probes the session on mount, and doing that
            app-wide made the public landing page fire an identity request and a
            token refresh that can only ever be refused — three console errors
            on a page with no protected content. The toaster stays app-wide
            because every area toasts. */}
        {children}
        <Toaster />
      </body>
    </html>
  );
}
