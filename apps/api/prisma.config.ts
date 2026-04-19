/**
 * Prisma 7 CLI configuration — apps/api
 *
 * Purpose  : Provides the database connection URL to Prisma CLI commands
 *            (`prisma generate`, `prisma migrate dev`, `prisma migrate deploy`).
 *            In Prisma 7 the `url` property was removed from the datasource
 *            block in schema.prisma; it now lives here instead.
 * Layer    : Infrastructure / DevOps
 * Constraints:
 *   - This file is only consumed by the Prisma CLI. The runtime PrismaClient
 *     receives its connection via the PrismaPg adapter in PrismaService.
 *   - Never hardcode credentials here; always use env().
 */

import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    // Seed script executed by `prisma db seed`.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
