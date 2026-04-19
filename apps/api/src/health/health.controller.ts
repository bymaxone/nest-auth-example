/**
 * @file health.controller.ts
 * @description Exposes `GET /api/health` for liveness probes and smoke tests.
 *
 * Phase 3: returns `{ status, uptime, version }` using in-process values only.
 * Phase 5 upgrades this endpoint to aggregate Postgres, Redis, and library version.
 *
 * @layer infrastructure
 */

import { Controller, Get } from '@nestjs/common';

import pkg from '../../package.json' with { type: 'json' };
import type { HealthStatus } from './health.types.js';

/** Package version resolved once at module load time; avoids per-request re-reads. */
const APP_VERSION: string = pkg.version;

/**
 * Controller for the health-check route.
 *
 * Mounted under the global `/api` prefix, so the effective URL is `GET /api/health`.
 * @public
 */
@Controller('health')
export class HealthController {
  /**
   * Returns a minimal liveness response.
   *
   * @returns Current health status, process uptime, and application version.
   */
  @Get()
  check(): HealthStatus {
    return {
      status: 'ok',
      uptime: process.uptime(),
      version: APP_VERSION,
    };
  }
}
