import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file throttle-demo.e2e-spec.ts
 * @description End-to-end spec for IP-based rate limiting on the throttle-demo
 * endpoint (`GET /api/health/throttle-demo`).
 *
 * The endpoint is `@Public()` (no auth required) and applies the `login`
 * throttle tier: 5 requests per 60 seconds per IP. The 6th request from the
 * same IP must receive HTTP 429 Too Many Requests.
 *
 *
 * Requires `docker-compose.test.yml` services to be running (Postgres at 55432,
 * Redis at 56379, Mailpit SMTP at 51025, Mailpit UI at 58025).
 *
 * @layer test
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
process.env['API_PORT'] = '4021';
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
import type { TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as supertest from 'supertest';
import type { Redis } from 'ioredis';
import { BYMAX_AUTH_REDIS_CLIENT } from '@bymax-one/nest-auth';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';

import { AppModule } from '../src/app.module.js';
import { AuthExceptionFilter } from '../src/auth/auth-exception.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { flushTestKeys } from './helpers/redis.js';

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Throttle-demo — IP-based rate limiting on GET /api/health/throttle-demo', () => {
  let app: INestApplication;
  let redis: Redis;
  /** In-memory throttle storage — cleared in beforeEach so per-test counters don't bleed. */
  let throttlerStorage: ThrottlerStorageService;

  beforeAll(async () => {
    // Run migrations against the test database before bootstrapping the app.
    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: 'pipe',
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const prisma = moduleRef.get<PrismaService>(PrismaService);
    redis = moduleRef.get<Redis>(BYMAX_AUTH_REDIS_CLIENT);
    throttlerStorage = moduleRef.get<ThrottlerStorageService>(ThrottlerStorage);

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
    // Clear the in-memory ThrottlerStorageMap so each test begins with a
    // fresh counter. ThrottlerModule.forRoot uses in-memory storage by default
    // (no Redis adapter), so flushing Redis alone is insufficient.
    throttlerStorage.storage.clear();
    // Flush Redis keys as a belt-and-suspenders clean-up for any library keys
    // that accumulate across tests (e.g. brute-force counters, OTP entries).
    await flushTestKeys(redis, 'nest-auth-example:*');
  });

  // ─── Test 1: Happy path within the limit ─────────────────────────────────

  it('GET /api/health/throttle-demo returns 200 within the rate limit', async () => {
    // Scenario: the first request to the throttle-demo endpoint (a @Public()
    // route with no auth) should succeed with HTTP 200. Confirms the endpoint
    // is reachable and the throttle counter starts from zero. Covers FCM #17.
    const res = await supertest.agent(app.getHttpServer()).get('/api/health/throttle-demo');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  // ─── Test 2: Exceeding the limit returns 429 ─────────────────────────────

  it('exceeding the throttle limit returns 429 Too Many Requests', async () => {
    // Scenario: in tests all requests originate from 127.0.0.1, so the per-IP
    // counter increments on every call. The login throttle tier allows 5 requests
    // per 60 seconds. After 5 successful responses the 6th must receive HTTP 429.
    // Protects FCM #17 (IP-based rate limiting is actually enforced, not just wired).
    const httpServer = app.getHttpServer();

    // Fire 5 requests that are within the allowed limit.
    for (let i = 0; i < 5; i++) {
      const res = await supertest.agent(httpServer).get('/api/health/throttle-demo');
      // Each of the first 5 must succeed.
      expect(res.status).toBe(200);
    }

    // The 6th request must be rejected by the ThrottlerGuard.
    const overLimitRes = await supertest.agent(httpServer).get('/api/health/throttle-demo');
    expect(overLimitRes.status).toBe(429);
  });
});
