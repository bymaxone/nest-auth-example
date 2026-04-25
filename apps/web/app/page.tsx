/**
 * @fileoverview Landing page — public entry point of nest-auth-example.
 *
 * Visual identity mirrors the ai-product-assistant design system:
 *   - Dark background (#0a0a0a) with three ambient glow layers
 *   - Orange brand (#ff6224) gradient headline
 *   - Glassmorphism feature cards with top accent lines
 *   - Pill-shaped CTA buttons (primary: gradient, secondary: glass)
 *   - Monospace typography for headings
 *
 * This is a pure server component — no client-side JS required for the
 * landing surface. Auth logic starts at Phase 12.
 */

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/** Feature cards rendered in the features grid. */
const FEATURES = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2" stroke="#ff6224" strokeWidth="1.5" />
        <path
          d="M7 11V7a5 5 0 0 1 10 0v4"
          stroke="#ff6224"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
    badge: 'Core',
    title: 'JWT Refresh Rotation',
    description:
      'Short-lived access tokens + long-lived refresh tokens with automatic silent rotation. Revocation via Redis on logout or breach detection.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 2l2.5 7.5H22l-6.5 4.5 2.5 7.5L12 17l-6 4.5 2.5-7.5L3 9.5h7.5L12 2z"
          stroke="#ff6224"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    badge: 'Security',
    title: 'MFA / TOTP',
    description:
      'RFC 6238 TOTP via QR code enrollment, 8 single-use recovery codes, and brute-force protection with configurable attempt limits.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="#ff6224" strokeWidth="1.5" />
        <path
          d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"
          stroke="#ff6224"
          strokeWidth="1.5"
        />
      </svg>
    ),
    badge: 'OAuth',
    title: 'Google OAuth',
    description:
      'OAuth 2.0 authorization code flow with PKCE. Account linking — merge social identity into an existing credential account.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
          stroke="#ff6224"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="9" cy="7" r="4" stroke="#ff6224" strokeWidth="1.5" />
        <path
          d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
          stroke="#ff6224"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
    badge: 'Multi-tenant',
    title: 'Multi-Tenancy',
    description:
      'Tenant isolation enforced at every query layer. X-Tenant-Id header as the single entry point. Invitation flow with role assignment.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 2L2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5"
          stroke="#ff6224"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    badge: 'Platform',
    title: 'Platform Admin',
    description:
      'Cross-tenant super-admin context with dedicated guards, decorators, and endpoints — completely isolated from tenant-scoped routes.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.42 2 2 0 0 1 3.6 1.25h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.9a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16.92z"
          stroke="#ff6224"
          strokeWidth="1.5"
        />
      </svg>
    ),
    badge: 'Real-time',
    title: 'WebSocket Auth',
    description:
      'Socket.IO gateway with JWT-authenticated handshake, per-event authorization guards, and Redis-based token revocation checks.',
  },
];

/**
 * Landing page — server component, no auth logic.
 *
 * Renders hero + features + CTA with the design system aesthetic.
 */
export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0a0a0a] text-white">
      {/* ── Ambient glow layers — fixed, no interaction ── */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -left-32 -top-32 h-[500px] w-[500px] animate-glow-float rounded-full bg-[#ff6224] opacity-[0.07] blur-[140px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -right-20 -top-20 h-[400px] w-[400px] animate-glow-drift rounded-full bg-[#60a5fa] opacity-[0.06] blur-[100px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -bottom-16 left-1/2 h-[350px] w-[350px] -translate-x-1/2 rounded-full bg-[#f97316] opacity-[0.04] blur-[120px]"
      />

      <main className="relative z-10">
        {/* ── Hero ── */}
        <section className="flex min-h-screen flex-col items-center justify-center px-4 py-24 text-center">
          <div className="flex max-w-3xl flex-col items-center gap-6">
            {/* Brand icon */}
            <div
              className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgba(255,98,36,0.3)] bg-[rgba(255,98,36,0.15)]"
              aria-hidden="true"
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2L2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5"
                  stroke="#ff6224"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            {/* Headline */}
            <h1 className="animate-fade-in bg-gradient-to-r from-[#ff6224] to-amber-200 bg-clip-text font-mono text-4xl font-bold leading-tight tracking-tight text-transparent md:text-5xl lg:text-6xl">
              nest-auth-example
            </h1>

            {/* Value proposition */}
            <p className="max-w-xl font-sans text-base leading-relaxed text-[rgba(255,255,255,0.7)] md:text-lg">
              A production-ready reference application demonstrating every feature of{' '}
              <span className="font-mono text-[#ff6224]">@bymax-one/nest-auth</span> — end-to-end,
              from the NestJS backend to this Next.js frontend.
            </p>

            {/* CTA buttons */}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/auth/login">Get started</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a
                  href="https://github.com/bymaxone/nest-auth"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View library
                </a>
              </Button>
            </div>
          </div>

          {/* Scroll hint */}
          <div className="absolute bottom-8 flex flex-col items-center gap-1.5 text-xs uppercase tracking-widest text-[rgba(255,255,255,0.4)]">
            <span>scroll</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 3v10M3 8l5 5 5-5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </section>

        {/* ── Features grid ── */}
        <section id="features" className="px-4 py-24">
          <div className="mx-auto max-w-6xl">
            <div className="mb-14 text-center">
              <h2 className="mb-3 font-mono text-3xl font-bold text-white">Feature coverage</h2>
              <p className="font-sans text-[rgba(255,255,255,0.6)]">
                Every FCM row from the spec, wired end-to-end.
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <Card
                  key={feature.title}
                  className="group transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_0_32px_rgba(255,98,36,0.12)]"
                >
                  <CardHeader accent>
                    <div className="mb-3 flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(255,98,36,0.3)] bg-[rgba(255,98,36,0.12)]">
                        {feature.icon}
                      </div>
                      <Badge variant="outline" className="text-[rgba(255,255,255,0.5)]">
                        {feature.badge}
                      </Badge>
                    </div>
                    <CardTitle className="text-base">{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="leading-relaxed text-[rgba(255,255,255,0.55)]">
                      {feature.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="px-4 py-24 text-center">
          <div className="mx-auto max-w-xl">
            <h2 className="mb-4 font-mono text-3xl font-bold text-white">Ready to explore?</h2>
            <p className="mb-8 font-sans text-[rgba(255,255,255,0.6)]">
              Create an account, enable MFA, invite a team member, and watch JWT rotation happen in
              real time.
            </p>
            <Button asChild size="lg">
              <Link href="/auth/login">Open the app</Link>
            </Button>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="border-t border-[rgba(255,255,255,0.06)] px-4 py-8 text-center font-mono text-xs text-[rgba(255,255,255,0.3)]">
          <p>
            nest-auth-example — reference implementation for{' '}
            <a
              href="https://github.com/bymaxone/nest-auth"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#ff6224] hover:underline"
            >
              @bymax-one/nest-auth
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
