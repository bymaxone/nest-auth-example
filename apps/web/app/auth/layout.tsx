/**
 * @fileoverview Auth route-group layout — dark background + ambient glows + glassmorphism card.
 *
 * Provides the complete visual shell for every page under `app/(auth)/*`:
 *   - Dark #0a0a0a background with three ambient glow layers (mirrors ai-product-assistant AuthLayout)
 *   - Centered glassmorphism card (rgba(255,255,255,0.06), backdrop-blur-lg, rounded-[24px])
 *   - Top accent gradient line (transparent → rgba(255,98,36,0.4) → transparent)
 *   - Brand section: orange icon badge + "nest-auth-example" gradient headline
 *   - Page content rendered below the brand in the card body
 *
 * Individual auth pages only need to supply their sub-heading, form fields,
 * and footer links — the card shell and brand header are shared.
 *
 * This is a pure server component — no client code.
 *
 * @layer layouts
 */

import type { ReactNode } from 'react';

interface AuthLayoutProps {
  /** Auth page content (sub-heading + form + footer links). */
  children: ReactNode;
}

/**
 * Full-screen dark layout that centers a glassmorphism card with the brand
 * header above the page-specific content.
 *
 * @param children - Auth page content rendered inside the card body.
 */
export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0a0a0a]">
      {/* ── Ambient glow layers (no interaction, purely decorative) ───────── */}
      {/* Layer A: orange — top-left */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 -top-32 h-[500px] w-[500px] rounded-full bg-[#ff6224] opacity-15 blur-[120px]"
      />
      {/* Layer B: blue — top-right */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-20 h-[400px] w-[400px] rounded-full bg-[#60a5fa] opacity-10 blur-[100px]"
      />
      {/* Layer C: accent orange — bottom-center */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-1/2 h-[300px] w-[300px] -translate-x-1/2 rounded-full bg-[#f97316] opacity-[0.05] blur-[80px]"
      />

      {/* ── Centered card ────────────────────────────────────────────────── */}
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
        <div className="w-full max-w-[420px]">
          {/* Glass card */}
          <div className="relative overflow-hidden rounded-[24px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.06)] backdrop-blur-lg">
            {/* Top accent gradient line */}
            <div
              aria-hidden="true"
              className="bg-linear-to-r absolute left-0 right-0 top-0 h-px from-transparent via-[rgba(255,98,36,0.4)] to-transparent"
            />

            {/* ── Brand header ── */}
            <div className="flex flex-col items-center gap-1 px-8 pb-4 pt-8">
              {/* Orange icon badge */}
              <div
                aria-hidden="true"
                className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl border border-[rgba(255,98,36,0.3)] bg-[rgba(255,98,36,0.2)]"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 2L2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5"
                    stroke="#ff6224"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              {/* Brand name — orange-to-amber gradient, monospace */}
              <p className="bg-linear-to-r from-[#ff6224] to-amber-200 bg-clip-text font-mono text-xl font-bold text-transparent">
                nest-auth-example
              </p>
            </div>

            {/* ── Page content ── */}
            <div className="px-8 pb-8">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
