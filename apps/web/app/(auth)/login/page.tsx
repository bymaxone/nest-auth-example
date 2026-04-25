/**
 * @fileoverview Login page — glassmorphism auth card.
 *
 * Visual style mirrors `ai-product-assistant`'s `LoginCard`:
 *   - Glass background: rgba(255,255,255,0.06) + backdrop-blur
 *   - Border: rgba(255,255,255,0.1), border-radius 24px
 *   - Top accent gradient line (transparent → #ff6224 → transparent)
 *   - Brand icon with orange tinted rounded container
 *   - Headline: gradient from #ff6224 to amber-200, monospace font
 *   - Email + password fields via shadcn Form / Input
 *   - Error banner when API rejects credentials
 *   - Submit button: orange gradient pill
 *
 * Uses `useAuth().login` from `@bymax-one/nest-auth/react`. MFA challenge
 * redirects to `/auth/mfa-challenge` with the temp token in sessionStorage
 * (never in a cookie or URL parameter).
 *
 * Reads `tenantId` from the `?tenant=` search param; defaults to `'default'`
 * for single-tenant / development use.
 *
 * @layer pages/auth
 */

'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@bymax-one/nest-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mapAuthClientError } from '@/lib/auth-client';

/** Zod schema for the login form — matches the server-side LoginDto. */
const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

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
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const onSubmit = async (data: LoginFormValues) => {
    setApiError(null);
    try {
      const result = await login(data.email, data.password, { tenantId });

      if ('mfaRequired' in result) {
        // Store the temp token in sessionStorage — never in a cookie or URL.
        sessionStorage.setItem('mfaTempToken', result.mfaTempToken);
        router.push('/auth/mfa-challenge');
        return;
      }

      router.push('/dashboard');
    } catch (err) {
      const { message } = mapAuthClientError(err);
      setApiError(message);
    }
  };

  const sessionExpiredReason = searchParams.get('reason') === 'session_expired';

  return (
    <div className="relative w-full max-w-[420px] overflow-hidden rounded-[24px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.06)] p-8 backdrop-blur-lg">
      {/* Top accent gradient line */}
      <div
        aria-hidden="true"
        className="bg-linear-to-r absolute left-0 right-0 top-0 h-px from-transparent via-[rgba(255,98,36,0.4)] to-transparent"
      />

      <div className="flex flex-col gap-7">
        {/* ── Header ── */}
        <div className="flex flex-col items-center gap-1">
          {/* Brand icon */}
          <div
            className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl border border-[rgba(255,98,36,0.3)] bg-[rgba(255,98,36,0.2)]"
            aria-hidden="true"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="#ff6224"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <h1 className="bg-gradient-to-r from-[#ff6224] to-amber-200 bg-clip-text font-mono text-xl font-bold text-transparent">
            nest-auth-example
          </h1>
          <p className="text-sm text-[rgba(255,255,255,0.5)]">Sign in to your account</p>
        </div>

        {/* ── Session-expired banner ── */}
        {sessionExpiredReason && (
          <div
            role="alert"
            className="rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)] px-4 py-3"
          >
            <p className="text-sm text-red-400">Your session expired. Please sign in again.</p>
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
                className="text-xs text-[rgba(255,98,36,0.8)] hover:text-[#ff6224]"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              aria-describedby={errors.password ? 'password-error' : undefined}
              className="border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-white placeholder:text-[rgba(255,255,255,0.3)] focus-visible:ring-[#ff6224]/50"
              {...register('password')}
            />
            {errors.password && (
              <p id="password-error" className="text-xs text-red-400">
                {errors.password.message}
              </p>
            )}
          </div>

          {/* API error */}
          {apiError && (
            <div
              role="alert"
              className="rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)] px-4 py-3"
            >
              <p className="text-sm text-red-400">{apiError}</p>
            </div>
          )}

          {/* Submit */}
          <Button type="submit" disabled={isSubmitting} size="lg" className="mt-1 w-full">
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        {/* ── Footer links ── */}
        <p className="text-center text-sm text-[rgba(255,255,255,0.4)]">
          New here?{' '}
          <Link href="/auth/register" className="text-[rgba(255,98,36,0.8)] hover:text-[#ff6224]">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
