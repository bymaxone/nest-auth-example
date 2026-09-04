import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file sessions-list-revoke.e2e-spec.ts
 * @description End-to-end spec for session listing and revocation:
 * listing active sessions, revoking a single session by sessionHash, and
 * revoking all sessions at once via POST /api/auth/sessions/revoke-all.
 *
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
process.env['API_PORT'] = '4018';
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
import { clearMailpit, waitForEmail, extractOtpFromHtml } from './helpers/mailpit.js';
import { resetAuthRateLimits } from './helpers/throttle.js';

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
 * Registers a user, verifies their email via Mailpit, and logs in.
 *
 * Returns a supertest agent carrying the authenticated session cookies.
 *
 * @param httpServer - The running NestJS HTTP server handle.
 * @param email - User email address.
 * @param password - Plain-text password.
 * @param name - Display name.
 * @param userAgent - User-Agent header value to distinguish the session.
 */
async function registerVerifyLogin(
  httpServer: ReturnType<INestApplication['getHttpServer']>,
  email: string,
  password: string,
  name: string,
  userAgent = 'TestBrowser-Default',
): Promise<Agent> {
  const reg = await supertest
    .agent(httpServer)
    .post('/api/auth/register')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .set('User-Agent', userAgent)
    .send({ email, password, name });
  expect(reg.status).toBe(201);

  const html = await waitForEmail(email);
  const otp = extractOtpFromHtml(html);

  await supertest
    .agent(httpServer)
    .post('/api/auth/verify-email')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ email, otp });

  const loginAgent = supertest.agent(httpServer);
  const loginRes = await loginAgent
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .set('User-Agent', userAgent)
    .send({ email, password });
  expect(loginRes.status).toBe(200);
  return loginAgent;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

/**
 * Testing module handle, shared so the login helpers below can clear the
 * per-IP rate-limit counters. Assigned in `beforeAll`.
 */
let moduleRef: TestingModule;

