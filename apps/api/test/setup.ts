/**
 * @file setup.ts
 * @description Shared e2e test bootstrap for all Jest e2e specs.
 *
 * `createTestApp` boots a full `NestApplication` against `DATABASE_URL_TEST`,
 * runs `prisma migrate deploy` once per process, wires all global middleware
 * (cookie-parser, ValidationPipe, AuthExceptionFilter, global prefix `/api`),
 * and returns a disposable `{ app, agent, prisma, redis }` bundle.
 *
 * Usage in a spec file:
 * ```typescript
 * let bundle: TestBundle;
 * beforeAll(async () => { bundle = await createTestApp(); });
 * afterAll(async () => { await bundle.app.close(); });
 * ```
 *
 * @layer test
 * @see test/helpers/db.ts
 * @see test/helpers/redis.ts
 */

import { execSync } from 'child_process';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Redis } from 'ioredis';
import * as supertest from 'supertest';
import type { Agent } from 'supertest';
import { BYMAX_AUTH_REDIS_CLIENT } from '@bymax-one/nest-auth';

import { AppModule } from '../src/app.module.js';
import { AuthExceptionFilter } from '../src/auth/auth-exception.filter.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { PrismaService as PrismaServiceClass } from '../src/prisma/prisma.service.js';

/** Return type of `createTestApp`. */
export interface TestBundle {
  /** The bootstrapped NestJS application instance. */
  app: INestApplication;
  /** Supertest agent that shares the app's HTTP server and cookie jar. */
  agent: Agent;
  /** Connected Prisma client scoped to the test database. */
  prisma: PrismaService;
  /** Connected ioredis client for direct key inspection / cleanup. */
  redis: Redis;
}

/** Guards against running `prisma migrate deploy` more than once per process. */
let migrated = false;

/**
 * Bootstraps a full NestJS application bound to the test database.
 *
 * @param options.port - TCP port to listen on (default: random ephemeral port
 *   via `0`, which avoids conflicts when multiple specs run in parallel).
 * @returns A `TestBundle` whose `app.close()` shuts down all connections.
 */
export async function createTestApp(options?: { port?: number }): Promise<TestBundle> {
  if (!migrated) {
    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? '',
      },
      stdio: 'pipe',
    });
    migrated = true;
  }

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  // Ensure the test tenant exists before bootstrapping.
  const prisma = moduleRef.get<PrismaService>(PrismaServiceClass);
  await prisma.$executeRaw`
    INSERT INTO "Tenant" (id, name, slug, "createdAt", "updatedAt")
    VALUES ('acme', 'Acme Corp', 'acme', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;

  const app = moduleRef.createNestApplication();
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

  const port = options?.port ?? 0;
  await app.listen(port);

  const redis = moduleRef.get<Redis>(BYMAX_AUTH_REDIS_CLIENT);
  const agent = supertest.agent(app.getHttpServer());

  return { app, agent, prisma, redis };
}

/**
 * Generates a unique email address to prevent cross-test contamination.
 *
 * @param prefix - Optional prefix for readability in test output.
 */
export function uniqueEmail(prefix = 'test'): string {
  return `${prefix}-${Date.now().toString()}-${Math.random().toString(36).slice(2)}@example.test`;
}
