/**
 * @fileoverview MFA challenge page — TOTP (default) or recovery-code toggle.
 *
 * Visual shell is provided by `app/(auth)/layout.tsx`. This page handles
 * two distinct entry paths that converge on the same lib endpoint
 * (`POST /api/auth/mfa/challenge`):
 *
 *   1. **Password-login path** (default).
 *      - The user passed `/auth/login`, hit the MFA branch, and the
 *        login response returned `{ mfaRequired: true, mfaTempToken }`.
 *      - The login page stashed `mfaTempToken` into `sessionStorage`.
 *      - This page reads it on mount and posts `{ mfaTempToken, code }`
 *        via `authClient.mfaChallenge(...)`.
 *
 *   2. **OAuth-login path** (lib v1.0.7+, signalled by `?source=oauth`).
 *      - The user authenticated via Google. Because their account has
 *        MFA enabled, the lib's `OAuthController.callback` planted a
 *        short-lived `mfa_temp_token` HttpOnly cookie (Path scoped to
 *        `/api/auth/mfa`) and redirected here.
 *      - The token is NOT in `sessionStorage` and CANNOT be read from
 *        JavaScript. The page posts `{ code }` only — the browser
 *        sends the cookie automatically, the lib's `MfaController`
 *        reads it on the server side.
 *      - On success, lib clears the cookie and issues full session
 *        cookies. The page redirects to `/dashboard`.
 *
 * Either flow ends with a `router.replace('/dashboard')` once
 * authentication completes. The mode toggle (TOTP vs recovery code) and
 * the form layout are shared — only the network call differs.
 *
 * **Retry semantics** (lib v1.0.8+): the MFA temp token is no longer
 * consumed on a wrong code — `MfaService.challenge` splits verify and
 * consume so the JWT stays alive in Redis until a valid TOTP / recovery
 * code is supplied (or the 5-minute TTL elapses). The page reflects this
 * by clearing only the visible OTP boxes on `MFA_INVALID_CODE` so the
 * user can re-type without leaving the page. Only `MFA_TEMP_TOKEN_INVALID`
 * — the unrecoverable case — kicks the user back to `/auth/login`.
 *
 * Security note: `mfaTempToken` from the password flow lives ONLY in
 * `sessionStorage` (never a cookie, never a URL param). The OAuth flow
 * uses an HttpOnly cookie planted by the lib (also never a URL param).
 *
 * @layer pages/auth
 */

'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useSession } from '@bymax-one/nest-auth/react';
import { authClient, mapAuthClientError, mfaChallengeViaCookie } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OtpInput } from '@/components/auth/otp-input';
import { mfaChallengeSchema, type MfaChallengeFormValues } from '@/lib/schemas/auth';
import { translateAuthError } from '@/lib/auth-errors';

const SESSION_KEY = 'mfaTempToken';

/**
 * Inner form — wrapped in `<Suspense>` by the default export so the page
 * can be statically prerendered despite `useSearchParams()` triggering a
 * CSR bailout in Next 16.
 */
function MfaChallengeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // `useSession()` exposes the AuthProvider's `refresh()` — calling it after a
  // successful challenge forces the provider to re-fetch `GET /api/auth/me`
  // so `useSession().user` is populated for the dashboard pages that follow.
  // Without this, the OAuth-MFA path renders /dashboard/security with a stuck
  // "Loading…" (the provider was mounted pre-MFA and never revalidates on
  // `router.replace` alone), and the NotificationListener never opens its
  // WebSocket because it guards on `user !== null` before connecting.
  const { refresh } = useSession();
  const isOAuthFlow = searchParams.get('source') === 'oauth';
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MfaChallengeFormValues>({
    resolver: zodResolver(mfaChallengeSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: { type: 'totp', code: '' },
  });

  useEffect(() => {
    setMounted(true);
    // OAuth flow: the token is in an HttpOnly cookie — there is nothing
    // for the page to read upfront. The browser will attach it on the
    // POST automatically. We skip the sessionStorage check entirely
    // because a missing-cookie failure surfaces in the server response,
    // not in the page's pre-mount validation.
    if (isOAuthFlow) {
      return;
    }
    const token = sessionStorage.getItem(SESSION_KEY);
    if (!token) {
      toast.error('Your session has expired. Please sign in again.');
      router.replace('/auth/login');
      return;
    }
    setTempToken(token);
  }, [router, isOAuthFlow]);

  const switchMode = (next: 'totp' | 'recovery') => {
    setMode(next);
    reset({ type: next, code: '' });
  };

  const onSubmit = async (data: MfaChallengeFormValues) => {
    setIsSubmitting(true);
    try {
      if (isOAuthFlow) {
        // Cookie-driven challenge — lib reads `mfa_temp_token` from the
        // HttpOnly cookie planted by the OAuth callback. No body token.
        await mfaChallengeViaCookie(data.code);
      } else {
        if (tempToken === null) return;
        await authClient.mfaChallenge(tempToken, data.code);
        sessionStorage.removeItem(SESSION_KEY);
      }
      // Force the AuthProvider to re-fetch `/api/auth/me` so `useSession().user`
      // reflects the freshly-issued session cookies before the next page mounts.
      // Without this, the soft navigation below ships the dashboard with a
      // stale (null) user, so role-gated UI + the Security page stay stuck
      // on "Loading…" until the user manually refreshes the page.
      await refresh();
      router.replace('/dashboard');
    } catch (err) {
      const { code } = mapAuthClientError(err);
      toast.error(translateAuthError(code === 'UNKNOWN' ? '' : code));

      // ── Branch on error kind ────────────────────────────────────────
      // `MFA_TEMP_TOKEN_INVALID` is unrecoverable — the temp JWT was
      // either forged, already consumed, or its 5-minute TTL elapsed.
      // The lib has already cleared the OAuth cookie server-side; here
      // we mirror that by purging the password-flow's sessionStorage
      // entry and bouncing back to /auth/login. A fresh login (or
      // OAuth drive) is the only path forward.
      if (code === 'auth.mfa_temp_token_invalid') {
        if (!isOAuthFlow) {
          sessionStorage.removeItem(SESSION_KEY);
        }
        router.replace('/auth/login');
        return;
      }

      // For every other failure (`MFA_INVALID_CODE`, `ACCOUNT_LOCKED`,
      // transient network errors) the lib v1.0.8+ keeps the temp token
      // alive so the user can retry. Clear the OTP boxes / recovery
      // input so they can re-type without manually deleting digits.
      reset({ type: mode, code: '' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Render nothing until the client mount resolves the token check. For
  // the OAuth path we render immediately on mount (the cookie is server-
  // side; nothing to wait for client-side).
  if (!mounted || (!isOAuthFlow && tempToken === null)) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Sub-heading ── */}
      <div className="text-center">
        {isOAuthFlow && (
          <p className="mb-2 text-xs text-[rgba(255,98,36,0.85)]">
            Continuing your Google sign-in — one more step.
          </p>
        )}
        <p className="text-sm text-[rgba(255,255,255,0.5)]">
          {mode === 'totp'
            ? 'Enter the 6-digit code from your authenticator app.'
            : 'Enter one of your saved recovery codes.'}
        </p>
      </div>

      {/* noValidate suppresses native browser validation — React Hook Form + Zod own it */}
      <form
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        noValidate
        className="flex flex-col gap-6"
      >
        {/* Hidden type discriminant */}
        <input type="hidden" {...register('type')} />

        {mode === 'totp' ? (
          /* ── TOTP boxes ── */
          <div className="flex flex-col items-center gap-2">
            <Label className="text-[rgba(255,255,255,0.7)]">Authenticator code</Label>
            <Controller
              name="code"
              control={control}
              render={({ field }) => (
                <OtpInput length={6} value={field.value} onChange={field.onChange} />
              )}
            />
            {errors.code && (
              <p className="text-xs text-red-400" role="alert">
                {errors.code.message}
              </p>
            )}
          </div>
        ) : (
          /* ── Recovery code text input ── */
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mfa-recovery" className="text-[rgba(255,255,255,0.7)]">
              Recovery code
            </Label>
            <Input
              id="mfa-recovery"
              type="text"
              autoComplete="one-time-code"
              placeholder="xxxxxxxx-xxxx-…"
              aria-describedby={errors.code ? 'mfa-recovery-error' : undefined}
              aria-invalid={!!errors.code}
              className="border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-center font-mono text-white placeholder:text-[rgba(255,255,255,0.3)] focus-visible:ring-[#ff6224]/50"
              {...register('code')}
            />
            {errors.code && (
              <p id="mfa-recovery-error" className="text-xs text-red-400" role="alert">
                {errors.code.message}
              </p>
            )}
          </div>
        )}

        <Button type="submit" disabled={isSubmitting} size="lg" className="w-full">
          {isSubmitting ? 'Verifying…' : 'Verify'}
        </Button>
      </form>

      {/* ── Mode toggle ── */}
      <div className="flex flex-col items-center gap-2">
        {mode === 'totp' ? (
          <button
            type="button"
            onClick={() => switchMode('recovery')}
            className="text-sm text-[rgba(255,98,36,0.8)] transition-colors hover:text-[#ff6224]"
          >
            Use a recovery code instead
          </button>
        ) : (
          <button
            type="button"
            onClick={() => switchMode('totp')}
            className="text-sm text-[rgba(255,98,36,0.8)] transition-colors hover:text-[#ff6224]"
          >
            Use authenticator app instead
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * MFA challenge page — presented after either a password login (token
 * from sessionStorage) or an OAuth callback that detected MFA (token
 * from HttpOnly cookie planted by the lib's `OAuthController`).
 */
export default function MfaChallengePage() {
  return (
    <Suspense fallback={null}>
      <MfaChallengeForm />
    </Suspense>
  );
}
