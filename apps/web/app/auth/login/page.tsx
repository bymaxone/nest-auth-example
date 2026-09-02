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
 * Tenant picker: renders a `<select>` populated from the shared
 * {@link TENANT_OPTIONS} list (same source as the register page). The default
 * value is resolved by {@link resolveDefaultTenantSlug}, which honors an
 * incoming `?tenantId=` query param when it matches a known tenant — so a
 * welcome / invitation email that deep-links to `/auth/login?tenantId=globex`
 * pre-selects globex. The dropdown is the source of truth at submit time;
 * the URL param is only the initial default. Before submitting, the slug is
 * resolved to a CUID via `GET /api/tenants/resolve` and stashed in the
 * `tenant_id` cookie so `tenantAwareFetch` injects `X-Tenant-Id` — the API's
 * `tenantIdResolver` reads only that header.
 *
 * @layer pages/auth
 */

'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useSession } from '@bymax-one/nest-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/auth/password-input';
import { TenantLookupFailedNotice } from '@/components/auth/tenant-lookup-failed-notice';
import { loginSchema, type LoginFormValues } from '@/lib/schemas/auth';
import {
  authClient,
  mapAuthClientError,
  resolveTenantForLogin,
  resolveTenantSlugById,
  TenantNotFoundError,
} from '@/lib/auth-client';
import { translateAuthError } from '@/lib/auth-errors';
import { TENANT_OPTIONS, isKnownTenantSlug, resolveDefaultTenantSlug } from '@/lib/tenants';

