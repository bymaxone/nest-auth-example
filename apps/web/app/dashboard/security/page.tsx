/**
 * @fileoverview Security settings page — MFA enrollment / disablement plus
 * the email-address change card.
 *
 * Both cards depend on whether the account has a password, which arrives from
 * `getMfaStatus()`. That answer has three states, not two: until it lands,
 * neither card can be rendered honestly, so unknown gets its own state rather
 * than a default.
 *
 * Uses `useSession()` from the auth library to read `mfaEnabled` and to
 * refresh the client-side session cache after every toggle. The page wires
 * the lib's `refresh()` (NOT the Next.js `router.refresh()`) so the
 * `AuthProvider` re-fetches `GET /api/auth/me` and the conditional
 * `mfaEnabled ? <MfaDisableCard/> : <MfaSetupCard/>` swap fires on the
 * very next render — no full page navigation required.
 *
 * Why `router.refresh()` is NOT enough: it re-renders the server tree but
 * never invalidates the `AuthProvider`'s in-memory state, which is the
 * source of truth for `useSession()`. The card swap is driven entirely by
 * client state, so the server refresh is irrelevant here.
 *
 * @layer pages/dashboard/security
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { useSession } from '@bymax-one/nest-auth/react';
import { MfaSetupCard } from '@/components/dashboard/mfa-setup-card';
import { MfaDisableCard } from '@/components/dashboard/mfa-disable-card';
import { MfaStatusUnavailableCard } from '@/components/dashboard/mfa-status-unavailable-card';
import { EmailChangeCard } from '@/components/dashboard/email-change-card';
import { getMfaStatus } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Security settings page — toggles MFA based on the user's current state.
 *
 * `session.refresh()` re-issues `GET /api/auth/me` against the API and
 * updates the `AuthProvider` context with the persisted `mfaEnabled`
 * value. Because both `MfaSetupCard.onEnabled` and `MfaDisableCard.onDisabled`
 * fire AFTER the underlying API call resolves, the refetch picks up the
 * latest server-side state and the page swaps to the correct card on the
 * next render tick.
 */
/** How many times the MFA-status request is attempted before giving up. */
const STATUS_FETCH_ATTEMPTS = 3;

/** Pause between status-request attempts, in milliseconds. */
const STATUS_RETRY_DELAY_MS = 750;

