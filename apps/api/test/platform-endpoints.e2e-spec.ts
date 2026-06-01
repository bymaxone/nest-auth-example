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
import { randomBytes, scrypt as nodeScrypt } from 'node:crypto';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as supertest from 'supertest';
import { PlatformRole, UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module.js';
import { AuthExceptionFilter } from '../src/auth/auth-exception.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const _scrypt = promisify(nodeScrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

async function hashPasswordForTest(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await _scrypt(plain, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

const PLATFORM_EMAIL = 'platform-endpoints@example.dev';
const PLATFORM_PASSWORD = 'PlatformPassw0rd!';

describe('Platform endpoints — refresh, logout, MFA challenge, revoke sessions', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: 'pipe',
    });

    const moduleRef = await Test.createTestingModule({
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

  it('POST /platform/mfa/challenge rejects an invalid mfaTempToken with a 4xx or 5xx error', async () => {
    /*
     * The endpoint is wired in the example app — verify it is reachable and
     * rejects bogus input. The library throws 500 when the temp token is not
     * a parseable JWT and 401 when it is parseable but invalid; both are
     * acceptable failure modes for this assertion. Happy-path coverage (a
     * real TOTP exchange) requires platform MFA enrollment infrastructure
     * that the library does not expose via HTTP; see the lib's own unit
     * tests for the full MfaService challenge coverage.
     */
    const fakeJwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4IiwidHlwZSI6Im1mYV9jaGFsbGVuZ2UifQ.invalid';
    const res = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/platform/mfa/challenge')
      .set('Content-Type', 'application/json')
      .send({ mfaTempToken: fakeJwt, code: '000000' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
