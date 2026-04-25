/**
 * @file platform-isolation.e2e-spec.ts
 * @description Phase 9 e2e spec that proves platform-context tokens cannot access
 * dashboard routes, and dashboard tokens cannot access platform routes.
 *
 * This is the guard for FCM row #22: "platform admin context". If a platform JWT
 * ever passes `JwtAuthGuard` on a tenant route, or a tenant JWT ever passes
 * `JwtPlatformGuard` on a platform route, this spec fails — which is the point.
 *
 * Test scenarios:
 *   1. Platform token → GET /api/projects → 401/403 (cross-context rejection).
 *   2. Dashboard token → GET /api/platform/tenants → 401/403 (cross-context rejection).
 *   3. Platform token → GET /api/platform/tenants → 200 (positive case).
 *   4. Dashboard token → GET /api/projects → 200 (positive case, with X-Tenant-Id).
 *
 * Requires `docker-compose.test.yml` services to be running (Postgres at 55432,
 * Redis at 56379, Mailpit SMTP at 51025, Mailpit UI at 58025).
 *
 * Covers FCM row #22 (Platform admin context — isolation guarantee).
 *
 * @layer test
 * @see docs/DEVELOPMENT_PLAN.md §Phase 9 P9-3
 * @see test/helpers/mailpit.ts
 */

// Set test env vars BEFORE importing AppModule so ConfigService sees them.
// These must be set before the Zod schema parses process.env.
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://postgres:postgres@localhost:55432/example_app_test';
process.env['REDIS_URL'] = 'redis://localhost:56379';
process.env['SMTP_HOST'] = 'localhost';
process.env['SMTP_PORT'] = '51025';
process.env['EMAIL_PROVIDER'] = 'mailpit';
process.env['WEB_ORIGIN'] = 'http://localhost:3000';
process.env['API_PORT'] = '4004';
process.env['PASSWORD_RESET_METHOD'] = 'token';
process.env['LOG_LEVEL'] = 'silent';
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
import bcryptjs from 'bcryptjs';
import cookieParser from 'cookie-parser';
import * as supertest from 'supertest';
import type { Agent } from 'supertest';
import { PlatformRole, UserStatus, Role } from '@prisma/client';

import { AppModule } from '../src/app.module.js';
import { AuthExceptionFilter } from '../src/auth/auth-exception.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const TENANT_ID = 'acme-isolation-test';
const PLATFORM_EMAIL = 'platform-isolation@example.dev';
const PLATFORM_PASSWORD = 'PlatformPassw0rd!';
const SUPPORT_EMAIL = 'platform-support@example.dev';
const SUPPORT_PASSWORD = 'SupportPassw0rd!';
const DASHBOARD_EMAIL = 'dashboard-isolation@example.test';
const DASHBOARD_PASSWORD = 'P@ssw0rd12345';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Truncates all tables that accumulate state across test runs.
 * Ordering respects foreign-key constraints (child tables first).
 */