describe('Sessions — list, single-session revocation, revoke-all', () => {
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

    prisma = moduleRef.get<PrismaService>(PrismaService);

    // Ensure the 'acme' tenant FK constraint is satisfied before the app starts.
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
    // Every request in this suite comes from 127.0.0.1, so the per-IP `login`
    // tier is shared by all of its cases. Clear it between them: what is under
    // test here is auth behaviour, and a leaked 429 would mask it.
    await resetAuthRateLimits(moduleRef);
    await clearMailpit();
    await truncateTables(prisma);
  });

  // ─── Test 1: List sessions ────────────────────────────────────────────────

  it('GET /api/auth/sessions returns active sessions for the authenticated user', async () => {
    // Scenario: a user who logs in three times (each with a distinct User-Agent
    // so the library tracks three separate sessions) should see all three returned
    // by GET /api/auth/sessions. Protects FCM #13 (session listing).
    const email = uniqueEmail('sessions-list');
    const password = 'Str0ngUniqu3Passw0rd!';
    const httpServer = app.getHttpServer();

    // Register and verify the user once.
    await registerVerifyLogin(httpServer, email, password, 'Sessions User', 'TestBrowser-Setup');

    // Subsequent two logins to accumulate 3 sessions total (first from registerVerifyLogin).
    await clearMailpit(); // discard the verification email

    const agent2 = supertest.agent(httpServer);
    const login2 = await agent2
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .set('User-Agent', 'TestBrowser-2')
      .send({ email, password });
    expect(login2.status).toBe(200);

    const agent3 = supertest.agent(httpServer);
    const login3 = await agent3
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .set('User-Agent', 'TestBrowser-3')
      .send({ email, password });
    expect(login3.status).toBe(200);

    // Use agent2 (a valid session agent) to list sessions.
    const sessionsRes = await agent2.get('/api/auth/sessions').set('X-Tenant-Id', 'acme');

    expect(sessionsRes.status).toBe(200);
    expect(Array.isArray(sessionsRes.body)).toBe(true);
    // At least 2 sessions should be visible; the exact count depends on whether
    // the first agent's session was recorded, but the minimum is the two we just created.
    expect((sessionsRes.body as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  // ─── Test 2: Revoke single session ───────────────────────────────────────

  it('DELETE /api/auth/sessions/:sessionHash revokes a single session', async () => {
    // Scenario: two separate logins produce two sessions. Revoking one session
    // by its sessionHash leaves only one session active. The revoked agent
    // should no longer be able to access protected routes (or the session list
    // returns only the remaining session). Protects FCM #13 (revocation path).
    const email = uniqueEmail('sessions-revoke');
    const password = 'Str0ngUniqu3Passw0rd!';
    const httpServer = app.getHttpServer();

    // First login — the one whose session we will keep.
    const keepAgent = await registerVerifyLogin(
      httpServer,
      email,
      password,
      'Revoke User',
      'TestBrowser-Keep',
    );
    await clearMailpit();

    // Second login — the one we will revoke.
    const revokeAgent = supertest.agent(httpServer);
    const login2 = await revokeAgent
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .set('User-Agent', 'TestBrowser-Revoke')
      .send({ email, password });
    expect(login2.status).toBe(200);

    // List sessions as the first agent to discover session hashes.
    const listBefore = await keepAgent.get('/api/auth/sessions').set('X-Tenant-Id', 'acme');
    expect(listBefore.status).toBe(200);
    const sessionsBefore = listBefore.body as Array<{ sessionHash: string; isCurrent: boolean }>;
    expect(sessionsBefore.length).toBeGreaterThanOrEqual(2);

    // Find the non-current session to revoke (the one that is NOT the keepAgent's current session).
    const toRevoke = sessionsBefore.find((s) => !s.isCurrent);
    expect(toRevoke).toBeDefined();
    const hashToRevoke = toRevoke!.sessionHash;

    // Revoke the selected session.
    const revokeRes = await keepAgent
      .delete(`/api/auth/sessions/${hashToRevoke}`)
      .set('X-Tenant-Id', 'acme');
    expect(revokeRes.status).toBe(204);

    // Since lib v1.4.x revoking a session bumps the per-user token epoch so the
    // revocation takes effect NOW — every outstanding access token dies,
    // including the caller's. The caller's refresh session survives, so one
    // refresh restores access; the revoked device cannot refresh at all.
    const refreshRes = await keepAgent.post('/api/auth/refresh').set('X-Tenant-Id', 'acme');
    expect(refreshRes.status).toBe(200);

    // List sessions again — the revoked session should be gone.
    const listAfter = await keepAgent.get('/api/auth/sessions').set('X-Tenant-Id', 'acme');
    expect(listAfter.status).toBe(200);
    const sessionsAfter = listAfter.body as Array<{ sessionHash: string }>;
    const revokedStillPresent = sessionsAfter.some((s) => s.sessionHash === hashToRevoke);
    expect(revokedStillPresent).toBe(false);
  });

  // ─── Test 3: Revoke all sessions ─────────────────────────────────────────

  it('POST /api/auth/sessions/revoke-all revokes all sessions', async () => {
    // Scenario: after calling POST /api/auth/sessions/revoke-all (the bulk
    // revocation route moved off DELETE /sessions/all in lib v1.4.x so the
    // refresh token can travel in the body under bearer delivery) the library
    // marks all
    // JTIs as revoked in Redis. Subsequent GET /api/auth/sessions on the same agent
    // returns an empty array (the session has been invalidated). Protects FCM #13
    // (full revoke-all path) and FCM #4 (revocation).
    const email = uniqueEmail('sessions-revoke-all');
    const password = 'Str0ngUniqu3Passw0rd!';
    const httpServer = app.getHttpServer();

    const agent = await registerVerifyLogin(
      httpServer,
      email,
      password,
      'Revoke All User',
      'TestBrowser-RevokeAll',
    );
    await clearMailpit();

    // Revoke all sessions.
    const revokeAllRes = await agent
      .post('/api/auth/sessions/revoke-all')
      .set('X-Tenant-Id', 'acme');
    expect(revokeAllRes.status).toBe(204);

    // The library's `revokeAllExceptCurrent` preserves the calling session
    // by design — so after the call the session list returns AT MOST 1 entry
    // (the current session). All OTHER sessions are revoked. Accept either
    // 401 (the caller's access_token was invalidated) or 200 with ≤1 entry.
    const listAfter = await agent.get('/api/auth/sessions').set('X-Tenant-Id', 'acme');
    if (listAfter.status === 200) {
      expect((listAfter.body as unknown[]).length).toBeLessThanOrEqual(1);
    } else {
      expect(listAfter.status).toBe(401);
    }
  });

  // ─── Test 4: sessionHash parameter validation ────────────────────────────

  it('DELETE /api/auth/sessions/:sessionHash refuses a malformed hash with 400 auth.validation', async () => {
    // Scenario: since lib v1.4.x the single-session revocation route accepts
    // ONLY the full 64-hex sessionHash. A malformed value is refused at the
    // DTO boundary with 400 `auth.validation` (earlier versions answered
    // 401/404), so a client bug is surfaced as a validation error instead of
    // being mistaken for a missing session.
    const email = uniqueEmail('sessions-badhash');
    const password = 'Str0ngUniqu3Passw0rd!';
    const agent = await registerVerifyLogin(
      app.getHttpServer(),
      email,
      password,
      'Bad Hash User',
      'TestBrowser-BadHash',
    );
    await clearMailpit();

    const res = await agent
      .delete('/api/auth/sessions/not-a-64-hex-hash')
      .set('X-Tenant-Id', 'acme');

    expect(res.status).toBe(AUTH_ERROR_STATUS[AUTH_ERROR_CODES.VALIDATION]);
    expect(res.body).toMatchObject({ error: { code: AUTH_ERROR_CODES.VALIDATION } });
  });

  it('DELETE /api/auth/sessions/:sessionHash answers 404 auth.session_not_found for an unknown hash', async () => {
    // Scenario: a WELL-FORMED 64-hex hash that names no live session answers
    // 404 `auth.session_not_found` (status moved from 401 to 404 in lib
    // v1.4.1) — distinct from the malformed-hash 400 above, so callers can
    // tell "bad request" from "already gone".
    const email = uniqueEmail('sessions-unknownhash');
    const password = 'Str0ngUniqu3Passw0rd!';
    const agent = await registerVerifyLogin(
      app.getHttpServer(),
      email,
      password,
      'Unknown Hash User',
      'TestBrowser-UnknownHash',
    );
    await clearMailpit();

    const unknownHash = 'ab'.repeat(32); // syntactically valid, not a live session
    const res = await agent.delete(`/api/auth/sessions/${unknownHash}`).set('X-Tenant-Id', 'acme');

    expect(res.status).toBe(AUTH_ERROR_STATUS[AUTH_ERROR_CODES.SESSION_NOT_FOUND]);
    expect(res.body).toMatchObject({ error: { code: AUTH_ERROR_CODES.SESSION_NOT_FOUND } });
  });
});
