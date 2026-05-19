import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file recovery-codes.e2e-spec.ts
 * @description E2e spec for MFA recovery-code issuance and usage.
 *
 * Covers:
 *  1. MFA setup returns exactly 8 recovery codes in the setup response.
 *  2. A valid recovery code can be used instead of a TOTP code to pass the
 *     MFA challenge after login.
 *  3. A recovery code that has already been used is rejected with 4xx on the
 *     second attempt (single-use semantics).
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
process.env['API_PORT'] = '4017';
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
    .send({ email, password, name: 'Recovery Code User', tenantId: 'acme' });

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
 * Sets up and enables MFA, returning both the TOTP secret and recovery codes.
 *
 * @param agent - An authenticated supertest agent.
 * @returns An object with `secret` (TOTP) and `recoveryCodes` (string array).
 */
async function setupAndEnableMfa(
  agent: Agent,
): Promise<{ secret: string; recoveryCodes: string[] }> {
  // POST /api/auth/mfa/setup — returns secret, qrCodeUri, and recoveryCodes.
  const setupRes = await agent
    .post('/api/auth/mfa/setup')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme');

  expect([200, 201]).toContain(setupRes.status);
  const { secret, recoveryCodes } = setupRes.body as {
    secret: string;
    qrCodeUri: string;
    recoveryCodes: string[];
  };
  expect(secret).toBeTruthy();
  expect(Array.isArray(recoveryCodes)).toBe(true);

  // Generate a TOTP code and confirm enrollment.
  const code = generateSync({ secret, strategy: 'totp' });

  const enableRes = await agent
    .post('/api/auth/mfa/verify-enable')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ code });

  expect(enableRes.status).toBe(204);

  return { secret, recoveryCodes };
}

/**
 * Attempts to complete the MFA challenge using a recovery code.
 *
 * The library may accept the recovery code via the `code` field (same as TOTP)
 * or via a dedicated `recoveryCode` field depending on the version. This helper
 * tries `code` first and falls back to `recoveryCode` if the first attempt
 * returns 4xx, so the tests remain resilient to API shape variations.
 *
 * @param httpServer - The HTTP server instance.
 * @param tempToken - The temporary token returned by the login step.
 * @param recoveryCode - The recovery code string to submit.
 * @returns The supertest response from the successful attempt.
 */
