/**
 * @fileoverview Platform admin security page — MFA enrolment / disable /
 * recovery-code rotation for the authenticated platform administrator.
 *
 * Source-of-truth for the MFA state is `GET /api/auth/platform/me` (returned
 * by the lib's `PlatformAuthController.me`). The page fetches the platform
 * admin profile on mount, then chooses between `PlatformMfaSetupCard` and
 * `PlatformMfaDisableCard` based on the `mfaEnabled` flag.
 *
 * Platform admins authenticate via bearer tokens stored in `sessionStorage`
 * (see `lib/platform-auth`), so this page does NOT consume the lib's
 * `useSession()` hook — that one is dashboard-only. State refresh after
 * a toggle re-fetches `platformGetMe()` via a version bump rather than the
 * lib's `revalidate`.
 *
 * @layer pages/platform
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import { toast } from 'sonner';
import { PlatformMfaSetupCard } from '@/components/platform/platform-mfa-setup-card';
import { PlatformMfaDisableCard } from '@/components/platform/platform-mfa-disable-card';
import { platformGetMe, handleAuthClientError, type PlatformMeInfo } from '@/lib/auth-client';

/**
 * Platform security page — admin-only, surfaces the platform-side MFA flows.
 */
export default function PlatformSecurityPage() {
  const [me, setMe] = useState<PlatformMeInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const profile = await platformGetMe();
        if (!cancelled) setMe(profile);
      } catch (err) {
        if (!cancelled) handleAuthClientError(err, { toast });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  // Both cards take a fire-and-forget callback; we bump the version so the
  // useEffect above re-fetches `me` and the conditional card swap happens
  // on the very next render.
  const handleToggle = useCallback(() => {
    setVersion((n) => n + 1);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* ── Page header ── */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)]">
          <Shield className="h-5 w-5 text-red-400" />
        </div>
        <div>
          <h1 className="font-mono text-xl font-semibold text-red-100">Security</h1>
          <p className="text-sm text-red-400/60">
            Manage your platform admin account&apos;s two-factor authentication.
          </p>
        </div>
      </div>

      <div className="max-w-xl">
        {isLoading ? (
          <div className="rounded-xl border border-[rgba(239,68,68,0.15)] bg-[rgba(20,0,0,0.4)] p-6">
            <p className="text-sm text-[rgba(255,200,200,0.5)]">Loading…</p>
          </div>
        ) : me === null ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6">
            <p className="text-sm text-red-300">
              Could not load your platform admin profile. Please reload the page.
            </p>
          </div>
        ) : me.mfaEnabled ? (
          <PlatformMfaDisableCard onDisabled={handleToggle} />
        ) : (
          <PlatformMfaSetupCard onEnabled={handleToggle} />
        )}
      </div>
    </div>
  );
}
