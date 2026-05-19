/**
 * @file health.controller.spec.ts
 * @description Unit tests for `HealthController`.
 *
 * Verifies that:
 * - `GET /health` returns `status: 'ok'` when both Postgres and Redis are healthy.
 * - `GET /health` returns `status: 'degraded'` when Postgres is unreachable.
 * - `GET /health` returns `status: 'degraded'` when Redis returns a non-PONG reply.
 * - `GET /health` returns `status: 'degraded'` when Redis throws.
 * - `GET /health/throttle-demo` returns `{ ok: true, at: <ISO string> }`.
 *
 * Both `PrismaService` and the Redis client (`BYMAX_AUTH_REDIS_CLIENT`) are fully
 * mocked. `InjectPinoLogger` is satisfied with a no-op logger stub.
 *
 * @layer test
 * @see apps/api/src/health/health.controller.ts
 */

import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { BYMAX_AUTH_REDIS_CLIENT } from '@bymax-one/nest-auth';
import { getLoggerToken } from 'nestjs-pino';

import { HealthController } from './health.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a no-op Pino logger stub that satisfies `PinoLogger`'s interface. */
function makeLoggerStub() {
  return { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('HealthController', () => {
  let controller: HealthController;
  let prismaQueryRaw: jest.Mock<() => Promise<unknown>>;
  let redisPing: jest.Mock<() => Promise<string>>;
  let loggerWarn: jest.Mock<() => void>;

  beforeEach(async () => {
    prismaQueryRaw = jest.fn<() => Promise<unknown>>();
    redisPing = jest.fn<() => Promise<string>>();
    loggerWarn = jest.fn<() => void>();

    const loggerStub = { ...makeLoggerStub(), warn: loggerWarn };

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: { $queryRaw: prismaQueryRaw },
        },
        {
          provide: BYMAX_AUTH_REDIS_CLIENT,
          useValue: { ping: redisPing },
        },
        // Satisfy the @InjectPinoLogger(HealthController.name) token.
        // `getLoggerToken` returns the string `'PinoLogger:HealthController'`
        // that nestjs-pino's @InjectPinoLogger decorator resolves at runtime.
        {
          provide: getLoggerToken(HealthController.name),
          useValue: loggerStub,
        },
      ],
    })
      // ThrottlerGuard on throttleDemo needs ThrottlerModule; override it so
      // the test module compiles without the full throttler configuration.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(HealthController);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── check ───────────────────────────────────────────────────────────────

  describe('check', () => {
    it('returns status "ok" when Postgres and Redis are both healthy', async () => {
      // Both dependencies must report "ok" for the aggregate to be "ok".
      prismaQueryRaw.mockResolvedValue([{ 1: 1 }]);
      redisPing.mockResolvedValue('PONG');

      const result = await controller.check();

      expect(result.status).toBe('ok');
      expect(result.deps.postgres).toBe('ok');
      expect(result.deps.redis).toBe('ok');
    });

    it('returns status "degraded" when Postgres throws', async () => {
      // A Postgres failure must degrade the aggregate without throwing so
      // orchestrators receive HTTP 200 with a machine-readable body.
      prismaQueryRaw.mockRejectedValue(new Error('connection refused'));
      redisPing.mockResolvedValue('PONG');

      const result = await controller.check();

      expect(result.status).toBe('degraded');
      expect(result.deps.postgres).toBe('degraded');
      expect(result.deps.redis).toBe('ok');
    });

    it('returns status "degraded" when Redis returns a non-PONG reply', async () => {
      // A non-PONG Redis response is treated as degraded to surface
      // potential proxy or middleware issues without crashing the probe.
      prismaQueryRaw.mockResolvedValue([{ 1: 1 }]);
      redisPing.mockResolvedValue('');

      const result = await controller.check();

      expect(result.status).toBe('degraded');
      expect(result.deps.redis).toBe('degraded');
    });

    it('returns status "degraded" when Redis throws', async () => {
      // A Redis throw must degrade the status and log a warning, not crash.
      prismaQueryRaw.mockResolvedValue([{ 1: 1 }]);
      redisPing.mockRejectedValue(new Error('redis unreachable'));

      const result = await controller.check();

      expect(result.status).toBe('degraded');
      expect(result.deps.redis).toBe('degraded');
      expect(loggerWarn).toHaveBeenCalled();
    });

    it('includes uptime, version, and deps.library in the response', async () => {
      // The health response shape must remain stable for monitoring dashboards.
      prismaQueryRaw.mockResolvedValue([{ 1: 1 }]);
      redisPing.mockResolvedValue('PONG');

      const result = await controller.check();

      expect(typeof result.uptime).toBe('number');
      expect(typeof result.version).toBe('string');
      expect(typeof result.deps.library).toBe('string');
    });

    it('returns status "degraded" when both Postgres and Redis fail', async () => {
      // Both dependencies failing must still return HTTP 200 with degraded status.
      prismaQueryRaw.mockRejectedValue(new Error('pg down'));
      redisPing.mockRejectedValue(new Error('redis down'));

      const result = await controller.check();

      expect(result.status).toBe('degraded');
      expect(result.deps.postgres).toBe('degraded');
      expect(result.deps.redis).toBe('degraded');
    });
  });

  // ─── throttleDemo ─────────────────────────────────────────────────────────

  describe('throttleDemo', () => {
    it('returns ok:true with an ISO timestamp string', () => {
      // The demo endpoint must return a stable shape regardless of throttle
      // state — the ThrottlerGuard is a framework concern, not controller logic.
      const result = controller.throttleDemo();

      expect(result.ok).toBe(true);
      expect(typeof result.at).toBe('string');
      expect(() => new Date(result.at)).not.toThrow();
    });
  });
});
