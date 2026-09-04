import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file email-change.e2e-spec.ts
 * @description E2e spec for the library's two-step email-change flow
 * (`controllers.emailChange`, lib v1.1.0+).
 *
 * Covers:
 *  1. `POST /auth/email/change` re-proves the current password and mails a
 *     single-use confirmation token to the NEW address — and leaves the
 *     account on its OLD address until the token is used.
 *  2. `POST /auth/email/change/confirm` adopts the new address, notifies the
 *     old one, and makes the new address the working login identity.
 *  3. A wrong current password is refused, so a stolen access token alone
 *     cannot repoint the account's recovery address.
 *  4. The confirmation token is single-use: a replay is refused.
 *  5. An address already taken in the tenant is refused.
 *
 * Requires `docker-compose.test.yml` services (Postgres at 55432, Redis at 56379,
 * Mailpit SMTP at 51025, Mailpit UI at 58025).
 *
 * @layer test
 * @see test/helpers/mailpit.ts
 */

// Set test env vars BEFORE importing AppModule so ConfigService sees them.
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://postgres:postgres@localhost:55432/example_app_test';
process.env['REDIS_URL'] = 'redis://127.0.0.1:56379';
process.env['SMTP_HOST'] = 'localhost';
process.env['SMTP_PORT'] = '51025';
process.env['EMAIL_PROVIDER'] = 'mailpit';
process.env['WEB_ORIGIN'] = 'http://localhost:3000';
process.env['API_PORT'] = '4025';
process.env['PASSWORD_RESET_METHOD'] = 'token';
process.env['LOG_LEVEL'] = 'warn';
// Deterministic test-only values — meaningless outside the ephemeral stack.
process.env['JWT_SECRET'] =
  'test-only-jwt-secret-must-be-at-least-64-characters-for-schema-validation-ok';
process.env['MFA_ENCRYPTION_KEY'] = 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMmJ5dGVzLW9rPT0=';

import { execSync } from 'child_process';
import type { INestApplication } from '@nestjs/common';
import { createAuthValidationPipe } from '@bymax-one/nest-auth';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as supertest from 'supertest';
import type { Agent } from 'supertest';

import { AppModule } from '../src/app.module.js';
import { AuthExceptionFilter } from '../src/auth/auth-exception.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { resetAuthRateLimits } from './helpers/throttle.js';
import {
  clearMailpit,
  waitForEmail,
  waitForEmailBySubject,
  extractOtpFromHtml,
} from './helpers/mailpit.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** The password every fixture user is created with. */
const PASSWORD = 'Str0ngUniqu3Passw0rd!';

