import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file new-session-alert.e2e-spec.ts
 * @description End-to-end spec for the new-session security email alert.
 *
 * The library never invokes `IEmailProvider.sendNewSessionAlert` itself —
 * consumers are responsible for dispatching the email from the `onNewSession`
 * hook. The reference app's `AppAuthHooks.onNewSession` wires the dispatch.
 *
 * This spec covers:
 *  1. After a successful login on a freshly-registered user the Mailpit inbox
 *     receives an email with subject "New sign-in detected on your account".
 *  2. The HTML body contains the device string, IP address, and session hash
 *     surfaced by the library so the recipient can identify the session.
 *  3. The audit log records a `session.new` row in parallel — proving the
 *     hook ran both side-effects.
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
process.env['API_PORT'] = '4010';
process.env['PASSWORD_RESET_METHOD'] = 'token';
process.env['LOG_LEVEL'] = 'warn';
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
import {
  clearMailpit,
  extractOtpFromHtml,
  listMailpitMessages,
  waitForEmail,
  waitForEmailBySubject,
} from './helpers/mailpit.js';

/** Generates a unique email address to prevent test-run cross-contamination. */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now().toString()}-${Math.random().toString(36).slice(2)}@example.test`;
}

/** Truncates accumulated state across runs (FK-safe order). */
async function truncateTables(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('DELETE FROM "AuditLog"');
  await prisma.$executeRawUnsafe('DELETE FROM "Project"');
  await prisma.$executeRawUnsafe('DELETE FROM "Invitation"');
  await prisma.$executeRawUnsafe('DELETE FROM "User"');
}

describe('New-session security alert — FCM #15', () => {
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
    await clearMailpit();
    await truncateTables(prisma);
  });

  it('login fires sendNewSessionAlert — Mailpit receives the "New sign-in" email', async () => {
    // Scenario: register → verify → login. Mailpit must capture an email whose
    // Subject begins with "New sign-in detected" and whose recipient matches
    // the freshly-registered user. This is the only guarantee FCM #15 makes;
    // without this assertion a refactor that drops the email dispatch would
    // ship silently. Covers FCM #15 (sendNewSessionAlert).
    const email = uniqueEmail('newsession');
    const password = 'P@ssw0rd12345';

    // Register and verify so login can succeed.
    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, name: 'New Session User', tenantId: 'acme' });

    const verifyHtml = await waitForEmail(email);
    const otp = extractOtpFromHtml(verifyHtml);
    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/verify-email')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, otp, tenantId: 'acme' });

    // Clear the inbox so only post-login emails count toward the assertion.
    await clearMailpit();

    const loginRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .set('User-Agent', 'jest-e2e/new-session')
      .send({ email, password, tenantId: 'acme' });

    expect(loginRes.status).toBe(200);

    // The hook fires after the login response — poll Mailpit until it lands.
    const alertHtml = await waitForEmailBySubject(email, /new sign-in detected/i);
    expect(alertHtml).toBeTruthy();

    // The template surfaces device, IP, and a session hash — verify each
    // section is present in the body so the recipient can identify the
    // session. Match labels (rendered by the template) and a hex chunk for
    // the session hash; the device user-agent string is parsed by the lib
    // into a short label, so we do not assert on the raw UA value.
    expect(alertHtml).toMatch(/Device/i);
    expect(alertHtml).toMatch(/IP address/i);
    expect(alertHtml).toMatch(/Session ID/i);
    // Session hash slug is hex characters — partial regex is sufficient.
    expect(alertHtml).toMatch(/[0-9a-f]{6,}/);
  });

  it('writes a session.new audit row in parallel with the email dispatch', async () => {
    // The hook does both side-effects; assert the audit row exists so the
    // forensic trail is not lost if the SMTP service is unreachable.
    const email = uniqueEmail('auditparallel');
    const password = 'P@ssw0rd12345';

    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, name: 'Audit User', tenantId: 'acme' });

    const verifyHtml = await waitForEmail(email);
    const otp = extractOtpFromHtml(verifyHtml);
    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/verify-email')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, otp, tenantId: 'acme' });

    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, tenantId: 'acme' });

    // The lib calls onNewSession via fire-and-forget — wait for the audit row
    // to actually land in Postgres before asserting. The email arrival in
    // Mailpit is the cleanest signal that the hook ran to completion (the
    // record() call happens before the email dispatch inside the hook).
    await waitForEmailBySubject(email, /new sign-in detected/i);

    // The library's HookContext for createSession does not include tenantId,
    // so the AuditLog row gets `tenantId: null` at the column level — the
    // tenant is preserved INSIDE the JSON `payload` field instead. Filter on
    // the event slug only and assert the payload carries the tenant.
    const row = await prisma.auditLog.findFirst({
      where: { event: 'session.new' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    expect(row?.payload).toMatchObject({ tenantId: 'acme' });
  });

  it('sends exactly one new-session alert per login — no duplicates', async () => {
    // Defensive — the hook must fire once. A bug that wired it twice (e.g.
    // re-binding in onLoginSuccess) would spam users and is worth pinning.
    const email = uniqueEmail('once');
    const password = 'P@ssw0rd12345';

    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, name: 'Once User', tenantId: 'acme' });

    const verifyHtml = await waitForEmail(email);
    const otp = extractOtpFromHtml(verifyHtml);
    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/verify-email')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, otp, tenantId: 'acme' });

    await clearMailpit();

    await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, tenantId: 'acme' });

    // Wait for the dispatch to complete, then count.
    await waitForEmailBySubject(email, /new sign-in detected/i);
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    const messages = await listMailpitMessages();
    const alertsForUser = messages.filter(
      (m) => /new sign-in detected/i.test(m.subject) && m.to.includes(email.toLowerCase()),
    );
    expect(alertsForUser).toHaveLength(1);
  });
});
