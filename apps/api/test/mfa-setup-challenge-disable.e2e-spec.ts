import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file mfa-setup-challenge-disable.e2e-spec.ts
 * @description E2e spec for the TOTP MFA lifecycle: setup → enable → challenge → disable.
 *
 * Covers:
 *  1. POST /api/auth/mfa/setup returns a `secret` and `qrCodeUri`.
 *  2. POST /api/auth/mfa/verify-enable with a valid TOTP code enables MFA (204).
 *  3. Login after MFA enrollment returns `{ mfaRequired: true, tempToken }` instead
 *     of setting auth cookies directly.
 *  4. POST /api/auth/mfa/challenge with a valid TOTP completes login and sets auth cookies.
 *  5. POST /api/auth/mfa/disable with a valid TOTP disables MFA; subsequent login
 *     no longer triggers the MFA challenge.
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
process.env['API_PORT'] = '4016';
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
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Redis } from 'ioredis';
import { generateSync } from 'otplib';
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
 * Clears the library's TOTP anti-replay keys (`nest-auth-example:tu:*`) so
 * the same TOTP code window can be reused in tests.
 *
 * The library hashes (userId, code) into a key and uses SETNX as an anti-replay
 * guard — once a code has been consumed (e.g. during /mfa/verify-enable) it
 * cannot be reused in the same 30-second window, even by a different endpoint.
 * Test specs that exercise the full enable → challenge → disable chain must
 * flush these keys between calls to avoid window-collision 401s.
 */
async function clearMfaAntiReplay(): Promise<void> {
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:56379');
  try {
    const keys = await redis.keys('nest-auth-example:tu:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } finally {
    await redis.quit();
  }
}

/**
 * Registers, verifies, and logs in a user, returning an authenticated agent.
 *
 * @param httpServer - The HTTP server instance from the NestJS app.
 * @param email - The email address for the new user.
 * @param password - The password for the new user.
 * @returns A supertest agent with auth cookies set (full session).
 */
async function registerVerifyLogin(
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
    .send({ email, password, name: 'MFA Test User', tenantId: 'acme' });

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

  // Login — the agent retains the auth cookies for subsequent requests.
  const loginRes = await agent
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ email, password, tenantId: 'acme' });

  expect(loginRes.status).toBe(200);

  return agent;
}

/**
 * Sets up MFA on the given authenticated agent and enables it with a TOTP code.
 *
 * After verify-enable succeeds, flushes the TOTP anti-replay namespace so the
 * caller can immediately generate and submit another current-window code
 * (otherwise SETNX would reject the next call as a replay).
 *
 * @param agent - An authenticated supertest agent.
 * @returns The TOTP secret so the caller can generate subsequent codes.
 */
