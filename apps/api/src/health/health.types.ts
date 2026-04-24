/**
 * @file health.types.ts
 * @description Shared types for the health-check module.
 *
 * Upgraded in Phase 5 to include Postgres, Redis, and library-version status.
 *
 * @layer infrastructure
 */

/** Status of an individual backing service dependency. */
export type DepStatus = 'ok' | 'degraded';

/**
 * Status of each backing-service dependency reported by `GET /api/health`.
 *
 * All fields are non-throwing — a degraded dependency returns `'degraded'`
 * rather than raising an exception, so orchestrators receive a 200 with a
 * machine-readable body instead of an opaque 5xx.
 */
export interface HealthDeps {
  /** Result of `SELECT 1` against the primary PostgreSQL database. */
  postgres: DepStatus;
  /** Result of `PING` against the Redis server. */
  redis: DepStatus;
  /** Installed version of `@bymax-one/nest-auth` (read from its `package.json`). */
  library: string;
}

/**
 * Shape of the response returned by `GET /api/health`.
 *
 * `status` is `'ok'` only when all dependencies report `'ok'`; otherwise
 * `'degraded'`. HTTP status is always 200 so orchestrators can distinguish
 * a process that is alive-but-impaired from one that is completely down.
 */
export interface HealthStatus {
  /** Aggregate health: `'ok'` when all deps pass, `'degraded'` on any failure. */
  status: 'ok' | 'degraded';
  /** Process uptime in seconds (`process.uptime()`). */
  uptime: number;
  /** `version` field from `apps/api/package.json`. */
  version: string;
  /** Per-dependency statuses. */
  deps: HealthDeps;
}
