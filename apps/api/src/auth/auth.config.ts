/**
 * @file auth.config.ts
 * @description Factory that builds `BymaxAuthModuleOptions` from the Zod-validated
 * environment, consumed by `BymaxAuthModule.registerAsync` in Phase 7.
 *
 * Keeps configuration concerns separate from module wiring: this file answers
 * "what are the options?" while `auth.module.ts` answers "how is the module wired?".
 *
 * Security contract:
 * - Never logs secrets (JWT_SECRET, MFA_ENCRYPTION_KEY, OAuth client secrets).
 * - `tenantIdResolver` uses no `as` casts — throws on absent or empty header.
 * - `cookies.resolveDomains` is only set in production when PUBLIC_DOMAIN is defined.
 * - `oauth.google` block is only included when all three OAuth env vars are set.
 *
 * @layer auth
 * @see docs/guidelines/nest-auth-guidelines.md
 * @see docs/DEVELOPMENT_PLAN.md §Phase 6.1
 */

import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import type { BymaxAuthModuleOptions } from '@bymax-one/nest-auth';

import type { Env } from '../config/env.schema.js';
import { BLOCKED_USER_STATUSES } from './auth.constants.js';

/**
 * Builds the `BymaxAuthModuleOptions` object for `BymaxAuthModule.registerAsync`.
 *
 * Every option group directly maps to the development plan §6.1 spec. The function
 * is pure — no side effects, no logging, no secret values emitted anywhere.
 *
 * FCM rows covered: #3 (refresh grace), #5 (email verification), #13 (sessions),
 * #14 (FIFO eviction), #16 (brute-force), #18/#19 (RBAC), #20 (tenant resolver),
 * #23 (blocked statuses).
 *
 * @param config - Zod-validated `ConfigService<Env, true>`. Every required variable
 *   is guaranteed present because the app refuses to start on an invalid config.
 * @returns Fully-typed options object ready for `BymaxAuthModule.registerAsync`.
 */
