/**
 * @file build-auth-options.spec.ts
 * @description Unit tests for `buildAuthOptions` in `auth.config.ts`.
 *
 * `buildAuthOptions` is a pure factory that reads Zod-validated env vars via
 * `ConfigService` and produces a `BymaxAuthModuleOptions` object. Tests exercise
 * every branch:
 *   - Minimal config (no OAuth, non-production, no PUBLIC_DOMAIN)
 *   - All three OAuth vars present → `options.oauth.google` is set
 *   - OAuth vars absent → `options.oauth` key is absent entirely
 *   - Production + PUBLIC_DOMAIN → `options.cookies.resolveDomains` resolves correctly
 *   - Non-production → `options.cookies` key is absent entirely
 *   - `tenantIdResolver`: valid header / empty-string header / missing header
 *
 * No I/O, no NestJS module bootstrap — the function is instantiated directly.
 *
 * @layer test
 * @see apps/api/src/auth/auth.config.ts
 */

import type { Request } from 'express';
import { jest } from '@jest/globals';
import { buildAuthOptions } from './auth.config.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a minimal `ConfigService`-shaped stub. `getOrThrow` resolves known keys;
 * `get` returns `undefined` by default unless an override is provided.
 *
 * @param overrides - Key → value pairs that replace the defaults for this test.
 */
function makeConfig(overrides: Record<string, string | undefined> = {}) {
  const defaults: Record<string, string> = {
    JWT_SECRET: 'test-jwt-secret-value-that-is-long-enough-for-the-schema',
    MFA_ENCRYPTION_KEY: Buffer.alloc(32).fill('k').toString('base64'),
    PASSWORD_RESET_METHOD: 'token',
    NODE_ENV: 'test',
  };

  const merged: Record<string, string | undefined> = { ...defaults, ...overrides };

  return {
    getOrThrow: jest.fn((key: string): string => {
      const val = merged[key];
      if (val === undefined) throw new Error(`Missing required config key: ${key}`);
      return val;
    }),
    get: jest.fn((key: string): string | undefined => merged[key]),
  };
}

/**
 * Builds a minimal Express `Request` stub with only the `headers` field populated.
 *
 * @param headers - Header key → value map for the request.
 */
