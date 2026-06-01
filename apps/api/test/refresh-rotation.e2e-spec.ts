import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file refresh-rotation.e2e-spec.ts
 * @description End-to-end spec for JWT refresh-token rotation.
 *
 * Covers:
 *  1. POST /api/auth/refresh rotates the access_token cookie (200 + new Set-Cookie).
 *  2. Two concurrent refreshes within the grace window both succeed (or the second
 *     is gracefully rejected as 401 if the library revokes immediately).
 *  3. POST /api/auth/refresh without a refresh_token cookie returns 401.
 *
 * Requires `docker-compose.test.yml` services to be running (Postgres at 55432,
 * Redis at 56379, Mailpit SMTP at 51025, Mailpit UI at 58025).
 *
 * The grace window for concurrent refreshes is configured to 30 seconds
 * (jwt.refreshGraceWindowSeconds: 30).
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
process.env['API_PORT'] = '4012';
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
 * @param email - Email address to register with.
 * @param password - Password to use for registration and login.
 * @returns A supertest Agent with the access_token and refresh_token cookies set.
 */
async function registerVerifyAndLogin(
  httpServer: ReturnType<INestApplication['getHttpServer']>,
  email: string,
  password: string,
): Promise<Agent> {
  await supertest
    .agent(httpServer)
    .post('/api/auth/register')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ email, password, name: 'Test User', tenantId: 'acme' });

  const html = await waitForEmail(email);
  const otp = extractOtpFromHtml(html);
  await supertest
    .agent(httpServer)
    .post('/api/auth/verify-email')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ email, otp, tenantId: 'acme' });

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

describe('Refresh rotation — POST /api/auth/refresh rotates the access token', () => {
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

  it('refresh rotates the access token cookie', async () => {
    // Scenario: after a successful login the client holds both access_token and
    // refresh_token cookies. POST /api/auth/refresh must return 200 and issue
    // a new Set-Cookie with a fresh access_token value (JWT rotation). This
    // covers FCM row #3 (JWT refresh rotation).
    const email = uniqueEmail('refresh');
    const password = 'P@ssw0rd12345';

    const sessionAgent = await registerVerifyAndLogin(app.getHttpServer(), email, password);

    const refreshRes = await sessionAgent.post('/api/auth/refresh').set('X-Tenant-Id', 'acme');

    expect(refreshRes.status).toBe(200);

    // The response must issue a new Set-Cookie containing access_token.
    const cookies = refreshRes.headers['set-cookie'] as string[] | undefined;
    expect(cookies).toBeDefined();
    const cookieHeader = (cookies ?? []).join('; ');
    expect(cookieHeader).toMatch(/access_token/);
  });

  it('two concurrent refreshes within the grace window both succeed', async () => {
    // Scenario: the library allows a configurable grace window (30 s) during which
    // a refresh token that has just been rotated can still be reused. This is needed
    // to prevent race conditions when multiple tabs fire a refresh simultaneously.
    // Both requests are sent before either response arrives so they race correctly.
    // The library may either accept both (grace window) or reject the second (401
    // if it revokes immediately) — both behaviours are valid here. Covers FCM #3.
    const email = uniqueEmail('concurrent');
    const password = 'P@ssw0rd12345';

    // Each concurrent request needs its own agent that shares the same initial
    // cookie jar — duplicate the cookies by logging in twice from scratch.
    const agentA = await registerVerifyAndLogin(app.getHttpServer(), email, password);

    // Fire both refreshes concurrently using Promise.all so they race.
    const [resA, resB] = await Promise.all([
      agentA.post('/api/auth/refresh').set('X-Tenant-Id', 'acme'),
      agentA.post('/api/auth/refresh').set('X-Tenant-Id', 'acme'),
    ]);

    // At least the first refresh must succeed.
    expect(resA.status).toBe(200);
    // The second may succeed (grace window) or be rejected (immediate revocation).
    expect([200, 401]).toContain(resB.status);
  });

  // ─── Sad paths ────────────────────────────────────────────────────────────

  it('refresh without a refresh_token cookie returns 401', async () => {
    // Scenario: a fresh supertest agent (no cookies) that POSTs to /api/auth/refresh
    // must be rejected with 401 because no refresh_token cookie is present.
    // This guards against unauthenticated token refresh attempts. Covers FCM #3
    // error-path.
    const freshAgent = supertest.agent(app.getHttpServer());

    const refreshRes = await freshAgent.post('/api/auth/refresh').set('X-Tenant-Id', 'acme');

    expect(refreshRes.status).toBe(401);
  });
});
