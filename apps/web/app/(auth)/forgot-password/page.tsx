/**
 * @fileoverview Forgot password page — email input with anti-enumeration success state.
 *
 * Visual shell is provided by `app/(auth)/layout.tsx`. This page:
 *   - Accepts an email address and calls `useAuth().forgotPassword(email, tenantId)`
 *   - Reads `tenantId` from the `?tenant=` search param (defaults to `'default'`)
 *   - On any resolved response (200 or "account not found" 404): shows the same
 *     generic confirmation — never distinguishes registered vs unknown email
 *   - Transport-level errors (network failure, rate limit) are surfaced as toasts
 *   - No automatic redirect after success; the user reads the confirmation and
 *     checks their inbox
 *
 * Anti-enumeration: the server always returns 200 regardless of whether the email
 * is registered. The UI mirrors this by always showing the same success copy.
 *
 * @layer pages/auth
 */

'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { MailOpen } from 'lucide-react';
import { useAuth } from '@bymax-one/nest-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { forgotPasswordSchema, type ForgotPasswordFormValues } from '@/lib/schemas/auth';
import { mapAuthClientError } from '@/lib/auth-client';
import { translateAuthError } from '@/lib/auth-errors';

/**
 * Forgot password page — submits the reset request and shows a generic
 * confirmation regardless of whether the email is registered.
 */
export default function ForgotPasswordPage() {
  const searchParams = useSearchParams();
  const tenantId = searchParams.get('tenant') ?? 'default';
  const { forgotPassword } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    getValues,
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const onSubmit = async (data: ForgotPasswordFormValues) => {
    setIsSubmitting(true);
    try {
      await forgotPassword(data.email, tenantId);
      // Always show the generic confirmation — the server never leaks user existence
      setSubmitted(true);
    } catch (err) {
      const { code } = mapAuthClientError(err);
      // Translate and surface only transport-level errors (rate limit, network)
      // Account-not-found is indistinguishable from success by design
      toast.error(translateAuthError(code === 'UNKNOWN' ? '' : code));
      // Still show the confirmation to prevent account enumeration via error timing
      setSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Success state ─────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <div
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgba(255,98,36,0.3)] bg-[rgba(255,98,36,0.1)]"
        >
          <MailOpen className="h-7 w-7 text-[#ff6224]" />
        </div>

        <div>
          <h2 className="font-mono text-base font-semibold text-white">Check your inbox</h2>
          <p className="mt-2 text-sm leading-relaxed text-[rgba(255,255,255,0.5)]">
            If an account exists for{' '}
            <span className="font-mono text-[rgba(255,255,255,0.8)]">{getValues('email')}</span>, we
            sent reset instructions.
          </p>
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
          Enter your email to receive reset instructions.
        </p>
      </div>

      {/* noValidate suppresses native browser validation — React Hook Form + Zod own it */}
      <form
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        noValidate
        className="flex flex-col gap-4"
      >
        {/* Email */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email" className="text-[rgba(255,255,255,0.7)]">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-describedby={errors.email ? 'fp-email-error' : undefined}
            aria-invalid={!!errors.email}
            className="border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-white placeholder:text-[rgba(255,255,255,0.3)] focus-visible:ring-[#ff6224]/50"
            {...register('email')}
          />
          {errors.email && (
            <p id="fp-email-error" className="text-xs text-red-400">
              {errors.email.message}
            </p>
          )}
        </div>

        {/* Submit */}
        <Button type="submit" disabled={isSubmitting} size="lg" className="mt-1 w-full">
          {isSubmitting ? 'Sending…' : 'Send reset instructions'}
        </Button>
      </form>

      {/* ── Footer ── */}
      <p className="text-center text-sm text-[rgba(255,255,255,0.4)]">
        Remember your password?{' '}
        <Link
          href="/auth/login"
          className="text-[rgba(255,98,36,0.8)] transition-colors hover:text-[#ff6224]"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
