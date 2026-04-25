/**
 * @file invitations.e2e-spec.ts
 * @description Phase 8 e2e spec for the full user-invitation flow:
 * an ADMIN creates an invitation → Mailpit captures the email → the invitee
 * extracts the accept token → calls the accept endpoint → a new `users` row
 * is created with the correct `tenantId`, `role`, and `emailVerified = true`.
 *
 * Covers FCM row #21 (User invitations).
 *
 * Requires `docker-compose.test.yml` services to be running (Postgres at 55432,
 * Redis at 56379, Mailpit SMTP at 51025, Mailpit UI at 58025).
 *
 * @layer test
 * @see docs/DEVELOPMENT_PLAN.md §Phase 8 P8-5
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
process.env['API_PORT'] = '4003';
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
import cookieParser from 'cookie-parser';
import * as supertest from 'supertest';
import type { Agent } from 'supertest';
import { Role } from '@prisma/client';

import { AppModule } from '../src/app.module.js';
import { AuthExceptionFilter } from '../src/auth/auth-exception.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  clearMailpit,
  waitForEmail,
  extractOtpFromHtml,
  extractInviteTokenFromHtml,
} from './helpers/mailpit.js';

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

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Invitations — admin creates invitation → invitee accepts → user row verified', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  /** Supertest agent carrying the admin's auth cookies. Refreshed before each test. */
  let adminAgent: Agent;

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

    // Ensure the 'acme' tenant FK constraint is satisfied before the app starts.
    // The tenantIdResolver returns the X-Tenant-Id header verbatim, so 'acme'
    // must exist as a Tenant row.
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
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await clearMailpit();
    await truncateTables(prisma);

    // Create a fresh ADMIN user before each test. The register endpoint always
    // creates a MEMBER; Prisma is used to elevate the role after email verification.
    const adminEmail = uniqueEmail('admin');
    const adminPassword = 'P@ssw0rd12345';
    const httpServer = app.getHttpServer();

    // Register — creates a PENDING user and sends a verification OTP.
    await supertest
      .agent(httpServer)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email: adminEmail, password: adminPassword, name: 'Admin User' });

    // Extract OTP from Mailpit and verify the admin's email.
    const verifyHtml = await waitForEmail(adminEmail);
    const otp = extractOtpFromHtml(verifyHtml);
    await supertest
      .agent(httpServer)
      .post('/api/auth/verify-email')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email: adminEmail, otp });

    // Promote to ADMIN — registration enforces MEMBER as the default role.
    await prisma.user.updateMany({
      where: { email: adminEmail.toLowerCase(), tenantId: 'acme' },
      data: { role: Role.ADMIN },
    });

    // Login and capture the session cookies in the persistent agent.
    adminAgent = supertest.agent(httpServer);
    const loginRes = await adminAgent
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email: adminEmail, password: adminPassword });
    expect(loginRes.status).toBe(200);

    // Clear Mailpit so the admin's OTP email does not interfere with the
    // invitation email assertions that follow.
    await clearMailpit();
  });

  // ─── Happy path ───────────────────────────────────────────────────────────

  it('happy path: admin sends invitation → invitee accepts → user row has correct tenantId, role, and emailVerified', async () => {
    // Scenario: an authenticated ADMIN creates an invitation for a new email address
    // (FCM #21 — POST /api/auth/invitations). Mailpit captures the invitation email.
    // The invitee extracts the accept token and calls POST /api/auth/invitations/accept
    // with their chosen name and password. Asserts: a single new User row exists in
    // the 'acme' tenant, scoped to role MEMBER, with emailVerified = true.

    const inviteeEmail = uniqueEmail('invitee');

    // 1. Admin creates the invitation — expect 201 Created.
    const createRes = await adminAgent
      .post('/api/auth/invitations')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email: inviteeEmail, role: 'MEMBER' });

    expect(createRes.status).toBe(201);

    // 2. Wait for the invitation email and extract the accept token from the URL.
    //    The template embeds the token as `?token=<hex>` in both the CTA href and
    //    the plain-text fallback — extractInviteTokenFromHtml picks the first match.
    const inviteHtml = await waitForEmail(inviteeEmail);
    const token = extractInviteTokenFromHtml(inviteHtml);
    expect(token).toBeTruthy();

    // 3. Accept the invitation — no prior session required; the token is self-contained.
    //    X-Tenant-Id is required because tenantIdResolver always reads the header.
    const acceptRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/invitations/accept')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ token, name: 'Invited User', password: 'P@ssw0rd12345' });

    expect(acceptRes.status).toBe(200);

    // 4. Assert the new user row was persisted with the expected attributes.
    //    emailVerified must be true — invitation acceptance skips the OTP step.
    const user = await prisma.user.findFirst({
      where: { email: inviteeEmail.toLowerCase(), tenantId: 'acme' },
    });
    expect(user).not.toBeNull();
    expect(user?.tenantId).toBe('acme');
    expect(user?.role).toBe(Role.MEMBER);
    expect(user?.emailVerified).toBe(true);
  });

  // ─── Sad paths ────────────────────────────────────────────────────────────

  it('rejects an invalid or unknown accept token with a 4xx response', async () => {
    // Scenario: a tampered or non-existent token must never produce a 5xx.
    // The library must validate the token and return a client-error response.
    // Covers the error-envelope path (FCM #29) for the invitations flow.
    const fakeToken = 'a'.repeat(64); // syntactically valid but not in the DB

    const acceptRes = await supertest
      .agent(app.getHttpServer())
      .post('/api/auth/invitations/accept')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ token: fakeToken, name: 'Hacker', password: 'P@ssw0rd12345' });

    expect(acceptRes.status).toBeGreaterThanOrEqual(400);
    expect(acceptRes.status).toBeLessThan(500);
  });

  it('rejects invitation creation from a non-admin (MEMBER) user with 403', async () => {
    // Scenario: only ADMIN or OWNER may create invitations. A MEMBER who attempts
    // to POST /api/auth/invitations must receive a 403. This guards against
    // privilege-escalation via invitation (FCM #18).
    const memberEmail = uniqueEmail('member');
    const memberPassword = 'P@ssw0rd12345';
    const httpServer = app.getHttpServer();

    // Register the MEMBER — role stays MEMBER (no Prisma promotion).
    await supertest
      .agent(httpServer)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email: memberEmail, password: memberPassword, name: 'Member User' });

    // Mailpit now holds both the admin's OTP (cleared by beforeEach) and this
    // member's OTP. waitForEmail filters by recipient so they do not conflict.
    const memberVerifyHtml = await waitForEmail(memberEmail);
    const memberOtp = extractOtpFromHtml(memberVerifyHtml);
    await supertest
      .agent(httpServer)
      .post('/api/auth/verify-email')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email: memberEmail, otp: memberOtp });

    // Login as MEMBER and keep cookies.
    const memberAgent = supertest.agent(httpServer);
    const memberLoginRes = await memberAgent
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email: memberEmail, password: memberPassword });
    expect(memberLoginRes.status).toBe(200);

    // MEMBER attempts to create an invitation — must be rejected.
    const createRes = await memberAgent
      .post('/api/auth/invitations')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email: uniqueEmail('target'), role: 'MEMBER' });

    expect(createRes.status).toBe(403);
  });
});