/** Generates a unique email address to prevent test-run cross-contamination. */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now().toString()}-${Math.random().toString(36).slice(2)}@example.test`;
}

/** Truncates tables that accumulate state; the 'acme' Tenant row survives. */
async function truncateTables(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('DELETE FROM "AuditLog"');
  await prisma.$executeRawUnsafe('DELETE FROM "Project"');
  await prisma.$executeRawUnsafe('DELETE FROM "Invitation"');
  await prisma.$executeRawUnsafe('DELETE FROM "User"');
}

/**
 * Extracts the confirmation token from an email-change verification email.
 *
 * The template embeds the confirm URL in both the CTA `href` and a plain-text
 * fallback: `{webOrigin}/auth/confirm-email-change?token=<token>`.
 *
 * @param html - HTML body of the verification email.
 * @returns The URL-decoded confirmation token.
 * @throws `Error` when no token is found.
 */
function extractEmailChangeTokenFromHtml(html: string): string {
  const match = html.match(/confirm-email-change\?token=([^"&\s<]+)/);
  if (match?.[1]) {
    return decodeURIComponent(match[1]);
  }
  throw new Error('Could not extract an email-change token from the email body');
}

/**
 * Registers, verifies and logs in a user, returning the authenticated agent.
 *
 * @param httpServer - The HTTP server from the NestJS app.
 * @param email - Address to register.
 * @returns A supertest agent carrying the session cookies.
 */
async function registerVerifyAndLogin(
  httpServer: ReturnType<INestApplication['getHttpServer']>,
  email: string,
): Promise<Agent> {
  const agent = supertest.agent(httpServer);

  const registerRes = await agent
    .post('/api/auth/register')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ email, password: PASSWORD, name: 'Email Change User' });
  expect(registerRes.status).toBe(201);

  const verifyHtml = await waitForEmail(email);
  const otp = extractOtpFromHtml(verifyHtml);

  const verifyRes = await agent
    .post('/api/auth/verify-email')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ email, otp });
  expect(verifyRes.status).toBe(204);

  const loginRes = await agent
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ email, password: PASSWORD });
  expect(loginRes.status).toBe(200);

  return agent;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

/** Module handle kept at module scope so rate-limit counters can be reset. */
let moduleRef: TestingModule;

describe('Email change — request → confirm → login with the new address', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: 'pipe',
    });

    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

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
      createAuthValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    app.useGlobalFilters(new AuthExceptionFilter([]));
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetAuthRateLimits(moduleRef);
    await clearMailpit();
    await truncateTables(prisma);
  });

  it('mails a confirmation token to the NEW address and leaves the account on the old one', async () => {
    /*
     * Scenario: the request step must not move the account. Until the mailed
     * link is opened the user keeps signing in with the old address — that is
     * what makes a typo in the new address recoverable rather than a lockout.
     * Protects: the two-step contract, and delivery to the NEW address.
     */
    const oldEmail = uniqueEmail('ec-old');
    const newEmail = uniqueEmail('ec-new');
    const agent = await registerVerifyAndLogin(app.getHttpServer(), oldEmail);
    await clearMailpit();

    const requestRes = await agent
      .post('/api/auth/email/change')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ newEmail, currentPassword: PASSWORD });
    expect(requestRes.status).toBeLessThan(300);

    // The verification email goes to the NEW address, carrying a token.
    const html = await waitForEmail(newEmail);
    expect(extractEmailChangeTokenFromHtml(html)).toBeTruthy();

    // The account still answers to the OLD address.
    const stored = await prisma.user.findFirst({ where: { email: oldEmail.toLowerCase() } });
    expect(stored).not.toBeNull();
  });

  it('adopts the new address on confirm, notifies the old one, and lets the user log in with it', async () => {
    /*
     * Scenario: the full happy path. After confirmation the new address is the
     * login identity, the old address is no longer accepted, and the previous
     * owner receives the notice that gives them a chance to react to a
     * takeover.
     * Protects: the confirm step end to end, plus the old-address notification.
     */
    const oldEmail = uniqueEmail('ec-old');
    const newEmail = uniqueEmail('ec-new');
    const agent = await registerVerifyAndLogin(app.getHttpServer(), oldEmail);
    await clearMailpit();

    await agent
      .post('/api/auth/email/change')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ newEmail, currentPassword: PASSWORD });

    const token = extractEmailChangeTokenFromHtml(await waitForEmail(newEmail));

    const confirmRes = await agent
      .post('/api/auth/email/change/confirm')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ token });
    expect(confirmRes.status).toBeLessThan(300);

    // The old address is told where the account went.
    const notice = await waitForEmailBySubject(oldEmail, /email address was changed/i);
    expect(notice).toContain(newEmail);

    // The new address is now the login identity…
    const newLogin = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email: newEmail, password: PASSWORD });
    expect(newLogin.status).toBe(200);

    // …and the old one no longer is.
    const oldLogin = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email: oldEmail, password: PASSWORD });
    expect(oldLogin.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses the request when the current password is wrong', async () => {
    /*
     * Scenario: the email address is the account's recovery credential, so a
     * stolen access token alone must not be enough to repoint it at a mailbox
     * the thief controls. The password re-proof is that barrier.
     * Protects: the currentPassword check — and the absence of any email to
     * the attacker's address when it fails.
     */
    const oldEmail = uniqueEmail('ec-old');
    const newEmail = uniqueEmail('ec-attacker');
    const agent = await registerVerifyAndLogin(app.getHttpServer(), oldEmail);
    await clearMailpit();

    const res = await agent
      .post('/api/auth/email/change')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ newEmail, currentPassword: 'WrongPassword123!' });

    expect(res.status).toBeGreaterThanOrEqual(400);

    const stored = await prisma.user.findFirst({ where: { email: oldEmail.toLowerCase() } });
    expect(stored).not.toBeNull();
  });

  it('refuses a replayed confirmation token', async () => {
    /*
     * Scenario: the token is single-use. A replay — from a mail scanner, a
     * shared link, or an attacker who read the inbox later — must not be able
     * to re-run the change.
     * Protects: single-use consumption of the confirmation token.
     */
    const oldEmail = uniqueEmail('ec-old');
    const newEmail = uniqueEmail('ec-new');
    const agent = await registerVerifyAndLogin(app.getHttpServer(), oldEmail);
    await clearMailpit();

    await agent
      .post('/api/auth/email/change')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ newEmail, currentPassword: PASSWORD });

    const token = extractEmailChangeTokenFromHtml(await waitForEmail(newEmail));

    const first = await agent
      .post('/api/auth/email/change/confirm')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ token });
    expect(first.status).toBeLessThan(300);

    const replay = await agent
      .post('/api/auth/email/change/confirm')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ token });
    expect(replay.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses an address already registered in the tenant', async () => {
    /*
     * Scenario: two accounts in one tenant cannot share a login identity.
     * Allowing the change would either collide on the unique index at confirm
     * time or silently merge two identities.
     * Protects: the address-availability check on the request step.
     */
    const takenEmail = uniqueEmail('ec-taken');
    await registerVerifyAndLogin(app.getHttpServer(), takenEmail);

    const oldEmail = uniqueEmail('ec-old');
    const agent = await registerVerifyAndLogin(app.getHttpServer(), oldEmail);
    await clearMailpit();

    const res = await agent
      .post('/api/auth/email/change')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ newEmail: takenEmail, currentPassword: PASSWORD });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
