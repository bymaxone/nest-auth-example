/**
 * @file health.types.ts
 * @description Shared types for the health-check module.
 * @layer infrastructure
 */

/**
 * Shape of the response returned by `GET /api/health`.
 *
 * Upgraded in Phase 5 to include Postgres, Redis, and library-version checks.
 */
export interface HealthStatus {
  /** Always `'ok'` while the process is alive. */
  status: 'ok';
  /** Process uptime in seconds (`process.uptime()`). */
  uptime: number;
  /** `version` field from `apps/api/package.json`. */
  version: string;
}
