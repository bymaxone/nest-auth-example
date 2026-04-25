/**
 * @fileoverview Security settings page — MFA enrollment / disablement.
 *
 * Uses `useSession()` from the auth library to read `mfaEnabled` in a
 * Client Component wrapper. The MFA state is refreshed after every enable
 * or disable action via `router.refresh()` so the server-rendered session
 * reflects the latest DB state.
 *
 * @layer pages/dashboard/security
 */

'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@bymax-one/nest-auth/react';
import { MfaSetupCard } from '@/components/dashboard/mfa-setup-card';
import { MfaDisableCard } from '@/components/dashboard/mfa-disable-card';

/**
 * Security settings page — toggles MFA based on the user's current state.
 *
 * `router.refresh()` triggers a Server Component re-render so `useSession()`
 * picks up the updated JWT claim once the library re-issues a fresh access
 * token on the next request (the client-side session cache is also cleared).
 */
export default function SecurityPage() {
  const router = useRouter();
  const { user } = useSession();

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  return (
    <div className="flex flex-col gap-8">
      {/* ── Page header ── */}
      <div>
        <h1 className="font-mono text-2xl font-bold text-white">Security</h1>
        <p className="mt-1 text-sm text-[rgba(255,255,255,0.5)]">
          Manage two-factor authentication and account security settings.
        </p>
      </div>

      <div className="max-w-xl">
        {user === null ? (
          <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-6">
            <p className="text-sm text-[rgba(255,255,255,0.4)]">Loading…</p>
          </div>
        ) : user.mfaEnabled ? (
          <MfaDisableCard onDisabled={refresh} />
        ) : (
          <MfaSetupCard onEnabled={refresh} />
        )}
      </div>
    </div>
  );
}
