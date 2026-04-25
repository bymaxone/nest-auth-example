/**
 * @fileoverview Platform admin login page.
 *
 * Standalone login page that is visually distinct from the tenant dashboard login.
 * The page renders inside a red-tinted card rather than the orange-branded auth
 * layout — operators must instantly recognise they are in the platform admin area.
 *
 * This page is intentionally NOT gated server-side against an active tenant session.
 * Platform auth and tenant auth are completely separate contexts: a tenant-authenticated
 * user who navigates to this URL will see the form, not an automatic redirect.
 *
 * FCM row #22 — Platform admin context (`controllers.platform: true`).
 *
 * @layer pages/platform
 */

import { PlatformLoginForm } from '@/components/platform/platform-login-form';

/**
 * Platform admin login page — server component shell that renders the client form.
 *
 * No server-side auth check is applied here: the platform and tenant cookie
 * contexts are separate, so a tenant-authenticated user still sees the form.
 */
export default function PlatformLoginPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0d0505]">
      {/* ── Ambient glow — deep red tint ── */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 -top-32 h-[500px] w-[500px] rounded-full bg-red-900 opacity-20 blur-[120px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-20 h-[400px] w-[400px] rounded-full bg-red-800 opacity-10 blur-[100px]"
      />

      {/* ── Centered card ── */}
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
        <div className="w-full max-w-[420px]">
          {/* Red-tinted glass card */}
          <div className="relative overflow-hidden rounded-[24px] border border-[rgba(239,68,68,0.2)] bg-[rgba(30,0,0,0.6)] backdrop-blur-lg">
            {/* Top accent gradient line — red */}
            <div
              aria-hidden="true"
              className="bg-linear-to-r absolute left-0 right-0 top-0 h-px from-transparent via-[rgba(239,68,68,0.6)] to-transparent"
            />

            {/* ── Brand header — platform admin identity ── */}
            <div className="flex flex-col items-center gap-1 px-8 pb-4 pt-8">
              {/* Red icon badge */}
              <div
                aria-hidden="true"
                className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.15)]"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 2L2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5"
                    stroke="#ef4444"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              {/* PLATFORM ADMIN label */}
              <p className="font-mono text-xs font-bold uppercase tracking-widest text-red-400">
                PLATFORM ADMIN
              </p>
              <p className="bg-linear-to-r from-red-300 to-red-100 bg-clip-text font-mono text-xl font-bold text-transparent">
                nest-auth-example
              </p>
            </div>

            {/* ── Page content ── */}
            <div className="px-8 pb-8">
              <PlatformLoginForm />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
