/**
 * @fileoverview Reset password page — token + OTP modes via `?mode=` query param.
 *
 * Visual shell is provided by `app/(auth)/layout.tsx`. A single page handles
 * both reset flows by reading `?mode=` from the URL:
 *
 *   `?mode=token&token=...`    — password-only form using a signed reset token
 *   `?mode=otp&email=...`      — OTP code + password form using a one-time OTP
 *
 * Unknown or missing `mode` renders an inline fallback with a link to
 * `/auth/forgot-password` so the user can request a new reset.
 *
 * Both flows call `useAuth().resetPassword` with the payload shape required by
 * `ResetPasswordInput` (mutually exclusive `token` vs `otp` fields). The tenant
 * is NOT part of the body — the API configures `tenantIdResolver`, so the
 * `?tenantId=` URL param is resolved to a CUID and stashed in the `tenant_id`
 * cookie before the call, letting `tenantAwareFetch` inject the `X-Tenant-Id`
 * header the resolver reads.
 *
 * On success: `router.replace('/auth/login?reset=1')`.
 *
 * @layer pages/auth
 */

'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useAuth } from '@bymax-one/nest-auth/react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/auth/password-input';
import { OtpInput } from '@/components/auth/otp-input';
import {
  resetPasswordTokenSchema,
  resetPasswordOtpSchema,
  type ResetPasswordTokenFormValues,
  type ResetPasswordOtpFormValues,
} from '@/lib/schemas/auth';
import { mapAuthClientError } from '@/lib/auth-client';

/**
 * Reset password page — token mode form.
 *
 * @param token    - Signed reset token from the URL.
 * @param email    - Email address of the account being reset.
 * @param tenantId - Tenant slug or CUID from the URL — resolved and sent via the X-Tenant-Id header.
 */
