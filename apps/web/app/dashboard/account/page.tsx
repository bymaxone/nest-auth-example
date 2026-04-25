/**
 * @fileoverview Account settings page — identity summary, password change, and
 * (dev-only) WebSocket notification demo button.
 *
 * Server component: `requireAuth()` reads the verified JWT without a network
 * round-trip and provides `userId`, `role`, and `tenantId` for the identity card.
 *
 * The `PasswordChangeForm` and `SendTestNotificationButton` are Client Components
 * rendered inside the page. The notification button is conditionally visible: it
 * is hidden in production builds by `SendTestNotificationButton` itself.
 *
 * @layer pages/dashboard/account
 */

import { requireAuth } from '@/lib/require-auth';
import { PasswordChangeForm } from '@/components/dashboard/password-change-form';
import { SendTestNotificationButton } from '@/components/dashboard/send-test-notification-button';

/**
 * Account settings page — shows the signed-in user's identity and exposes
 * the password-change form.
 */
export default async function AccountPage() {
  const session = await requireAuth();

  const shortId = session.userId.slice(0, 8) + '…';

  return (
    <div className="flex flex-col gap-8">
      {/* ── Page header ── */}
      <div>
        <h1 className="font-mono text-2xl font-bold text-white">Account</h1>
        <p className="mt-1 text-sm text-[rgba(255,255,255,0.5)]">
          Manage your identity and local password.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Identity card ── */}
        <section
          aria-labelledby="identity-heading"
          className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-6"
        >
          <h2
            id="identity-heading"
            className="mb-4 font-mono text-sm font-semibold uppercase tracking-widest text-[rgba(255,255,255,0.4)]"
          >
            Identity
          </h2>

          <dl className="space-y-3">
            <div>
              <dt className="text-xs text-[rgba(255,255,255,0.4)]">User ID</dt>
              <dd className="mt-0.5 font-mono text-sm text-[rgba(255,255,255,0.8)]">{shortId}</dd>
            </div>
            <div>
              <dt className="text-xs text-[rgba(255,255,255,0.4)]">Role</dt>
              <dd className="mt-0.5">
                <span className="inline-flex items-center rounded-full border border-[rgba(255,98,36,0.25)] bg-[rgba(255,98,36,0.12)] px-2 py-0.5">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#ff6224]">
                    {session.role}
                  </span>
                </span>
              </dd>
            </div>
            {session.tenantId && (
              <div>
                <dt className="text-xs text-[rgba(255,255,255,0.4)]">Tenant</dt>
                <dd className="mt-0.5 font-mono text-xs text-[rgba(255,255,255,0.6)]">
                  {session.tenantId}
                </dd>
              </div>
            )}
          </dl>
        </section>

        {/* ── Password change ── */}
        <section
          aria-labelledby="password-heading"
          className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-6"
        >
          <h2
            id="password-heading"
            className="mb-1 font-mono text-sm font-semibold uppercase tracking-widest text-[rgba(255,255,255,0.4)]"
          >
            Password
          </h2>
          <p className="mb-4 text-xs text-[rgba(255,255,255,0.35)]">
            Not available for Google OAuth accounts.
          </p>

          <PasswordChangeForm />
        </section>
      </div>

      {/* ── Notifications demo (dev only) ── */}
      <section
        aria-labelledby="notifications-heading"
        className="rounded-xl border border-[rgba(255,98,36,0.15)] bg-[rgba(255,98,36,0.04)] p-6"
      >
        <h2
          id="notifications-heading"
          className="mb-1 font-mono text-sm font-semibold uppercase tracking-widest text-[rgba(255,255,255,0.4)]"
        >
          Notifications demo
        </h2>
        <p className="mb-4 text-xs text-[rgba(255,255,255,0.35)]">
          Sends a test notification through the WebSocket gateway to this session. Only visible in
          development.
        </p>
        <SendTestNotificationButton />
      </section>
    </div>
  );
}
