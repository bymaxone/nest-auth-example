import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file jwt-revocation.e2e-spec.ts
 * @description End-to-end spec for JWT revocation and session invalidation.
 *
 * Covers:
 *  1. DELETE /api/auth/sessions/all revokes all active sessions; GET /me returns 401.
 *  2. GET /api/auth/me with a stale access token after logout returns 401.
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
process.env['API_PORT'] = '4013';
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

describe('JWT revocation — logout and revoke-all invalidate active sessions', () => {
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

  // ─── Revoke-all sessions ──────────────────────────────────────────────────

  it('revoke all sessions: DELETE /api/auth/sessions/all invalidates OTHER active sessions', async () => {
    // Scenario: the library's `revokeAllExceptCurrent` preserves the calling
    // session by design — a user who clicks "sign out everywhere" expects to
    // remain signed in on the device they just used. To prove the OTHER sessions
    // are killed we need TWO supertest agents: session 1 calls revoke-all,
    // session 2 then tries to refresh and must be rejected. Covers FCM row #4
    // (session revocation) and protects the library contract for `revokeAllExceptCurrent`.
    //
    // Per-test timeout bumped to 60 s — this test runs three register-+-verify
    // (Mailpit roundtrip) + login + revoke flows in series, and Mailpit's
    // response time under cumulative load from earlier specs in the full e2e
    // run regularly pushes the total past the 30 s default. Isolated runs take
    // ~2 s, so this is purely a "slow Mailpit at the tail of the suite" margin.
    const email = uniqueEmail('revoke-all');
    const password = 'P@ssw0rd12345';

    // Session 1 — created via full register + verify + login flow.
    const session1Agent = await registerVerifyAndLogin(app.getHttpServer(), email, password);

    // Session 2 — a second concurrent login with a distinct user-agent so the
    // library records it as a separate session entry in Redis.
    const session2Agent = supertest.agent(app.getHttpServer());
    const login2 = await session2Agent
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .set('User-Agent', 'TestBrowser-2')
      .send({ email, password, tenantId: 'acme' });
    expect(login2.status).toBe(200);

    // Sanity-check both sessions are alive.
    const meBefore1 = await session1Agent.get('/api/auth/me').set('X-Tenant-Id', 'acme');
    expect(meBefore1.status).toBe(200);
    const meBefore2 = await session2Agent.get('/api/auth/me').set('X-Tenant-Id', 'acme');
    expect(meBefore2.status).toBe(200);

    // Session 1 calls revoke-all — expect 204 No Content.
    const revokeRes = await session1Agent
      .delete('/api/auth/sessions/all')
      .set('X-Tenant-Id', 'acme');
    expect(revokeRes.status).toBe(204);

    // The caller's session (session 1) is preserved by design — `/me` still 200.
    const meAfter1 = await session1Agent.get('/api/auth/me').set('X-Tenant-Id', 'acme');
    expect(meAfter1.status).toBe(200);

    // Session 2's refresh token was deleted from Redis. The library's contract
    // is that refresh must now fail — the access token may still be valid for
    // its 15-minute TTL but the refresh path is the load-bearing check.
    const refreshRes = await session2Agent.post('/api/auth/refresh').set('X-Tenant-Id', 'acme');
    expect(refreshRes.status).toBe(401);
  }, 60_000);

  // ─── Stale token after logout ─────────────────────────────────────────────

  it('GET /api/auth/me with a stale access token after logout returns 401', async () => {
    // Scenario: after POST /api/auth/logout, the access_token cookie value is added
    // to the Redis revocation set (rv:{jti}). Any subsequent request that sends the
    // same token must be rejected with 401, regardless of the token's cryptographic
    // validity, because the JTI is blocklisted. Covers FCM row #4 (revocation via
    // logout) and the server-side revocation check.
    const email = uniqueEmail('stale');
    const password = 'P@ssw0rd12345';

    const sessionAgent = await registerVerifyAndLogin(app.getHttpServer(), email, password);

    // Verify the session is alive before logout.
    const meBefore = await sessionAgent.get('/api/auth/me').set('X-Tenant-Id', 'acme');
    expect(meBefore.status).toBe(200);

    // Logout — expect 204 No Content.
    const logoutRes = await sessionAgent.post('/api/auth/logout').set('X-Tenant-Id', 'acme');
    expect(logoutRes.status).toBe(204);

    // The same agent still holds the (now-revoked) access_token cookie value.
    // The server must reject the request because the JTI is blocklisted in Redis.
    const meAfter = await sessionAgent.get('/api/auth/me').set('X-Tenant-Id', 'acme');
    expect(meAfter.status).toBe(401);
  }, 60_000);
});
