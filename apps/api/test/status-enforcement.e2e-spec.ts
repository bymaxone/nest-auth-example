import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file status-enforcement.e2e-spec.ts
 * @description Phase 17 e2e spec for account status enforcement.
 *
 * Verifies that the `UserStatusGuard` blocks suspended users on every
 * authenticated request, and that re-activating a suspended user restores
 * their ability to log in.
 *
 * Covers FCM row #23 (account status enforcement — UserStatusGuard wiring).
 *
 * Requires `docker-compose.test.yml` services to be running (Postgres at 55432,
 * Redis at 56379, Mailpit SMTP at 51025, Mailpit UI at 58025).
 *
 * @layer test
 * @see docs/DEVELOPMENT_PLAN.md §Phase 17 P17-7
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
process.env['API_PORT'] = '4024';
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
import { Role } from '@prisma/client';

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
 */
async function truncateTables(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('DELETE FROM "AuditLog"');
  await prisma.$executeRawUnsafe('DELETE FROM "Project"');
  await prisma.$executeRawUnsafe('DELETE FROM "Invitation"');
  await prisma.$executeRawUnsafe('DELETE FROM "User"');
}

/**
 * Registers, verifies, and logs in a user, then optionally promotes their role.
 *
 * Returns a supertest agent carrying the authenticated session cookies.
 *
 * @param httpServer - The running NestJS HTTP server handle.
 * @param prisma - PrismaService for direct role promotion.
 * @param email - User email address.
 * @param password - Plain-text password.
 * @param name - Display name.
 * @param role - Role to set before issuing the login JWT (default: MEMBER).
 */
async function registerVerifyLogin(
  httpServer: ReturnType<INestApplication['getHttpServer']>,
  prisma: PrismaService,
  email: string,
  password: string,
  name: string,
  role: Role = Role.MEMBER,
): Promise<Agent> {
  const regRes = await supertest
    .agent(httpServer)
    .post('/api/auth/register')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ email, password, name, tenantId: 'acme' });
  expect(regRes.status).toBe(201);

  const html = await waitForEmail(email);
  const otp = extractOtpFromHtml(html);

  await supertest
    .agent(httpServer)
    .post('/api/auth/verify-email')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ email, otp, tenantId: 'acme' });

  if (role !== Role.MEMBER) {
    await prisma.user.updateMany({
      where: { email: email.toLowerCase(), tenantId: 'acme' },
      data: { role },
    });
  }

  const loginAgent = supertest.agent(httpServer);
  const loginRes = await loginAgent
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', 'acme')
    .send({ email, password, tenantId: 'acme' });
  expect(loginRes.status).toBe(200);
  return loginAgent;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Status enforcement — suspended users are blocked by UserStatusGuard', () => {
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

  // ─── Test 1: Suspended user is blocked ───────────────────────────────────

  it('admin suspending a user causes subsequent /me requests to return 401/403', async () => {
    // Scenario: an ADMIN suspends a MEMBER after that MEMBER has already logged in.
    // The UserStatusGuard checks the DB on every authenticated request, so even
    // though the MEMBER's JWT may still be within its 15-minute validity window,
    // subsequent calls to GET /api/auth/me or GET /api/projects must return 401 or
    // 403 with a USER_BLOCKED error code. Protects FCM #23.
    const httpServer = app.getHttpServer();

    const adminEmail = uniqueEmail('status-admin');
    const adminAgent = await registerVerifyLogin(
      httpServer,
      prisma,
      adminEmail,
      'P@ssw0rd12345',
      'Status Admin',
      Role.ADMIN,
    );
    await clearMailpit();

    const memberEmail = uniqueEmail('status-member');
    const memberAgent = await registerVerifyLogin(
      httpServer,
      prisma,
      memberEmail,
      'P@ssw0rd12345',
      'Status Member',
    );
    await clearMailpit();

    // Confirm the member can access a protected route before suspension.
    const meBeforeRes = await memberAgent.get('/api/auth/me').set('X-Tenant-Id', 'acme');
    expect(meBeforeRes.status).toBe(200);
    const memberId = (meBeforeRes.body as { id: string }).id;

    // Admin suspends the member.
    const suspendRes = await adminAgent
      .patch(`/api/users/${memberId}/status`)
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ status: 'SUSPENDED' });
    expect(suspendRes.status).toBe(200);

    // The member's next request must be blocked by UserStatusGuard.
    // The guard checks the database on every request so the JWT's remaining
    // validity time does not matter — the DB status takes precedence.
    const meAfterRes = await memberAgent.get('/api/auth/me').set('X-Tenant-Id', 'acme');
    expect([401, 403]).toContain(meAfterRes.status);

    // Also check a different protected route to confirm the guard is global.
    const projectsAfterRes = await memberAgent.get('/api/projects').set('X-Tenant-Id', 'acme');
    expect([401, 403]).toContain(projectsAfterRes.status);
  });

  // ─── Test 2: Re-activating a suspended user restores login ───────────────

  it('re-activating a suspended user allows them to log in again', async () => {
    // Scenario: after a user is suspended and then re-activated by an ADMIN, they
    // must be able to log in successfully (200). The UserStatusGuard re-reads the
    // DB status, so re-activation takes effect immediately. Protects FCM #23
    // (status lifecycle: ACTIVE → SUSPENDED → ACTIVE).
    const httpServer = app.getHttpServer();

    const adminEmail = uniqueEmail('reactivate-admin');
    const adminAgent = await registerVerifyLogin(
      httpServer,
      prisma,
      adminEmail,
      'P@ssw0rd12345',
      'Reactivate Admin',
      Role.ADMIN,
    );
    await clearMailpit();

    const memberEmail = uniqueEmail('reactivate-member');
    const memberPassword = 'P@ssw0rd12345';
    const memberAgent = await registerVerifyLogin(
      httpServer,
      prisma,
      memberEmail,
      memberPassword,
      'Reactivate Member',
    );
    await clearMailpit();

    // Get the member's ID so the admin can target the PATCH endpoint.
    const meRes = await memberAgent.get('/api/auth/me').set('X-Tenant-Id', 'acme');
    expect(meRes.status).toBe(200);
    const memberId = (meRes.body as { id: string }).id;

    // Admin suspends the member.
    const suspendRes = await adminAgent
      .patch(`/api/users/${memberId}/status`)
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ status: 'SUSPENDED' });
    expect(suspendRes.status).toBe(200);

    // Admin re-activates the member.
    const reactivateRes = await adminAgent
      .patch(`/api/users/${memberId}/status`)
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ status: 'ACTIVE' });
    expect(reactivateRes.status).toBe(200);

    // The member can now log in again with their existing credentials.
    const freshAgent = supertest.agent(httpServer);
    const loginRes = await freshAgent
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email: memberEmail, password: memberPassword, tenantId: 'acme' });
    expect(loginRes.status).toBe(200);

    // Confirm the re-activated member can access protected routes.
    const meAfterRes = await freshAgent.get('/api/auth/me').set('X-Tenant-Id', 'acme');
    expect(meAfterRes.status).toBe(200);
  });
});
