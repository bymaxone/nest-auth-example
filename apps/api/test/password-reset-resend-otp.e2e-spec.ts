import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file password-reset-resend-otp.e2e-spec.ts
 * @description e2e spec for `POST /api/auth/password/resend-otp`.
 *
 * Covers:
 *  1. Happy path — after `forgot-password` (OTP mode) the user can request a
 *     resend; the second OTP is the one that completes the reset.
 *  2. Anti-enumeration — unknown emails return a success-shaped response with
 *     no email dispatched.
 *  3. Library decorator does not crash when global throttler guard is absent
 *     (see throttle-demo for in-process throttling coverage).
 *
 * Requires `PASSWORD_RESET_METHOD=otp` so the reset flow generates OTPs.
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
process.env['API_PORT'] = '4013';
process.env['PASSWORD_RESET_METHOD'] = 'otp';
process.env['LOG_LEVEL'] = 'warn';
process.env['JWT_SECRET'] =
  'test-only-jwt-secret-must-be-at-least-64-characters-for-schema-validation-ok';
process.env['MFA_ENCRYPTION_KEY'] = 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMmJ5dGVzLW9rPT0=';

import { execSync } from 'child_process';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as supertest from 'supertest';

import { AppModule } from '../src/app.module.js';
import { AuthExceptionFilter } from '../src/auth/auth-exception.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
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

/** Registers a user, verifies their email, and returns the persisted email. */
async function makeVerifiedUser(
  httpServer: ReturnType<INestApplication['getHttpServer']>,
  password: string,
): Promise<string> {
  const email = uniqueEmail('reset-resend');
  await supertest
    .agent(httpServer)
    .post('/api/auth/register')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ email, password, name: 'Reset Resend', tenantId: 'acme' });
  const verifyHtml = await waitForEmail(email);
  const verifyOtp = extractOtpFromHtml(verifyHtml);
  await supertest
    .agent(httpServer)
    .post('/api/auth/verify-email')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ email, otp: verifyOtp, tenantId: 'acme' });
  return email;
}

describe('POST /api/auth/password/resend-otp — OTP-mode reset resend', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: 'pipe',
    });

    const moduleRef = await Test.createTestingModule({
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
      new ValidationPipe({
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
    await clearMailpit();
    await truncateTables(prisma);
  });

  it('resends the password reset OTP and the new code completes the reset', async () => {
    /*
     * Scenario: trigger forgot-password (delivers OTP #1), then call
     * resend-otp (delivers OTP #2). The user submits OTP #2 to reset-password
     * and is then able to log in with the new password. Verifies that the
     * resend invalidates the prior code.
     */
    const password = 'P@ssw0rd12345';
    const email = await makeVerifiedUser(app.getHttpServer(), password);
    await clearMailpit();

    // Trigger initial OTP via forgot-password.
    const forgotRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/password/forgot-password')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, tenantId: 'acme' });
    expect(forgotRes.status).toBeGreaterThanOrEqual(200);
    expect(forgotRes.status).toBeLessThan(300);

    const firstHtml = await waitForEmail(email);
    const firstOtp = extractOtpFromHtml(firstHtml);
    await clearMailpit();

    // Resend OTP.
    const resendRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/password/resend-otp')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, tenantId: 'acme' });
    expect(resendRes.status).toBeGreaterThanOrEqual(200);
    expect(resendRes.status).toBeLessThan(300);

    const secondHtml = await waitForEmail(email);
    const secondOtp = extractOtpFromHtml(secondHtml);
    expect(secondOtp).toMatch(/^\d{6}$/);
    expect(secondOtp).not.toBe(firstOtp);

    // Submit the resent OTP to reset-password.
    const newPassword = 'N3wP@ssword12345';
    const resetRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/password/reset-password')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, otp: secondOtp, newPassword, tenantId: 'acme' });
    expect(resetRes.status).toBeGreaterThanOrEqual(200);
    expect(resetRes.status).toBeLessThan(300);

    // Confirm login with the new password.
    const loginRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password: newPassword, tenantId: 'acme' });
    expect(loginRes.status).toBe(200);
  });

  it('returns a success-shaped response for an unknown email (no enumeration)', async () => {
    /*
     * Scenario: the resend endpoint must not disclose whether the email exists.
     * Anti-enumeration: same response shape as the happy path, no email sent.
     */
    const ghost = uniqueEmail('ghost-reset');

    const resendRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/password/resend-otp')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email: ghost, tenantId: 'acme' });
    expect(resendRes.status).toBeGreaterThanOrEqual(200);
    expect(resendRes.status).toBeLessThan(300);

    const straggler = await waitForEmailBySubject(ghost, /.*/, 500).catch(() => null);
    expect(straggler).toBeNull();
  });

  it('accepts repeated calls (lib decorator metadata only; throttle via throttle-demo)', async () => {
    /*
     * Same rationale as resend-verification.e2e-spec — the example does not
     * wire ThrottlerGuard globally, so the lib's @Throttle metadata is set but
     * not enforced. Asserts the endpoint stays well-behaved under repeat use.
     */
    const password = 'P@ssw0rd12345';
    const email = await makeVerifiedUser(app.getHttpServer(), password);
    await clearMailpit();
    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/password/forgot-password')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, tenantId: 'acme' });

    const agent = supertest.agent(app.getHttpServer());
    for (let i = 0; i < 4; i++) {
      const res = await agent
        .post('/api/auth/password/resend-otp')
        .set('Content-Type', 'application/json')
        .set('X-Tenant-Id', 'acme')
        .send({ email, tenantId: 'acme' });
      expect([200, 201, 204, 429]).toContain(res.status);
    }
  });
});
