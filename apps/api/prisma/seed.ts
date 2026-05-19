/**
 * Prisma seed script — nest-auth-example
 *
 * Purpose  : Populates the database with reproducible demo data for local
 *            development. Creates two tenants (acme, globex), one user per
 *            role per tenant (8 users total), and one platform super-admin.
 * Layer    : Persistence / DevOps
 * Constraints:
 *   - Idempotent: every write uses upsert keyed on the natural unique
 *     constraint. Existing rows have their `passwordHash` re-hashed so the
 *     stored hash always matches the canonical seed password and the current
 *     library `PasswordService` format.
 *   - Passwords are hashed with scrypt in the `scrypt:{salt_hex}:{derived_hex}`
 *     format the @bymax-one/nest-auth `PasswordService` expects. The previous
 *     bcrypt hashes are rejected by `PasswordService.compare`, which requires
 *     the scrypt prefix.
 *   - This script is DEV-ONLY. Never run in production; seeds use known
 *     passwords that are publicly documented in GETTING_STARTED.md.
 */

import { PrismaClient, PlatformRole, Role, UserStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';
import 'dotenv/config';

/**
 * Promisified wrapper for `crypto.scrypt` that exposes the `ScryptOptions`
 * overload. `util.promisify(scryptCallback)` only types the 3-argument form
 * (no options), so a manual wrapper is required to pass N/r/p/maxmem.
 */
function scrypt(
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derived) => {
      if (err != null) reject(err);
      else resolve(derived);
    });
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Shared password for all seeded tenant users. DEV ONLY — document in GETTING_STARTED. */
const SEED_PASSWORD = 'Passw0rd!Passw0rd';
/**
 * Dedicated password for the seeded platform super-admin.
 * Different from tenant user password to make the separation explicit in docs and tests.
 * DEV ONLY — must never be used in production.
 */
const PLATFORM_ADMIN_PASSWORD = 'PlatformPassw0rd!';

/** E2E-specific passwords — match the default credentials in the Playwright spec files. */
const E2E_MEMBER_PASSWORD = 'MemberPassw0rd!';
const E2E_ADMIN_PASSWORD = 'AdminPassw0rd!';

/**
 * scrypt parameters — must match the library's default `PasswordService` settings
 * (N=2^15, r=8, p=1, key length 64, salt length 16).
 */
const SCRYPT_COST = 32768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_MAXMEM = Math.max(SCRYPT_COST * SCRYPT_BLOCK_SIZE * 128 * 2, 64 * 1024 * 1024);

/**
 * Hash a plaintext password using the same scrypt format the library's
 * `PasswordService` writes: `scrypt:{salt_hex}:{derived_hex}`.
 */
async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scrypt(plain, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

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

  // Create one user per role per tenant (8 users total).
  // Re-hashes the passwordHash on every run so existing rows get migrated
  // from the legacy bcrypt format to the scrypt format the library expects.
  const seededEmails: string[] = [];
  for (const tenant of tenants) {
    for (const role of ROLES) {
      const email = `${role.toLowerCase()}.${tenant.slug}@example.com`;
      const passwordHash = await hashPassword(SEED_PASSWORD);
      await prisma.user.upsert({
        where: { tenantId_email: { tenantId: tenant.id, email } },
        update: {
          passwordHash,
          status: UserStatus.ACTIVE,
          emailVerified: true,
          mfaEnabled: false,
          mfaSecret: null,
          mfaRecoveryCodes: [],
        },
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

  // Create e2e-specific users in the acme tenant with the credential defaults used
  // in the Playwright spec files (E2E_MEMBER_EMAIL, E2E_ADMIN_EMAIL env vars).
  // These are separate from the role-based `*.acme@example.com` users so both
  // naming conventions coexist without conflict.
  const acmeTenant = tenants.find((t) => t.slug === 'acme');
  if (acmeTenant) {
    const e2eMemberHash = await hashPassword(E2E_MEMBER_PASSWORD);
    const e2eAdminHash = await hashPassword(E2E_ADMIN_PASSWORD);

    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: acmeTenant.id, email: 'member@example.dev' } },
      update: {
        passwordHash: e2eMemberHash,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        mfaEnabled: false,
        mfaSecret: null,
        mfaRecoveryCodes: [],
      },
      create: {
        tenantId: acmeTenant.id,
        email: 'member@example.dev',
        name: 'E2E Member',
        passwordHash: e2eMemberHash,
        role: Role.MEMBER,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      },
    });

    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: acmeTenant.id, email: 'admin@example.dev' } },
      update: {
        passwordHash: e2eAdminHash,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        mfaEnabled: false,
        mfaSecret: null,
        mfaRecoveryCodes: [],
      },
      create: {
        tenantId: acmeTenant.id,
        email: 'admin@example.dev',
        name: 'E2E Admin',
        passwordHash: e2eAdminHash,
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      },
    });
  }

  // Create one platform super-admin (generic, uses shared SEED_PASSWORD)
  const genericPlatformHash = await hashPassword(SEED_PASSWORD);
  await prisma.platformUser.upsert({
    where: { email: 'platform@example.com' },
    update: { status: UserStatus.ACTIVE, passwordHash: genericPlatformHash },
    create: {
      email: 'platform@example.com',
      name: 'Platform Admin (generic)',
      passwordHash: genericPlatformHash,
      role: PlatformRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
    },
  });

  // Create the documented platform super-admin for e2e tests and Phase 15 frontend.
  // Uses a dedicated password (PLATFORM_ADMIN_PASSWORD) distinct from the tenant
  // seed password so docs and tests reference a single canonical credential.
  // FCM #22 — Platform admin context.
  const canonicalPlatformHash = await hashPassword(PLATFORM_ADMIN_PASSWORD);
  await prisma.platformUser.upsert({
    where: { email: 'platform@example.dev' },
    update: { status: UserStatus.ACTIVE, passwordHash: canonicalPlatformHash },
    create: {
      email: 'platform@example.dev',
      name: 'Platform Admin',
      passwordHash: canonicalPlatformHash,
      role: PlatformRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      mfaEnabled: false,
    },
  });

  // Print dev credentials — clearly marked so the banner is easy to grep out
  const lines = [
    '',
    '╔═══════════════════════════════════════════════════════╗',
    '║     DEV CREDENTIALS (seed) — NEVER USE IN PROD        ║',
    '╠═══════════════════════════════════════════════════════╣',
    '║  Tenant IDs (use as X-Tenant-Id header):              ║',
    ...tenants.map((t) => `║    ${t.slug}: ${t.id.padEnd(49 - t.slug.length)}║`),
    '╠═══════════════════════════════════════════════════════╣',
    `║  Password (all tenant users): ${SEED_PASSWORD.padEnd(24)}║`,
    '╠═══════════════════════════════════════════════════════╣',
    '║  Tenant users:                                        ║',
    ...seededEmails.map((e) => `║    ${e.padEnd(51)}║`),
    '╠═══════════════════════════════════════════════════════╣',
    '║  Platform admin (generic):                            ║',
    '║    platform@example.com                               ║',
    `║    Password: ${SEED_PASSWORD.padEnd(41)}║`,
    '╠═══════════════════════════════════════════════════════╣',
    '║  Platform admin (canonical, FCM #22):                 ║',
    '║    Email:    platform@example.dev                     ║',
    `║    Password: ${PLATFORM_ADMIN_PASSWORD.padEnd(41)}║`,
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
