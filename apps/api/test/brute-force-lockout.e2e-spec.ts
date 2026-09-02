import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file brute-force-lockout.e2e-spec.ts
 * @description End-to-end spec for brute-force account lockout protection.
 *
 * Verifies that 5 consecutive wrong-password attempts lock the account, and
 * that repeated failures on an unknown email do not expose enumeration data.
 *
 *
 * Requires `docker-compose.test.yml` services to be running (Postgres at 55432,
 * Redis at 56379, Mailpit SMTP at 51025, Mailpit UI at 58025).
 *
 * @layer test
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
process.env['API_PORT'] = '4020';
process.env['PASSWORD_RESET_METHOD'] = 'token';
process.env['LOG_LEVEL'] = 'warn';
// JWT_SECRET and MFA_ENCRYPTION_KEY use deterministic test-only values.
// These are intentionally committed — they are meaningless outside of the
// ephemeral test stack and must never be reused in any other environment.
process.env['JWT_SECRET'] =
  'test-only-jwt-secret-must-be-at-least-64-characters-for-schema-validation-ok';
process.env['MFA_ENCRYPTION_KEY'] = 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMmJ5dGVzLW9rPT0=';

import { execSync } from 'child_process';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as supertest from 'supertest';
import type { Redis } from 'ioredis';
import {
  AUTH_ERROR_CODES,
  AUTH_ERROR_STATUS,
  BYMAX_AUTH_REDIS_CLIENT,
  createAuthValidationPipe,
} from '@bymax-one/nest-auth';

import { AppModule } from '../src/app.module.js';
import { AuthExceptionFilter } from '../src/auth/auth-exception.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { clearMailpit, waitForEmail, extractOtpFromHtml } from './helpers/mailpit.js';
import { resetAuthRateLimits } from './helpers/throttle.js';
import { flushTestKeys } from './helpers/redis.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generates a unique email address to prevent test-run cross-contamination. */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now().toString()}-${Math.random().toString(36).slice(2)}@example.test`;
}