async function setupAndEnableMfa(agent: Agent): Promise<string> {
  // POST /api/auth/mfa/setup — returns secret and qrCodeUri.
  const setupRes = await agent
    .post('/api/auth/mfa/setup')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme');

  expect([200, 201]).toContain(setupRes.status);
  const { secret } = setupRes.body as { secret: string; qrCodeUri: string };
  expect(secret).toBeTruthy();

  // Generate a TOTP code and confirm enrollment.
  const code = generateSync({ secret, strategy: 'totp' });

  const enableRes = await agent
    .post('/api/auth/mfa/verify-enable')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ code });

  expect(enableRes.status).toBe(204);

  // Clear the anti-replay keys so the next test step can reuse a current-window code.
  await clearMfaAntiReplay();

  return secret;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('MFA lifecycle — setup → verify-enable → challenge → disable', () => {
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

  // ─── Test 1 — Setup response ──────────────────────────────────────────────

  it('POST /api/auth/mfa/setup returns secret and qrCodeUri', async () => {
    // Scenario: a logged-in user initiates MFA setup. The library must return
    // a TOTP secret (base32-encoded) and a QR code URI so the user can register
    // their authenticator app. FCM row #8 (MFA setup).
    const email = uniqueEmail('mfa-setup');
    const agent = await registerVerifyLogin(app.getHttpServer(), email, 'P@ssw0rd12345');
    await clearMailpit();

    const setupRes = await agent
      .post('/api/auth/mfa/setup')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme');

    expect([200, 201]).toContain(setupRes.status);

    const body = setupRes.body as Record<string, unknown>;
    // The setup response must include both fields needed by an authenticator app.
    expect(typeof body['secret']).toBe('string');
    expect((body['secret'] as string).length).toBeGreaterThan(0);
    expect(typeof body['qrCodeUri']).toBe('string');
    expect((body['qrCodeUri'] as string).length).toBeGreaterThan(0);
  });

  // ─── Test 2 — verify-enable ───────────────────────────────────────────────

  it('POST /api/auth/mfa/verify-enable confirms TOTP and enables MFA', async () => {
    // Scenario: after receiving the secret from /mfa/setup, the user generates a
    // TOTP code and calls verify-enable. A 204 response confirms MFA is active.
    // This proves the TOTP validation logic is wired correctly. FCM row #8.
    const email = uniqueEmail('mfa-enable');
    const agent = await registerVerifyLogin(app.getHttpServer(), email, 'P@ssw0rd12345');
    await clearMailpit();

    // Initiate setup and capture the secret.
    const setupRes = await agent
      .post('/api/auth/mfa/setup')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme');

    expect([200, 201]).toContain(setupRes.status);
    const { secret } = setupRes.body as { secret: string };

    // Generate a valid TOTP code for this secret.
    const code = generateSync({ secret, strategy: 'totp' });

    const enableRes = await agent
      .post('/api/auth/mfa/verify-enable')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ code });

    // 204 No Content confirms MFA was successfully enabled.
    expect(enableRes.status).toBe(204);
  });

  // ─── Test 3 — Login requires MFA challenge ────────────────────────────────

  it('login after MFA enrolled requires MFA challenge', async () => {
    // Scenario: once MFA is enabled, a standard login with valid credentials must
    // NOT return auth cookies. Instead the library returns a partial response with
    // { mfaRequired: true, tempToken } so the client can proceed to the challenge
    // endpoint. FCM row #9 (MFA challenge required).
    const email = uniqueEmail('mfa-login-challenge');
    const password = 'P@ssw0rd12345';
    const agent = await registerVerifyLogin(app.getHttpServer(), email, password);
    await clearMailpit();

    // Enable MFA via the shared helper.
    await setupAndEnableMfa(agent);

    // Logout so the next login uses a fresh session (no cached cookies).
    await agent.post('/api/auth/logout').set('X-Tenant-Id', 'acme');

    // Login with valid credentials — must be intercepted by MFA.
    const loginRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, tenantId: 'acme' });

    // The library signals MFA is required via this shape; auth cookies must NOT
    // be set at this stage.
    expect(loginRes.body).toMatchObject({ mfaRequired: true });
    expect(typeof (loginRes.body as Record<string, unknown>)['mfaTempToken']).toBe('string');
  });

  // ─── Test 4 — Challenge with valid TOTP ───────────────────────────────────

  it('POST /api/auth/mfa/challenge with valid TOTP completes login', async () => {
    // Scenario: the full MFA login flow — login returns tempToken, the user
    // generates a TOTP code and calls /mfa/challenge, which must return 200 and
    // set the auth cookies (access_token, refresh_token). FCM row #9.
    const email = uniqueEmail('mfa-challenge');
    const password = 'P@ssw0rd12345';
    const agent = await registerVerifyLogin(app.getHttpServer(), email, password);
    await clearMailpit();

    // Enable MFA and keep the secret for code generation.
    const secret = await setupAndEnableMfa(agent);

    // Logout to reset the session state.
    await agent.post('/api/auth/logout').set('X-Tenant-Id', 'acme');

    // Login — must return mfaRequired + tempToken.
    const loginRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, tenantId: 'acme' });

    const { mfaTempToken: tempToken } = loginRes.body as { mfaTempToken: string };
    expect(tempToken).toBeTruthy();

    // The setupAndEnableMfa helper already flushed the anti-replay namespace
    // after verify-enable, so a current-window code is safe to submit here.
    const code = generateSync({ secret, strategy: 'totp' });

    // Submit the challenge — expect 200 with auth cookies.
    const challengeAgent = supertest.agent(app.getHttpServer());
    const challengeRes = await challengeAgent
      .post('/api/auth/mfa/challenge')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ mfaTempToken: tempToken, code });

    expect(challengeRes.status).toBe(200);

    // Auth cookies must be set after a successful challenge.
    const cookies = challengeRes.headers['set-cookie'] as string[] | undefined;
    const cookieString = (cookies ?? []).join('; ');
    expect(cookieString).toMatch(/access_token/);
  });

  // ─── Test 5 — Disable MFA ─────────────────────────────────────────────────

  it('POST /api/auth/mfa/disable disables MFA after valid TOTP', async () => {
    // Scenario: a user with MFA enabled calls /mfa/disable with a valid TOTP code.
    // The library responds with 204, and a subsequent login must succeed directly
    // without triggering a challenge. FCM row #10 (MFA disable).
    const email = uniqueEmail('mfa-disable');
    const password = 'P@ssw0rd12345';
    const agent = await registerVerifyLogin(app.getHttpServer(), email, password);
    await clearMailpit();

    // Enable MFA and keep the secret. The helper flushes anti-replay keys
    // after verify-enable, so a current-window code is safe to submit here.
    const secret = await setupAndEnableMfa(agent);
    const code = generateSync({ secret, strategy: 'totp' });

    const disableRes = await agent
      .post('/api/auth/mfa/disable')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ code });

    expect(disableRes.status).toBe(204);

    // Logout and re-login — must succeed without an MFA challenge.
    await agent.post('/api/auth/logout').set('X-Tenant-Id', 'acme');

    const loginRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, tenantId: 'acme' });

    // After disabling MFA, login must return auth cookies directly (no tempToken).
    expect(loginRes.status).toBe(200);
    expect((loginRes.body as Record<string, unknown>)['mfaRequired']).toBeUndefined();
    const cookies = loginRes.headers['set-cookie'] as string[] | undefined;
    const cookieString = (cookies ?? []).join('; ');
    expect(cookieString).toMatch(/access_token/);
  });
});