function makeRequest(headers: Record<string, string | undefined>): Request {
  return { headers } as unknown as Request;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('buildAuthOptions', () => {
  // ── Minimal config ─────────────────────────────────────────────────────────

  describe('minimal non-production config (no OAuth, no PUBLIC_DOMAIN)', () => {
    it('returns a complete options object with the expected static fields', () => {
      // The baseline non-production config must produce valid options with all
      // required top-level keys so the module can register without throwing.
      const config = makeConfig();

      const options = buildAuthOptions(config as never);

      expect(options.jwt.secret).toBe('test-jwt-secret-value-that-is-long-enough-for-the-schema');
      expect(options.jwt.accessExpiresIn).toBe('15m');
      expect(options.jwt.refreshExpiresInDays).toBe(7);
      // mfa, sessions, bruteForce, passwordReset, emailVerification are typed as
      // optional in BymaxAuthModuleOptions but buildAuthOptions always sets them.
      // We use optional chaining + toBeDefined() to prove presence without casting.
      expect(options.mfa).toBeDefined();
      expect(options.mfa?.issuer).toBe('nest-auth-example');
      expect(options.sessions).toBeDefined();
      expect(options.sessions?.enabled).toBe(true);
      expect(options.sessions?.evictionStrategy).toBe('fifo');
      expect(options.bruteForce).toBeDefined();
      expect(options.bruteForce?.maxAttempts).toBe(5);
      expect(options.passwordReset).toBeDefined();
      expect(options.passwordReset?.method).toBe('token');
      expect(options.emailVerification).toBeDefined();
      expect(options.emailVerification?.required).toBe(true);
      expect(options.platform?.enabled).toBe(true);
      expect(options.invitations?.enabled).toBe(true);
      expect(options.redisNamespace).toBe('nest-auth-example');
      expect(options.routePrefix).toBe('auth');
      expect(options.secureCookies).toBe(false);
    });

    it('does not include the oauth key when no OAuth env vars are provided', () => {
      // exactOptionalPropertyTypes: key must be absent — not set to undefined.
      // An absent oauth key means the library does not register the Google strategy.
      const config = makeConfig();

      const options = buildAuthOptions(config as never);

      expect('oauth' in options).toBe(false);
    });

    it('does not set cookies.resolveDomains in non-production without PUBLIC_DOMAIN', () => {
      // cookies.refreshCookiePath is always set (required for all envs so the
      // refresh_token cookie reaches /api/auth/refresh). What is env-gated is
      // resolveDomains — it must be absent outside production.
      const config = makeConfig();

      const options = buildAuthOptions(config as never);

      expect(options.cookies).toBeDefined();
      expect(options.cookies?.resolveDomains).toBeUndefined();
    });
  });

  // ── OAuth present ──────────────────────────────────────────────────────────

  describe('OAuth configuration', () => {
    it('includes options.oauth.google when all three OAuth env vars are set', () => {
      // FCM #11 — Google OAuth is only active when client ID, secret, and callback
      // URL are all present. A partial set is rejected by the Zod schema; the
      // runtime check here is a belt-and-suspenders narrowing guard.
      const config = makeConfig({
        OAUTH_GOOGLE_CLIENT_ID: 'gid.apps.googleusercontent.com',
        OAUTH_GOOGLE_CLIENT_SECRET: 'GOCSPX-secret',
        OAUTH_GOOGLE_CALLBACK_URL: 'http://localhost:4000/auth/google/callback',
      });

      const options = buildAuthOptions(config as never);

      expect(options.oauth).toBeDefined();
      expect(options.oauth?.google).toEqual({
        clientId: 'gid.apps.googleusercontent.com',
        clientSecret: 'GOCSPX-secret',
        callbackUrl: 'http://localhost:4000/auth/google/callback',
      });
    });

    it('sets options.oauth.successRedirectUrl to "/dashboard" when OAuth is configured', () => {
      // Lib v1.0.4 added `oauth.successRedirectUrl` so the OAuth callback can
      // redirect the browser instead of returning JSON. The example pins it to
      // the relative `/dashboard` path — combined with an OAuth callback URL
      // that points to the web origin (Next.js rewrites `/api/:path*` to the
      // NestJS API), the redirect stays same-origin and the auth cookies
      // travel without SameSite=Strict tripping on a cross-port hop. The
      // lib's startup validator rejects this option when paired with
      // `tokenDelivery: 'bearer'` — the example uses the default `cookie`
      // mode, which makes the redirect safe.
      const config = makeConfig({
        OAUTH_GOOGLE_CLIENT_ID: 'gid.apps.googleusercontent.com',
        OAUTH_GOOGLE_CLIENT_SECRET: 'GOCSPX-secret',
        OAUTH_GOOGLE_CALLBACK_URL: 'http://localhost:3000/api/auth/oauth/google/callback',
      });

      const options = buildAuthOptions(config as never);

      expect(options.oauth?.successRedirectUrl).toBe('/dashboard');
    });

    it('sets options.oauth.mfaRedirectUrl to "/auth/mfa-challenge?source=oauth" when OAuth is configured', () => {
      /*
       * Scenario: lib v1.0.7 introduced `oauth.mfaRedirectUrl`. With OAuth
       * configured, the example must wire it so an MFA-enabled user signing
       * in via Google lands on `/auth/mfa-challenge?source=oauth` instead of
       * receiving a session JWT with `mfaVerified: false` (which would be
       * rejected by `MfaRequiredGuard` on every subsequent request). The
       * `?source=oauth` query param tells the page to use the
       * cookie-driven challenge flow instead of the sessionStorage one.
       * Protects: the wiring at `auth.config.ts:198` that closes the v1.0.6
       * lockout bug for OAuth + MFA users.
       */
      const config = makeConfig({
        OAUTH_GOOGLE_CLIENT_ID: 'gid.apps.googleusercontent.com',
        OAUTH_GOOGLE_CLIENT_SECRET: 'GOCSPX-secret',
        OAUTH_GOOGLE_CALLBACK_URL: 'http://localhost:3000/api/auth/oauth/google/callback',
      });

      const options = buildAuthOptions(config as never);

      expect(options.oauth?.mfaRedirectUrl).toBe('/auth/mfa-challenge?source=oauth');
    });

    it('sets options.oauth.errorRedirectUrl to "/auth/login" when OAuth is configured', () => {
      /*
       * Scenario: lib v1.0.7 introduced `oauth.errorRedirectUrl`. The example
       * pins it to `/auth/login` so any `AuthException` thrown during the
       * OAuth callback (provider failure, hook reject, invalid state, etc.)
       * resolves to a 302 to that URL with `?error=<code>` appended — the
       * login page already reads `?error=<code>` and surfaces a toast. Without
       * this option, the browser would land on a raw JSON 500 response.
       */
      const config = makeConfig({
        OAUTH_GOOGLE_CLIENT_ID: 'gid.apps.googleusercontent.com',
        OAUTH_GOOGLE_CLIENT_SECRET: 'GOCSPX-secret',
        OAUTH_GOOGLE_CALLBACK_URL: 'http://localhost:3000/api/auth/oauth/google/callback',
      });

      const options = buildAuthOptions(config as never);

      expect(options.oauth?.errorRedirectUrl).toBe('/auth/login');
    });

    it('omits options.oauth when OAUTH_GOOGLE_CLIENT_ID is absent', () => {
      // A partial OAuth config (secret without ID) must not produce a google
      // block — the missing ID check prevents an incomplete strategy registration.
      const config = makeConfig({
        OAUTH_GOOGLE_CLIENT_SECRET: 'GOCSPX-secret',
        OAUTH_GOOGLE_CALLBACK_URL: 'http://localhost:4000/auth/google/callback',
      });

      const options = buildAuthOptions(config as never);

      expect('oauth' in options).toBe(false);
    });

    it('omits options.oauth when only OAUTH_GOOGLE_CLIENT_ID is set (no secret)', () => {
      // ID without secret is equally incomplete — the oauth key must be absent.
      const config = makeConfig({
        OAUTH_GOOGLE_CLIENT_ID: 'gid.apps.googleusercontent.com',
      });

      const options = buildAuthOptions(config as never);

      expect('oauth' in options).toBe(false);
    });
  });

  // ── Production cookies ─────────────────────────────────────────────────────

  describe('cookies.resolveDomains (production + PUBLIC_DOMAIN)', () => {
    it('sets cookies.resolveDomains in production when PUBLIC_DOMAIN is provided', () => {
      // FCM #20 — In production, cookies must be valid for all sub-domains of the
      // apex domain. resolveDomains is the library hook that controls this.
      const config = makeConfig({
        NODE_ENV: 'production',
        PUBLIC_DOMAIN: 'example.com',
      });

      const options = buildAuthOptions(config as never);

      expect(options.cookies).toBeDefined();
      expect(typeof options.cookies?.resolveDomains).toBe('function');
    });

    it('resolveDomains returns [".example.com"] for any request domain in production', () => {
      // The leading dot is required for sub-domain coverage. The resolver ignores
      // the request domain and always returns the apex-based wildcard entry.
      const config = makeConfig({
        NODE_ENV: 'production',
        PUBLIC_DOMAIN: 'example.com',
      });

      const options = buildAuthOptions(config as never);
      // resolveDomains is typed as optional inside cookies — use optional chaining.
      // We already verified cookies is defined via the prior test; here we call it.
      const resolve = options.cookies?.resolveDomains;
      expect(typeof resolve).toBe('function');

      // Optional chaining prevents TS2722 ("cannot invoke possibly undefined").
      expect(resolve?.('app.example.com')).toEqual(['.example.com']);
      expect(resolve?.('other.example.com')).toEqual(['.example.com']);
    });

    it('does not set cookies.resolveDomains when production but PUBLIC_DOMAIN is absent', () => {
      // Without PUBLIC_DOMAIN there is no apex domain to scope cookies to —
      // resolveDomains must be absent so the library uses its single-domain default.
      const config = makeConfig({ NODE_ENV: 'production' });

      const options = buildAuthOptions(config as never);

      expect(options.cookies).toBeDefined();
      expect(options.cookies?.resolveDomains).toBeUndefined();
    });

    it('does not set cookies.resolveDomains when PUBLIC_DOMAIN is set but NODE_ENV is not production', () => {
      // resolveDomains is only meaningful in production. In dev/test it must
      // remain absent to avoid unintended wildcard-domain cookies locally.
      const config = makeConfig({
        NODE_ENV: 'development',
        PUBLIC_DOMAIN: 'example.com',
      });

      const options = buildAuthOptions(config as never);

      expect(options.cookies).toBeDefined();
      expect(options.cookies?.resolveDomains).toBeUndefined();
    });
  });

  // ── tenantIdResolver ───────────────────────────────────────────────────────

  describe('tenantIdResolver', () => {
    it('returns the x-tenant-id header value when a non-empty string is provided', () => {
      // Multi-tenancy contract: the resolver reads ONLY from the header and returns
      // the raw value without any transformation or fallback.
      const config = makeConfig();

      const options = buildAuthOptions(config as never);
      // tenantIdResolver is typed as optional in BymaxAuthModuleOptions but
      // buildAuthOptions always sets it — assert presence before calling.
      expect(options.tenantIdResolver).toBeDefined();
      const req = makeRequest({ 'x-tenant-id': 'tenant-cuid-001' });

      expect(options.tenantIdResolver?.(req)).toBe('tenant-cuid-001');
    });

    it('throws when x-tenant-id header is an empty string', () => {
      // An empty-string header is treated as absent — the caller must send a real
      // tenant ID. Empty values must never silently resolve to an unexpected tenant.
      const config = makeConfig();

      const options = buildAuthOptions(config as never);
      const resolver = options.tenantIdResolver;
      expect(resolver).toBeDefined();
      const req = makeRequest({ 'x-tenant-id': '' });

      // Wrap in arrow to avoid "cannot invoke possibly undefined" without assertions.
      expect(() => resolver?.(req)).toThrow('Missing or invalid x-tenant-id header');
    });

    it('throws when x-tenant-id header is entirely absent', () => {
      // A missing header is a hard error — tenant-less requests must never be
      // silently routed to any tenant, preventing cross-tenant data leakage.
      const config = makeConfig();

      const options = buildAuthOptions(config as never);
      const resolver = options.tenantIdResolver;
      expect(resolver).toBeDefined();
      const req = makeRequest({});

      expect(() => resolver?.(req)).toThrow('Missing or invalid x-tenant-id header');
    });

    it('throws when x-tenant-id is a string array (multi-value header)', () => {
      // HTTP allows duplicate headers, which express parses as an array. The
      // resolver requires a single string — an array must be treated as invalid
      // to prevent resolving to an ambiguous or attacker-chosen tenant.
      const config = makeConfig();

      const options = buildAuthOptions(config as never);
      const resolver = options.tenantIdResolver;
      expect(resolver).toBeDefined();
      // Cast is intentional: simulates what express does with duplicate headers.
      const req = makeRequest({
        'x-tenant-id': ['acme', 'evil'] as unknown as string,
      });

      expect(() => resolver?.(req)).toThrow('Missing or invalid x-tenant-id header');
    });
  });

  // ── blockedStatuses ────────────────────────────────────────────────────────

  describe('blockedStatuses', () => {
    it('includes BANNED, INACTIVE, and SUSPENDED in the blocked statuses array', () => {
      // FCM #23 — The three blocked statuses must always propagate from the single
      // source of truth (auth.constants.ts) to the module options so the credential
      // path and the OAuth path enforce the same set.
      const config = makeConfig();

      const options = buildAuthOptions(config as never);

      expect(options.blockedStatuses).toContain('BANNED');
      expect(options.blockedStatuses).toContain('INACTIVE');
      expect(options.blockedStatuses).toContain('SUSPENDED');
    });
  });
});
