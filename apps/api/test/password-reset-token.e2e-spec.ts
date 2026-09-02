import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file password-reset-token.e2e-spec.ts
 * @description E2e spec for the token-based password-reset flow (PASSWORD_RESET_METHOD=token).
 *
 * Covers:
 *  1. `forgot-password` with a known email delivers a reset-link email to Mailpit.
 *  2. Following the reset link (extracting the token) and calling `reset-password`
 *     with the new password allows a subsequent login with that password.
 *  3. `forgot-password` with an unknown email returns the same HTTP shape
 *     (anti-enumeration protection).
 *  4. `reset-password` with an invalid or expired token returns 4xx.
 *
 * Requires `docker-compose.test.yml` services (Postgres at 55432, Redis at 56379,
 * Mailpit SMTP at 51025, Mailpit UI at 58025).
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
process.env['API_PORT'] = '4014';
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
import { resetAuthRateLimits } from './helpers/throttle.js';
import {
  clearMailpit,
  waitForEmail,
  extractOtpFromHtml,
  extractResetTokenFromHtml,
} from './helpers/mailpit.js';

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
 * Registers and verifies a new user, returning the agent that completed login.
 *
 * @param httpServer - The HTTP server instance from the NestJS app.
 * @param email - The email address for the new user.
 * @param password - The password for the new user.
 * @returns A supertest agent with auth cookies set.
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
    .send({ email, password, name: 'Reset Test User' });

  expect(registerRes.status).toBe(201);

  // Extract the OTP from Mailpit and verify the email address.
  const verifyHtml = await waitForEmail(email);
  const otp = extractOtpFromHtml(verifyHtml);

  const verifyRes = await agent
    .post('/api/auth/verify-email')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ email, otp });

  expect(verifyRes.status).toBe(204);

  return agent;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

/**
 * Testing module handle, kept at module scope so rate-limit counters can be
 * reset between tests. Assigned in `beforeAll`.
 */
let moduleRef: TestingModule;

describe('Password reset (token mode) — forgot-password → reset link → login', () => {
  let app: INestApplication;
  let prisma: PrismaService;

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
    // Redis-backed per-IP counters) so auth-route limits never bleed across
    // tests or spec files in a sequential run.
    await resetAuthRateLimits(moduleRef);
    // Clear accumulated email and user data before every individual test.
    await clearMailpit();
    await truncateTables(prisma);
  });

  // ─── Test 1 — Reset link delivered ───────────────────────────────────────

  it('request reset with known email sends reset link to Mailpit', async () => {
    // Scenario: a verified user calls forgot-password. The library sends an
    // email containing a reset link to the user's address. This proves the
    // forgot-password endpoint is wired and the email adapter is working.
    const email = uniqueEmail('reset-tok');
    const password = 'Str0ngUniqu3Passw0rd!';
    await registerAndVerify(app.getHttpServer(), email, password);

    // Clear Mailpit so the verification OTP does not match the reset-link assertion.
    await clearMailpit();

    const forgotRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/password/forgot-password')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email });

    expect(forgotRes.status).toBe(200);

    // Assert that a reset-link email arrived in Mailpit for the user's address.
    const resetHtml = await waitForEmail(email);
    expect(resetHtml).toBeTruthy();

    // The reset URL must contain a `token` query parameter (token-mode contract).
    const resetUrl = extractResetTokenFromHtml(resetHtml);
    expect(resetUrl).toMatch(/token=/);
  });

  // ─── Test 2 — Full reset flow ─────────────────────────────────────────────

  it('follow reset link: reset password → login with new password succeeds', async () => {
    // Scenario: end-to-end token-mode password reset. The user requests a reset,
    // extracts the token from the email URL, posts the new password, then logs in
    // with the new credentials. The old password must no longer work.
    const email = uniqueEmail('reset-full');
    const oldPassword = 'Str0ngUniqu3Passw0rd!';
    const newPassword = 'N3wStr0ngP@ssw0rd!42';

    await registerAndVerify(app.getHttpServer(), email, oldPassword);

    // Clear Mailpit before triggering the reset so only the reset email is captured.
    await clearMailpit();

    // 1. Request password reset — expect 200.
    const forgotRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/password/forgot-password')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email });

    expect(forgotRes.status).toBe(200);

    // 2. Extract the reset token from the link in the Mailpit email.
    const resetHtml = await waitForEmail(email);
    const resetUrl = extractResetTokenFromHtml(resetHtml);
    const tokenMatch = resetUrl.match(/[?&]token=([^&]+)/);
    const token = tokenMatch?.[1] ?? '';
    expect(token).toBeTruthy();

    // 3. Submit the new password using the token — library returns 204 No Content.
    const resetRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/password/reset-password')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ token, newPassword, email });

    expect(resetRes.status).toBe(204);

    // 4. Login with the new password — must succeed (200 with auth cookies).
    const loginRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password: newPassword });

    expect(loginRes.status).toBe(200);

    // 5. Login with the old password — must fail (401).
    const oldLoginRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password: oldPassword });

    expect(oldLoginRes.status).toBe(401);
  });

  // ─── Test 3 — Anti-enumeration ────────────────────────────────────────────

  it('unknown email returns the same response shape (anti-enumeration)', async () => {
    // Scenario: calling forgot-password with an email that does not exist in the
    // tenant must return 200 — the same status as a known email — to prevent
    // user enumeration attacks. The body shape must also be consistent.
    const unknownEmail = uniqueEmail('nonexistent');

    const res = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/password/forgot-password')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email: unknownEmail });

    // Anti-enumeration: response must be identical to a successful request.
    expect(res.status).toBe(200);
  });

  // ─── Test 4 — Invalid token ───────────────────────────────────────────────

  it('invalid/expired token returns 400 auth.password_reset_token_invalid', async () => {
    // Scenario: submitting a fake or expired token to reset-password answers
    // 400 `auth.password_reset_token_invalid` — since lib v1.4.1 the expired
    // case is folded into the same code (PASSWORD_RESET_TOKEN_EXPIRED was
    // removed) so callers cannot distinguish a token that once existed from
    // one that never did.
    const fakeToken = 'a'.repeat(64); // syntactically plausible but not in the DB

    const res = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/password/reset-password')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({
        token: fakeToken,
        newPassword: 'N3wStr0ngP@ssw0rd!42',
        email: 'test@example.test',
      });

    expect(res.status).toBe(AUTH_ERROR_STATUS[AUTH_ERROR_CODES.PASSWORD_RESET_TOKEN_INVALID]);
    expect(res.body).toMatchObject({
      code: AUTH_ERROR_CODES.PASSWORD_RESET_TOKEN_INVALID,
      statusCode: 400,
    });
  });
});