async function truncateTables(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('DELETE FROM "AuditLog"');
  await prisma.$executeRawUnsafe('DELETE FROM "Project"');
  await prisma.$executeRawUnsafe('DELETE FROM "Invitation"');
  await prisma.$executeRawUnsafe('DELETE FROM "User"');
  await prisma.$executeRawUnsafe('DELETE FROM "PlatformUser"');
  // Remove the test-only tenant row last (Users, Projects, and Invitations
  // reference it via FK and have already been deleted above).
  await prisma.$executeRaw`DELETE FROM "Tenant" WHERE id = ${TENANT_ID}`;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Platform isolation — platform token cannot access dashboard routes and vice versa', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  /** Supertest agent carrying the platform admin's auth cookies. */
  let platformAgent: Agent;

  /** Supertest agent carrying the SUPPORT platform user's auth cookies. */
  let supportAgent: Agent;

  /** Supertest agent carrying the dashboard user's auth cookies. */
  let dashboardAgent: Agent;

  beforeAll(async () => {
    // Run migrations against the test database before bootstrapping the app.
    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env['DATABASE_URL'] },
      stdio: 'pipe',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = moduleRef.get<PrismaService>(PrismaService);

    // Seed the test tenant and users — these survive across all specs in this suite.
    await prisma.$executeRaw`
      INSERT INTO "Tenant" (id, name, slug, "createdAt", "updatedAt")
      VALUES (${TENANT_ID}, 'Acme Isolation Corp', 'acme-isolation', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `;

    // Seed the platform admin for platform login tests.
    const platformHash = await bcryptjs.hash(PLATFORM_PASSWORD, 10);
    await prisma.platformUser.upsert({
      where: { email: PLATFORM_EMAIL },
      update: {},
      create: {
        email: PLATFORM_EMAIL,
        name: 'Platform Isolation Tester',
        passwordHash: platformHash,
        role: PlatformRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        mfaEnabled: false,
      },
    });

    // Seed a SUPPORT platform user to verify it is blocked from write routes.
    const supportHash = await bcryptjs.hash(SUPPORT_PASSWORD, 10);
    await prisma.platformUser.upsert({
      where: { email: SUPPORT_EMAIL },
      update: {},
      create: {
        email: SUPPORT_EMAIL,
        name: 'Platform Support Tester',
        passwordHash: supportHash,
        role: PlatformRole.SUPPORT,
        status: UserStatus.ACTIVE,
        mfaEnabled: false,
      },
    });

    // Seed the dashboard user directly (emailVerified: true to skip OTP flow).
    const dashHash = await bcryptjs.hash(DASHBOARD_PASSWORD, 10);
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: TENANT_ID, email: DASHBOARD_EMAIL } },
      update: {},
      create: {
        tenantId: TENANT_ID,
        email: DASHBOARD_EMAIL,
        name: 'Dashboard Isolation Tester',
        passwordHash: dashHash,
        role: Role.MEMBER,
        status: UserStatus.ACTIVE,
        emailVerified: true,
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
    await app.init();

    // Log in the platform admin once — reuse the agent across specs.
    platformAgent = supertest.agent(app.getHttpServer());
    const platformLogin = await platformAgent
      .post('/api/auth/platform/login')
      .set('Content-Type', 'application/json')
      .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD });

    // A successful platform login must return 200 with platform cookies.
    // If this fails, the isolation tests below are invalid — abort the suite.
    expect(platformLogin.status).toBe(200);

    // Log in the SUPPORT user once — reuse the agent across specs.
    supportAgent = supertest.agent(app.getHttpServer());
    const supportLogin = await supportAgent
      .post('/api/auth/platform/login')
      .set('Content-Type', 'application/json')
      .send({ email: SUPPORT_EMAIL, password: SUPPORT_PASSWORD });

    expect(supportLogin.status).toBe(200);

    // Log in the dashboard user once — reuse the agent across specs.
    dashboardAgent = supertest.agent(app.getHttpServer());
    const dashLogin = await dashboardAgent
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', TENANT_ID)
      .send({ email: DASHBOARD_EMAIL, password: DASHBOARD_PASSWORD });

    // A successful dashboard login must return 200 with tenant cookies.
    expect(dashLogin.status).toBe(200);
  });

  afterAll(async () => {
    await truncateTables(prisma);
    await app.close();
  });

  // ─── Cross-context rejection tests ────────────────────────────────────────

  it('rejects the platform token on a dashboard route (JwtAuthGuard blocks non-tenant JWTs)', async () => {
    // Scenario: JwtAuthGuard is wired as a global guard for all routes EXCEPT
    // platform ones. A platform JWT (issued by /api/auth/platform/login) must be
    // rejected at the JwtAuthGuard boundary so that /api/projects returns 401 or 403.
    // This guards against cross-context privilege escalation (FCM #22).
    const res = await platformAgent.get('/api/projects').set('X-Tenant-Id', TENANT_ID);

    // 401 (unauthenticated) or 403 (forbidden) — both are acceptable rejections.
    expect([401, 403]).toContain(res.status);
  });

  it('rejects the dashboard token on a platform route (JwtPlatformGuard blocks tenant JWTs)', async () => {
    // Scenario: JwtPlatformGuard is applied at the PlatformController class level.
    // A tenant JWT (issued by /api/auth/login) must be rejected when used against
    // /api/platform/tenants — the guard verifies the JWT payload shape is a platform
    // payload, not a tenant payload. Covers FCM #22 isolation guarantee.
    const res = await dashboardAgent.get('/api/platform/tenants');

    // 401 or 403 — both are valid rejections of a non-platform token.
    expect([401, 403]).toContain(res.status);
  });

  // ─── Positive access tests ────────────────────────────────────────────────

  it('allows the platform token to access the platform tenants list', async () => {
    // Scenario: positive sanity check — the platform agent logged in above must
    // successfully reach GET /api/platform/tenants and receive a 200 with an array.
    // Confirms the guard pipeline works in the happy path (FCM #22).
    const res = await platformAgent.get('/api/platform/tenants');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // The seeded tenant must appear in the list.
    const ids: unknown[] = (res.body as Array<{ id: unknown }>).map((t) => t.id);
    expect(ids).toContain(TENANT_ID);
  });

  it('allows the dashboard token to access tenant-scoped project listing', async () => {
    // Scenario: positive sanity check — the dashboard agent logged in above must
    // successfully reach GET /api/projects (with X-Tenant-Id) and receive 200.
    // Confirms that the dashboard guard pipeline still works correctly (FCM #20).
    const res = await dashboardAgent.get('/api/projects').set('X-Tenant-Id', TENANT_ID);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // ─── Role-level write restriction tests ───────────────────────────────────

  it('rejects a SUPPORT token on the write endpoint (PATCH status is SUPER_ADMIN only)', async () => {
    // Scenario: the @PlatformRoles('SUPER_ADMIN') override on the PATCH endpoint
    // means SUPPORT users (who can read tenants and users) must be blocked from
    // status mutations. This guards against SUPPORT role privilege escalation
    // to write operations (FCM #22 — authorization boundary).
    const res = await supportAgent
      .patch(`/api/platform/users/00000000-0000-4000-8000-000000000001/status`)
      .send({ status: 'ACTIVE' });

    // 403 — authenticated but not authorized to write.
    expect(res.status).toBe(403);
  });

  // ─── Cookie name isolation ─────────────────────────────────────────────────

  it('uses different cookie sets for platform and dashboard contexts', async () => {
    // Scenario: the library issues different cookie names for each context so that
    // a browser carrying both sets cannot accidentally use the wrong token on the
    // wrong route. This test captures the cookie names from each login response
    // and asserts they are distinct. Covers FCM #22.
    const freshPlatformAgent = supertest.agent(app.getHttpServer());
    const platformLogin = await freshPlatformAgent
      .post('/api/auth/platform/login')
      .set('Content-Type', 'application/json')
      .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD });

    const freshDashAgent = supertest.agent(app.getHttpServer());
    const dashLogin = await freshDashAgent
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', TENANT_ID)
      .send({ email: DASHBOARD_EMAIL, password: DASHBOARD_PASSWORD });

    const platformCookies = (platformLogin.headers['set-cookie'] as string[] | undefined) ?? [];
    const dashCookies = (dashLogin.headers['set-cookie'] as string[] | undefined) ?? [];

    // Both login responses must issue at least one cookie.
    expect(platformCookies.length).toBeGreaterThan(0);
    expect(dashCookies.length).toBeGreaterThan(0);

    // Extract cookie names (the part before the first '=').
    const platformNames = new Set(platformCookies.map((c) => c.split('=')[0]?.trim() ?? ''));
    const dashNames = new Set(dashCookies.map((c) => c.split('=')[0]?.trim() ?? ''));

    // There must be zero overlap — each context uses exclusively distinct cookie
    // names so a browser carrying both sets cannot accidentally send the wrong
    // token to the wrong route (FCM #22).
    const overlap = [...platformNames].filter((n) => dashNames.has(n));
    expect(overlap.length).toBe(0);
  });
});
