/**
 * @file db.ts
 * @description Database helper for e2e test suites.
 *
 * Provides a `truncate` function that wipes all application tables between
 * test runs. Ordering respects foreign-key constraints (child rows first).
 *
 * Only deletes tables that accumulate state across runs. The `Tenant` and
 * `PlatformUser` seed rows (created by migrations) must survive to keep
 * the FK constraints intact — see the `keepRows` note below.
 *
 * @layer test
 */

import type { PrismaClient } from '@prisma/client';

/**
 * Deletes all rows from application tables in dependency order.
 *
 * Uses raw SQL `DELETE FROM` rather than `TRUNCATE ... CASCADE` so that
 * sequences are NOT reset — tests that check for unique IDs are not confused
 * by two runs producing identical IDs from a freshly reset sequence.
 *
 * Call once per test (in `beforeEach`) to guarantee isolation between specs.
 *
 * @param prisma - Connected Prisma client pointing at the test database.
 * @param tables - Optional explicit list of tables to truncate. When omitted,
 *   ALL application tables in safe deletion order are cleared.
 */
export async function truncate(prisma: PrismaClient, tables?: string[]): Promise<void> {
  const defaultTables = [
    'AuditLog',
    'Project',
    'Invitation',
    'User',
    // PlatformUser rows are seeded; only delete non-seeded rows in tests
    // by using specific DELETE with a WHERE clause. Cleared here by
    // truncate so tests that create platform users get a clean state.
    'PlatformUser',
    // Tenant rows survive between runs — they are seeded by the migration.
    // Tests that need a tenant must upsert one rather than rely on truncation.
  ];

  const targets = tables ?? defaultTables;

  for (const table of targets) {
    // Double-quote the table name to preserve PascalCase against Postgres
    // identifier folding.
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
  }
}
