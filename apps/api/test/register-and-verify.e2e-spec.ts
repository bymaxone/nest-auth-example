import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file register-and-verify.e2e-spec.ts
 * @description End-to-end spec for user registration and email-verification flow.
 *
 * Covers:
 *  1. POST /api/auth/register returns 201 with PENDING status; Mailpit receives
 *     the OTP email.
 *  2. POST /api/auth/verify-email with the correct OTP marks the user as verified.
 *  3. Duplicate registration in the same tenant is rejected (4xx).
 *  4. verify-email with an incorrect OTP is rejected (4xx).
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
process.env['API_PORT'] = '4010';
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
import * as supertest from 'supertest';

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

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Register & Verify — register → OTP email → verify-email', () => {
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
    // Clear the Mailpit inbox and accumulated test data before each spec.
    await clearMailpit();
    await truncateTables(prisma);
  });

  // ─── Happy paths ──────────────────────────────────────────────────────────

  it('registers a new user and sends a verification OTP email', async () => {
    // Scenario: POST /api/auth/register with valid credentials should return 201
    // with PENDING status and no passwordHash exposed. Mailpit must receive an
    // email containing a 6-digit OTP code for the registered address. Covers FCM #1.
    const email = uniqueEmail('reg');

    const res = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password: 'P@ssw0rd12345', name: 'Test User', tenantId: 'acme' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ user: { email, status: 'PENDING' } });
    // The API must never expose the password hash in any response.
    expect(res.body.user).not.toHaveProperty('passwordHash');

    // Verify the OTP email was captured by Mailpit.
    const html = await waitForEmail(email);
    expect(html).toBeTruthy();
    const otp = extractOtpFromHtml(html);
    expect(otp).toMatch(/^\d{6}$/);
  });

  it('verifies email with the correct OTP and marks emailVerified = true', async () => {
    // Scenario: after a successful registration the user extracts the OTP from
    // the email and submits it via POST /api/auth/verify-email. The library must
    // respond 204 (No Content — void return) and persist emailVerified = true on
    // the User row. Covers FCM #5.
    const email = uniqueEmail('verify');

    // Register — creates a PENDING user and dispatches the OTP email.
    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password: 'P@ssw0rd12345', name: 'Verify User', tenantId: 'acme' });

    // Poll Mailpit and extract the 6-digit OTP from the email body.
    const html = await waitForEmail(email);
    const otp = extractOtpFromHtml(html);

    // Submit the correct OTP — expect 204 No Content (library returns void).
    const verifyRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/verify-email')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, otp, tenantId: 'acme' });

    expect(verifyRes.status).toBe(204);

    // Confirm via Prisma that the user row has been updated.
    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), tenantId: 'acme' },
    });
    expect(user).not.toBeNull();
    expect(user?.emailVerified).toBe(true);
  });

  // ─── Sad paths ────────────────────────────────────────────────────────────

  it('rejects duplicate registration with the same email in the same tenant', async () => {
    // Scenario: the unique constraint on (tenantId, email) must prevent a second
    // registration attempt for an address already registered in the 'acme' tenant.
    // The library must return a 4xx client-error response, not a 5xx. Covers FCM #1
    // error-path and the anti-duplicate-account rule.
    const email = uniqueEmail('dup');

    // First registration — must succeed.
    const firstRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password: 'P@ssw0rd12345', name: 'First User', tenantId: 'acme' });

    expect(firstRes.status).toBe(201);

    // Second registration with the same email — must be rejected.
    const secondRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password: 'An0therP@ss!', name: 'Duplicate User', tenantId: 'acme' });

    expect(secondRes.status).toBeGreaterThanOrEqual(400);
    expect(secondRes.status).toBeLessThan(500);
  });

  it('rejects verify-email with an incorrect OTP', async () => {
    // Scenario: submitting a wrong OTP must be rejected with a 4xx response.
    // The library must not accidentally verify the user on an invalid code.
    // Covers the error-path of FCM #5.
    const email = uniqueEmail('badotp');

    // Register to produce a pending user with a valid OTP in the system.
    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password: 'P@ssw0rd12345', name: 'Bad OTP User', tenantId: 'acme' });

    // Submit a deliberately wrong OTP (000000 is extremely unlikely to be correct).
    const verifyRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/verify-email')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, otp: '000000', tenantId: 'acme' });

    expect(verifyRes.status).toBeGreaterThanOrEqual(400);
    expect(verifyRes.status).toBeLessThan(500);

    // Confirm the user was NOT verified despite the bad OTP attempt.
    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), tenantId: 'acme' },
    });
    expect(user?.emailVerified).not.toBe(true);
  });
});