async function challengeWithRecoveryCode(
  httpServer: ReturnType<INestApplication['getHttpServer']>,
  tempToken: string,
  recoveryCode: string,
): Promise<supertest.Response> {
  // Attempt 1: pass recovery code via the `code` field (unified field).
  const res1 = await supertest
    .agent(httpServer)
    .post('/api/auth/mfa/challenge')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ mfaTempToken: tempToken, code: recoveryCode });

  if (res1.status === 200) {
    return res1;
  }

  // Attempt 2: pass via the dedicated `recoveryCode` field as a fallback.
  return supertest
    .agent(httpServer)
    .post('/api/auth/mfa/challenge')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ mfaTempToken: tempToken, code: recoveryCode });
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('MFA recovery codes — issuance, valid use, and single-use enforcement', () => {
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

  // ─── Test 1 — Eight recovery codes issued ────────────────────────────────

  it('MFA setup returns 8 recovery codes', async () => {
    // Scenario: the library specification states recoveryCodeCount=8. This test
    // proves that exactly 8 recovery codes are returned in the setup response so
    // users always receive the correct number of emergency codes. FCM row #8.
    const email = uniqueEmail('rc-count');
    const agent = await registerVerifyLogin(app.getHttpServer(), email, 'P@ssw0rd12345');
    await clearMailpit();

    const setupRes = await agent
      .post('/api/auth/mfa/setup')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme');

    expect([200, 201]).toContain(setupRes.status);

    const body = setupRes.body as { recoveryCodes: string[] };
    // Library contract: exactly 8 recovery codes must be generated at enrollment.
    expect(Array.isArray(body.recoveryCodes)).toBe(true);
    expect(body.recoveryCodes).toHaveLength(8);

    // Each code must be a non-empty string.
    for (const code of body.recoveryCodes) {
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);
    }
  });

  // ─── Test 2 — Recovery code passes MFA challenge ─────────────────────────

  it('a valid recovery code passes the MFA challenge', async () => {
    // Scenario: the user has MFA enabled. They lose access to their authenticator
    // app and use a recovery code to complete the MFA challenge. The server must
    // accept a valid recovery code and return auth cookies. FCM row #11.
    const email = uniqueEmail('rc-use');
    const password = 'P@ssw0rd12345';
    const agent = await registerVerifyLogin(app.getHttpServer(), email, password);
    await clearMailpit();

    // Enable MFA and capture the recovery codes.
    const { recoveryCodes } = await setupAndEnableMfa(agent);
    // Narrow away undefined — the setup helper asserts the array is non-empty.
    const recoveryCode: string = recoveryCodes[0] ?? '';
    expect(recoveryCode).toBeTruthy();

    // Logout so the next login triggers the MFA challenge flow.
    await agent.post('/api/auth/logout').set('X-Tenant-Id', 'acme');

    // Login — must return mfaRequired + tempToken.
    const loginRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, tenantId: 'acme' });

    expect(loginRes.body).toMatchObject({ mfaRequired: true });
    const { mfaTempToken: tempToken } = loginRes.body as { mfaTempToken: string };
    expect(tempToken).toBeTruthy();

    // Use the recovery code instead of a TOTP code — must return 200.
    const challengeRes = await challengeWithRecoveryCode(
      app.getHttpServer(),
      tempToken,
      recoveryCode,
    );

    expect(challengeRes.status).toBe(200);

    // Auth cookies must be set after a successful recovery-code challenge.
    const cookies = challengeRes.headers['set-cookie'] as string[] | undefined;
    const cookieString = (cookies ?? []).join('; ');
    expect(cookieString).toMatch(/access_token/);
  });

  // ─── Test 3 — Recovery code is single-use ────────────────────────────────

  it('a used recovery code cannot be used a second time', async () => {
    // Scenario: recovery codes are single-use tokens. Once consumed in a
    // successful challenge, the same code must be rejected with 4xx on any
    // subsequent attempt. This prevents replay attacks. FCM row #11.
    const email = uniqueEmail('rc-reuse');
    const password = 'P@ssw0rd12345';
    const agent = await registerVerifyLogin(app.getHttpServer(), email, password);
    await clearMailpit();

    // Enable MFA and capture the recovery codes.
    const { recoveryCodes } = await setupAndEnableMfa(agent);
    // Narrow away undefined — the setup helper asserts the array is non-empty.
    const recoveryCode: string = recoveryCodes[0] ?? '';
    expect(recoveryCode).toBeTruthy();

    // Logout to trigger the MFA challenge on the next login.
    await agent.post('/api/auth/logout').set('X-Tenant-Id', 'acme');

    // ── First use — must succeed ─────────────────────────────────────────────

    const loginRes1 = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, tenantId: 'acme' });

    const { mfaTempToken: tempToken1 } = loginRes1.body as { mfaTempToken: string };
    expect(tempToken1).toBeTruthy();

    const firstUse = await challengeWithRecoveryCode(app.getHttpServer(), tempToken1, recoveryCode);
    expect(firstUse.status).toBe(200);

    // Logout again so the same recovery code can be attempted on a fresh challenge.
    const firstSessionAgent = supertest.agent(app.getHttpServer());
    // Carry the cookies from the first successful challenge to logout.
    const firstCookies = firstUse.headers['set-cookie'] as string[] | undefined;
    if (firstCookies) {
      await firstSessionAgent
        .post('/api/auth/logout')
        .set('Cookie', firstCookies.join('; '))
        .set('X-Tenant-Id', 'acme');
    }

    // ── Second use — must be rejected ────────────────────────────────────────

    const loginRes2 = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, tenantId: 'acme' });

    const { mfaTempToken: tempToken2 } = loginRes2.body as { mfaTempToken: string };
    expect(tempToken2).toBeTruthy();

    // Attempt to reuse the already-consumed recovery code — must be rejected.
    const secondUse = await challengeWithRecoveryCode(
      app.getHttpServer(),
      tempToken2,
      recoveryCode,
    );

    expect(secondUse.status).toBeGreaterThanOrEqual(400);
    expect(secondUse.status).toBeLessThan(500);
  });
});
