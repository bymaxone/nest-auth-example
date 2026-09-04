import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file oauth-link.e2e-spec.ts
 * @description End-to-end spec verifying the OAuth pre-existing-account
 * guarantee (lib v1.4.x): a first OAuth sign-in whose profile email already
 * belongs to an email+password account in the tenant is REFUSED with
 * `auth.oauth_email_mismatch` — never silently linked and never duplicated —
 * while a brand-new email provisions a fresh OAuth-only user row.
 *
 *
 * Requires `docker-compose.test.yml` services to be running (Postgres at 55432,
 * Redis at 56379, Mailpit SMTP at 51025, Mailpit UI at 58025).
 *
 * Google network calls are stubbed via `test/helpers/fake-google.ts` — no real
 * `accounts.google.com` or `googleapis.com` requests are made.
 *
 * @layer test
 * @see test/helpers/fake-google.ts
 * @see test/helpers/mailpit.ts
 */

// Set test env vars BEFORE importing AppModule so ConfigService sees them.
// These must be set before the Zod schema parses process.env.
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://postgres:postgres@localhost:55432/example_app_test';
process.env['REDIS_URL'] = 'redis://127.0.0.1:56379';
process.env['SMTP_HOST'] = 'localhost';
process.env['SMTP_PORT'] = '51025';
process.env['EMAIL_PROVIDER'] = 'mailpit';
process.env['WEB_ORIGIN'] = 'http://localhost:3000';
process.env['API_PORT'] = '4002';
process.env['PASSWORD_RESET_METHOD'] = 'token';
process.env['LOG_LEVEL'] = 'warn';
// JWT_SECRET and MFA_ENCRYPTION_KEY use deterministic test-only values.
// These are intentionally committed — they are meaningless outside of the
// ephemeral test stack and must never be reused in any other environment.
process.env['JWT_SECRET'] =
  'test-only-jwt-secret-must-be-at-least-64-characters-for-schema-validation-ok';
process.env['MFA_ENCRYPTION_KEY'] = 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMmJ5dGVzLW9rPT0=';
// OAuth credentials set BEFORE module decoration — `isGoogleOAuthConfigured()` in
// auth.module.ts reads process.env at decoration time, before useFactory resolves.
process.env['OAUTH_GOOGLE_CLIENT_ID'] = 'test-client-id';
process.env['OAUTH_GOOGLE_CLIENT_SECRET'] = 'test-client-secret';
process.env['OAUTH_GOOGLE_CALLBACK_URL'] = 'http://localhost:4002/api/auth/oauth/google/callback';

import { execSync } from 'child_process';
import type { INestApplication } from '@nestjs/common';
import {
  AUTH_ERROR_CODES,
  AUTH_ERROR_STATUS,
  createAuthValidationPipe,
} from '@bymax-one/nest-auth';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as supertest from 'supertest';
import type { Agent } from 'supertest';

import { AppModule } from '../src/app.module.js';
import { AuthExceptionFilter } from '../src/auth/auth-exception.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { clearMailpit, waitForEmail, extractOtpFromHtml } from './helpers/mailpit.js';
import { resetAuthRateLimits } from './helpers/throttle.js';
import { installFakeGoogle, uninstallFakeGoogle } from './helpers/fake-google.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generates a unique email address to prevent test-run cross-contamination. */
function uniqueEmail(): string {
  return `oauth-link-${Date.now().toString()}-${Math.random().toString(36).slice(2)}@example.test`;
}

/**
 * Truncates all tables that accumulate state across test runs.
 * Ordering respects foreign-key constraints (child tables first).
 * `Tenant` rows survive — the 'acme' row created in `beforeAll` must persist.
 */
async function truncateTables(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('DELETE FROM "AuditLog"');
  await prisma.$executeRawUnsafe('DELETE FROM "Project"');
  await prisma.$executeRawUnsafe('DELETE FROM "Invitation"');
  await prisma.$executeRawUnsafe('DELETE FROM "User"');
}

// ─── Suite ───────────────────────────────────────────────────────────────────

/**
 * Testing module handle, kept at module scope so rate-limit counters can be
 * reset between tests. Assigned in `beforeAll`.
 */
let moduleRef: TestingModule;

