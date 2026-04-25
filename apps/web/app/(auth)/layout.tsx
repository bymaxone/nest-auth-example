/**
 * @fileoverview Auth route group layout — dark background + ambient glow layers.
 *
 * Applies the dark/orange design system (mirroring the landing page aesthetic)
 * to every page under `app/(auth)/*`: login, register, forgot-password, etc.
 *
 * The three ambient glow layers (orange top-left, blue top-right, orange bottom)
 * match `ai-product-assistant`'s `AuthLayout` component — no animated canvas or
 * particle network; auth pages are intentionally static for performance.
 *
 * This is a server component — no client-side JS required for the layout shell.
 *
 * @layer layouts
 */

import type { ReactNode } from 'react';

interface AuthLayoutProps {
  /** Auth page content (login form, register form, etc.). */
  children: ReactNode;
}

/**
 * Full-screen dark layout for all authentication pages.
 *
 * @param children - The auth page content to centre on screen.
 */
export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0a0a0a]">
      {/* ── Ambient glow layers ─────────────────────────────────────────── */}
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

      {/* ── Centered page content ─────────────────────────────────────── */}
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
        {children}
      </div>
    </div>
  );
}
