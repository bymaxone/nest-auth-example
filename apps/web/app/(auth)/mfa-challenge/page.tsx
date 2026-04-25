/**
 * @fileoverview MFA challenge page — TOTP (default) or recovery-code toggle.
 *
 * Visual shell is provided by `app/(auth)/layout.tsx`. This page:
 *   - Reads `mfaTempToken` from `sessionStorage` on mount; if absent, redirects
 *     to `/auth/login` so the user can restart the login flow
 *   - Default mode: TOTP — 6-box `<OtpInput>` driven by `mfaChallengeSchema`
 *   - "Use a recovery code instead" toggle swaps to a plain text input
 *   - Submit calls `authClient.mfaChallenge(tempToken, code)` directly; on
 *     success clears the temp token from `sessionStorage` and navigates to
 *     `/dashboard`
 *   - Error handling: `mapAuthClientError` → `translateAuthError` → `sonner` toast
 *
 * Security note: `mfaTempToken` lives only in `sessionStorage` — never written
 * to a cookie or a URL parameter. It is cleared on both the success path and
 * the missing-token redirect path.
 *
 * @layer pages/auth
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { authClient } from '@/lib/auth-client';
import { mapAuthClientError } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OtpInput } from '@/components/auth/otp-input';
import { mfaChallengeSchema, type MfaChallengeFormValues } from '@/lib/schemas/auth';
import { translateAuthError } from '@/lib/auth-errors';

const SESSION_KEY = 'mfaTempToken';

/**
 * MFA challenge page — presented after a successful credential login on an
 * account with MFA enrolled. Reads the short-lived `mfaTempToken` from
 * `sessionStorage` and completes authentication with either a TOTP code or
 * a recovery code.
 */
export default function MfaChallengePage() {
  const router = useRouter();
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
    const token = sessionStorage.getItem(SESSION_KEY);
    if (!token) {
      toast.error('Your session has expired. Please sign in again.');
      router.replace('/auth/login');
      return;
    }
    setTempToken(token);
  }, [router]);

  const switchMode = (next: 'totp' | 'recovery') => {
    setMode(next);
    reset({ type: next, code: '' });
  };

  const onSubmit = async (data: MfaChallengeFormValues) => {
    if (!tempToken) return;
    setIsSubmitting(true);
    try {
      await authClient.mfaChallenge(tempToken, data.code);
      sessionStorage.removeItem(SESSION_KEY);
      router.replace('/dashboard');
    } catch (err) {
      const { code } = mapAuthClientError(err);
      toast.error(translateAuthError(code === 'UNKNOWN' ? '' : code));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Render nothing until the client mount resolves the token check to
  // prevent a flash of the form before the redirect fires.
  if (!mounted || tempToken === null) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Sub-heading ── */}
      <div className="text-center">
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
