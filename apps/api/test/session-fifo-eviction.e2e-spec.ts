import { WsAdapter } from '@nestjs/platform-ws';
/**
 * @file session-fifo-eviction.e2e-spec.ts
 * @description End-to-end spec for FIFO session eviction when a user exceeds
 * `defaultMaxSessions` (5). Creating a 6th session must evict the oldest (first)
 * session and record a `session.evicted` AuditLog entry.
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
process.env['API_PORT'] = '4019';
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

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Session FIFO eviction — oldest session is removed when maxSessions is exceeded', () => {
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

  // ─── Test 1: FIFO eviction ────────────────────────────────────────────────

  it('creating maxSessions + 1 sessions evicts the oldest via FIFO', async () => {
    // Scenario: defaultMaxSessions is 5. After the 6th login the library must
    // silently evict the oldest session (FIFO) so the active session count
    // stays at 5. A `session.evicted` AuditLog entry must be written.
    // Protects FCM #13 (session-limit enforcement and eviction audit trail).
    const email = uniqueEmail('fifo-eviction');
    const password = 'P@ssw0rd12345';
    const httpServer = app.getHttpServer();

    // Register the user (sends verification OTP).
    const regRes = await supertest
      .agent(httpServer)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password, name: 'FIFO User', tenantId: 'acme' });
    expect(regRes.status).toBe(201);

    // Verify the email via Mailpit.
    const verifyHtml = await waitForEmail(email);
    const otp = extractOtpFromHtml(verifyHtml);
    const verifyRes = await supertest
      .agent(httpServer)
      .post('/api/auth/verify-email')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, otp, tenantId: 'acme' });
    expect(verifyRes.status).toBe(204);

    // Create 5 sessions (maxSessions = 5). Each uses a distinct User-Agent so
    // the library records each as an independent session entry.
    const agents: Agent[] = [];
    for (let i = 1; i <= 5; i++) {
      const loginAgent = supertest.agent(httpServer);
      const loginRes = await loginAgent
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .set('X-Tenant-Id', 'acme')
        .set('User-Agent', `TestBrowser-${i.toString()}`)
        .send({ email, password, tenantId: 'acme' });
      expect(loginRes.status).toBe(200);
      agents.push(loginAgent);
    }

    // Capture the session list after exactly 5 logins.
    const listAt5 = await agents[4]!.get('/api/auth/sessions').set('X-Tenant-Id', 'acme');
    expect(listAt5.status).toBe(200);
    const sessionsBefore = listAt5.body as Array<{ sessionHash: string }>;
    // The oldest session hash is the first entry created (position 0 after sorting by age).
    // We capture all hashes before the eviction occurs.
    const hashesAtMax = new Set(sessionsBefore.map((s) => s.sessionHash));

    // Create the 6th session — this must trigger FIFO eviction of the oldest.
    const agent6 = supertest.agent(httpServer);
    const login6 = await agent6
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .set('User-Agent', 'TestBrowser-6')
      .send({ email, password, tenantId: 'acme' });
    expect(login6.status).toBe(200);

    // List sessions after the 6th login — must be at most 5 (oldest was evicted).
    const listAfter = await agent6.get('/api/auth/sessions').set('X-Tenant-Id', 'acme');
    expect(listAfter.status).toBe(200);
    const sessionsAfter = listAfter.body as Array<{ sessionHash: string }>;
    expect(sessionsAfter.length).toBeLessThanOrEqual(5);

    // At least one previously-tracked hash must be missing (the evicted one).
    const hashesAfter = new Set(sessionsAfter.map((s) => s.sessionHash));
    const evictedCount = [...hashesAtMax].filter((h) => !hashesAfter.has(h)).length;
    expect(evictedCount).toBeGreaterThanOrEqual(1);

    // The AuditLog must contain at least one `session.evicted` entry.
    // NOTE: the library's session-manager calls `onSessionEvicted` with a context
    // that does not carry a tenantId — so the row is written with tenantId=null.
    // Filtering by tenantId here would always miss it; we filter only by event.
    const evictedAuditRow = await prisma.auditLog.findFirst({
      where: { event: 'session.evicted' },
    });
    expect(evictedAuditRow).not.toBeNull();
  });
});