export function buildAuthOptions(config: ConfigService<Env, true>): BymaxAuthModuleOptions {
  const jwtSecret = config.getOrThrow<string>('JWT_SECRET');
  const mfaEncryptionKey = config.getOrThrow<string>('MFA_ENCRYPTION_KEY');
  const passwordResetMethod = config.getOrThrow<'token' | 'otp'>('PASSWORD_RESET_METHOD');
  const nodeEnv = config.getOrThrow<string>('NODE_ENV');
  const isProduction = nodeEnv === 'production';

  // Optional OAuth vars — all three must be present to enable Google OAuth.
  const oauthClientId = config.get<string>('OAUTH_GOOGLE_CLIENT_ID');
  const oauthClientSecret = config.get<string>('OAUTH_GOOGLE_CLIENT_SECRET');
  const oauthCallbackUrl = config.get<string>('OAUTH_GOOGLE_CALLBACK_URL');

  // Optional cookie domain for multi-domain production deployments.
  const publicDomain = config.get<string>('PUBLIC_DOMAIN');

  // OAuth config is only included when all three required vars are set.
  // The Zod schema enforces mutual presence; the runtime check satisfies TS narrowing.
  const googleOauth =
    oauthClientId && oauthClientSecret && oauthCallbackUrl
      ? {
          clientId: oauthClientId,
          clientSecret: oauthClientSecret,
          callbackUrl: oauthCallbackUrl,
        }
      : undefined;

  // Cookie domain resolver — only active in production when PUBLIC_DOMAIN is set.
  // The leading dot makes the cookie valid for all sub-domains of the apex domain.
  const resolveDomains =
    isProduction && publicDomain
      ? (_requestDomain: string): string[] => [`.${publicDomain}`]
      : undefined;

  const options: BymaxAuthModuleOptions = {
    // ── JWT ──────────────────────────────────────────────────────────────────
    jwt: {
      secret: jwtSecret,
      accessExpiresIn: '15m',
      refreshExpiresInDays: 7,
      // Prevents race conditions when multiple concurrent requests arrive during
      // the token rotation window — the old token stays valid for 30 s.
      refreshGraceWindowSeconds: 30,
    },

    // ── MFA (TOTP) ───────────────────────────────────────────────────────────
    mfa: {
      encryptionKey: mfaEncryptionKey,
      issuer: 'nest-auth-example',
      recoveryCodeCount: 8,
    },

    // ── Sessions (Redis-backed, FIFO eviction) ────────────────────────────────
    sessions: {
      enabled: true,
      defaultMaxSessions: 5,
      evictionStrategy: 'fifo',
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

    // ── Cookie security ───────────────────────────────────────────────────────
    secureCookies: isProduction,

    // ── Tenant resolver ───────────────────────────────────────────────────────
    // Reads ONLY from the X-Tenant-Id header. Never from the request body.
    // No `as` cast — explicit type guard prevents silent undefined propagation.
    tenantIdResolver: (req: Request): string => {
      const id = req.headers['x-tenant-id'];
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error('Missing or invalid x-tenant-id header');
      }
      return id;
    },
  };

  // Conditionally merge oauth block — key must be absent (not undefined) when
  // OAuth is not configured, due to exactOptionalPropertyTypes: true.
  //
  // `successRedirectUrl` (lib v1.0.4+) instructs the OAuth callback to issue a
  // 302 to the configured URL after delivering cookies, instead of returning
  // the JSON response body that API/SPA consumers expect. Without it the
  // browser would land on the JSON payload — fine for fetch-based clients,
  // broken for the full-page OAuth navigation the example uses.
  //
  // The path is RELATIVE because the OAuth callback URL points to the WEB
  // origin (`localhost:3000/api/auth/oauth/google/callback`) and Next.js
  // rewrites `/api/:path*` to the NestJS API at `:4000`. From the browser's
  // perspective, the callback response (Set-Cookie + 302) comes from the web
  // origin, so the redirect to `/dashboard` is same-origin and the auth
  // cookies arrive on the destination page with zero cross-origin caveats.
  // Note: since lib v1.0.5 the default `cookies.sameSite` is `'lax'`, which
  // already permits top-level navigation cookies — but routing through the
  // web origin keeps the dev-tools timeline clean and avoids depending on
  // cross-origin SameSite semantics. The lib's startup validator accepts a
  // leading-slash path without requiring HTTPS.
  if (googleOauth) {
    options.oauth = {
      google: googleOauth,
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

  // refreshCookiePath must include the /api global prefix so the refresh_token
  // cookie (Path: /auth by default) is actually sent to /api/auth/refresh.
  // Without this, cookie-aware HTTP clients (browsers, supertest) never attach
  // the refresh_token on requests to /api/auth/refresh because the path /auth
  // does not prefix-match /api/auth/refresh per RFC 6265.
  //
  // mfaTempCookiePath (lib v1.0.9+) follows the SAME RFC 6265 logic: the lib's
  // OAuth callback plants `mfa_temp_token` and the MFA controller clears it,
  // both using this Path attribute. The lib's default is `/auth/mfa` (correct
  // when routes mount at the app root). Because main.ts calls
  // `app.setGlobalPrefix('api')`, the real challenge URL is
  // `/api/auth/mfa/challenge`, and the cookie MUST be set with Path
  // `/api/auth/mfa` — otherwise the browser drops it on the post-OAuth POST
  // and every challenge surfaces as `MFA_TEMP_TOKEN_INVALID`. The lib cannot
  // observe `setGlobalPrefix` at module construction time, so opting in here
  // is mandatory for apps that combine a global prefix with OAuth + MFA.
  if (resolveDomains) {
    options.cookies = {
      refreshCookiePath: '/api/auth',
      mfaTempCookiePath: '/api/auth/mfa',
      resolveDomains,
    };
  } else {
    options.cookies = {
      refreshCookiePath: '/api/auth',
      mfaTempCookiePath: '/api/auth/mfa',
    };
  }

  return options;
}
