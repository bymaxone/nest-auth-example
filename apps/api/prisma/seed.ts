/**
 * Prisma seed script — nest-auth-example
 *
 * Purpose  : Populates the database with reproducible demo data for local
 *            development. Creates two tenants (acme, globex), one user per
 *            role per tenant (8 users total), and one platform super-admin.
 * Layer    : Persistence / DevOps
 * Constraints:
 *   - Idempotent: every write uses upsert keyed on the natural unique
 *     constraint. Running this script multiple times produces identical state.
 *   - Passwords are hashed with bcryptjs (cost 12) — the same algorithm
 *     @bymax-one/nest-auth uses for passwordHash comparisons.
 *   - This script is DEV-ONLY. Never run in production; seeds use known
 *     passwords that are publicly documented in GETTING_STARTED.md.
 */

import { PrismaClient, PlatformRole, Role, UserStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcryptjs from 'bcryptjs';
import 'dotenv/config';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Shared password for all seeded users. DEV ONLY — document in GETTING_STARTED. */
const SEED_PASSWORD = 'Passw0rd!Passw0rd';
const BCRYPT_ROUNDS = 12;

const TENANT_DEFINITIONS = [
  { name: 'Acme Corp', slug: 'acme' },
  { name: 'Globex Inc', slug: 'globex' },
] as const;

const ROLES = [Role.OWNER, Role.ADMIN, Role.MEMBER, Role.VIEWER] as const;

// ---------------------------------------------------------------------------
// Database client
// ---------------------------------------------------------------------------

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('[seed] DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const passwordHash = await bcryptjs.hash(SEED_PASSWORD, BCRYPT_ROUNDS);

  // Create tenants (upsert on slug)
  const tenants = await Promise.all(
    TENANT_DEFINITIONS.map(({ name, slug }) =>
      prisma.tenant.upsert({
        where: { slug },
        update: {},
        create: { name, slug },
      }),
    ),
  );

  // Create one user per role per tenant (8 users total)
  const seededEmails: string[] = [];
  for (const tenant of tenants) {
    for (const role of ROLES) {
      const email = `${role.toLowerCase()}.${tenant.slug}@example.com`;
      await prisma.user.upsert({
        where: { tenantId_email: { tenantId: tenant.id, email } },
        update: {},
        create: {
          tenantId: tenant.id,
          email,
          name: `${role.charAt(0) + role.slice(1).toLowerCase()} at ${tenant.name}`,
          passwordHash,
          role,
          status: UserStatus.ACTIVE,
          emailVerified: true,
        },
      });
      seededEmails.push(email);
    }
  }

  // Create one platform super-admin (upsert on email)
  await prisma.platformUser.upsert({
    where: { email: 'platform@example.com' },
    update: {},
    create: {
      email: 'platform@example.com',
      name: 'Platform Admin',
      passwordHash,
      role: PlatformRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
    },
  });

  // Print dev credentials — clearly marked so the banner is easy to grep out
  const lines = [
    '',
    '╔═══════════════════════════════════════════════════════╗',
    '║     DEV CREDENTIALS (seed) — NEVER USE IN PROD        ║',
    '╠═══════════════════════════════════════════════════════╣',
    `║  Password (all users): ${SEED_PASSWORD.padEnd(31)}║`,
    '╠═══════════════════════════════════════════════════════╣',
    '║  Tenant users:                                        ║',
    ...seededEmails.map((e) => `║    ${e.padEnd(51)}║`),
    '╠═══════════════════════════════════════════════════════╣',
    '║  Platform admin:                                      ║',
    '║    platform@example.com                               ║',
    '╚═══════════════════════════════════════════════════════╝',
    '',
  ];

  console.log(lines.join('\n'));
}

main()
  .catch((err: unknown) => {
    // Log only the message — Prisma/pg errors may embed DATABASE_URL in the full object.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[seed] Fatal error:', message);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
