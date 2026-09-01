/**
 * @file websocket-auth.e2e-spec.ts
 * @description End-to-end spec for WebSocket authentication and notifications.
 *
 * Proves:
 *  1. Happy path — a valid dashboard JWT in `Authorization: Bearer` allows
 *     connecting; a pushed notification is received within 2 s.
 *  2. Negative — connecting without the Authorization header results in an
 *     immediate close with a non-1000 code (application code 4401).
 *  3. Status change — when an admin suspends a connected member, the member's
 *     WebSocket is closed within 2 s (code 4403).
 *  4. Single-use tickets (lib v1.1.0+) — `POST /api/auth/ws-ticket` mints a
 *     30 s single-use ticket; `?ticket=` connections authenticate without
 *     headers, and replaying a redeemed ticket closes with 4401.
 *
 * # Manual reproduction with websocat
 * ```
 * # 1. Obtain an access_token (value only, not the full cookie header):
 * TOKEN=$(curl -s -X POST http://localhost:4001/api/auth/login \
 *   -H 'Content-Type: application/json' \
 *   -H 'X-Tenant-Id: acme' \
 *   -d '{"email":"member@ws.test","password":"P@ssw0rd!WS"}' \
 *   -c /tmp/ws-cookies.txt | jq -r '.access_token // empty')
 * # 2. Open a WebSocket (uses the access_token from the cookie jar):
 * websocat --header "Authorization: Bearer $TOKEN" ws://localhost:4001/ws/notifications
 * ```
 *
 * Requires `docker-compose.test.yml` services to be running (Postgres at 55432,
 * Redis at 56379, Mailpit SMTP at 51025, Mailpit UI at 58025).
 *
 * `WsJwtGuard` from `@bymax-one/nest-auth` is the library-side guard used here.
 *
 * @layer test
 * @see apps/api/src/notifications/notifications.gateway.ts
 */

// Set test env vars BEFORE importing AppModule so ConfigService sees them.
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://postgres:postgres@localhost:55432/example_app_test';
process.env['REDIS_URL'] = 'redis://127.0.0.1:56379';
process.env['SMTP_HOST'] = 'localhost';
process.env['SMTP_PORT'] = '51025';
process.env['EMAIL_PROVIDER'] = 'mailpit';
process.env['WEB_ORIGIN'] = 'http://localhost:3000';
// Use a distinct port so this suite can run in parallel with other e2e specs.
process.env['API_PORT'] = '4005';
process.env['PASSWORD_RESET_METHOD'] = 'token';
process.env['LOG_LEVEL'] = 'warn';
// Deterministic test-only secrets — meaningless outside the ephemeral test stack.
process.env['JWT_SECRET'] =
  'test-only-jwt-secret-must-be-at-least-64-characters-for-schema-validation-ok';
process.env['MFA_ENCRYPTION_KEY'] = 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMmJ5dGVzLW9rPT0=';

import { execSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import { createAuthValidationPipe } from '@bymax-one/nest-auth';
import { Test, type TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import cookieParser from 'cookie-parser';
import * as supertest from 'supertest';
import type { Agent } from 'supertest';
import { Role, UserStatus } from '@prisma/client';

import { AppModule } from '../src/app.module.js';
import { AuthExceptionFilter } from '../src/auth/auth-exception.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createWsClient } from './helpers/ws.js';
import { resetAuthRateLimits } from './helpers/throttle.js';
import { hashPasswordForTest } from './helpers/password.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const TEST_PORT = parseInt(process.env['API_PORT'] ?? '4005', 10);
const WS_URL = `ws://localhost:${TEST_PORT.toString()}/ws/notifications`;
const TENANT_ID = 'acme-ws-test';
const ADMIN_EMAIL = 'admin@ws.test';
const ADMIN_PASSWORD = 'Adm!nPassw0rd';
const MEMBER_EMAIL = 'member@ws.test';
const MEMBER_PASSWORD = 'P@ssw0rd!WS';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Truncates test-owned tables between specs.
 * Foreign-key order: children first, then parent.
 */
async function truncateTables(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('DELETE FROM "AuditLog"');
  await prisma.$executeRawUnsafe('DELETE FROM "Project"');
  await prisma.$executeRawUnsafe('DELETE FROM "Invitation"');
  await prisma.$executeRawUnsafe('DELETE FROM "User"');
}

/**
 * Extracts the raw JWT value from a `Set-Cookie` header array.
 *
 * The access_token cookie has the form:
 *   `access_token=eyJ...; Path=/api; HttpOnly; SameSite=Lax`
 *
 * @param headers - `Set-Cookie` headers array from the login response.
 * @returns The raw JWT string.
 * @throws When no access_token cookie is found.
 */
function extractAccessToken(headers: string | string[] | undefined): string {
  const cookies = Array.isArray(headers) ? headers : [headers ?? ''];

  for (const cookie of cookies) {
    const match = /^access_token=([^;]+)/.exec(cookie);
    if (match?.[1]) {
      return match[1];
    }
  }

  throw new Error('access_token cookie not found in Set-Cookie headers');
}

// ─── Suite ───────────────────────────────────────────────────────────────────

/**
 * Testing module handle, shared so the login helpers below can clear the
 * per-IP rate-limit counters. Assigned in `beforeAll`.
 */
let moduleRef: TestingModule;

describe('WebSocket auth — WsJwtGuard protection and push delivery (FCM #24)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  /** Supertest agent carrying admin auth cookies for the notify endpoint. */
  let adminAgent: Agent;

  /** The seeded member user's database ID — used for push + suspend targets. */
  let memberId: string;

  /** Raw access_token JWT for the member user — used as Authorization: Bearer. */
  let memberToken: string;

  /** Cookie-authenticated supertest agent for the member — mints WS tickets. */
  let memberAgent: Agent;

  /** Scrypt hashes computed once in beforeAll and reused in every beforeEach. */
  let adminPasswordHash: string;
  let memberPasswordHash: string;

  beforeAll(async () => {
    // Run migrations against the test database before bootstrapping the app.
    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env['DATABASE_URL'] },
      stdio: 'pipe',
    });

    // Pre-compute scrypt hashes once — matches the library's PasswordService format.
    // Reusing across beforeEach avoids per-test scrypt overhead.
    [adminPasswordHash, memberPasswordHash] = await Promise.all([
      hashPasswordForTest(ADMIN_PASSWORD),
      hashPasswordForTest(MEMBER_PASSWORD),
    ]);

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = moduleRef.get<PrismaService>(PrismaService);

    // Seed the test tenant.
    await prisma.$executeRaw`
      INSERT INTO "Tenant" (id, name, slug, "createdAt", "updatedAt")
      VALUES (${TENANT_ID}, 'Acme WS Corp', 'acme-ws', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `;

    // Seed an ADMIN user directly (emailVerified: true, ADMIN role).
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: TENANT_ID, email: ADMIN_EMAIL } },
      update: {},
      create: {
        tenantId: TENANT_ID,
        email: ADMIN_EMAIL,
        name: 'WS Admin',
        passwordHash: adminPasswordHash,
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      },
    });

    // Seed a MEMBER user.
    const memberRow = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: TENANT_ID, email: MEMBER_EMAIL } },
      update: {},
      create: {
        tenantId: TENANT_ID,
        email: MEMBER_EMAIL,
        name: 'WS Member',
        passwordHash: memberPasswordHash,
        role: Role.MEMBER,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      },
    });
    memberId = memberRow.id;

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
    app.useGlobalFilters(new AuthExceptionFilter());
    // Activate the plain WebSocket adapter so the notifications gateway binds.
    app.useWebSocketAdapter(new WsAdapter(app));
    // Use listen() (not init()) so the HTTP + WS server actually binds to the port.
    await app.listen(TEST_PORT);

    // Clear both rate limiters before the first login — counters left behind
    // by earlier spec files in a sequential run share this IP.
    await resetAuthRateLimits(moduleRef);

    // Log in the admin once and reuse the agent across specs.
    adminAgent = supertest.agent(app.getHttpServer());
    const adminLogin = await adminAgent
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', TENANT_ID)
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    // If admin login fails the WS tests below are invalid — abort the suite.
    expect(adminLogin.status).toBe(200);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Every request in this suite comes from 127.0.0.1, so the per-IP `login`
    // tier is shared by all of its cases. Clear it between them: what is under
    // test here is auth behaviour, and a leaked 429 would mask it.
    await resetAuthRateLimits(moduleRef);
    // Truncate test data so each spec starts clean.
    await truncateTables(prisma);

    // Re-seed member because truncateTables deletes all users.
    const memberRow = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: TENANT_ID, email: MEMBER_EMAIL } },
      update: { status: UserStatus.ACTIVE },
      create: {
        tenantId: TENANT_ID,
        email: MEMBER_EMAIL,
        name: 'WS Member',
        passwordHash: memberPasswordHash,
        role: Role.MEMBER,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      },
    });
    memberId = memberRow.id;

    // Re-seed admin (deleted by truncateTables).
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: TENANT_ID, email: ADMIN_EMAIL } },
      update: {},
      create: {
        tenantId: TENANT_ID,
        email: ADMIN_EMAIL,
        name: 'WS Admin',
        passwordHash: adminPasswordHash,
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      },
    });

    // Log the member in to obtain a fresh access_token for each spec.
    memberAgent = supertest.agent(app.getHttpServer());
    const memberLogin = await memberAgent
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', TENANT_ID)
      .send({ email: MEMBER_EMAIL, password: MEMBER_PASSWORD });

    expect(memberLogin.status).toBe(200);

    memberToken = extractAccessToken(memberLogin.headers['set-cookie'] as string[] | undefined);

    // Re-login admin to refresh cookies after table truncation.
    const adminReloginAgent = supertest.agent(app.getHttpServer());
    const adminLogin = await adminReloginAgent
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', TENANT_ID)
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(adminLogin.status).toBe(200);
    // Rebuild the admin agent with fresh cookies.
    adminAgent = adminReloginAgent;
  });

  // ─── Happy path ───────────────────────────────────────────────────────────────

  it('delivers notification:new when POST /api/debug/notify/:userId is called', async () => {
    // Scenario: a member with a valid dashboard JWT opens a WS connection; an admin
    // triggers a push via the debug endpoint; the member receives the notification
    // within 2 s. Covers FCM row #24 (WebSocket auth + gateway emit).
    const client = createWsClient({
      url: WS_URL,
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    // Wait for the connection to be established.
    await client.opened;

    // Register the message listener BEFORE issuing the notify — otherwise the
    // push can race ahead of `socket.once('message')` and be dropped. The
    // suspend test below uses the same defensive ordering for `nextClose`.
    const messagePromise = client.nextMessage(5000);

    // Admin triggers the notification push.
    const notifyRes = await adminAgent
      .post(`/api/debug/notify/${memberId}`)
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', TENANT_ID)
      .send({ title: 'Test title', body: 'Test body' });

    expect(notifyRes.status).toBe(200);
    expect(notifyRes.body).toMatchObject({ delivered: 1 });

    // Assert the member's socket received the expected event within the window.
    const message = await messagePromise;

    expect(message).toMatchObject({
      event: 'notification:new',
      data: { title: 'Test title', body: 'Test body' },
    });

    client.close();
  });

  // ─── Negative ────────────────────────────────────────────────────────────────

  it('closes the connection with code 4401 when Authorization header is absent', async () => {
    // Scenario: a client connects without any Authorization header; the gateway
    // detects the missing token in handleConnection and closes with code 4401.
    // Proves the guard is active and rejects unauthenticated connections.
    const client = createWsClient({ url: WS_URL });

    const closeCode = await client.nextClose(2000);

    // WS close codes in the 4000–4999 range are application-defined.
    // 4401 = unauthorized (set by NotificationsGateway.handleConnection).
    expect(closeCode).toBe(4401);
  });

  // ─── Status-change disconnect ─────────────────────────────────────────────────

  it('closes the member socket when admin suspends the member', async () => {
    // Scenario: a connected member is suspended by an admin via PATCH /api/users/:id/status.
    // NotificationsGateway.maybeDisconnectBlockedUser is called after the status update
    // and forcibly closes the member's socket. Proves FCM row #23 + #24 integration.
    const client = createWsClient({
      url: WS_URL,
      headers: { Authorization: `Bearer ${memberToken}` },
    });

    // Wait for the member's connection to be established.
    await client.opened;

    // Start listening for close BEFORE issuing the suspend — race condition safe
    // because nextClose only resolves when the event fires.
    const closePromise = client.nextClose(2000);

    // Admin suspends the member user.
    const suspendRes = await adminAgent
      .patch(`/api/users/${memberId}/status`)
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', TENANT_ID)
      .send({ status: 'SUSPENDED' });

    expect(suspendRes.status).toBe(200);

    // Assert the member's socket closes within 2 s of the suspension.
    const closeCode = await closePromise;

    // 4403 = access revoked / account suspended (set by NotificationsGateway.disconnectUser).
    expect(closeCode).toBe(4403);
  });

  // ─── Single-use WS upgrade tickets (lib v1.1.0+) ──────────────────────────

  it('accepts a ?ticket= connection minted via POST /api/auth/ws-ticket and delivers pushes', async () => {
    // Scenario: browsers cannot set custom headers on WS upgrades, so the
    // canonical browser path mints a single-use ticket from the authenticated
    // session (POST /api/auth/ws-ticket → `{ ticket, expiresIn }`, 30 s TTL)
    // and connects with `?ticket=`. The gateway redeems it atomically, the
    // connection survives, and a self-targeted debug push arrives on it.
    const ticketRes = await memberAgent.post('/api/auth/ws-ticket').set('X-Tenant-Id', TENANT_ID);

    expect([200, 201]).toContain(ticketRes.status);
    const { ticket, expiresIn } = ticketRes.body as { ticket: string; expiresIn: number };
    expect(typeof ticket).toBe('string');
    expect(ticket.length).toBeGreaterThan(0);
    expect(expiresIn).toBeGreaterThan(0);

    const client = createWsClient({ url: `${WS_URL}?ticket=${encodeURIComponent(ticket)}` });
    await client.opened;

    // Register the message listener BEFORE issuing the push (race-safe).
    const messagePromise = client.nextMessage(5000);

    // The member pushes to themselves — the ticket connection was registered
    // under the member's own user id, so delivered must be exactly 1.
    const notifyRes = await memberAgent
      .post('/api/debug/notify/self')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', TENANT_ID)
      .send({ title: 'Ticket title', body: 'Ticket body' });

    expect(notifyRes.status).toBe(200);
    expect(notifyRes.body).toMatchObject({ delivered: 1 });

    const message = await messagePromise;
    expect(message).toMatchObject({
      event: 'notification:new',
      data: { title: 'Ticket title', body: 'Ticket body' },
    });

    client.close();
  });

  it('closes a connection replaying an already-redeemed ticket with code 4401', async () => {
    // Scenario: tickets are single-use — `WsTicketService.redeem` consumes the
    // ticket atomically on the first upgrade, so a second connection replaying
    // the SAME ticket must be refused with close code 4401. A leaked ticket in
    // an access log is worthless after its first (or any) use.
    const ticketRes = await memberAgent.post('/api/auth/ws-ticket').set('X-Tenant-Id', TENANT_ID);
    expect([200, 201]).toContain(ticketRes.status);
    const { ticket } = ticketRes.body as { ticket: string };

    // First connection redeems the ticket and stays open.
    const first = createWsClient({ url: `${WS_URL}?ticket=${encodeURIComponent(ticket)}` });
    await first.opened;

    // Second connection replays the consumed ticket — refused at the door.
    const second = createWsClient({ url: `${WS_URL}?ticket=${encodeURIComponent(ticket)}` });
    const closeCode = await second.nextClose(2000);
    expect(closeCode).toBe(4401);

    first.close();
  });
});
