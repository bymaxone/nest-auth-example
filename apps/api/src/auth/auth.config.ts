/**
 * @file auth.config.ts
 * @description Factory that builds `BymaxAuthModuleOptions` from the Zod-validated
 * environment, consumed by `BymaxAuthModule.registerAsync`.
 *
 * Keeps configuration concerns separate from module wiring: this file answers
 * "what are the options?" while `auth.module.ts` answers "how is the module wired?".
 *
 * `buildAuthOptions` is the assembler. The option surface is large and almost
 * entirely declarative, so it is grouped into focused builders — credentials,
 * account flows, tenancy, OAuth, cookies — each of which owns one slice and can
 * be read without scrolling past the others.
 *
 * Security contract:
 * - Never logs secrets (JWT_SECRET, MFA_ENCRYPTION_KEY, OAuth client secrets).
 * - `resolveTenantId` uses no `as` casts — throws on absent or empty header.
 * - `cookies.resolveDomains` is only set in production when PUBLIC_DOMAIN is defined.
 * - `oauth.google` block is only included when all three OAuth env vars are set.
 *
 * @layer auth
 * @see docs/guidelines/nest-auth-guidelines.md
 */

import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import type { BymaxAuthModuleOptions } from '@bymax-one/nest-auth';

import type { Env } from '../config/env.schema.js';
import { BLOCKED_USER_STATUSES } from './auth.constants.js';