/**
 * Truncates all tables that accumulate state across test runs.
 * Ordering respects foreign-key constraints (child tables first).
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

describe('Brute-force lockout — account locks after 5 wrong-password attempts', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;

  beforeAll(async () => {
    // Run migrations against the test database before bootstrapping the app.
    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: 'pipe',
    });

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    redis = moduleRef.get<Redis>(BYMAX_AUTH_REDIS_CLIENT);

    // Ensure the 'acme' tenant FK constraint is satisfied before the app starts.
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
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clear both rate limiters (in-memory ThrottlerGuard + the library's
    // Redis-backed per-IP counters) so login-rate limits never bleed between
    // tests or in from earlier spec files.
    await resetAuthRateLimits(moduleRef);
    // Flush all brute-force lockout keys so each test starts from a clean state.
    // The identifier inside the key is HMAC-derived since lib v1.4.4, but the
    // `lf:` prefix survives, so the wildcard pattern still matches.
    await flushTestKeys(redis, 'nest-auth-example:lf:*');
    await clearMailpit();
    await truncateTables(prisma);
  });

  // ─── Test 1: 5 wrong attempts lock the account ───────────────────────────

  it('5 wrong-password attempts lock the account', async () => {
    // Scenario: a registered and verified user receives exactly 5 failed login
    // attempts with the wrong password. The 6th attempt (even with the correct
    // password) must return 429 with a code starting with 'auth.' — specifically
    // the ACCOUNT_LOCKED error (the library uses HTTP 429 for lockout, not 401).
    // A Redis key matching `nest-auth-example:lf:*` must also be present after
    // the lockout. Protects FCM #16.
    const email = uniqueEmail('brute-force');
    const password = 'Str0ngUniqu3Passw0rd!';
    const httpServer = app.getHttpServer();

    // Register the user.
    const regRes = await supertest
      .agent(httpServer)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, name: 'Brute Force Victim' });
    expect(regRes.status).toBe(201);

    // Verify the email via Mailpit.
    const verifyHtml = await waitForEmail(email);
    const otp = extractOtpFromHtml(verifyHtml);
    const verifyRes = await supertest
      .agent(httpServer)
      .post('/api/auth/verify-email')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, otp });
    expect(verifyRes.status).toBe(204);

    // Fire 5 consecutive bad-password attempts.
    for (let i = 0; i < 5; i++) {
      const attempt = await supertest
        .agent(httpServer)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .set('X-Tenant-Id', 'acme')
        .send({ email, password: 'WrongPassword99!' });
      // Each attempt should return 401 (not 429 from throttle).
      expect(attempt.status).toBe(401);
    }

    // The five attempts above also exhausted the `login` tier for this IP, and
    // both rate limiters run ahead of the auth service. Left in place they
    // would answer the next request with a per-IP 429 (`auth.too_many_requests`
    // or the bare ThrottlerException), hiding the lockout this test exists to
    // prove. Clearing the counters lets the library's own lockout response
    // through; the rate limit itself is covered by the throttle-demo suite.
    await resetAuthRateLimits(moduleRef);

    // The 6th attempt — even with the correct password — must be rejected because
    // the account is now locked. The library throws AuthException(ACCOUNT_LOCKED, 429).
    const lockedAttempt = await supertest
      .agent(httpServer)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password });

    // ACCOUNT_LOCKED answers HTTP 429 on every lockout path since lib v1.4.1
    // (the library reserves 429 for rate-limit errors, lockout included).
    expect(lockedAttempt.status).toBe(AUTH_ERROR_STATUS[AUTH_ERROR_CODES.ACCOUNT_LOCKED]);
    expect(lockedAttempt.body).toMatchObject({
      code: AUTH_ERROR_CODES.ACCOUNT_LOCKED,
      statusCode: 429,
    });

    // Redis must have a lockout key registered for this user's failed-login counter.
    const keys = await redis.keys('nest-auth-example:lf:*');
    expect(keys.length).toBeGreaterThan(0);
  });

  // ─── Test 2: Unknown email does not trigger lockout ───────────────────────

  it('wrong password on unknown email does not lock any account (anti-enumeration)', async () => {
    // Scenario: 5 failed logins against a non-existent email address must return
    // INVALID_CREDENTIALS (auth.*) — never ACCOUNT_LOCKED — because locking
    // a non-existent account would enable enumeration of valid addresses.
    // Protects FCM #16 (anti-enumeration guarantee).
    const nonExistentEmail = uniqueEmail('no-such-user');
    const httpServer = app.getHttpServer();

    for (let i = 0; i < 5; i++) {
      const attempt = await supertest
        .agent(httpServer)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .set('X-Tenant-Id', 'acme')
        .send({ email: nonExistentEmail, password: 'AnyPassword99!' });

      // Must always be 401 with a generic auth error — never a lockout-specific code
      // that would reveal the email is registered.
      expect(attempt.status).toBe(401);
      expect(attempt.body).toMatchObject({
        code: expect.stringMatching(/^auth\./),
        statusCode: 401,
      });
      // Must NOT return ACCOUNT_LOCKED since the account does not exist.
      const body = attempt.body as { code: string };
      expect(body.code).not.toMatch(/locked/i);
    }
  });

  // ─── Test 3: Debug lockout force → status read → unlock → login works ─────

  it('debug lockout endpoints force, report, and clear a lockout end-to-end', async () => {
    // Scenario: the dev-only debug surface drives the library's full lockout
    // read/write API. POST /api/debug/lockout replays 5 wrong-password logins
    // through the REAL AuthService path (firing onLoginFailed/onLockout hooks),
    // GET reports `{ locked, retryAfterSeconds }`, and DELETE unlocks via
    // `AuthService.unlockAccount` — after which a correct-password login
    // succeeds without waiting out the window. The tenant always travels in the
    // X-Tenant-Id header; the body names only the email.
    const email = uniqueEmail('debug-lockout');
    const password = 'Str0ngUniqu3Passw0rd!';
    const httpServer = app.getHttpServer();

    // Register and verify a real user so the post-unlock login can succeed.
    const regRes = await supertest
      .agent(httpServer)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, name: 'Debug Lockout User' });
    expect(regRes.status).toBe(201);

    const verifyHtml = await waitForEmail(email);
    const otp = extractOtpFromHtml(verifyHtml);
    const verifyRes = await supertest
      .agent(httpServer)
      .post('/api/auth/verify-email')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, otp });
    expect(verifyRes.status).toBe(204);

    // Force the lockout — the endpoint reports the resulting window.
    const forceRes = await supertest
      .agent(httpServer)
      .post('/api/debug/lockout')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email });
    expect(forceRes.status).toBe(200);
    expect(forceRes.body).toMatchObject({ locked: true });
    expect((forceRes.body as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);

    // The status read agrees with the forced state.
    const statusRes = await supertest
      .agent(httpServer)
      .get(`/api/debug/lockout?email=${encodeURIComponent(email)}`)
      .set('X-Tenant-Id', 'acme');
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toMatchObject({ locked: true });

    // Even the correct password is refused while the account is locked.
    const lockedLogin = await supertest
      .agent(httpServer)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password });
    expect(lockedLogin.status).toBe(AUTH_ERROR_STATUS[AUTH_ERROR_CODES.ACCOUNT_LOCKED]);
    expect(lockedLogin.body).toMatchObject({ code: AUTH_ERROR_CODES.ACCOUNT_LOCKED });

    // Unlock early — the admin "unlock account" surface.
    const unlockRes = await supertest
      .agent(httpServer)
      .delete('/api/debug/lockout')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email });
    expect(unlockRes.status).toBe(204);

    const afterUnlock = await supertest
      .agent(httpServer)
      .get(`/api/debug/lockout?email=${encodeURIComponent(email)}`)
      .set('X-Tenant-Id', 'acme');
    expect(afterUnlock.body).toMatchObject({ locked: false, retryAfterSeconds: 0 });

    // With the lockout cleared, the correct password signs in immediately.
    const loginRes = await supertest
      .agent(httpServer)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password });
    expect(loginRes.status).toBe(200);
  });
});