describe('OAuth account linking — email/password user links to Google OAuth', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agent: Agent;

  beforeAll(async () => {
    // Run migrations against the test database before bootstrapping the app.
    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: process.env['DATABASE_URL'],
      },
      stdio: 'pipe',
    });

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Ensure the 'acme' tenant exists in the test database. The tenantIdResolver
    // returns the X-Tenant-Id header value verbatim, so tests using 'acme' as the
    // tenant identifier require a Tenant row with id = 'acme'.
    prisma = moduleRef.get<PrismaService>(PrismaService);
    await prisma.$executeRaw`
      INSERT INTO "Tenant" (id, name, slug, "createdAt", "updatedAt")
      VALUES ('acme', 'Acme Corp', 'acme', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `;

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      createAuthValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    app.useGlobalFilters(new AuthExceptionFilter());
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();

    agent = supertest.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clear both rate limiters (in-memory ThrottlerGuard + the library's
    // Redis-backed per-IP counters) so auth-route limits never bleed across
    // tests or spec files in a sequential run.
    await resetAuthRateLimits(moduleRef);
    await clearMailpit();
    await truncateTables(prisma);
  });

  // ─── Core pre-existing-account spec ───────────────────────────────────────

  it('refuses a first OAuth sign-in whose email already belongs to a password account (no silent linking)', async () => {
    // Scenario: user registers with email+password (FCM #1), verifies their
    // email (FCM #5), then attempts Google OAuth with the same address. Since
    // lib v1.4.x the create path REFUSES an OAuth profile whose email already
    // exists in the tenant (`auth.oauth_email_mismatch`) instead of silently
    // linking — an attacker controlling the OAuth identity for a victim's
    // address must not inherit the victim's account. With `errorRedirectUrl`
    // configured the callback 302s to the login page carrying the error code;
    // the spec asserts no duplicate row appears, the existing row stays
    // unlinked, and no auth cookies are issued. Covers FCM #12.

    const email = uniqueEmail();
    const googleSubId = `google-sub-${Date.now().toString()}`;

    // 1. Register with email/password — expect 201 PENDING.
    const registerRes = await agent
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password: 'Str0ngUniqu3Passw0rd!', name: 'OAuth Link Test' });

    expect(registerRes.status).toBe(201);

    // 2. Extract the 6-digit OTP from the Mailpit-captured verification email.
    const verifyHtml = await waitForEmail(email);
    const otp = extractOtpFromHtml(verifyHtml);
    expect(otp).toMatch(/^\d{6}$/);

    // 3. Verify email — the user is now able to authenticate.
    const verifyRes = await agent
      .post('/api/auth/verify-email')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, otp });

    expect(verifyRes.status).toBe(204);

    // 4. Install the fake Google stub before triggering the OAuth flow.
    //    The stub intercepts `globalThis.fetch` calls to:
    //    - POST https://oauth2.googleapis.com/token   → returns a fake Bearer token.
    //    - GET  https://www.googleapis.com/oauth2/v2/userinfo → returns the profile below.
    installFakeGoogle({ id: googleSubId, email, name: 'OAuth Link Test' });

    try {
      // 5. Initiate OAuth — the library generates a state nonce, stores it in
      //    Redis, and 302-redirects to Google's consent page. Prevent supertest
      //    from following the redirect so the Location header can be inspected.
      // The tenant travels in the X-Tenant-Id header — since lib v1.4.2 a
      // `?tenantId=` query param is refused with 400 `auth.validation` when a
      // tenantIdResolver is configured.
      const initiateRes = await agent
        .get('/api/auth/oauth/google')
        .set('X-Tenant-Id', 'acme')
        .redirects(0);

      expect(initiateRes.status).toBe(302);
      const location = initiateRes.headers['location'] as string;
      expect(location).toContain('accounts.google.com');

      // 6. Parse the `state` anti-CSRF nonce from the Google authorization URL.
      //    The library embeds it as a query parameter; the callback must echo it back.
      const authUrl = new URL(location);
      const state = authUrl.searchParams.get('state');
      expect(state).toBeTruthy();

      // 7. Simulate the browser redirecting back from Google. The library:
      //    a. Validates the state nonce (consumes it from Redis).
      //    b. Exchanges the code for tokens via the fake Google endpoint.
      //    c. Fetches the profile from the fake UserInfo endpoint.
      //    d. Calls onOAuthLogin — no user matches this provider id, so the
      //       hook answers 'create'; the create path then finds the address
      //       already registered in the tenant and throws
      //       `auth.oauth_email_mismatch` (account-takeover defence).
      //    e. With `errorRedirectUrl: '/auth/login'` configured, the callback
      //       302s there with `?error=oauth_email_mismatch` appended and NO
      //       auth cookies on the response.
      //    `.redirects(0)` prevents supertest from auto-following the 302 so
      //    the response is captured at the redirect boundary.
      const callbackRes = await agent
        .get(
          `/api/auth/oauth/google/callback?code=fake-code&state=${encodeURIComponent(state ?? '')}`,
        )
        .redirects(0);

      expect(callbackRes.status).toBe(302);
      expect(callbackRes.headers['location']).toBe('/auth/login?error=oauth_email_mismatch');
      // No session may be issued on the refusal leg.
      const setCookieHeader = callbackRes.headers['set-cookie'];
      const setCookies = Array.isArray(setCookieHeader)
        ? setCookieHeader.join('\n')
        : (setCookieHeader ?? '');
      expect(setCookies).not.toMatch(/access_token=/);
      expect(setCookies).not.toMatch(/refresh_token=/);

      // 8. Assert no duplicate row was created — exactly 1 user with this email.
      const userCount = await prisma.user.count({
        where: { email: email.toLowerCase(), tenantId: 'acme' },
      });
      expect(userCount).toBe(1);

      // 9. Assert the existing row stays a pure password account — untouched
      //    by the refused OAuth attempt.
      const untouchedUser = await prisma.user.findFirst({
        where: { email: email.toLowerCase(), tenantId: 'acme' },
      });
      expect(untouchedUser).not.toBeNull();
      expect(untouchedUser?.oauthProvider).toBeNull();
      expect(untouchedUser?.oauthProviderId).toBeNull();
      expect(untouchedUser?.emailVerified).toBe(true);
    } finally {
      // Always restore the original fetch regardless of test outcome.
      uninstallFakeGoogle();
    }
  });

  // ─── New OAuth-only user creation ─────────────────────────────────────────

  it('creates a new user when no email/password account exists for the Google profile email', async () => {
    // Scenario: a brand-new email (never registered with email/password) signs in
    // via Google OAuth. The createWithOAuth upsert takes the INSERT path rather
    // than the UPDATE path. Covers FCM #12 (sign-in half).

    const email = uniqueEmail();
    const googleSubId = `google-sub-new-${Date.now().toString()}`;

    installFakeGoogle({ id: googleSubId, email, name: 'New OAuth User' });

    try {
      // Initiate and extract state.
      // The tenant travels in the X-Tenant-Id header — since lib v1.4.2 a
      // `?tenantId=` query param is refused with 400 `auth.validation` when a
      // tenantIdResolver is configured.
      const initiateRes = await agent
        .get('/api/auth/oauth/google')
        .set('X-Tenant-Id', 'acme')
        .redirects(0);

      expect(initiateRes.status).toBe(302);
      const authUrl = new URL(initiateRes.headers['location'] as string);
      const state = authUrl.searchParams.get('state');
      expect(state).toBeTruthy();

      // Complete callback. Since v1.0.4 the response is a 302 to
      // `oauth.successRedirectUrl` ('/dashboard') with the auth cookies on
      // the same response — the JSON body that earlier versions returned is
      // gone by design. `.redirects(0)` keeps supertest at the redirect
      // boundary so the response is captured before any follow-up GET to
      // `/dashboard` (which would 404 inside the supertest agent because
      // the dashboard lives on the Next.js side, not on the NestJS API).
      const callbackRes = await agent
        .get(
          `/api/auth/oauth/google/callback?code=fake-code&state=${encodeURIComponent(state ?? '')}`,
        )
        .redirects(0);

      expect(callbackRes.status).toBe(302);
      expect(callbackRes.headers['location']).toBe('/dashboard');

      // Assert exactly 1 user was created with the expected OAuth identity.
      const user = await prisma.user.findFirst({
        where: { email: email.toLowerCase(), tenantId: 'acme' },
      });
      expect(user).not.toBeNull();
      expect(user?.oauthProvider).toBe('google');
      expect(user?.oauthProviderId).toBe(googleSubId);
      expect(user?.emailVerified).toBe(true);
      expect(user?.passwordHash).toBeNull();
    } finally {
      uninstallFakeGoogle();
    }
  });

  // ─── Tenant must come from the header, never the query string ─────────────

  it('refuses a ?tenantId= query param on the OAuth initiate route with 400 auth.validation', async () => {
    // Scenario: the API configures a tenantIdResolver (X-Tenant-Id header), so
    // since lib v1.4.2 the initiate route refuses a `tenantId` query parameter
    // with 400 `auth.validation` instead of silently preferring one source —
    // the query string cannot override the deployment's tenant resolution.
    const res = await agent.get('/api/auth/oauth/google?tenantId=acme').redirects(0);

    expect(res.status).toBe(AUTH_ERROR_STATUS[AUTH_ERROR_CODES.VALIDATION]);
    expect(res.body).toMatchObject({ error: { code: AUTH_ERROR_CODES.VALIDATION } });
  });
});
