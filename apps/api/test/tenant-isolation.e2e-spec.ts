import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file tenant-isolation.e2e-spec.ts
 * @description End-to-end spec for multi-tenant data isolation.
 *
 * Verifies that users in different tenants cannot see each other's projects or
 * user lists. Every query in the application is scoped by `tenantId` — this
 * spec confirms that wiring at the HTTP layer correctly prevents cross-tenant
 * data leakage.
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
process.env['API_PORT'] = '4023';
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
 * Tenant rows are NOT deleted here — they are managed per-test.
 */
async function truncateTables(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('DELETE FROM "AuditLog"');
  await prisma.$executeRawUnsafe('DELETE FROM "Project"');
  await prisma.$executeRawUnsafe('DELETE FROM "Invitation"');
  await prisma.$executeRawUnsafe('DELETE FROM "User"');
}

/**
 * Registers, verifies, and logs in a user for the given tenant.
 *
 * Returns a supertest agent carrying the authenticated session cookies.
 *
 * @param httpServer - The running NestJS HTTP server handle.
 * @param prisma - PrismaService for optional role promotion.
 * @param tenantId - The tenant to register within (used as the X-Tenant-Id header).
 * @param email - User email address.
 * @param password - Plain-text password.
 * @param name - Display name.
 * @param role - Optional role to promote to after registration (default: MEMBER).
 */
async function registerVerifyLoginForTenant(
  httpServer: ReturnType<INestApplication['getHttpServer']>,
  prisma: PrismaService,
  tenantId: string,
  email: string,
  password: string,
  name: string,
  role: Role = Role.MEMBER,
): Promise<Agent> {
  const regRes = await supertest
    .agent(httpServer)
    .post('/api/auth/register')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', tenantId)
    .send({ email, password, name, tenantId });
  expect(regRes.status).toBe(201);

  const html = await waitForEmail(email);
  const otp = extractOtpFromHtml(html);

  await supertest
    .agent(httpServer)
    .post('/api/auth/verify-email')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', tenantId)
    .send({ email, otp, tenantId });

  if (role !== Role.MEMBER) {
    await prisma.user.updateMany({
      where: { email: email.toLowerCase(), tenantId },
      data: { role },
    });
  }

  const loginAgent = supertest.agent(httpServer);
  const loginRes = await loginAgent
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .set('X-Tenant-Id', tenantId)
    .send({ email, password, tenantId });
  expect(loginRes.status).toBe(200);
  return loginAgent;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Tenant isolation — cross-tenant data access is impossible', () => {
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

    // Seed both tenant rows before the app starts.
    await prisma.$executeRaw`
      INSERT INTO "Tenant" (id, name, slug, "createdAt", "updatedAt")
      VALUES ('acme', 'Acme Corp', 'acme', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `;
    await prisma.$executeRaw`
      INSERT INTO "Tenant" (id, name, slug, "createdAt", "updatedAt")
      VALUES ('beta', 'Beta Corp', 'beta', NOW(), NOW())
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
    // Clean up the beta tenant row that was created solely for this suite.
    await prisma.$executeRaw`DELETE FROM "Tenant" WHERE id = 'beta'`;
    await app.close();
  });

  beforeEach(async () => {
    await clearMailpit();
    await truncateTables(prisma);
  });

  // ─── Test 1: Projects are tenant-scoped ──────────────────────────────────

  it("users in different tenants cannot see each other's projects", async () => {
    // Scenario: an ADMIN in 'acme' creates a project. A user in 'beta' calls
    // GET /api/projects and must receive an empty array — the acme project must
    // never appear in the beta tenant's response. Protects FCM #20 (tenant
    // isolation on project listing).
    const httpServer = app.getHttpServer();

    // Register and promote an ADMIN in 'acme'.
    const acmeEmail = uniqueEmail('acme-admin');
    const acmeAgent = await registerVerifyLoginForTenant(
      httpServer,
      prisma,
      'acme',
      acmeEmail,
      'P@ssw0rd12345',
      'Acme Admin',
      Role.ADMIN,
    );
    await clearMailpit();

    // Register a MEMBER in 'beta'.
    const betaEmail = uniqueEmail('beta-member');
    const betaAgent = await registerVerifyLoginForTenant(
      httpServer,
      prisma,
      'beta',
      betaEmail,
      'P@ssw0rd12345',
      'Beta Member',
    );
    await clearMailpit();

    // Create a project inside 'acme'.
    const createRes = await acmeAgent
      .post('/api/projects')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ name: 'Acme Secret Project' });
    expect(createRes.status).toBe(201);

    // The 'beta' user must see an empty project list — no cross-tenant leakage.
    const betaListRes = await betaAgent.get('/api/projects').set('X-Tenant-Id', 'beta');
    expect(betaListRes.status).toBe(200);
    expect(Array.isArray(betaListRes.body)).toBe(true);
    expect((betaListRes.body as unknown[]).length).toBe(0);

    // Sanity check: the 'acme' user must see the project they created.
    const acmeListRes = await acmeAgent.get('/api/projects').set('X-Tenant-Id', 'acme');
    expect(acmeListRes.status).toBe(200);
    const acmeProjects = acmeListRes.body as Array<{ name: string }>;
    expect(acmeProjects.some((p) => p.name === 'Acme Secret Project')).toBe(true);
  });

  // ─── Test 2: User list is tenant-scoped ──────────────────────────────────

  it("GET /api/users lists only users from the caller's tenant", async () => {
    // Scenario: two users exist — one in 'acme' and one in 'beta'. When the
    // 'acme' user calls GET /api/users the response must contain only the 'acme'
    // user, never the 'beta' user. Protects FCM #20 (tenant-scoped user listing).
    const httpServer = app.getHttpServer();

    // Register a MEMBER in each tenant.
    const acmeEmail = uniqueEmail('acme-user');
    const acmeAgent = await registerVerifyLoginForTenant(
      httpServer,
      prisma,
      'acme',
      acmeEmail,
      'P@ssw0rd12345',
      'Acme User',
    );
    await clearMailpit();

    const betaEmail = uniqueEmail('beta-user');
    await registerVerifyLoginForTenant(
      httpServer,
      prisma,
      'beta',
      betaEmail,
      'P@ssw0rd12345',
      'Beta User',
    );
    await clearMailpit();

    // The 'acme' user requests the user list.
    const usersRes = await acmeAgent.get('/api/users').set('X-Tenant-Id', 'acme');
    expect(usersRes.status).toBe(200);
    expect(Array.isArray(usersRes.body)).toBe(true);

    const emails = (usersRes.body as Array<{ email: string }>).map((u) => u.email);

    // The 'beta' user's email must NOT appear in the 'acme' user list.
    expect(emails).not.toContain(betaEmail.toLowerCase());
    // The 'acme' user's own email must be present.
    expect(emails).toContain(acmeEmail.toLowerCase());
  });
});
