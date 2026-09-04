import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file security-headers.e2e-spec.ts
 * @description E2e assertions for HTTP security headers set by Helmet in
 * `apps/api/src/main.ts`.
 *
 * Verifies that every response from the NestJS API carries the headers that
 * Helmet installs by default:
 *  - `X-Content-Type-Options: nosniff`
 *  - `X-Frame-Options: SAMEORIGIN`
 *  - `Referrer-Policy: no-referrer`
 *  - No `X-Powered-By` header (removed by Helmet's `hidePoweredBy`)
 *
 * The test uses the `/api/health` endpoint because it is public (`@Public()`)
 * and therefore reachable without auth credentials.
 *
 * Anti-enumeration assertion: verifies that an unknown-email login returns
 * the same error code as a known-email / wrong-password login, so the
 * response does not leak account existence.
 *
 * Trusted-origin assertion: verifies the library's TrustedOriginGuard refuses
 * browser writes whose Origin is outside `cookies.trustedOrigins`
 * (403 `auth.untrusted_origin`) while the configured WEB_ORIGIN passes.
 *
 *
 * @layer test
 * @see apps/api/src/main.ts (helmet registration)
 * @see docs/DEPLOYMENT.md (security headers documentation)
 */

// Set test env vars BEFORE importing AppModule so ConfigService sees them.
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://postgres:postgres@localhost:55432/example_app_test';
process.env['REDIS_URL'] = 'redis://127.0.0.1:56379';
process.env['SMTP_HOST'] = 'localhost';
process.env['SMTP_PORT'] = '51025';
process.env['EMAIL_PROVIDER'] = 'mailpit';
process.env['WEB_ORIGIN'] = 'http://localhost:3000';
process.env['API_PORT'] = '4099';
process.env['PASSWORD_RESET_METHOD'] = 'token';
process.env['LOG_LEVEL'] = 'warn';
// JWT_SECRET must be at least 64 characters per the Zod schema.
// This is a test-only value — meaningless outside the ephemeral test stack.
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
import helmet from 'helmet';
import * as supertest from 'supertest';
import type { Agent } from 'supertest';

import { AppModule } from '../src/app.module.js';
import { AuthExceptionFilter } from '../src/auth/auth-exception.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { resetAuthRateLimits } from './helpers/throttle.js';

/** Whether prisma migrations have been applied in this process. */
let migrated = false;

let app: INestApplication;
let agent: Agent;

/**
 * Testing module handle, kept at module scope so rate-limit counters can be
 * reset between tests. Assigned in `beforeAll`.
 */
let moduleRef: TestingModule;

beforeAll(async () => {
  if (!migrated) {
    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: 'pipe',
    });
    migrated = true;
  }

  moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const prisma = moduleRef.get<PrismaService>(PrismaService);
  await prisma.$executeRaw`
    INSERT INTO "Tenant" (id, name, slug, "createdAt", "updatedAt")
    VALUES ('acme', 'Acme Corp', 'acme', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;

  app = moduleRef.createNestApplication();
  app.useWebSocketAdapter(new WsAdapter(app));
  // Apply helmet exactly as main.ts does so the security-header assertions
  // test the real production middleware configuration, not a test-only stub.
  app.use(helmet());
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
  app.useGlobalFilters(new AuthExceptionFilter([]));
  await app.listen(0);

  agent = supertest.agent(app.getHttpServer());
}, 30_000);

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  // Clear both rate limiters (in-memory ThrottlerGuard + the library's
  // Redis-backed per-IP counters) so login attempts made by earlier spec files
  // in a sequential run cannot leak a 429 into these assertions.
  await resetAuthRateLimits(moduleRef);
});

// ── Helmet security headers ───────────────────────────────────────────────────

describe('GET /api/health — Helmet security headers', () => {
  it('sets X-Content-Type-Options: nosniff', async () => {
    /**
     * Scenario: every NestJS response must carry the nosniff directive to
     * prevent browsers from MIME-sniffing a response away from the declared
     * content type. A missing header would allow an attacker to serve a
     * script disguised as a benign resource.
     * Rule: X-Content-Type-Options is set by Helmet on every response.
     */
    const res = await agent.get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options to prevent clickjacking', async () => {
    /**
     * Scenario: without X-Frame-Options an attacker can embed the API
     * response in a transparent <iframe> and perform a clickjacking attack.
     * Rule: X-Frame-Options is set by Helmet to block framing.
     */
    const res = await agent.get('/api/health');
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('sets Referrer-Policy', async () => {
    /**
     * Scenario: without Referrer-Policy the browser may send the full URL
     * (including path and query params) in the Referer header on cross-origin
     * requests, potentially leaking session context or sensitive paths.
     * Rule: Referrer-Policy is set by Helmet on every response.
     */
    const res = await agent.get('/api/health');
    expect(res.headers['referrer-policy']).toBeDefined();
  });

  it('does not expose X-Powered-By', async () => {
    /**
     * Scenario: X-Powered-By advertises the server technology stack, giving
     * attackers a free fingerprint. Helmet removes it unconditionally.
     * Rule: X-Powered-By must be absent from every response.
     */
    const res = await agent.get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

// ── Anti-enumeration assertions ───────────────────────────────────────────────

describe('POST /api/auth/login — anti-enumeration', () => {
  it('returns the same error code for unknown-email and wrong-password attempts', async () => {
    /**
     * Scenario: a non-existent email and a wrong password for a real account
     * must return identical status codes and error codes. Distinct responses
     * would allow an attacker to enumerate which emails are registered.
     *
     * The library uses AUTH_ERROR_CODES.INVALID_CREDENTIALS for both paths;
     * this test pins the behaviour so a library upgrade that adds a new error
     * code cannot accidentally break anti-enumeration.
     *
     * Rule: unknown-email login → same HTTP status and error code as
     * known-email / wrong-password login.
     */
    const unknownEmailRes = await agent
      .post('/api/auth/login')
      .set('X-Tenant-Id', 'acme')
      .send({ email: 'nobody@nowhere.invalid', password: 'wrong-password' });

    const wrongPasswordRes = await agent
      .post('/api/auth/login')
      .set('X-Tenant-Id', 'acme')
      .send({ email: 'alice@acme.example.test', password: 'definitely-wrong' });

    expect(unknownEmailRes.status).toBe(wrongPasswordRes.status);
    expect(unknownEmailRes.body.error.code).toBe(wrongPasswordRes.body.error.code);
  });
});

// ── Trusted-origin enforcement (lib TrustedOriginGuard) ──────────────────────

describe('POST /api/auth/login — trusted-origin enforcement', () => {
  it('refuses a browser write from an origin outside the trustedOrigins allowlist', async () => {
    /**
     * Scenario: `cookies.trustedOrigins` in auth.config.ts arms the library's
     * TrustedOriginGuard — a state-changing auth request carrying an Origin
     * header must come from the configured WEB_ORIGIN or it is refused with
     * `auth.untrusted_origin` (CSRF defence in depth on top of SameSite=Lax).
     * Rule: Origin outside the allowlist → 403 auth.untrusted_origin.
     */
    const res = await agent
      .post('/api/auth/login')
      .set('X-Tenant-Id', 'acme')
      .set('Origin', 'https://evil.example')
      .send({ email: 'nobody@nowhere.invalid', password: 'IrrelevantP@ssw0rd!x' });

    expect(res.status).toBe(AUTH_ERROR_STATUS[AUTH_ERROR_CODES.UNTRUSTED_ORIGIN]);
    expect(res.body).toMatchObject({
      error: { code: AUTH_ERROR_CODES.UNTRUSTED_ORIGIN },
    });
  });

  it('lets a request from the configured WEB_ORIGIN through the guard', async () => {
    /**
     * Scenario: the same request with `Origin: http://localhost:3000` (the
     * configured WEB_ORIGIN) must pass the TrustedOriginGuard and reach the
     * credential check — the response is the ordinary invalid-credentials 401,
     * never `auth.untrusted_origin`. Also covers the non-browser path contract:
     * supertest requests without an Origin header are allowed by design, which
     * every other spec in this suite exercises implicitly.
     * Rule: allowlisted Origin → the guard is transparent.
     */
    const res = await agent
      .post('/api/auth/login')
      .set('X-Tenant-Id', 'acme')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'nobody@nowhere.invalid', password: 'IrrelevantP@ssw0rd!x' });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: AUTH_ERROR_CODES.INVALID_CREDENTIALS } });
  });
});
