/**
 * @fileoverview Verify email page — 6-digit OTP input + resend cooldown.
 *
 * Visual shell is provided by `app/(auth)/layout.tsx`. This page:
 *   - Reads `?email=` and `?tenantId=` from the URL (provided in the verification email link)
 *   - Renders a 6-box OtpInput for the email verification code
 *   - On submit: POST to `/api/auth/verify-email` with `{ email, otp, tenantId }`
 *   - On success: redirects to `/auth/login?verified=1`
 *   - Resend button has a 60-second cooldown, persisted per-email in sessionStorage
 *   - Missing query params: shows an inline "re-open the link" error instead of crashing
 *
 * @layer pages/auth
 */

'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { OtpInput } from '@/components/auth/otp-input';
import { verifyEmailSchema, type VerifyEmailFormValues } from '@/lib/schemas/auth';
import { translateAuthError } from '@/lib/auth-errors';
import { useCooldown } from '@/hooks/use-cooldown';

/**
 * Verify email page — accepts a 6-digit OTP from the verification email.
 *
 * Redirects to `/auth/login?verified=1` on success. If `?email=` or `?tenantId=`
 * are absent from the URL the user is shown an inline error to re-open the link.
 */
export default function VerifyEmailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const email = searchParams.get('email') ?? '';
  const tenantId = searchParams.get('tenantId') ?? '';
  const hasRequiredParams = email !== '' && tenantId !== '';

  const [isSubmitting, setIsSubmitting] = useState(false);

  const cooldownKey = `verifyEmail:cooldown:${email}`;
  const { isCoolingDown, secondsLeft, startCooldown } = useCooldown(cooldownKey, 60);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<VerifyEmailFormValues>({
    resolver: zodResolver(verifyEmailSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: { otp: '' },
  });

  const onSubmit = async (data: VerifyEmailFormValues) => {
    if (!hasRequiredParams) return;
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/verify-email', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: data.otp, tenantId }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { code?: string; message?: string };
        const code = body.code ?? '';
        toast.error(translateAuthError(code));
        return;
      }

      router.replace('/auth/login?verified=1');
    } catch {
      toast.error('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!hasRequiredParams || isCoolingDown) return;
    try {
      await fetch('/api/auth/resend-verification', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, tenantId }),
      });
      startCooldown();
      toast.success('Verification email resent.');
    } catch {
      toast.error('Failed to resend. Please try again.');
    }
  };

  // ── Missing params guard ──────────────────────────────────────────────────
  if (!hasRequiredParams) {
    return (
      <div className="flex flex-col gap-6 text-center">
        <p className="text-sm text-[rgba(255,255,255,0.5)]">Verify your email</p>
        <div
          role="alert"
          className="rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)] px-4 py-3 text-sm text-red-400"
        >
          This link looks incomplete. Please re-open the link from your verification email.
        </div>
        <Link
          href="/auth/login"
          className="text-sm text-[rgba(255,98,36,0.8)] transition-colors hover:text-[#ff6224]"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Sub-heading ── */}
      <div className="text-center">
        <p className="text-sm text-[rgba(255,255,255,0.5)]">
          Enter the 6-digit code sent to{' '}
          <span className="font-mono text-[rgba(255,255,255,0.8)]">{email}</span>.
        </p>
      </div>

      {/* noValidate suppresses native browser validation — React Hook Form + Zod own it */}
      <form
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        noValidate
        className="flex flex-col gap-6"
      >
        {/* OTP boxes */}
        <div className="flex flex-col items-center gap-2">
          <Label className="text-[rgba(255,255,255,0.7)]">Verification code</Label>
          <Controller
            name="otp"
            control={control}
            render={({ field }) => (
              <OtpInput length={6} value={field.value} onChange={field.onChange} />
            )}
          />
          {errors.otp && (
            <p className="text-xs text-red-400" role="alert">
              {errors.otp.message}
            </p>
          )}
        </div>

        {/* Submit */}
        <Button type="submit" disabled={isSubmitting} size="lg" className="w-full">
          {isSubmitting ? 'Verifying…' : 'Verify email'}
        </Button>
      </form>

      {/* ── Resend + back link ── */}
      <div className="flex flex-col items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isCoolingDown}
          onClick={() => void handleResend()}
        >
          {isCoolingDown ? `Resend in ${secondsLeft}s` : 'Resend code'}
        </Button>

        <Link
          href="/auth/login"
          className="text-sm text-[rgba(255,255,255,0.4)] transition-colors hover:text-[rgba(255,255,255,0.6)]"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
