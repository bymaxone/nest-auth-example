/**
 * @fileoverview Platform admin login form — email + password, bearer-mode.
 *
 * Posts to `POST /api/auth/platform/login` via `platformLogin` from `lib/auth-client`.
 * On success, persists the bearer tokens and admin record in sessionStorage
 * (via `setPlatformTokens`) then navigates to `/platform/tenants`.
 *
 * Platform sessions are always bearer-mode (no cookies set by the API for this
 * flow). The form is intentionally isolated from the tenant auth context — visiting
 * this page when a tenant dashboard session is active has no effect.
 *
 * @layer components/platform
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/auth/password-input';
import { platformLogin } from '@/lib/auth-client';
import { setPlatformTokens } from '@/lib/platform-auth';
import type { PlatformAdmin } from '@/lib/platform-auth';
import { translateAuthError } from '@/lib/auth-errors';
import { mapAuthClientError } from '@/lib/auth-client';

/** Zod schema for the platform login form — email + password. */
const platformLoginSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

/** Inferred type for the platform login form values. */
type PlatformLoginFormValues = z.infer<typeof platformLoginSchema>;

/**
 * Standalone login form for platform administrators.
 *
 * On successful authentication, the bearer tokens and admin profile are stored
 * in `sessionStorage` and the user is redirected to `/platform/tenants`.
 * Error codes are translated via `translateAuthError` and surfaced as sonner toasts.
 */
export function PlatformLoginForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PlatformLoginFormValues>({
    resolver: zodResolver(platformLoginSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const onSubmit = async (data: PlatformLoginFormValues) => {
    setIsSubmitting(true);
    try {
      const result = await platformLogin(data.email, data.password);

      if ('mfaRequired' in result) {
        // MFA challenge path — store temp token and redirect.
        sessionStorage.setItem('platform_mfa_temp_token', result.mfaTempToken);
        router.push('/platform/mfa-challenge');
        return;
      }

      // Persist bearer tokens and admin profile for all subsequent platform calls.
      setPlatformTokens(result.accessToken, result.refreshToken, result.admin as PlatformAdmin);
      router.replace('/platform/tenants');
    } catch (err) {
      const { code } = mapAuthClientError(err);
      toast.error(translateAuthError(code === 'UNKNOWN' ? '' : code));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ── Sub-heading ── */}
      <div className="text-center">
        <p className="text-sm text-[rgba(255,255,255,0.5)]">Sign in to the platform admin area</p>
      </div>

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
            placeholder="admin@example.com"
            aria-describedby={errors.email ? 'email-error' : undefined}
            aria-invalid={!!errors.email}
            className="border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-white placeholder:text-[rgba(255,255,255,0.3)] focus-visible:ring-red-500/50"
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
          <Label htmlFor="password" className="text-[rgba(255,255,255,0.7)]">
            Password
          </Label>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            placeholder="••••••••"
            aria-describedby={errors.password ? 'password-error' : undefined}
            aria-invalid={!!errors.password}
            className="border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-white placeholder:text-[rgba(255,255,255,0.3)] focus-visible:ring-red-500/50"
            {...register('password')}
          />
          {errors.password && (
            <p id="password-error" className="text-xs text-red-400">
              {errors.password.message}
            </p>
          )}
        </div>

        {/* Submit */}
        <Button
          type="submit"
          disabled={isSubmitting}
          size="lg"
          className="mt-1 w-full bg-red-900 text-red-50 hover:bg-red-800"
        >
          {isSubmitting ? 'Signing in…' : 'Sign in to Platform Admin'}
        </Button>
      </form>
    </div>
  );
}
