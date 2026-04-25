/**
 * @fileoverview Register page — email + name + password + tenant + post-registration flow.
 *
 * Visual shell is provided by `app/(auth)/layout.tsx`. This page renders:
 *   - Registration form (email, name, password via PasswordInput, tenant dropdown)
 *   - Conditional Google OAuth button
 *   - After successful registration: "Check your email" confirmation screen with
 *     a Resend button (60-second client-side cooldown, persisted in sessionStorage)
 *
 * The tenant dropdown is populated with a static list because a public tenants API
 * is not yet available.
 * TODO(P14): replace the static list with a fetch from `/api/tenants/public`.
 *
 * @layer pages/auth
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { MailOpen } from 'lucide-react';
import { useAuth } from '@bymax-one/nest-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/auth/password-input';
import { registerSchema, type RegisterFormValues } from '@/lib/schemas/auth';
import { mapAuthClientError } from '@/lib/auth-client';
import { translateAuthError } from '@/lib/auth-errors';
import { useCooldown } from '@/hooks/use-cooldown';

// TODO(P14): source tenant list from /api/tenants/public
/** Static workspace options for the tenant selector. */
const TENANT_OPTIONS: { value: string; label: string }[] = [
  { value: 'default', label: 'Default workspace' },
];

/**
 * Register page — collects credentials and tenant, then shows an email
 * verification confirmation screen on success.
 */
export default function RegisterPage() {
  const { register: authRegister } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);
  const [confirmedTenantId, setConfirmedTenantId] = useState<string>('default');

  // NEXT_PUBLIC_ vars are statically inlined by Next.js at build time
  const googleEnabled = process.env.NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED === 'true';

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: { tenantId: 'default' },
  });

  const cooldownKey = confirmedEmail ? `register:cooldown:${confirmedEmail}` : 'register:cooldown';
  const { isCoolingDown, secondsLeft, startCooldown } = useCooldown(cooldownKey, 60);

  const onSubmit = async (data: RegisterFormValues) => {
    setIsSubmitting(true);
    try {
      await authRegister({
        email: data.email,
        name: data.name,
        password: data.password,
        tenantId: data.tenantId,
      });
      // Show the email confirmation screen — no redirect until verified
      setConfirmedEmail(data.email);
      setConfirmedTenantId(data.tenantId);
      startCooldown();
    } catch (err) {
      const { code } = mapAuthClientError(err);
      toast.error(translateAuthError(code === 'UNKNOWN' ? '' : code));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!confirmedEmail || isCoolingDown) return;
    try {
      await fetch('/api/auth/resend-verification', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: confirmedEmail, tenantId: confirmedTenantId }),
      });
      startCooldown();
      toast.success('Verification email resent.');
    } catch {
      toast.error('Failed to resend verification email. Please try again.');
    }
  };

  // ── Email confirmation screen ──────────────────────────────────────────────
  if (confirmedEmail !== null) {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <div
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgba(34,197,94,0.3)] bg-[rgba(34,197,94,0.1)]"
        >
          <MailOpen className="h-7 w-7 text-green-400" />
        </div>

        <div>
          <h2 className="font-mono text-base font-semibold text-white">Check your email</h2>
          <p className="mt-1 text-sm text-[rgba(255,255,255,0.5)]">
            We sent a verification code to{' '}
            <span className="font-mono text-[rgba(255,255,255,0.8)]">{confirmedEmail}</span>.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isCoolingDown}
          onClick={() => void handleResend()}
          className="w-full"
        >
          {isCoolingDown ? `Resend in ${secondsLeft}s` : 'Resend verification email'}
        </Button>

        <p className="text-sm text-[rgba(255,255,255,0.4)]">
          Already verified?{' '}
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

  // ── Registration form ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* ── Sub-heading ── */}
      <div className="text-center">
        <p className="text-sm text-[rgba(255,255,255,0.5)]">Create your account</p>
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
            aria-describedby={errors.email ? 'reg-email-error' : undefined}
            aria-invalid={!!errors.email}
            className="border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-white placeholder:text-[rgba(255,255,255,0.3)] focus-visible:ring-[#ff6224]/50"
            {...register('email')}
          />
          {errors.email && (
            <p id="reg-email-error" className="text-xs text-red-400">
              {errors.email.message}
            </p>
          )}
        </div>

        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name" className="text-[rgba(255,255,255,0.7)]">
            Display name
          </Label>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            placeholder="Your name"
            aria-describedby={errors.name ? 'reg-name-error' : undefined}
            aria-invalid={!!errors.name}
            className="border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-white placeholder:text-[rgba(255,255,255,0.3)] focus-visible:ring-[#ff6224]/50"
            {...register('name')}
          />
          {errors.name && (
            <p id="reg-name-error" className="text-xs text-red-400">
              {errors.name.message}
            </p>
          )}
        </div>

        {/* Password */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password" className="text-[rgba(255,255,255,0.7)]">
            Password
          </Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            aria-describedby={errors.password ? 'reg-password-error' : undefined}
            aria-invalid={!!errors.password}
            className="border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-white placeholder:text-[rgba(255,255,255,0.3)] focus-visible:ring-[#ff6224]/50"
            {...register('password')}
          />
          {errors.password && (
            <p id="reg-password-error" className="text-xs text-red-400">
              {errors.password.message}
            </p>
          )}
        </div>

        {/* Tenant */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tenantId" className="text-[rgba(255,255,255,0.7)]">
            Workspace
          </Label>
          <select
            id="tenantId"
            aria-describedby={errors.tenantId ? 'reg-tenant-error' : undefined}
            aria-invalid={!!errors.tenantId}
            className="flex h-12 w-full appearance-none rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] px-5 py-2 text-sm text-white transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6224]/50"
            {...register('tenantId')}
          >
            {TENANT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-[#1a1a1a] text-white">
                {opt.label}
              </option>
            ))}
          </select>
          {errors.tenantId && (
            <p id="reg-tenant-error" className="text-xs text-red-400">
              {errors.tenantId.message}
            </p>
          )}
        </div>

        {/* Submit */}
        <Button type="submit" disabled={isSubmitting} size="lg" className="mt-1 w-full">
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      {/* ── Google OAuth (conditional) ── */}
      {googleEnabled && (
        <>
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[rgba(255,255,255,0.08)]" />
            <span className="text-xs text-[rgba(255,255,255,0.3)]">or</span>
            <div className="h-px flex-1 bg-[rgba(255,255,255,0.08)]" />
          </div>
          {/* Full-page navigation required for OAuth 302 redirect — do not use fetch */}
          <a
            href="/api/auth/oauth/google/start"
            className="flex w-full items-center justify-center gap-2 rounded-full border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-6 py-3 text-sm font-medium text-[rgba(255,255,255,0.7)] transition-colors hover:bg-[rgba(255,255,255,0.08)] hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="rgba(255,255,255,0.5)"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="rgba(255,255,255,0.4)"
              />
              <path
                d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"
                fill="rgba(255,255,255,0.3)"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83c.87-2.6 3.3-4.52 6.16-4.52z"
                fill="rgba(255,255,255,0.5)"
              />
            </svg>
            Continue with Google
          </a>
        </>
      )}

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
