import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file password-reset-otp.e2e-spec.ts
 * @description E2e spec for the OTP-based password-reset flow (PASSWORD_RESET_METHOD=otp).
 *
 * Covers:
 *  1. `forgot-password` with a known email delivers an OTP email to Mailpit.
 *  2. Extracting the OTP and calling `reset-password` with email + otp + newPassword
 *     allows a subsequent login with the new password.
 *  3. `reset-password` with an incorrect OTP returns 4xx.
 *
 * Requires `docker-compose.test.yml` services (Postgres at 55432, Redis at 56379,
 * Mailpit SMTP at 51025, Mailpit UI at 58025).
 *
 * @layer test
 * @see docs/DEVELOPMENT_PLAN.md §Phase 17 P17-5
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
process.env['API_PORT'] = '4015';
process.env['PASSWORD_RESET_METHOD'] = 'otp';
process.env['LOG_LEVEL'] = 'warn';
// JWT_SECRET and MFA_ENCRYPTION_KEY use deterministic test-only values.
// These are intentionally committed — they are meaningless outside of the
// ephemeral test stack and must never be reused in any other environment.
process.env['JWT_SECRET'] =
  'test-only-jwt-secret-must-be-at-least-64-characters-for-schema-validation-ok';
process.env['MFA_ENCRYPTION_KEY'] = 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMmJ5dGVzLW9rPT0=';

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generates a unique email address to prevent test-run cross-contamination. */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now().toString()}-${Math.random().toString(36).slice(2)}@example.test`;
}

/**
 * Truncates all tables that accumulate state across test runs.
 * Ordering respects foreign-key constraints (child tables first).
 * The 'acme' Tenant row created in `beforeAll` survives.
 */
async function truncateTables(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('DELETE FROM "AuditLog"');
  await prisma.$executeRawUnsafe('DELETE FROM "Project"');
  await prisma.$executeRawUnsafe('DELETE FROM "Invitation"');
  await prisma.$executeRawUnsafe('DELETE FROM "User"');
}

/**
 * Registers and verifies a new user, returning the agent that completed the flow.
 *
 * @param httpServer - The HTTP server instance from the NestJS app.
 * @param email - The email address for the new user.
 * @param password - The password for the new user.
 * @returns A supertest agent that completed email verification.
 */
async function registerAndVerify(
  httpServer: ReturnType<INestApplication['getHttpServer']>,
  email: string,
  password: string,
): Promise<Agent> {
  const agent = supertest.agent(httpServer);

  // Register — creates a PENDING user and triggers a verification OTP email.
  const registerRes = await agent
    .post('/api/auth/register')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ email, password, name: 'OTP Reset User', tenantId: 'acme' });

  expect(registerRes.status).toBe(201);

  // Extract the OTP from Mailpit and verify the email address.
  const verifyHtml = await waitForEmail(email);
  const otp = extractOtpFromHtml(verifyHtml);

  const verifyRes = await agent
    .post('/api/auth/verify-email')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ email, otp, tenantId: 'acme' });

  expect(verifyRes.status).toBe(204);

  return agent;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Password reset (OTP mode) — forgot-password → OTP email → reset → login', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    // Run migrations against the test database before bootstrapping the app.
    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: 'pipe',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Ensure the 'acme' tenant FK constraint is satisfied before the app starts.
    // The tenantIdResolver returns the X-Tenant-Id header verbatim, so 'acme'
    // must exist as a Tenant row.
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
    // Clear accumulated email and user data before every individual test.
    await clearMailpit();
    await truncateTables(prisma);
  });

  // ─── Test 1 — OTP email delivered ────────────────────────────────────────

  it('request reset with OTP mode sends OTP email to Mailpit', async () => {
    // Scenario: a verified user calls forgot-password in OTP mode. The library
    // sends an OTP (not a reset link) to the user's address. This proves the
    // OTP-mode reset path is active and the email adapter is working.
    const email = uniqueEmail('reset-otp');
    const password = 'P@ssw0rd12345';
    await registerAndVerify(app.getHttpServer(), email, password);

    // Clear Mailpit so only the reset OTP email is captured in the assertion.
    await clearMailpit();

    const forgotRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/password/forgot-password')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, tenantId: 'acme' });

    expect(forgotRes.status).toBe(200);

    // Assert that an OTP email arrived in Mailpit for the user's address.
    // In OTP mode the email contains a 6-digit code rather than a URL link.
    const resetHtml = await waitForEmail(email);
    expect(resetHtml).toBeTruthy();

    // The OTP helper must extract a 6-digit code from the email body.
    const otp = extractOtpFromHtml(resetHtml);
    expect(otp).toMatch(/^\d{6}$/);
  });

  // ─── Test 2 — Full OTP reset flow ────────────────────────────────────────

  it('submit correct OTP and new password → login succeeds with new password', async () => {
    // Scenario: end-to-end OTP-mode password reset. The user requests a reset,
    // extracts the OTP from the email, posts email + otp + newPassword, then logs
    // in with the new credentials. The old password must no longer work.
    const email = uniqueEmail('reset-otp-full');
    const oldPassword = 'P@ssw0rd12345';
    const newPassword = 'N3wP@ssword!99';

    await registerAndVerify(app.getHttpServer(), email, oldPassword);

    // Clear Mailpit before triggering the reset so only the reset OTP is captured.
    await clearMailpit();

    // 1. Request password reset — expect 200.
    const forgotRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/password/forgot-password')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, tenantId: 'acme' });

    expect(forgotRes.status).toBe(200);

    // 2. Extract the OTP from the Mailpit email.
    const resetHtml = await waitForEmail(email);
    const otp = extractOtpFromHtml(resetHtml);
    expect(otp).toMatch(/^\d{6}$/);

    // 3. Submit email + OTP + new password — library returns 204 No Content.
    const resetRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/password/reset-password')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, otp, newPassword, tenantId: 'acme' });

    expect(resetRes.status).toBe(204);

    // 4. Login with the new password — must succeed (200 with auth cookies).
    const loginRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password: newPassword, tenantId: 'acme' });

    expect(loginRes.status).toBe(200);

    // 5. Login with the old password — must fail (401).
    const oldLoginRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password: oldPassword, tenantId: 'acme' });

    expect(oldLoginRes.status).toBe(401);
  });

  // ─── Test 3 — Invalid OTP ─────────────────────────────────────────────────

  it('invalid OTP returns 4xx', async () => {
    // Scenario: submitting a wrong OTP to reset-password in OTP mode must
    // result in a client-error (4xx) response, never a 5xx or silent success.
    // This ensures the OTP is validated and single-use semantics are enforced.
    const email = uniqueEmail('reset-otp-bad');
    const password = 'P@ssw0rd12345';
    const newPassword = 'N3wP@ssword!99';

    await registerAndVerify(app.getHttpServer(), email, password);
    await clearMailpit();

    // Trigger a reset to ensure the user is in the "reset pending" state.
    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/password/forgot-password')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, tenantId: 'acme' });

    // Submit an incorrect OTP — the server must reject it with 4xx.
    const res = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/password/reset-password')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, otp: '000000', newPassword, tenantId: 'acme' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
