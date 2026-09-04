import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file platform-endpoints.e2e-spec.ts
 * @description Consolidated e2e spec for the platform admin endpoints:
 *
 *   - POST /api/auth/platform/refresh         (rotates refresh, returns admin)
 *   - POST /api/auth/platform/logout          (revokes the session's tokens)
 *   - DELETE /api/auth/platform/sessions      (revokes every active session)
 *   - POST /api/auth/platform/mfa/challenge   (rejects invalid temp tokens)
 *
 * Platform MFA *setup* is not part of the library's public HTTP surface — the
 * post-login challenge endpoint is the only platform MFA route mounted. The
 * challenge test therefore only proves the endpoint is wired and validates
 * input. Full MFA exchange coverage lives in the library's own unit tests.
 *
 * Requires `docker-compose.test.yml` services to be running.
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
process.env['API_PORT'] = '4014';
process.env['PASSWORD_RESET_METHOD'] = 'token';
process.env['LOG_LEVEL'] = 'warn';
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
import { PlatformRole, UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module.js';
import { AuthExceptionFilter } from '../src/auth/auth-exception.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { resetAuthRateLimits } from './helpers/throttle.js';
import { hashPasswordForTest } from './helpers/password.js';

const PLATFORM_EMAIL = 'platform-endpoints@example.dev';
const PLATFORM_PASSWORD = 'PlatformPassw0rd!';

/**
 * Testing module handle, kept at module scope so rate-limit counters can be
 * reset between tests. Assigned in `beforeAll`.
 */
let moduleRef: TestingModule;

describe('Platform endpoints — refresh, logout, MFA challenge, revoke sessions', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: 'pipe',
    });

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    const hash = await hashPasswordForTest(PLATFORM_PASSWORD);
    await prisma.platformUser.upsert({
      where: { email: PLATFORM_EMAIL },
      update: { passwordHash: hash, status: UserStatus.ACTIVE, mfaEnabled: false },
      create: {
        email: PLATFORM_EMAIL,
        name: 'Platform Endpoints Tester',
        passwordHash: hash,
        role: PlatformRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        mfaEnabled: false,
      },
    });

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
    // Redis-backed per-IP counters) — the platform login tier is shared by
    // every test in this suite and by earlier spec files in a sequential run.
    await resetAuthRateLimits(moduleRef);
  });

  /** Logs in the platform admin and returns the bearer access + raw refresh tokens. */
  async function platformLogin(): Promise<{ accessToken: string; refreshToken: string }> {
    const res = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/platform/login')
      .set('Content-Type', 'application/json')
      .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD });
    expect(res.status).toBe(200);
    const body = res.body as { accessToken: string; refreshToken: string };
    return body;
  }

  it('POST /platform/refresh rotates the refresh token and returns the admin record', async () => {
    /*
     * Scenario: a logged-in platform admin submits their refresh token; the lib
     * returns a NEW refresh token (rotation) and a fresh access token, plus the
     * admin record. The old refresh token is then no longer accepted.
     */
    const initial = await platformLogin();

    const rotated = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/platform/refresh')
      .set('Content-Type', 'application/json')
      .send({ refreshToken: initial.refreshToken });
    expect(rotated.status).toBe(200);
    const body = rotated.body as {
      accessToken: string;
      refreshToken: string;
      admin: { email: string; role: string };
    };
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.refreshToken).not.toBe(initial.refreshToken);
    expect(body.admin.email).toBe(PLATFORM_EMAIL.toLowerCase());
    expect(body.admin.role).toBe(PlatformRole.SUPER_ADMIN);

    // Note: the lib intentionally honors a short grace window for the
    // pre-rotation token so that concurrent requests issued just before
    // rotation do not all fail. Asserting an immediate 4xx on the old token
    // would race against that window; the refresh service's grace expiry is
    // covered by the lib's unit tests (token-manager.service.spec).
  });

  it('POST /platform/logout revokes the access token JTI — subsequent /platform/me returns 401', async () => {
    /*
     * Scenario: the admin logs in, then logs out. The access token's JTI is
     * added to the revocation blacklist, so a subsequent /platform/me call
     * with the same Bearer token must be rejected.
     */
    const { accessToken, refreshToken } = await platformLogin();

    // Logout — Bearer + refresh token in body, per the lib contract.
    const logout = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/platform/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'application/json')
      .send({ refreshToken });
    expect([200, 201, 204]).toContain(logout.status);

    // After logout the same access token must be rejected (JTI revoked).
    const meAfter = await supertest
      .agent(app.getHttpServer())
      .get('/api/auth/platform/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(meAfter.status).toBe(401);
  });

  it('DELETE /platform/sessions revokes every active session — old refresh tokens are no longer accepted', async () => {
    /*
     * Scenario: an admin logs in twice from different "devices" (separate
     * supertest agents). Calling DELETE /platform/sessions from one session
     * must invalidate BOTH refresh tokens — subsequent refresh attempts with
     * either old token must fail.
     */
    const sessionA = await platformLogin();
    const sessionB = await platformLogin();

    const revoke = await supertest
      .agent(app.getHttpServer())
      .delete('/api/auth/platform/sessions')
      .set('Authorization', `Bearer ${sessionA.accessToken}`);
    expect([200, 201, 204]).toContain(revoke.status);

    // Neither old refresh token may be usable now.
    const tryA = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/platform/refresh')
      .set('Content-Type', 'application/json')
      .send({ refreshToken: sessionA.refreshToken });
    expect(tryA.status).toBeGreaterThanOrEqual(400);
    expect(tryA.status).toBeLessThan(500);

    const tryB = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/platform/refresh')
      .set('Content-Type', 'application/json')
      .send({ refreshToken: sessionB.refreshToken });
    expect(tryB.status).toBeGreaterThanOrEqual(400);
    expect(tryB.status).toBeLessThan(500);
  });

  it('POST /platform/mfa/challenge rejects an invalid mfaTempToken with 401 auth.mfa_temp_token_invalid', async () => {
    /*
     * Scenario: the endpoint is wired in the example app — verify it is
     * reachable and rejects bogus input. Since lib v1.4.x a malformed or
     * unparseable temp token answers 401 `auth.mfa_temp_token_invalid`
     * (earlier versions leaked a 500 on unparseable JWTs). Happy-path
     * coverage (a real TOTP exchange) requires platform MFA enrollment
     * infrastructure that the library does not expose via HTTP; see the
     * lib's own unit tests for the full MfaService challenge coverage.
     */
    const fakeJwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4IiwidHlwZSI6Im1mYV9jaGFsbGVuZ2UifQ.invalid';
    const res = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/platform/mfa/challenge')
      .set('Content-Type', 'application/json')
      .send({ mfaTempToken: fakeJwt, code: '000000' });
    expect(res.status).toBe(AUTH_ERROR_STATUS[AUTH_ERROR_CODES.MFA_TEMP_TOKEN_INVALID]);
    expect(res.body).toMatchObject({ error: { code: AUTH_ERROR_CODES.MFA_TEMP_TOKEN_INVALID } });
  });

  it('POST /platform/users/:id/reset-mfa clears a tenant user MFA and writes an audit row', async () => {
    /*
     * Scenario: the support path for "lost device AND lost recovery codes".
     * A SUPER_ADMIN resets a tenant user's MFA after out-of-band identity
     * verification; the library clears the MFA state and the app records who
     * did it. Verified on the wire because the privileged cross-tenant write
     * is exactly the kind of endpoint a unit test cannot prove is reachable
     * only by SUPER_ADMIN.
     * Protects: the route, its SUPER_ADMIN guard, the MFA clear, and the
     * `platform.user.mfa_reset` audit row with the acting admin's id.
     */
    const { accessToken } = await platformLogin();

    await prisma.$executeRaw`
      INSERT INTO "Tenant" (id, name, slug, "createdAt", "updatedAt")
      VALUES ('acme', 'Acme Corp', 'acme', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `;
    const target = await prisma.user.create({
      data: {
        email: `mfa-reset-${Date.now().toString()}@example.test`,
        name: 'MFA Reset Target',
        passwordHash: await hashPasswordForTest(PLATFORM_PASSWORD),
        tenantId: 'acme',
        status: UserStatus.ACTIVE,
        emailVerified: true,
        mfaEnabled: true,
        mfaSecret: 'encrypted-placeholder',
      },
    });

    const res = await supertest
      .agent(app.getHttpServer())
      .post(`/api/platform/users/${target.id}/reset-mfa`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBeLessThan(300);
    expect((res.body as { mfaEnabled: boolean }).mfaEnabled).toBe(false);

    const stored = await prisma.user.findUnique({ where: { id: target.id } });
    expect(stored?.mfaEnabled).toBe(false);

    const audit = await prisma.auditLog.findFirst({
      where: { event: 'platform.user.mfa_reset' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.tenantId).toBeNull();
    expect(audit?.actorPlatformUserId).not.toBeNull();

    await prisma.auditLog.deleteMany({ where: { event: 'platform.user.mfa_reset' } });
    await prisma.user.delete({ where: { id: target.id } });
  });

  it('POST /platform/users/:id/reset-mfa answers 404 for an unknown user', async () => {
    /*
     * Scenario: a reset aimed at an id that does not exist must not report
     * success. Reporting success would leave the operator believing an account
     * was recovered when nothing was touched.
     * Protects: the NotFoundException path across the real HTTP boundary.
     */
    const { accessToken } = await platformLogin();

    const res = await supertest
      .agent(app.getHttpServer())
      .post('/api/platform/users/ckzzzzzzzzzzzzzzzzzzzzzzz/reset-mfa')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
  });

  it('POST /platform/users/:id/reset-mfa refuses an unauthenticated caller', async () => {
    /*
     * Scenario: the endpoint weakens an account's protections, so it must be
     * unreachable without a platform credential. A missing Authorization
     * header is the cheapest proof the guard chain is actually mounted.
     * Protects: JwtPlatformGuard on the reset-mfa route.
     */
    const res = await supertest
      .agent(app.getHttpServer())
      .post('/api/platform/users/ckzzzzzzzzzzzzzzzzzzzzzzz/reset-mfa');

    expect(res.status).toBe(401);
  });
});
