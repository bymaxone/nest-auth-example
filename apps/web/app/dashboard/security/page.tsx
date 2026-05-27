/**
 * @fileoverview Security settings page — MFA enrollment / disablement.
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
import { ShieldAlert } from 'lucide-react';
import { useSession } from '@bymax-one/nest-auth/react';
import { MfaSetupCard } from '@/components/dashboard/mfa-setup-card';
import { MfaDisableCard } from '@/components/dashboard/mfa-disable-card';
import { getMfaStatus } from '@/lib/auth-client';

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
export default function SecurityPage() {
  const { user, refresh } = useSession();
  const searchParams = useSearchParams();
  const [isMfaRequired, setIsMfaRequired] = useState(false);

  // Fetch the workspace MFA policy on mount. We only need the `required`
  // flag here — the recovery-code counter inside MfaDisableCard has its
  // own fetch that picks up `recoveryCodesRemaining` after the lib's
  // session refresh completes. Errors are swallowed because the banner
  // is informational; the dashboard shell already redirected the user
  // here when the policy applies, so a missing banner is the lesser bug.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await getMfaStatus();
        if (!cancelled) setIsMfaRequired(status.required);
      } catch {
        if (!cancelled) setIsMfaRequired(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // The cards expect a fire-and-forget `() => void` callback; the lib's
  // `refresh` is async. `void` discards the promise so the callback's
  // return type stays compatible — any error inside `refresh` is handled
  // internally by the lib's `revalidate` (it dispatches CLEAR_SESSION on
  // 401 and is a no-op on transient failures).
  const handleToggle = useCallback(() => {
    void refresh();
  }, [refresh]);

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
        {user === null ? (
          <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-6">
            <p className="text-sm text-[rgba(255,255,255,0.4)]">Loading…</p>
          </div>
        ) : user.mfaEnabled ? (
          <MfaDisableCard onDisabled={handleToggle} />
        ) : (
          <MfaSetupCard onEnabled={handleToggle} />
        )}
      </div>
    </div>
  );
}
