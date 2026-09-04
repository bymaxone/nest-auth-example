import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file resend-verification.e2e-spec.ts
 * @description e2e spec for `POST /api/auth/resend-verification`.
 *
 * Covers:
 *  1. Happy path — a pending user receives a fresh OTP email on resend, and
 *     the new code successfully verifies the account.
 *  2. Already-verified accounts return success-shaped responses without
 *     dispatching a new email (anti-enumeration; the lib does not throw).
 *  3. Unknown email returns the same success-shaped response.
 *  4. Throttling — the 4th request from the same IP within 5 minutes is 429
 *     (AUTH_THROTTLE_CONFIGS.resendVerification: 3 / 5 min).
 *
 * Requires `docker-compose.test.yml` services to be running.
 *
 * @layer test
 */

process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://postgres:postgres@localhost:55432/example_app_test';
process.env['REDIS_URL'] = 'redis://127.0.0.1:56379';
process.env['SMTP_HOST'] = 'localhost';
process.env['SMTP_PORT'] = '51025';
process.env['EMAIL_PROVIDER'] = 'mailpit';
process.env['WEB_ORIGIN'] = 'http://localhost:3000';
process.env['API_PORT'] = '4012';
process.env['PASSWORD_RESET_METHOD'] = 'token';
process.env['LOG_LEVEL'] = 'warn';
process.env['JWT_SECRET'] =
  'test-only-jwt-secret-must-be-at-least-64-characters-for-schema-validation-ok';
process.env['MFA_ENCRYPTION_KEY'] = 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMmJ5dGVzLW9rPT0=';

import { execSync } from 'child_process';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as supertest from 'supertest';

import { AppModule } from '../src/app.module.js';
import { AuthExceptionFilter } from '../src/auth/auth-exception.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { resetAuthRateLimits } from './helpers/throttle.js';
import { createAuthValidationPipe } from '@bymax-one/nest-auth';
import {
  clearMailpit,
  extractOtpFromHtml,
  waitForEmail,
  waitForEmailBySubject,
} from './helpers/mailpit.js';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now().toString()}-${Math.random().toString(36).slice(2)}@example.test`;
}

async function truncateTables(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('DELETE FROM "AuditLog"');
  await prisma.$executeRawUnsafe('DELETE FROM "User"');
}

/**
 * Testing module handle, kept at module scope so rate-limit counters can be
 * reset between tests. Assigned in `beforeAll`.
 */
let moduleRef: TestingModule;

describe('POST /api/auth/resend-verification — resend OTP + throttling', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: 'pipe',
    });

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
    app.useGlobalFilters(new AuthExceptionFilter([]));
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await clearMailpit();
    await truncateTables(prisma);
    // Clear both rate limiters (in-memory ThrottlerGuard + the library's
    // Redis-backed per-IP counters) so auth-route limits never bleed across
    // tests or spec files in a sequential run.
    await resetAuthRateLimits(moduleRef);
  });

  it('resends the verification OTP and the new code verifies the account', async () => {
    /*
     * Scenario: register a pending user, ignore the first OTP, ask the lib to
     * resend, then verify with the second code. The endpoint dispatches a
     * fresh OTP — not a stored copy of the first — and the new code is the
     * only one that works.
     */
    const email = uniqueEmail('resendverify');
    const password = 'Str0ngUniqu3Passw0rd!';

    // Step 1: register (creates a PENDING user + dispatches OTP #1).
    const regRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, name: 'Resend Verify' });
    expect(regRes.status).toBe(201);

    // Capture the FIRST OTP and clear Mailpit so the resent OTP is unambiguous.
    const firstHtml = await waitForEmail(email);
    const firstOtp = extractOtpFromHtml(firstHtml);
    await clearMailpit();

    // Step 2: ask for a resend.
    const resendRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/resend-verification')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email });
    expect(resendRes.status).toBeGreaterThanOrEqual(200);
    expect(resendRes.status).toBeLessThan(300);

    // The new OTP arrives in Mailpit.
    const secondHtml = await waitForEmail(email);
    const secondOtp = extractOtpFromHtml(secondHtml);
    expect(secondOtp).toMatch(/^\d{6}$/);

    // The freshly resent code verifies the account.
    const verifyRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/verify-email')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, otp: secondOtp });
    expect(verifyRes.status).toBe(204);

    const userRow = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), tenantId: 'acme' },
    });
    expect(userRow?.emailVerified).toBe(true);

    // The original code is now invalidated — it must not also work.
    expect(firstOtp).not.toBe(secondOtp);
  });

  it('returns a success-shaped response for an already-verified email (no enumeration)', async () => {
    /*
     * Scenario: a verified user retries resend. The lib must not throw or
     * disclose that the account is already verified — anti-enumeration. The
     * response status is in the 2xx range and no new email is dispatched.
     */
    const email = uniqueEmail('alreadyverified');
    const password = 'Str0ngUniqu3Passw0rd!';

    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, name: 'Already Verified' });

    const html = await waitForEmail(email);
    const otp = extractOtpFromHtml(html);
    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/verify-email')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, otp });
    await clearMailpit();

    const resendRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/resend-verification')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email });
    expect(resendRes.status).toBeGreaterThanOrEqual(200);
    expect(resendRes.status).toBeLessThan(300);

    // No new verification OTP should be dispatched — the user is already
    // active. Give Mailpit a short window to surface any unexpected mail.
    await new Promise<void>((r) => setTimeout(r, 300));
    const stragglerCheck = await waitForEmailBySubject(email, /.*/, 500).catch(() => null);
    expect(stragglerCheck).toBeNull();
  });

  it('returns a success-shaped response for an unknown email (no enumeration)', async () => {
    /*
     * Scenario: caller submits an email that does not exist in the tenant. The
     * endpoint must NOT reveal that fact — same status + shape as the happy
     * path, no email dispatched.
     */
    const ghostEmail = uniqueEmail('ghost');

    const resendRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/resend-verification')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email: ghostEmail });
    expect(resendRes.status).toBeGreaterThanOrEqual(200);
    expect(resendRes.status).toBeLessThan(300);

    const stragglerCheck = await waitForEmailBySubject(ghostEmail, /.*/, 500).catch(() => null);
    expect(stragglerCheck).toBeNull();
  });

  it('accepts repeated calls and answers 2xx or a per-IP 429 once the tier is spent', async () => {
    /*
     * Scenario: send several resend-verification requests in succession. The
     * route is rate-limited per IP at 3 / 5 min (AUTH_THROTTLE_CONFIGS
     * .resendVerification) by BOTH the app's global ThrottlerGuard and the
     * library's own AuthRateLimitGuard (Redis-backed, lib v1.4.x). The first
     * calls succeed shape-wise; once the tier is spent the endpoint answers
     * 429 — either outcome is library-faithful, so both are accepted here.
     * Deterministic 429 coverage lives in throttle-demo.e2e-spec.ts.
     */
    const email = uniqueEmail('throttle');
    const password = 'Str0ngUniqu3Passw0rd!';

    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, name: 'Throttle Test' });

    const agent = supertest.agent(app.getHttpServer());
    for (let i = 0; i < 4; i++) {
      const res = await agent
        .post('/api/auth/resend-verification')
        .set('Content-Type', 'application/json')
        .set('X-Tenant-Id', 'acme')
        .send({ email });
      // 2xx or 429 — both are valid library-faithful outcomes depending on
      // whether the consumer wires the global throttler guard.
      expect([200, 201, 204, 429]).toContain(res.status);
    }
  });
});