/** Google OAuth credentials, present only when all three env vars are set. */
interface GoogleOauthCredentials {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

/**
 * Resolves the acting tenant for a request.
 *
 * Never reads the request body (since lib v1.4.2 a body `tenantId` is refused
 * outright when a resolver is configured). Sources, in order:
 *   1. `X-Tenant-Id` header — every fetch()-based call (the web client injects
 *      it from the `tenant_id` cookie).
 *   2. `tenant_id` cookie — top-level navigations that cannot carry a custom
 *      header: the OAuth initiate/callback GETs. The pages set the cookie
 *      (resolved tenant CUID) before navigating. The cookie is a tenant
 *      SELECTOR, not a credential — authorization still comes from the auth
 *      cookies/tokens, and every query stays tenant-scoped.
 *
 * No `as` cast — explicit type guards prevent silent undefined propagation.
 *
 * @param req - The inbound Express request.
 * @returns The tenant id.
 * @throws `Error` when neither source carries a non-empty tenant id.
 */
function resolveTenantId(req: Request): string {
  const headerId = req.headers['x-tenant-id'];
  if (typeof headerId === 'string' && headerId.length > 0) {
    return headerId;
  }
  const cookieId: unknown = req.cookies?.['tenant_id'];
  if (typeof cookieId === 'string' && cookieId.length > 0) {
    return cookieId;
  }
  throw new Error('Missing tenant: no X-Tenant-Id header and no tenant_id cookie');
}

/**
 * Credential and access-control options: JWT lifetimes, password policy, the
 * per-IP rate limiter, and TOTP.
 *
 * @param params - Validated secrets plus the rate-limiter kill switch.
 * @returns The credential slice of the module options.
 */
function buildCredentialOptions(params: {
  jwtSecret: string;
  mfaEncryptionKey: string;
  throttleDisabled: boolean;
}): Pick<BymaxAuthModuleOptions, 'jwt' | 'password' | 'rateLimit' | 'mfa'> {
  const { jwtSecret, mfaEncryptionKey, throttleDisabled } = params;
  return {
    // ── JWT ──────────────────────────────────────────────────────────────────
    jwt: {
      secret: jwtSecret,
      accessExpiresIn: '15m',
      refreshExpiresInDays: 7,
      // Prevents race conditions when multiple concurrent requests arrive during
      // the token rotation window — the old token stays valid for 30 s.
      refreshGraceWindowSeconds: 30,
      // Hard cap on total session age: no refresh chain can outlive 30 days,
      // regardless of activity. This is also the library maximum.
      absoluteSessionLifetimeDays: 30,
    },

    // ── Password policy ──────────────────────────────────────────────────────
    // The library default floor is 15 characters (NIST-aligned); stated
    // explicitly here so readers see where to tune it. `blocklist` feeds the
    // offline CommonPasswordChecker with deployment-specific words that would
    // otherwise pass the global top-10k list.
    password: {
      minLength: 15,
      blocklist: ['nest-auth-example', 'bymax'],
    },

    // ── Per-IP rate limiting (library-enforced) ──────────────────────────────
    // `clientIpSource: 'peer'` charges the socket peer address — correct when
    // clients reach the API directly (dev, e2e). Behind a reverse proxy that
    // terminates client connections, switch to 'trusted-proxy' AND configure
    // Express `trust proxy`, otherwise every client shares the proxy's bucket.
    // AUTH_THROTTLE_DISABLED=true turns the limiter off for load/e2e tooling.
    rateLimit: throttleDisabled ? { enabled: false } : { enabled: true, clientIpSource: 'peer' },

    // ── MFA (TOTP) ───────────────────────────────────────────────────────────
    mfa: {
      encryptionKey: mfaEncryptionKey,
      issuer: 'nest-auth-example',
      recoveryCodeCount: 8,
      // Accept one 30 s TOTP step of clock drift on either side (library default,
      // stated explicitly; startup-validated to 0..=10).
      totpWindow: 1,
    },
  };
}

/**
 * Account-lifecycle options: session storage, brute-force lockout, and the
 * password-reset / email-verification / email-change token flows.
 *
 * @param passwordResetMethod - Validated `PASSWORD_RESET_METHOD`.
 * @returns The account-flow slice of the module options.
 */
function buildAccountFlowOptions(
  passwordResetMethod: 'token' | 'otp',
): Pick<
  BymaxAuthModuleOptions,
  'sessions' | 'bruteForce' | 'passwordReset' | 'emailVerification' | 'emailChange'
> {
  return {
    // ── Sessions (Redis-backed, FIFO eviction) ────────────────────────────────
    sessions: {
      enabled: true,
      defaultMaxSessions: 5,
    },

    // ── Brute-force protection ────────────────────────────────────────────────
    bruteForce: {
      maxAttempts: 5,
      windowSeconds: 15 * 60, // 15-minute sliding window
    },

    // ── Password reset ────────────────────────────────────────────────────────
    passwordReset: {
      method: passwordResetMethod,
      tokenTtlSeconds: 10 * 60, // 10 minutes
      otpTtlSeconds: 10 * 60, // 10 minutes
      otpLength: 6,
    },

    // ── Email verification ────────────────────────────────────────────────────
    emailVerification: {
      required: true,
      otpTtlSeconds: 10 * 60, // 10 minutes
    },

    // ── Email change ─────────────────────────────────────────────────────────
    // Two-step address change (lib v1.1.0+): POST /auth/email/change re-proves
    // the current password and mails a single-use token to the NEW address;
    // POST /auth/email/change/confirm completes it. Requires the email
    // provider to implement `sendEmailChangeVerification` (boot refusal
    // otherwise) and `controllers.emailChange: true` in auth.module.ts.
    emailChange: {
      tokenTtlSeconds: 10 * 60, // 10 minutes — same window as password reset
    },
  };
}

/**
 * Tenancy, RBAC, and infrastructure naming — all static, none env-derived.
 *
 * @returns The tenancy slice of the module options.
 */
function buildTenancyOptions(): Pick<
  BymaxAuthModuleOptions,
  'platform' | 'invitations' | 'roles' | 'blockedStatuses' | 'redisNamespace' | 'routePrefix'
> {
  return {
    // ── Platform admin (FCM #22 — Platform admin context) ────────────────────
    // Enables JwtPlatformGuard, PlatformRolesGuard, and the platform auth routes
    // under /api/auth/platform/*. Platform users never appear in tenant queries.
    platform: { enabled: true },

    // ── Invitations (FCM #21) ─────────────────────────────────────────────────
    // Token TTL of 48 h gives invitees a business-day window to accept.
    invitations: {
      enabled: true,
      tokenTtlSeconds: 172_800, // 48 hours
    },

    // ── RBAC role hierarchy ───────────────────────────────────────────────────
    // Hierarchy is fully denormalized: each role lists ALL roles it transitively
    // subsumes. hasRole() performs a single-level lookup, not recursive traversal.
    roles: {
      hierarchy: {
        OWNER: ['ADMIN', 'MEMBER', 'VIEWER'],
        ADMIN: ['MEMBER', 'VIEWER'],
        MEMBER: ['VIEWER'],
        VIEWER: [],
      },
      platformHierarchy: {
        SUPER_ADMIN: ['SUPPORT'],
        SUPPORT: [],
      },
    },

    // ── Statuses that block login ─────────────────────────────────────────────
    // BLOCKED_USER_STATUSES is the single source of truth — imported here so
    // the credential path and the OAuth path always enforce the same set.
    blockedStatuses: [...BLOCKED_USER_STATUSES],

    // ── Redis namespace ───────────────────────────────────────────────────────
    // All library-owned keys are prefixed with this namespace. App-owned keys
    // live under `nest-auth-example:app:*` — see redis-guidelines.md.
    redisNamespace: 'nest-auth-example',

    // ── Route prefix ─────────────────────────────────────────────────────────
    // Combined with the global `/api` prefix in main.ts → final: /api/auth/*
    routePrefix: 'auth',
  };
}

/**
 * OAuth options for the Google provider.
 *
 * Included only when all three OAuth env vars are set; the key must be absent
 * (not merely undefined) otherwise, due to `exactOptionalPropertyTypes: true`.
 *
 * `successRedirectUrl` (lib v1.0.4+) instructs the OAuth callback to issue a
 * 302 to the configured URL after delivering cookies, instead of returning
 * the JSON response body that API/SPA consumers expect. Without it the
 * browser would land on the JSON payload — fine for fetch-based clients,
 * broken for the full-page OAuth navigation the example uses.
 *
 * The path is RELATIVE because the OAuth callback URL points to the WEB
 * origin (`localhost:3000/api/auth/oauth/google/callback`) and Next.js
 * rewrites `/api/:path*` to the NestJS API at `:4000`. From the browser's
 * perspective, the callback response (Set-Cookie + 302) comes from the web
 * origin, so the redirect to `/dashboard` is same-origin and the auth
 * cookies arrive on the destination page with zero cross-origin caveats.
 * Note: since lib v1.0.5 the default `cookies.sameSite` is `'lax'`, which
 * already permits top-level navigation cookies — but routing through the
 * web origin keeps the dev-tools timeline clean and avoids depending on
 * cross-origin SameSite semantics. The lib's startup validator accepts a
 * leading-slash path without requiring HTTPS.
 *
 * @param google - Verified Google client credentials.
 * @returns The `oauth` option block.
 */
function buildOauthOptions(
  google: GoogleOauthCredentials,
): NonNullable<BymaxAuthModuleOptions['oauth']> {
  return {
    google,
    successRedirectUrl: '/dashboard',
    // `mfaRedirectUrl` (lib v1.0.7+) — destination when the OAuth-resolved
    // user has MFA enabled. Without this, an MFA-enabled user who signs in
    // via Google would receive session cookies with `mfaVerified: false`,
    // which the global `MfaRequiredGuard` rejects on every subsequent
    // request — leaving the user locked out with no surfaced path forward.
    //
    // With this option set, the lib instead plants a short-lived
    // `mfa_temp_token` HttpOnly cookie (Path scoped to `/api/auth/mfa`,
    // 5-minute Max-Age) and 302s here. The `/auth/mfa-challenge` page
    // POSTs to `/api/auth/mfa/challenge` with just `{ code }` — the lib
    // reads the temp token from the cookie automatically. The `?source=oauth`
    // query param tells the page to skip its sessionStorage read and use
    // the cookie-only flow.
    mfaRedirectUrl: '/auth/mfa-challenge?source=oauth',
    // `errorRedirectUrl` (lib v1.0.7+) — destination when the OAuth
    // callback throws an `AuthException` (provider error, hook reject,
    // invalid state, etc.). The lib appends `?error=<code>` (e.g.
    // `?error=oauth_failed`) preserving any existing query params.
    // Without this, the browser sees a raw JSON 500.
    errorRedirectUrl: '/auth/login',
  };
}

/**
 * Cookie options — paths, trusted origins, and the optional domain resolver.
 *
 * refreshCookiePath must include the /api global prefix so the refresh_token
 * cookie (Path: /auth by default) is actually sent to /api/auth/refresh.
 * Without this, cookie-aware HTTP clients (browsers, supertest) never attach
 * the refresh_token on requests to /api/auth/refresh because the path /auth
 * does not prefix-match /api/auth/refresh per RFC 6265.
 *
 * mfaTempCookiePath (lib v1.0.9+) follows the SAME RFC 6265 logic: the lib's
 * OAuth callback plants `mfa_temp_token` and the MFA controller clears it,
 * both using this Path attribute. The lib's default is `/auth/mfa` (correct
 * when routes mount at the app root). Because main.ts calls
 * `app.setGlobalPrefix('api')`, the real challenge URL is
 * `/api/auth/mfa/challenge`, and the cookie MUST be set with Path
 * `/api/auth/mfa` — otherwise the browser drops it on the post-OAuth POST
 * and every challenge surfaces as `MFA_TEMP_TOKEN_INVALID`. The lib cannot
 * observe `setGlobalPrefix` at module construction time, so opting in here
 * is mandatory for apps that combine a global prefix with OAuth + MFA.
 * `trustedOrigins` arms the library's TrustedOriginGuard: cookie-authenticated
 * write requests must carry an Origin/Referer from this allowlist or they are
 * refused with `auth.untrusted_origin` — CSRF defence in depth on top of
 * SameSite=Lax (the default since lib v1.0.5).
 *
 * @param webOrigin - Validated `WEB_ORIGIN`, the sole trusted origin.
 * @param resolveDomains - Domain resolver, set only in production with PUBLIC_DOMAIN.
 * @returns The `cookies` option block.
 */
function buildCookieOptions(
  webOrigin: string,
  resolveDomains: ((requestDomain: string) => string[]) | undefined,
): NonNullable<BymaxAuthModuleOptions['cookies']> {
  const base = {
    refreshCookiePath: '/api/auth',
    mfaTempCookiePath: '/api/auth/mfa',
    trustedOrigins: [webOrigin],
  };
  // The key must be absent, not undefined, under exactOptionalPropertyTypes.
  return resolveDomains ? { ...base, resolveDomains } : base;
}

/**
 * Reads the three Google OAuth env vars, all-or-nothing.
 *
 * The Zod schema already enforces mutual presence; the runtime check is what
 * narrows the three `string | undefined` reads to `string` for the caller.
 *
 * @param config - Zod-validated `ConfigService`.
 * @returns The credentials, or undefined when OAuth is not configured.
 */
function resolveGoogleOauth(config: ConfigService<Env, true>): GoogleOauthCredentials | undefined {
  const clientId = config.get<string>('OAUTH_GOOGLE_CLIENT_ID');
  const clientSecret = config.get<string>('OAUTH_GOOGLE_CLIENT_SECRET');
  const callbackUrl = config.get<string>('OAUTH_GOOGLE_CALLBACK_URL');

  return clientId && clientSecret && callbackUrl
    ? { clientId, clientSecret, callbackUrl }
    : undefined;
}

/**
 * Builds the `BymaxAuthModuleOptions` object for `BymaxAuthModule.registerAsync`.
 *
 * The function is pure — no side effects, no logging, no secret values emitted anywhere.
 *
 * @param config - Zod-validated `ConfigService<Env, true>`. Every required variable
 *   is guaranteed present because the app refuses to start on an invalid config.
 * @returns Fully-typed options object ready for `BymaxAuthModule.registerAsync`.
 */
export function buildAuthOptions(config: ConfigService<Env, true>): BymaxAuthModuleOptions {
  const nodeEnv = config.getOrThrow<'production' | 'development' | 'test'>('NODE_ENV');
  const isProduction = nodeEnv === 'production';
  const webOrigin = config.getOrThrow<string>('WEB_ORIGIN');
  // ConfigService reads LIVE process.env strings (config.module.ts deliberately
  // skips the `validate` transform), so the Zod boolean coercion never applies
  // here — compare the string form, exactly like app.module.ts does for the
  // ThrottlerGuard. A `=== true` comparison would silently never disable.
  const throttleDisabled = String(config.get('AUTH_THROTTLE_DISABLED')) === 'true';

  const googleOauth = resolveGoogleOauth(config);

  // Cookie domain resolver — only active in production when PUBLIC_DOMAIN is set.
  // The leading dot makes the cookie valid for all sub-domains of the apex domain.
  const publicDomain = config.get<string>('PUBLIC_DOMAIN');
  const resolveDomains =
    isProduction && publicDomain
      ? (_requestDomain: string): string[] => [`.${publicDomain}`]
      : undefined;

  const options: BymaxAuthModuleOptions = {
    // Explicit environment declaration — the library defaults to 'production'
    // (fail-secure) and never sniffs NODE_ENV. Drives cookie hardening and
    // development-only diagnostics.
    environment: nodeEnv,
    ...buildCredentialOptions({
      jwtSecret: config.getOrThrow<string>('JWT_SECRET'),
      mfaEncryptionKey: config.getOrThrow<string>('MFA_ENCRYPTION_KEY'),
      throttleDisabled,
    }),
    ...buildAccountFlowOptions(config.getOrThrow<'token' | 'otp'>('PASSWORD_RESET_METHOD')),
    ...buildTenancyOptions(),
    secureCookies: isProduction,
    tenantIdResolver: resolveTenantId,
    cookies: buildCookieOptions(webOrigin, resolveDomains),
  };

  if (googleOauth) {
    options.oauth = buildOauthOptions(googleOauth);
  }

  return options;
}
