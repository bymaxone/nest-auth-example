/**
 * @fileoverview Login page — email + password form with Google OAuth and MFA hand-off.
 *
 * Visual shell is provided by `app/(auth)/layout.tsx`. This page renders only
 * the sub-heading, form, and footer links inside the shared glass card.
 *
 * Flows:
 *   - Success (no MFA): `router.replace('/dashboard')`
 *   - MFA challenge: stores `mfaTempToken` in `sessionStorage` (never a cookie),
 *     then navigates to `/auth/mfa-challenge`
 *   - Error: translated via `translateAuthError` + surfaced as a `sonner` toast
 *
 * Google OAuth button is rendered only when `NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED=true`.
 * Clicking it uses a full-page navigation (`<a>`) so the browser follows the library's
 * 302 redirect — a client-side `fetch` would not work for OAuth redirects.
 *
 * Reads `tenantId` from the `?tenant=` search param; defaults to `'default'` for
 * single-tenant / development use.
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
import { useAuth } from '@bymax-one/nest-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/auth/password-input';
import { loginSchema, type LoginFormValues } from '@/lib/schemas/auth';
import { mapAuthClientError } from '@/lib/auth-client';
import { translateAuthError } from '@/lib/auth-errors';

/**
 * Login page — authenticates with email + password and navigates on success.
 *
 * On MFA challenge the temp token is stored in `sessionStorage` and the user
 * is redirected to `/auth/mfa-challenge` to complete the second factor.
 */
export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tenantId = searchParams.get('tenant') ?? 'default';
  const { login } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // NEXT_PUBLIC_ vars are statically inlined by Next.js at build time
  const googleEnabled = process.env.NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED === 'true';

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const onSubmit = async (data: LoginFormValues) => {
    setIsSubmitting(true);
    try {
      const result = await login(data.email, data.password, { tenantId });

      if ('mfaRequired' in result) {
        // Store the temp token in sessionStorage — never in a cookie or URL param
        sessionStorage.setItem('mfaTempToken', result.mfaTempToken);
        router.push('/auth/mfa-challenge');
        return;
      }

      router.replace('/dashboard');
    } catch (err) {
      const { code } = mapAuthClientError(err);
      toast.error(translateAuthError(code === 'UNKNOWN' ? '' : code));
    } finally {
      setIsSubmitting(false);
    }
  };

  const sessionExpired = searchParams.get('reason') === 'session_expired';
  const justVerified = searchParams.get('verified') === '1';
  const justReset = searchParams.get('reset') === '1';

  return (
    <div className="flex flex-col gap-6">
      {/* ── Sub-heading ── */}
      <div className="text-center">
        <p className="text-sm text-[rgba(255,255,255,0.5)]">Sign in to your account</p>
      </div>

      {/* ── Status banners ── */}
      {sessionExpired && (
        <div
          role="alert"
          className="rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)] px-4 py-3"
        >
          <p className="text-sm text-red-400">Your session expired. Please sign in again.</p>
        </div>
      )}
      {justVerified && (
        <div
          role="alert"
          className="rounded-lg border border-[rgba(34,197,94,0.3)] bg-[rgba(34,197,94,0.1)] px-4 py-3"
        >
          <p className="text-sm text-green-400">Email verified — you can now sign in.</p>
        </div>
      )}
      {justReset && (
        <div
          role="alert"
          className="rounded-lg border border-[rgba(34,197,94,0.3)] bg-[rgba(34,197,94,0.1)] px-4 py-3"
        >
          <p className="text-sm text-green-400">
            Password reset — please sign in with your new password.
          </p>
        </div>
      )}

      {/* ── Form ── */}
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
            aria-describedby={errors.email ? 'email-error' : undefined}
            aria-invalid={!!errors.email}
            className="border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-white placeholder:text-[rgba(255,255,255,0.3)] focus-visible:ring-[#ff6224]/50"
            {...register('email')}
          />
          {errors.email && (
            <p id="email-error" className="text-xs text-red-400">
              {errors.email.message}
            </p>
          )}
        </div>

        {/* Password */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-[rgba(255,255,255,0.7)]">
              Password
            </Label>
            <Link
              href="/auth/forgot-password"
              className="text-xs text-[rgba(255,98,36,0.8)] transition-colors hover:text-[#ff6224]"
            >
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            placeholder="••••••••"
            aria-describedby={errors.password ? 'password-error' : undefined}
            aria-invalid={!!errors.password}
            className="border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-white placeholder:text-[rgba(255,255,255,0.3)] focus-visible:ring-[#ff6224]/50"
            {...register('password')}
          />
          {errors.password && (
            <p id="password-error" className="text-xs text-red-400">
              {errors.password.message}
            </p>
          )}
        </div>

        {/* Submit */}
        <Button type="submit" disabled={isSubmitting} size="lg" className="mt-1 w-full">
          {isSubmitting ? 'Signing in…' : 'Sign in'}
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
        New here?{' '}
        <Link
          href="/auth/register"
          className="text-[rgba(255,98,36,0.8)] transition-colors hover:text-[#ff6224]"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
