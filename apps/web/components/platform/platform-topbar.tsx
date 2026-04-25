/**
 * @fileoverview Platform admin topbar — visually distinct red-tinted header.
 *
 * The `PLATFORM ADMIN` label and red background make this area immediately
 * recognisable so an operator cannot confuse it with the tenant dashboard.
 *
 * Sign-out: POSTs to `/api/auth/platform/logout` with the bearer token +
 * refresh token, clears sessionStorage, then navigates to `/platform/login`.
 *
 * @layer components/platform
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  getPlatformAdmin,
  getPlatformRefreshToken,
  clearPlatformTokens,
} from '@/lib/platform-auth';
import { platformLogout } from '@/lib/auth-client';

/**
 * Fixed top bar for the platform admin area.
 *
 * Shows a prominent `PLATFORM ADMIN` badge on a red background so the area is
 * visually impossible to confuse with the tenant dashboard. Avatar displays the
 * platform admin's initials; the sign-out button revokes the bearer session.
 */
export function PlatformTopbar() {
  const router = useRouter();
  const admin = getPlatformAdmin();
  const [isPending, setIsPending] = useState(false);

  const initials = admin?.name
    ? admin.name
        .split(' ')
        .slice(0, 2)
        .map((n) => n[0] ?? '')
        .join('')
        .toUpperCase()
    : 'PA';

  const handleSignOut = async () => {
    setIsPending(true);
    try {
      const refreshToken = getPlatformRefreshToken() ?? '';
      await platformLogout(refreshToken);
    } catch {
      // Best-effort revocation — always clear local state regardless of API outcome.
    } finally {
      clearPlatformTokens();
      router.replace('/platform/login');
    }
  };

  return (
    <header
      className="z-200 fixed left-0 right-0 top-0 flex h-16 items-center justify-between border-b border-[rgba(239,68,68,0.3)] bg-red-950 px-4 text-red-50 lg:px-6"
      role="banner"
    >
      {/* ── Left: PLATFORM ADMIN badge ── */}
      <div className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[rgba(239,68,68,0.5)] bg-[rgba(239,68,68,0.25)]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2L2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="#fca5a5"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className="flex flex-col">
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-red-400">
            PLATFORM ADMIN
          </span>
          <span className="font-mono text-sm font-semibold text-red-100">nest-auth-example</span>
        </div>
      </div>

      {/* ── Right: admin identity + sign out ── */}
      <div className="flex items-center gap-3">
        {admin && (
          <div className="hidden items-center gap-2 lg:flex">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="bg-[rgba(239,68,68,0.25)] text-[10px] font-semibold text-red-300">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-mono text-xs font-medium text-red-100">{admin.name}</span>
              <span className="font-mono text-[10px] text-red-400">{admin.role}</span>
            </div>
          </div>
        )}

        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          className="text-red-300 hover:bg-[rgba(239,68,68,0.15)] hover:text-red-100"
          onClick={() => void handleSignOut()}
        >
          <LogOut className="mr-1 h-4 w-4" />
          Sign out
        </Button>
      </div>
    </header>
  );
}