export default function SecurityPage() {
  const { user, status, refresh } = useSession();
  const searchParams = useSearchParams();
  const [isMfaRequired, setIsMfaRequired] = useState(false);
  // `null` means "not known yet" — either still loading or the status request
  // failed. It is deliberately distinct from `false`: pinning it to a boolean
  // on failure would either strand OAuth-only accounts behind a password field
  // they cannot fill, or drop the password requirement for accounts that do
  // have one. Consumers below decide what unknown means for them.
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  // Bumped by the "Try again" control so the effect below re-runs. The
  // automatic attempts are bounded, and once they are spent the user is the
  // only thing that can ask again short of reloading the page.
  const [statusRequestId, setStatusRequestId] = useState(0);

  // Fetch the workspace MFA policy on mount. We only need the `required`
  // flag here — the recovery-code counter inside MfaDisableCard has its
  // own fetch that picks up `recoveryCodesRemaining` after the lib's
  // session refresh completes. Errors are swallowed because the banner
  // is informational; the dashboard shell already redirected the user
  // here when the policy applies, so a missing banner is the lesser bug.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Retry rather than guess. `hasPassword` decides whether the cards ask
      // for a password, and a single transient failure must not settle that
      // for the rest of the page's life — the user has no way to re-trigger
      // the request short of reloading. Attempts are bounded: if the API is
      // still unreachable after these, the page has larger problems than a
      // missing capability flag.
      for (let attempt = 0; attempt < STATUS_FETCH_ATTEMPTS; attempt += 1) {
        try {
          const status = await getMfaStatus();
          if (!cancelled) {
            setIsMfaRequired(status.required);
            setHasPassword(status.hasPassword);
          }
          return;
        } catch {
          if (cancelled) return;
          // The banner is informational, so a failure here is not surfaced;
          // the dashboard shell already redirected the user when the policy
          // applies. `hasPassword` stays unknown for the consumers below.
          setIsMfaRequired(false);
          if (attempt < STATUS_FETCH_ATTEMPTS - 1) {
            await new Promise((resolve) => setTimeout(resolve, STATUS_RETRY_DELAY_MS));
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, statusRequestId]);

  // The cards expect a fire-and-forget `() => void` callback; the lib's
  // `refresh` is async. `void` discards the promise so the callback's
  // return type stays compatible — any error inside `refresh` is handled
  // internally by the lib's `revalidate` (it dispatches CLEAR_SESSION on
  // 401 and is a no-op on transient failures).
  const handleToggle = useCallback(() => {
    void refresh();
  }, [refresh]);

  /** Re-runs the status effect after its bounded attempts have been spent. */
  const handleStatusRetry = useCallback(() => {
    setStatusRequestId((id) => id + 1);
  }, []);

  const arrivedViaMfaRedirect = searchParams.get('reason') === 'mfa_required';

  return (
    <div className="flex flex-col gap-8">
      {/* ── Page header ── */}
      <div>
        <h1 className="font-mono text-2xl font-bold text-white">Security</h1>
        <p className="mt-1 text-sm text-[rgba(255,255,255,0.5)]">
          Manage two-factor authentication and account security settings.
        </p>
      </div>

      {/* ── Workspace-required MFA banner ──
          Shown when the API's `TenantMfaPolicyGuard` says this workspace
          requires MFA. The banner is louder ("setup-required") when the
          user has NOT yet enrolled, and softer ("verified") once MFA is
          on — both states are useful info for a tenant policy. */}
      {isMfaRequired && user !== null && (
        <div
          role={user.mfaEnabled ? 'note' : 'alert'}
          data-testid="mfa-required-banner"
          className={`max-w-xl rounded-xl border px-4 py-3 ${
            user.mfaEnabled
              ? 'border-[rgba(34,197,94,0.3)] bg-[rgba(34,197,94,0.08)] text-[#86efac]'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
          }`}
        >
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="text-sm leading-relaxed">
              {user.mfaEnabled ? (
                <>
                  <strong className="font-semibold">MFA verified for this workspace.</strong>{' '}
                  Two-factor authentication is required by your workspace administrator and is
                  currently active on your account.
                </>
              ) : (
                <>
                  <strong className="font-semibold">MFA setup is required.</strong> Your workspace
                  administrator requires every user to enrol in two-factor authentication before
                  using the app.
                  {arrivedViaMfaRedirect &&
                    ' You were redirected here from a protected page — complete enrolment below to continue.'}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-xl">
        {user === null && status === 'loading' ? (
          <Card className="p-6">
            <p className="text-sm text-[rgba(255,255,255,0.4)]">Loading…</p>
          </Card>
        ) : user === null ? (
          /* The session ended while this page was open — enabling a second
             factor invalidates every session, so this is a normal way to get
             here. Branching on `user === null` alone leaves the card showing
             "Loading…" forever with no way out. */
          <Card className="flex flex-col items-start gap-4 p-6">
            <div>
              <h2 className="font-mono text-base font-semibold text-white">
                Your session has ended
              </h2>
              <p className="mt-2 text-sm text-[rgba(255,255,255,0.5)]">
                Sign in again to manage two-factor authentication.
              </p>
            </div>
            <Button asChild size="sm">
              <Link href="/auth/login">Sign in</Link>
            </Button>
          </Card>
        ) : user.mfaEnabled ? (
          <MfaDisableCard onDisabled={handleToggle} />
        ) : hasPassword === null ? (
          <MfaStatusUnavailableCard onRetry={handleStatusRetry} />
        ) : (
          <MfaSetupCard onEnabled={handleToggle} hasPassword={hasPassword} />
        )}
      </div>

      {/* ── Email address card ──
          Starts the library's two-step address change: password re-proof
          here, then a confirmation link mailed to the new address which
          lands on /auth/confirm-email-change. Rendered only once the
          session has resolved so an anonymous flash never shows the form,
          and only once the capability is known to be true: the change
          re-proves the current password, which an OAuth-only account cannot
          supply, so showing the card there would offer an action that can
          never succeed. Unknown is treated as "do not offer it" — better a
          missing card after a failed status fetch than a permanently failing
          form. Their address is owned by the identity provider. */}
      {user !== null && hasPassword === true && (
        <div className="max-w-xl">
          <EmailChangeCard />
        </div>
      )}
    </div>
  );
}