function TokenModeForm({
  token,
  email,
  tenantId,
}: {
  token: string;
  email: string;
  tenantId: string;
}) {
  const router = useRouter();
  const { resetPassword } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordTokenFormValues>({
    resolver: zodResolver(resetPasswordTokenSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const onSubmit = async (data: ResetPasswordTokenFormValues) => {
    setIsSubmitting(true);
    try {
      // The link is built by the email provider from the `tenantId` the library
      // hands it — `Tenant.id`, never the slug — so it goes into the cookie as
      // it stands, for `tenantAwareFetch` to send as X-Tenant-Id. Running it
      // through the slug lookup would ask the server to translate an id, which
      // answers 404 for any deployment whose ids are not also slugs. The body
      // carries no tenantId: the API's `tenantIdResolver` refuses it.
      document.cookie = `tenant_id=${tenantId}; Path=/; SameSite=Lax; Max-Age=31536000`;

      await resetPassword({ email, newPassword: data.newPassword, token });
      router.replace('/auth/login?reset=1');
    } catch (err) {
      const { message } = mapAuthClientError(err);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      noValidate
      className="flex flex-col gap-4"
    >
      {/* New password */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="rp-password" className="text-[rgba(255,255,255,0.7)]">
          New password
        </Label>
        <PasswordInput
          id="rp-password"
          autoComplete="new-password"
          placeholder="At least 15 characters"
          aria-describedby={errors.newPassword ? 'rp-password-error' : undefined}
          aria-invalid={!!errors.newPassword}
          className="border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-white placeholder:text-[rgba(255,255,255,0.3)] focus-visible:ring-[#ff6224]/50"
          {...register('newPassword')}
        />
        {errors.newPassword && (
          <p id="rp-password-error" className="text-xs text-red-400">
            {errors.newPassword.message}
          </p>
        )}
      </div>

      {/* Confirm password */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="rp-confirm" className="text-[rgba(255,255,255,0.7)]">
          Confirm password
        </Label>
        <PasswordInput
          id="rp-confirm"
          autoComplete="new-password"
          placeholder="Repeat your password"
          aria-describedby={errors.confirmPassword ? 'rp-confirm-error' : undefined}
          aria-invalid={!!errors.confirmPassword}
          className="border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-white placeholder:text-[rgba(255,255,255,0.3)] focus-visible:ring-[#ff6224]/50"
          {...register('confirmPassword')}
        />
        {errors.confirmPassword && (
          <p id="rp-confirm-error" className="text-xs text-red-400">
            {errors.confirmPassword.message}
          </p>
        )}
      </div>

      <Button type="submit" disabled={isSubmitting} size="lg" className="mt-1 w-full">
        {isSubmitting ? 'Resetting…' : 'Set new password'}
      </Button>
    </form>
  );
}

/**
 * Reset password page — OTP mode form.
 *
 * @param email    - Email address of the account being reset.
 * @param tenantId - Tenant slug or CUID from the URL — resolved and sent via the X-Tenant-Id header.
 */
function OtpModeForm({ email, tenantId }: { email: string; tenantId: string }) {
  const router = useRouter();
  const { resetPassword } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordOtpFormValues>({
    resolver: zodResolver(resetPasswordOtpSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: { otp: '' },
  });

  const onSubmit = async (data: ResetPasswordOtpFormValues) => {
    setIsSubmitting(true);
    try {
      // The link is built by the email provider from the `tenantId` the library
      // hands it — `Tenant.id`, never the slug — so it goes into the cookie as
      // it stands, for `tenantAwareFetch` to send as X-Tenant-Id. Running it
      // through the slug lookup would ask the server to translate an id, which
      // answers 404 for any deployment whose ids are not also slugs. The body
      // carries no tenantId: the API's `tenantIdResolver` refuses it.
      document.cookie = `tenant_id=${tenantId}; Path=/; SameSite=Lax; Max-Age=31536000`;

      await resetPassword({ email, newPassword: data.newPassword, otp: data.otp });
      router.replace('/auth/login?reset=1');
    } catch (err) {
      const { message } = mapAuthClientError(err);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      noValidate
      className="flex flex-col gap-4"
    >
      {/* OTP code */}
      <div className="flex flex-col items-center gap-2">
        <Label className="text-[rgba(255,255,255,0.7)]">Reset code</Label>
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

      {/* New password */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="rp-otp-password" className="text-[rgba(255,255,255,0.7)]">
          New password
        </Label>
        <PasswordInput
          id="rp-otp-password"
          autoComplete="new-password"
          placeholder="At least 15 characters"
          aria-describedby={errors.newPassword ? 'rp-otp-password-error' : undefined}
          aria-invalid={!!errors.newPassword}
          className="border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-white placeholder:text-[rgba(255,255,255,0.3)] focus-visible:ring-[#ff6224]/50"
          {...register('newPassword')}
        />
        {errors.newPassword && (
          <p id="rp-otp-password-error" className="text-xs text-red-400">
            {errors.newPassword.message}
          </p>
        )}
      </div>

      {/* Confirm password */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="rp-otp-confirm" className="text-[rgba(255,255,255,0.7)]">
          Confirm password
        </Label>
        <PasswordInput
          id="rp-otp-confirm"
          autoComplete="new-password"
          placeholder="Repeat your password"
          aria-describedby={errors.confirmPassword ? 'rp-otp-confirm-error' : undefined}
          aria-invalid={!!errors.confirmPassword}
          className="border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-white placeholder:text-[rgba(255,255,255,0.3)] focus-visible:ring-[#ff6224]/50"
          {...register('confirmPassword')}
        />
        {errors.confirmPassword && (
          <p id="rp-otp-confirm-error" className="text-xs text-red-400">
            {errors.confirmPassword.message}
          </p>
        )}
      </div>

      <Button type="submit" disabled={isSubmitting} size="lg" className="mt-1 w-full">
        {isSubmitting ? 'Resetting…' : 'Set new password'}
      </Button>
    </form>
  );
}

/**
 * Inner page body — extracted so the default export can wrap it in `<Suspense>`,
 * required because `useSearchParams()` triggers a CSR bailout during static
 * generation in Next 16.
 */
function ResetPasswordContent() {
  const searchParams = useSearchParams();

  const mode = searchParams.get('mode');
  const token = searchParams.get('token') ?? '';
  const email = searchParams.get('email') ?? '';
  const tenantId = searchParams.get('tenantId') ?? 'default';

  // ── Fallback — unknown or missing mode ────────────────────────────────────
  if (mode !== 'token' && mode !== 'otp') {
    return (
      <div className="flex flex-col gap-6 text-center">
        <p className="text-sm text-[rgba(255,255,255,0.5)]">Reset your password</p>
        <div
          role="alert"
          className="rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)] px-4 py-3 text-sm text-red-400"
        >
          This link looks incomplete. Please request a new password reset.
        </div>
        <Link
          href="/auth/forgot-password"
          className="text-sm text-[rgba(255,98,36,0.8)] transition-colors hover:text-[#ff6224]"
        >
          Request a new reset link
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Sub-heading ── */}
      <div className="text-center">
        <p className="text-sm text-[rgba(255,255,255,0.5)]">
          {mode === 'token'
            ? 'Set your new password.'
            : 'Enter the code from your email, then set a new password.'}
        </p>
      </div>

      {mode === 'token' ? (
        <TokenModeForm token={token} email={email} tenantId={tenantId} />
      ) : (
        <OtpModeForm email={email} tenantId={tenantId} />
      )}

      {/* ── Footer ── */}
      <p className="text-center text-sm text-[rgba(255,255,255,0.4)]">
        <Link
          href="/auth/forgot-password"
          className="text-[rgba(255,98,36,0.8)] transition-colors hover:text-[#ff6224]"
        >
          Request a new reset link
        </Link>
      </p>
    </div>
  );
}

/**
 * Reset password page — branches on `?mode=token` or `?mode=otp`.
 *
 * Unknown or missing mode renders an inline fallback with a link to request a
 * new reset so the user is never silently stuck on a broken URL.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}
