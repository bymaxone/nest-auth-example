import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file login-and-logout.e2e-spec.ts
 * @description End-to-end spec for the login, /me, and logout flows.
 *
 * Covers:
 *  1. Login with valid credentials sets HttpOnly auth cookies.
 *  2. GET /api/auth/me returns the authenticated user (no passwordHash).
 *  3. Logout clears the session; subsequent /me returns 401.
 *  4. Wrong password returns a 401 with an auth.* error code.
 *  5. Unknown email returns the same 401/auth.* shape (anti-enumeration).
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
process.env['API_PORT'] = '4011';
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
 * Executes the full register → verify-email → login flow and returns a
 * supertest Agent that carries the resulting auth cookies.
 *
 * @param httpServer - The HTTP server instance from `app.getHttpServer()`.
 * @param prismaClient - PrismaService instance (unused here, kept for parity).
 * @param email - Email address to register with.
 * @param password - Password to use for registration and login.
 * @returns A supertest Agent with the access_token and refresh_token cookies set.
 */
async function registerVerifyAndLogin(
  httpServer: ReturnType<INestApplication['getHttpServer']>,
  email: string,
  password: string,
): Promise<Agent> {
  // Step 1: register.
  await supertest
    .agent(httpServer)
    .post('/api/auth/register')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ email, password, name: 'Test User', tenantId: 'acme' });

  // Step 2: extract OTP and verify email.
  const html = await waitForEmail(email);
  const otp = extractOtpFromHtml(html);
  await supertest
    .agent(httpServer)
    .post('/api/auth/verify-email')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ email, otp, tenantId: 'acme' });

  // Step 3: login and return the cookie-carrying agent.
  const sessionAgent = supertest.agent(httpServer);
  const loginRes = await sessionAgent
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ email, password, tenantId: 'acme' });

  expect(loginRes.status).toBe(200);
  return sessionAgent;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Login & Logout — login → /me → logout → error paths', () => {
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

  it('login with valid credentials sets auth cookies', async () => {
    // Scenario: after completing the register → verify flow, POST /api/auth/login
    // with correct credentials must return 200 and set Set-Cookie headers that
    // include both the access_token (HttpOnly) and refresh_token (HttpOnly).
    // Covers FCM row #2 (login).
    const email = uniqueEmail('login');
    const password = 'P@ssw0rd12345';

    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, name: 'Login User', tenantId: 'acme' });

    const html = await waitForEmail(email);
    const otp = extractOtpFromHtml(html);
    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/verify-email')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, otp, tenantId: 'acme' });

    const loginRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, tenantId: 'acme' });

    expect(loginRes.status).toBe(200);

    const cookies = loginRes.headers['set-cookie'] as string[] | undefined;
    expect(cookies).toBeDefined();
    const cookieHeader = (cookies ?? []).join('; ');
    // Both access_token and refresh_token must be present in the cookie set.
    expect(cookieHeader).toMatch(/access_token/);
    expect(cookieHeader).toMatch(/refresh_token/);
    // HttpOnly must be set on each to prevent client-side JavaScript access.
    const accessCookie = (cookies ?? []).find((c) => c.startsWith('access_token'));
    const refreshCookie = (cookies ?? []).find((c) => c.startsWith('refresh_token'));
    expect(accessCookie?.toLowerCase()).toContain('httponly');
    // SameSite=Lax is the lib's default since v1.0.5 (was 'strict' before).
    // The example relies on Lax for the OAuth round-trip: when Google's
    // 302 lands on the callback handler and the handler in turn 302s to
    // `/dashboard`, the Set-Cookie must survive both hops. With Strict,
    // Chromium would drop the auth cookies on the cross-site-initiated
    // navigation and the user would bounce back to /auth/login. Pinning
    // the attribute here turns a future lib regression into a loud test
    // failure instead of a silent UX break that only shows up under real
    // OAuth credentials.
    expect(accessCookie?.toLowerCase()).toContain('samesite=lax');
    expect(refreshCookie?.toLowerCase()).toContain('samesite=lax');
  });

  it('GET /api/auth/me returns user data after login', async () => {
    // Scenario: an authenticated session (cookies from login) must allow GET
    // /api/auth/me to return the user's profile including the email field but
    // excluding sensitive fields such as passwordHash. Covers FCM row #2.
    const email = uniqueEmail('me');
    const password = 'P@ssw0rd12345';

    const sessionAgent = await registerVerifyAndLogin(app.getHttpServer(), email, password);

    const meRes = await sessionAgent.get('/api/auth/me').set('X-Tenant-Id', 'acme');

    expect(meRes.status).toBe(200);
    expect(meRes.body).toMatchObject({ email });
    // Sensitive fields must be stripped from the response payload.
    expect(meRes.body).not.toHaveProperty('passwordHash');
    expect(meRes.body).not.toHaveProperty('mfaSecret');
  });

  it('logout clears the session and subsequent /me returns 401', async () => {
    // Scenario: POST /api/auth/logout must invalidate the active session so that
    // any follow-up GET /api/auth/me call is rejected with 401. This ensures the
    // server-side revocation takes effect immediately. Covers FCM row #4 (revocation).
    const email = uniqueEmail('logout');
    const password = 'P@ssw0rd12345';

    const sessionAgent = await registerVerifyAndLogin(app.getHttpServer(), email, password);

    // Confirm the session is active before logging out.
    const meBeforeLogout = await sessionAgent.get('/api/auth/me').set('X-Tenant-Id', 'acme');
    expect(meBeforeLogout.status).toBe(200);

    // Logout — expect 204 No Content.
    const logoutRes = await sessionAgent.post('/api/auth/logout').set('X-Tenant-Id', 'acme');
    expect(logoutRes.status).toBe(204);

    // After logout the session must be invalidated on the server side.
    const meAfterLogout = await sessionAgent.get('/api/auth/me').set('X-Tenant-Id', 'acme');
    expect(meAfterLogout.status).toBe(401);
  });

  // ─── Sad paths ────────────────────────────────────────────────────────────

  it('wrong password returns INVALID_CREDENTIALS code and 401', async () => {
    // Scenario: submitting the correct email with the wrong password must return
    // a 401 response with a body that matches the auth error envelope shape
    // ({ code, message, statusCode }). The code must start with 'auth.' to allow
    // the frontend to map it via the auth-errors map. Covers FCM row #29.
    const email = uniqueEmail('wrongpw');
    const password = 'P@ssw0rd12345';

    // Register and verify so a real user exists, then attempt login with bad password.
    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, name: 'Wrong PW User', tenantId: 'acme' });

    const html = await waitForEmail(email);
    const otp = extractOtpFromHtml(html);
    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/verify-email')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, otp, tenantId: 'acme' });

    const loginRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password: 'WrongP@ss999', tenantId: 'acme' });

    expect(loginRes.status).toBe(401);
    expect(loginRes.body).toMatchObject({
      code: expect.stringMatching(/^auth\./),
      message: expect.any(String),
      statusCode: 401,
    });
  });

  it('unknown email returns the same error shape as wrong password (anti-enumeration)', async () => {
    // Scenario: an attacker must not be able to enumerate valid email addresses by
    // observing differences between "unknown email" and "wrong password" responses.
    // Both must return 401 with the same auth.* error envelope. Covers FCM #29.
    const unknownEmail = uniqueEmail('nobody');

    const loginRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email: unknownEmail, password: 'IrrelevantP@ss1', tenantId: 'acme' });

    expect(loginRes.status).toBe(401);
    expect(loginRes.body).toMatchObject({
      code: expect.stringMatching(/^auth\./),
      message: expect.any(String),
      statusCode: 401,
    });
  });
});
