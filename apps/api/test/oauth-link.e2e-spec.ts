/**
 * @file oauth-link.e2e-spec.ts
 * @description Phase 8 e2e spec that verifies the OAuth account-linking guarantee:
 * a user who first registers with email+password, then signs in via Google OAuth
 * with the same email address, ends up on the **same** `users` row — with
 * `oauthProvider = 'google'` and `oauthProviderId` populated — rather than a
 * duplicate row being created.
 *
 * Covers FCM row #12 (OAuth Google sign-in & link — the linking half).
 *
 * Requires `docker-compose.test.yml` services to be running (Postgres at 55432,
 * Redis at 56379, Mailpit SMTP at 51025, Mailpit UI at 58025).
 *
 * Google network calls are stubbed via `test/helpers/fake-google.ts` — no real
 * `accounts.google.com` or `googleapis.com` requests are made.
 *
 * @layer test
 * @see docs/DEVELOPMENT_PLAN.md §Phase 8 P8-3
 * @see test/helpers/fake-google.ts
 * @see test/helpers/mailpit.ts
 */

// Set test env vars BEFORE importing AppModule so ConfigService sees them.
// These must be set before the Zod schema parses process.env.
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://postgres:postgres@localhost:55432/example_app_test';
process.env['REDIS_URL'] = 'redis://localhost:56379';
process.env['SMTP_HOST'] = 'localhost';
process.env['SMTP_PORT'] = '51025';
process.env['EMAIL_PROVIDER'] = 'mailpit';
process.env['WEB_ORIGIN'] = 'http://localhost:3000';
process.env['API_PORT'] = '4002';
process.env['PASSWORD_RESET_METHOD'] = 'token';
process.env['LOG_LEVEL'] = 'silent';
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
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as supertest from 'supertest';
import type { Agent } from 'supertest';

import { AppModule } from '../src/app.module.js';
import { AuthExceptionFilter } from '../src/auth/auth-exception.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { clearMailpit, waitForEmail, extractOtpFromHtml } from './helpers/mailpit.js';
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

    const moduleRef = await Test.createTestingModule({
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
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();

    agent = supertest.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await clearMailpit();
    await truncateTables(prisma);
  });

  // ─── Core account-linking spec ─────────────────────────────────────────────

  it('links an existing email/password user to Google OAuth on first OAuth sign-in without creating a duplicate row', async () => {
    // Scenario: user registers with email+password (FCM #1), verifies their email
    // (FCM #5), then authenticates via Google OAuth with the same email. The spec
    // asserts that (a) no duplicate user row is created and (b) the existing row
    // gains oauthProvider='google' and a non-null oauthProviderId. Covers FCM #12.

    const email = uniqueEmail();
    const googleSubId = `google-sub-${Date.now().toString()}`;

    // 1. Register with email/password — expect 201 PENDING.
    const registerRes = await agent
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password: 'P@ssw0rd12345', name: 'OAuth Link Test' });

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

    expect(verifyRes.status).toBe(200);

    // 4. Install the fake Google stub before triggering the OAuth flow.
    //    The stub intercepts `globalThis.fetch` calls to:
    //    - POST https://oauth2.googleapis.com/token   → returns a fake Bearer token.
    //    - GET  https://www.googleapis.com/oauth2/v2/userinfo → returns the profile below.
    installFakeGoogle({ id: googleSubId, email, name: 'OAuth Link Test' });

    try {
      // 5. Initiate OAuth — the library generates a state nonce, stores it in
      //    Redis, and 302-redirects to Google's consent page. Prevent supertest
      //    from following the redirect so the Location header can be inspected.
      const initiateRes = await agent.get('/api/auth/oauth/google?tenantId=acme').redirects(0);

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
      //    d. Calls onOAuthLogin → 'create' → PrismaUserRepository.createWithOAuth
      //       (upsert) → updates the existing user's OAuth fields instead of
      //       creating a duplicate row.
      //    e. Issues access_token + refresh_token cookies and returns { user }.
      const callbackRes = await agent.get(
        `/api/auth/oauth/google/callback?code=fake-code&state=${encodeURIComponent(state ?? '')}`,
      );

      expect(callbackRes.status).toBe(200);
      expect(callbackRes.body).toHaveProperty('user');
      expect(callbackRes.body.user).toMatchObject({ email: email.toLowerCase() });

      // 8. Assert no duplicate row was created — exactly 1 user with this email.
      const userCount = await prisma.user.count({
        where: { email: email.toLowerCase(), tenantId: 'acme' },
      });
      expect(userCount).toBe(1);

      // 9. Assert the existing row now carries the Google OAuth identity.
      const linkedUser = await prisma.user.findFirst({
        where: { email: email.toLowerCase(), tenantId: 'acme' },
      });
      expect(linkedUser).not.toBeNull();
      expect(linkedUser?.oauthProvider).toBe('google');
      expect(linkedUser?.oauthProviderId).toBe(googleSubId);
      expect(linkedUser?.emailVerified).toBe(true);
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
      const initiateRes = await agent.get('/api/auth/oauth/google?tenantId=acme').redirects(0);

      expect(initiateRes.status).toBe(302);
      const authUrl = new URL(initiateRes.headers['location'] as string);
      const state = authUrl.searchParams.get('state');
      expect(state).toBeTruthy();

      // Complete callback.
      const callbackRes = await agent.get(
        `/api/auth/oauth/google/callback?code=fake-code&state=${encodeURIComponent(state ?? '')}`,
      );

      expect(callbackRes.status).toBe(200);

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
});
