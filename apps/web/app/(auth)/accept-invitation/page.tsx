/**
 * @fileoverview Accept invitation page — name + password for invited users.
 *
 * Visual shell is provided by `app/(auth)/layout.tsx`. This page:
 *   - Reads `?token=` from the URL (embedded in the invitation email link)
 *   - Missing token: shows an inline error with a "Contact your administrator"
 *     message so the user is never silently stuck on a broken URL
 *   - Form collects `name` + `password` (via `<PasswordInput>`) and a
 *     `confirmPassword` field — validated by `acceptInvitationSchema`
 *   - Submit POSTs to `/api/auth/invitations/accept` with `{ token, name, password }`
 *   - On success: the library issues session cookies; page redirects to `/dashboard`
 *   - Invalid/expired token errors are surfaced inline (not just as toasts) since
 *     the user cannot recover without a new invite link
 *
 * Note: `@bymax-one/nest-auth` does not expose a GET endpoint for fetching
 * invitation metadata (inviter name, tenant, role) before acceptance — the
 * form is shown immediately after verifying the token param is present. The
 * validation occurs on the accept POST.
 *
 * @layer pages/auth
 */

'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/auth/password-input';
import { acceptInvitationSchema, type AcceptInvitationFormValues } from '@/lib/schemas/auth';
import { translateAuthError } from '@/lib/auth-errors';

/** Error codes that indicate an unrecoverable invitation state. */
const INVITATION_FATAL_CODES = new Set([
  'auth.invalid_invitation_token',
  'auth.invitation_not_found',
  'auth.invitation_expired',
  'auth.invitation_used',
]);

/**
 * Accept invitation page — collects the recipient's display name and password
 * to complete account creation for an invited user.
 */
export default function AcceptInvitationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const hasToken = token !== '';

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AcceptInvitationFormValues>({
    resolver: zodResolver(acceptInvitationSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const onSubmit = async (data: AcceptInvitationFormValues) => {
    setIsSubmitting(true);
    setFatalError(null);
    try {
      const response = await fetch('/api/auth/invitations/accept', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name: data.name, password: data.password }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { code?: string; message?: string };
        const code = body.code ?? '';
        const message = translateAuthError(code);

        if (INVITATION_FATAL_CODES.has(code)) {
          setFatalError(message);
          return;
        }

        toast.error(message);
        return;
      }

      router.replace('/dashboard');
    } catch {
      toast.error('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Missing token guard ────────────────────────────────────────────────────
  if (!hasToken) {
    return (
      <div className="flex flex-col gap-6 text-center">
        <p className="text-sm text-[rgba(255,255,255,0.5)]">Accept invitation</p>
        <div
          role="alert"
          className="rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)] px-4 py-3 text-sm text-red-400"
        >
          This link looks incomplete. Please re-open the link from your invitation email.
        </div>
        <p className="text-sm text-[rgba(255,255,255,0.4)]">
          If the problem persists, contact your administrator for a new invite.
        </p>
        <Link
          href="/auth/login"
          className="text-sm text-[rgba(255,98,36,0.8)] transition-colors hover:text-[#ff6224]"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  // ── Fatal invitation error (expired / used / not found) ───────────────────
  if (fatalError !== null) {
    return (
      <div className="flex flex-col gap-6 text-center">
        <p className="text-sm text-[rgba(255,255,255,0.5)]">Accept invitation</p>
        <div
          role="alert"
          className="rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)] px-4 py-3 text-sm text-red-400"
        >
          {fatalError}
        </div>
        <p className="text-sm text-[rgba(255,255,255,0.4)]">
          Please contact your administrator for a new invitation link.
        </p>
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
          Set up your account to accept the invitation.
        </p>
      </div>

      {/* noValidate suppresses native browser validation — React Hook Form + Zod own it */}
      <form
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        noValidate
        className="flex flex-col gap-4"
      >
        {/* Display name */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-name" className="text-[rgba(255,255,255,0.7)]">
            Display name
          </Label>
          <Input
            id="ai-name"
            type="text"
            autoComplete="name"
            placeholder="Your name"
            aria-describedby={errors.name ? 'ai-name-error' : undefined}
            aria-invalid={!!errors.name}
            className="border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-white placeholder:text-[rgba(255,255,255,0.3)] focus-visible:ring-[#ff6224]/50"
            {...register('name')}
          />
          {errors.name && (
            <p id="ai-name-error" className="text-xs text-red-400">
              {errors.name.message}
            </p>
          )}
        </div>

        {/* Password */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-password" className="text-[rgba(255,255,255,0.7)]">
            Password
          </Label>
          <PasswordInput
            id="ai-password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            aria-describedby={errors.password ? 'ai-password-error' : undefined}
            aria-invalid={!!errors.password}
            className="border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-white placeholder:text-[rgba(255,255,255,0.3)] focus-visible:ring-[#ff6224]/50"
            {...register('password')}
          />
          {errors.password && (
            <p id="ai-password-error" className="text-xs text-red-400">
              {errors.password.message}
            </p>
          )}
        </div>

        {/* Confirm password */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-confirm" className="text-[rgba(255,255,255,0.7)]">
            Confirm password
          </Label>
          <PasswordInput
            id="ai-confirm"
            autoComplete="new-password"
            placeholder="Repeat your password"
            aria-describedby={errors.confirmPassword ? 'ai-confirm-error' : undefined}
            aria-invalid={!!errors.confirmPassword}
            className="border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-white placeholder:text-[rgba(255,255,255,0.3)] focus-visible:ring-[#ff6224]/50"
            {...register('confirmPassword')}
          />
          {errors.confirmPassword && (
            <p id="ai-confirm-error" className="text-xs text-red-400">
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        <Button type="submit" disabled={isSubmitting} size="lg" className="mt-1 w-full">
          {isSubmitting ? 'Accepting…' : 'Accept invitation'}
        </Button>
      </form>

      {/* ── Footer ── */}
      <p className="text-center text-sm text-[rgba(255,255,255,0.4)]">
        Already have an account?{' '}
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
