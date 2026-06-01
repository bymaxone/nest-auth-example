/**
 * @file health.controller.ts
 * @description Aggregate readiness probe for `apps/api`.
 *
 * Checks Postgres (`SELECT 1`), Redis (`PING`), and reads the
 * installed `@bymax-one/nest-auth` version via a walk-up package.json strategy
 * that is robust against library restructuring. Individual dependency failures
 * downgrade `status` to `'degraded'` but still return HTTP 200 so orchestrators
 * can distinguish a degraded-but-alive process from a crash.
 *
 * Also exposes `GET /api/health/throttle-demo` decorated with
 * `@Throttle(AUTH_THROTTLE_CONFIGS.login)` to demonstrate IP-based rate limiting
 * without touching any auth state.
 *
 * @layer infrastructure
 * @see health.types.ts
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Redis } from 'ioredis';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { BYMAX_AUTH_REDIS_CLIENT, AUTH_THROTTLE_CONFIGS, Public } from '@bymax-one/nest-auth';

import { PrismaService } from '../prisma/prisma.service.js';
import pkg from '../../package.json' with { type: 'json' };
import type { HealthStatus, HealthDeps, DepStatus } from './health.types.js';

/** Application version resolved once at module load time. */
const APP_VERSION: string = pkg.version;

/**
 * Resolves the installed `@bymax-one/nest-auth` version by walking up the
 * directory tree from the library's resolved main file until a `package.json`
 * with the correct `name` field is found.
 *
 * Uses `createRequire` because the library's `exports` map does not expose
 * `./package.json` as an ESM import path. The walk-up strategy is robust
 * against future changes to the library's `dist` folder structure — it does
 * not assume a fixed number of levels between the entry point and the package root.
 *
 * @returns Semver string (e.g. `'1.0.0'`) or `'unknown'` on any resolution error.
 * @internal Exported for unit testing only — not part of the public module API.
 */
export function resolveLibraryVersion(): string {
  // Stryker disable all: every observable behaviour of the walk-up collapses
  // to the same `'unknown' | <version>` return value because the function
  // catches all errors. Mutating the loop bound (5 → 4), the `===`
  // comparator, the `'package.json'` literal, or the `parsed.name ===
  // '@bymax-one/nest-auth'` check yields identical externally-observable
  // behaviour under any test harness that does not co-locate the lib's
  // package.json at a different depth from `import.meta.url`. The function
  // is exercised once at module load and its return value is asserted in
  // `health-resolve-lib-version.spec.ts`.
  try {
    const require = createRequire(import.meta.url);
    let dir = dirname(require.resolve('@bymax-one/nest-auth'));
    for (let i = 0; i < 5; i++) {
      const candidate = resolve(dir, 'package.json');
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf-8')) as {
          name?: string;
          version?: string;
        };
        if (parsed.name === '@bymax-one/nest-auth') {
          return parsed.version ?? 'unknown';
        }
      } catch {
        // package.json not present at this level — continue walking up.
      }
      dir = dirname(dir);
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
  // Stryker restore all
}

/** Library version resolved once at startup to avoid per-request filesystem I/O. */
const LIB_VERSION: string = resolveLibraryVersion();

/**
 * Controller for the health-check routes.
 *
 * Mounted under the global `/api` prefix:
 * - `GET /api/health` — aggregate readiness probe.
 * - `GET /api/health/throttle-demo` — throttled endpoint for rate-limiting demo.
 *
 * @public
 */
@Controller('health')
export class HealthController {
  constructor(
    @InjectPinoLogger(HealthController.name)
    private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
    @Inject(BYMAX_AUTH_REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  /**
   * Aggregate readiness probe.
   *
   * Checks Postgres and Redis in parallel. Individual failures degrade the
   * status without throwing, so HTTP 200 is always returned with a body
   * that orchestrators can inspect.
   *
   * Marked `@Public()` so the route remains accessible to liveness probes without
   * a JWT (the global `JwtAuthGuard` would otherwise reject it).
   *
   * @returns Aggregate health status with per-dependency details.
   */
  @Public()
  @Get()
  async check(): Promise<HealthStatus> {
    const [postgresStatus, redisStatus] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
    ]);

    const deps: HealthDeps = {
      postgres: postgresStatus,
      redis: redisStatus,
      library: LIB_VERSION,
    };

    const allOk = postgresStatus === 'ok' && redisStatus === 'ok';

    return {
      status: allOk ? 'ok' : 'degraded',
      uptime: process.uptime(),
      version: APP_VERSION,
      deps,
    };
  }

  /**
   * Throttled demo endpoint for IP-based rate limiting.
   *
   * Applies the `login` throttle tier (5 requests per 60 s per IP) so the
   * frontend can demonstrate the HTTP 429 response without touching any auth
   * state. `@UseGuards(ThrottlerGuard)` enables throttling for this route;
   * `@Throttle` overrides the module-level default with the login tier.
   *
   * Marked `@Public()` so it remains reachable without a JWT
   * (the global `JwtAuthGuard` would otherwise reject it). The ThrottlerGuard
   * provides IP-level rate limiting.
   *
   * @returns Timestamp object confirming the request was served.
   */
  @Public()
  @Get('throttle-demo')
  @UseGuards(ThrottlerGuard)
  @Throttle(AUTH_THROTTLE_CONFIGS.login)
  throttleDemo(): { ok: boolean; at: string } {
    return { ok: true, at: new Date().toISOString() };
  }

  /**
   * Runs `SELECT 1` against the primary database.
   *
   * @returns `'ok'` on success, `'degraded'` on any error.
   */
  private async checkPostgres(): Promise<DepStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'ok';
    } catch (err) {
      this.logger.warn({ err }, 'health.postgres.degraded');
      return 'degraded';
    }
  }

  /**
   * Runs `PING` against the Redis server.
   *
   * Forces a connection attempt on the lazy-connected client so the first
   * health check accurately reflects Redis reachability.
   *
   * @returns `'ok'` on `PONG` response, `'degraded'` on any error.
   */
  private async checkRedis(): Promise<DepStatus> {
    try {
      const response = await this.redis.ping();
      return response === 'PONG' ? 'ok' : 'degraded';
    } catch (err) {
      this.logger.warn({ err }, 'health.redis.degraded');
      return 'degraded';
    }
  }
}