/**
 * Inner form — extracted so the default export can wrap it in `<Suspense>`,
 * required because `useSearchParams()` triggers a CSR bailout during static
 * generation in Next 16.
 */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Dropdown is the source of truth at submit time; the URL param is only
  // the initial default. `resolveDefaultTenantSlug` returns the URL slug
  // when it matches a known tenant, otherwise falls back to the seed's
  // first tenant (DEFAULT_TENANT_SLUG). Reads `searchParams` only once on
  // mount — subsequent changes come from the <select> onChange handler.
  const [tenantSlug, setTenantSlug] = useState<string>(() =>
    resolveDefaultTenantSlug(searchParams.get('tenantId')),
  );
  const { refresh } = useSession();
  // Whether the workspace this page will sign into is settled. It is not while
  // a `?tenantId=` the picker does not recognise is being translated, and it is
  // not after that lookup fails — in both states the selector still shows the
  // default, and acting on it would write the wrong `tenant_id` cookie and send
  // real credentials to a workspace nobody chose. A password manager can
  // autofill and submit inside that window with no help from the user, so the
  // state is seeded from the parameter itself rather than by the effect below,
  // and it is already closed on the very first render.
  const [tenantState, setTenantState] = useState<'settled' | 'resolving' | 'failed'>(() => {
    const param = searchParams.get('tenantId');
    return param !== null && !isKnownTenantSlug(param) ? 'resolving' : 'settled';
  });
  // Bumped by the retry control so the effect runs again after a failure.
  const [tenantRequestId, setTenantRequestId] = useState(0);
  // Set when the user names the workspace themselves. A lookup already in
  // flight has no cleanup to cancel it — nothing re-runs the effect — so it
  // would otherwise land afterwards and overwrite their choice with the link's
  // workspace, silently, right before they submit.
  const userChoseTenant = useRef(false);
  const isTenantUnsettled = tenantState !== 'settled';

  // A `?tenantId=` the picker does not recognise is not a malformed link — it
  // is what every tenant-scoped email the library sends carries, because
  // `IEmailProvider` receives `Tenant.id`, not the slug. `resolveDefaultTenantSlug`
  // cannot match one against the picker's slugs, so without this it silently
  // selects the default workspace and the submit below overwrites the
  // `tenant_id` cookie with the wrong tenant — a confirmation link for Globex
  // signs the user in at Acme.
  useEffect(() => {
    const param = searchParams.get('tenantId');
    if (param === null || isKnownTenantSlug(param)) return;
    let cancelled = false;
    void (async () => {
      const slug = await resolveTenantSlugById(param);
      if (cancelled || userChoseTenant.current) return;
      if (slug === null) {
        // Unknown stays unknown. Reverting to the default here is what would
        // sign a Globex user into Acme, so the controls stay shut until either
        // a retry succeeds or the user names the workspace themselves.
        setTenantState('failed');
        return;
      }
      setTenantSlug(slug);
      setTenantState('settled');
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, tenantRequestId]);

  /** Re-runs the lookup after a failure. */
  const handleTenantRetry = useCallback(() => {
    // Asking for the lookup again withdraws the manual choice, if there was one.
    userChoseTenant.current = false;
    setTenantState('resolving');
    setTenantRequestId((id) => id + 1);
  }, []);

  /**
   * The user naming the workspace settles it as surely as a lookup would.
   *
   * Reachable for every option, including the one the picker would have shown
   * by default, because the control renders empty while unsettled.
   */
  const handleTenantChange = useCallback((slug: string) => {
    userChoseTenant.current = true;
    setTenantSlug(slug);
    setTenantState('settled');
  }, []);
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
      // Resolve slug → CUID so tenantAwareFetch can inject X-Tenant-Id.
      // tenantIdResolver on the API reads only the header, not the body.
      const tenantId = await resolveTenantForLogin(tenantSlug);
      document.cookie = `tenant_id=${tenantId}; Path=/; SameSite=Lax; Max-Age=31536000`;

      // Call the low-level client instead of `useAuth().login`. The react
      // AuthProvider's login always injects a BODY `tenantId` (falling back
      // to 'default' when the option is omitted — see the provider's
      // DEFAULT_TENANT_ID), but the API configures `tenantIdResolver`, which
      // makes the server refuse any body tenantId with 400 auth.validation.
      // The tenant travels exclusively via the X-Tenant-Id header injected by
      // `tenantAwareFetch` from the `tenant_id` cookie set above.
      const result = await authClient.login({ email: data.email, password: data.password });

      if ('mfaRequired' in result) {
        // Store the temp token in sessionStorage — never in a cookie or URL param
        sessionStorage.setItem('mfaTempToken', result.mfaTempToken);
        router.push('/auth/mfa-challenge');
        return;
      }

      // Bypassing the provider's login means its context state was not
      // updated — revalidate so the AuthProvider reflects the new session
      // before the dashboard mounts and reads it.
      await refresh();
      router.replace('/dashboard');
    } catch (err) {
      if (err instanceof TenantNotFoundError) {
        toast.error(
          `Workspace "${err.slug}" was not found. Open the link with ?tenantId=<slug> (e.g. ?tenantId=acme).`,
        );
        return;
      }
      const { code } = mapAuthClientError(err);
      toast.error(translateAuthError(code === 'UNKNOWN' ? '' : code));
    } finally {
      setIsSubmitting(false);
    }
  };

  const sessionExpired = searchParams.get('reason') === 'session_expired';
  const justVerified = searchParams.get('verified') === '1';
  const justReset = searchParams.get('reset') === '1';
  // `?error=<code>` is appended by the lib's `oauth.errorRedirectUrl` flow
  // (v1.0.7+) when the OAuth callback throws an `AuthException`. The lib
  // strips the `auth.` namespace prefix and surfaces just the suffix —
  // e.g. `auth.oauth_failed` → `?error=oauth_failed`. The toast pulls
  // the localized message via `translateAuthError`, which knows the
  // full `auth.<code>` form, so we prefix the value back to look it up.
  const oauthError = searchParams.get('error');

  useEffect(() => {
    if (oauthError !== null && oauthError.length > 0) {
      const fullCode = oauthError.startsWith('auth.') ? oauthError : `auth.${oauthError}`;
      toast.error(translateAuthError(fullCode));
    }
    // The query param is intentionally NOT cleared from the URL — if the
    // user bookmarks or shares it, the toast re-fires on revisit. That's
    // the desired UX (the error happened on the last navigation; until
    // the user acts again, the page should keep surfacing it).
  }, [oauthError]);

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
        {/* Workspace — symmetric with the register page picker. Kept outside
            React Hook Form because the slug does NOT participate in the login
            credential schema; it travels through the resolved CUID + the
            `tenant_id` cookie + the `X-Tenant-Id` header that the lib's
            `tenantIdResolver` consumes. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tenantId" className="text-[rgba(255,255,255,0.7)]">
            Workspace
          </Label>
          <select
            id="tenantId"
            // Empty while the workspace is unsettled, so the control does not
            // assert one the page has not established — and so that picking the
            // workspace it would otherwise be showing still fires `onChange`.
            // With the value pre-set to the default, choosing that same option
            // is a no-op, which left the notice offering an escape the select
            // could not deliver.
            value={isTenantUnsettled ? '' : tenantSlug}
            onChange={(e) => handleTenantChange(e.target.value)}
            className="flex h-12 w-full appearance-none rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] px-5 py-2 text-sm text-white transition-shadow duration-200 focus-visible:ring-2 focus-visible:ring-[#ff6224]/50 focus-visible:outline-none"
          >
            {isTenantUnsettled && (
              <option value="" disabled className="bg-[#1a1a1a] text-white">
                Select your workspace…
              </option>
            )}
            {TENANT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-[#1a1a1a] text-white">
                {opt.label}
              </option>
            ))}
          </select>
          {tenantState === 'failed' && <TenantLookupFailedNotice onRetry={handleTenantRetry} />}
        </div>

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
        <Button
          type="submit"
          disabled={isSubmitting || isTenantUnsettled}
          size="lg"
          className="mt-1 w-full"
        >
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
          {/* Full-page navigation required for OAuth 302 redirect — do not use fetch.
              The lib mounts the initiate endpoint at `GET /api/auth/oauth/:provider`.

              Tenant delivery: since lib v1.4.2 a `?tenantId=` query param is
              REFUSED when the API configures a `tenantIdResolver`, and a
              top-level navigation cannot carry the `X-Tenant-Id` header — so
              the handler resolves the slug to the tenant's CUID and stores it
              in the `tenant_id` cookie BEFORE navigating; the API resolver
              falls back to that cookie for navigation flows. The lib uses the
              resolved value verbatim as the FK on `User.tenantId` (Tenant.id
              is a CUID, not the slug), so the slug must be resolved first.

              Disabled while the workspace is unsettled, for the same reason the
              submit is: the handler resolves whatever slug the picker currently
              shows, so a click before the link's workspace is known starts
              OAuth in the default one and writes its cookie.

              A button, deliberately, not a link: the resolve is asynchronous,
              so the destination is only correct once it has finished. An
              anchor offers the browser a native path to that URL — middle
              click, "open in new tab", a restored session — that runs no
              handler and would arrive with no tenant cookie, or worse, with a
              stale one pointing at a different workspace. There is no href
              that is right before the resolve, so there is no href. */}
          <button
            type="button"
            disabled={isTenantUnsettled}
            onClick={() => {
              void (async () => {
                try {
                  const tenantId = await resolveTenantForLogin(tenantSlug);
                  document.cookie = `tenant_id=${tenantId}; Path=/; SameSite=Lax; Max-Age=31536000`;
                  window.location.assign('/api/auth/oauth/google');
                } catch (err) {
                  if (err instanceof TenantNotFoundError) {
                    toast.error(
                      `Workspace "${err.slug}" was not found. Open the link with ?tenantId=<slug> (e.g. ?tenantId=acme).`,
                    );
                    return;
                  }
                  toast.error('Could not start Google sign-in. Please try again.');
                }
              })();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-6 py-3 text-sm font-medium text-[rgba(255,255,255,0.7)] transition-colors hover:bg-[rgba(255,255,255,0.08)] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
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
          </button>
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

/**
 * Login page — authenticates with email + password and navigates on success.
 *
 * On MFA challenge the temp token is stored in `sessionStorage` and the user
 * is redirected to `/auth/mfa-challenge` to complete the second factor.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
