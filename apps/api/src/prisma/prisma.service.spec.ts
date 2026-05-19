/**
 * @file prisma.service.spec.ts
 * @description Unit tests for `PrismaService` lifecycle hooks.
 *
 * Verifies that `onModuleInit` calls `$connect()` and `onModuleDestroy` calls
 * `$disconnect()`. `@prisma/client` is mocked to avoid any real database
 * construction — Prisma 7 requires adapter options at construction time and would
 * fail in a unit-test context without them.
 *
 * @layer test
 * @see apps/api/src/prisma/prisma.service.ts
 */

import { jest } from '@jest/globals';

// ─── Mock @prisma/client before imports ──────────────────────────────────────

// Prisma 7 PrismaClient requires adapter options at construction time.
// We replace PrismaClient with a minimal mock class that exposes only the
// lifecycle methods exercised by PrismaService.
const mockConnect = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockDisconnect = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

jest.unstable_mockModule('@prisma/client', () => {
  class MockPrismaClient {
    $connect = mockConnect;
    $disconnect = mockDisconnect;
  }
  return { PrismaClient: MockPrismaClient };
});

// ─── Imports (after mock registration) ───────────────────────────────────────

// Static imports are hoisted past jest.unstable_mockModule in ESM — the
// service must be loaded via dynamic import so @prisma/client resolves to
// the mock above rather than the real adapter-requiring client.
const { PrismaService } = await import('./prisma.service.js');
type PrismaServiceType = InstanceType<typeof PrismaService>;

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('PrismaService', () => {
  let service: PrismaServiceType;

  beforeEach(() => {
    // Reset call counts between tests.
    mockConnect.mockClear();
    mockDisconnect.mockClear();
    // Direct instantiation — no NestJS test module needed since PrismaService
    // has no injected dependencies beyond the PrismaClient base class.
    service = new PrismaService();
  });

  // ─── onModuleInit ──────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('calls $connect() to open the database connection on module startup', async () => {
      // NestJS calls onModuleInit at bootstrap. Calling $connect here surfaces
      // connection errors early rather than on the first query.
      await service.onModuleInit();

      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('resolves without error when $connect() succeeds', async () => {
      // Happy path — $connect resolves and onModuleInit completes normally.
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });

    it('propagates errors from $connect() so bootstrap fails visibly', async () => {
      // A connection error must bubble up so the process exits at startup rather
      // than silently running with a broken DB pool.
      const dbError = new Error('ECONNREFUSED');
      mockConnect.mockRejectedValueOnce(dbError);

      await expect(service.onModuleInit()).rejects.toThrow('ECONNREFUSED');
    });
  });

  // ─── onModuleDestroy ───────────────────────────────────────────────────────

  describe('onModuleDestroy', () => {
    it('calls $disconnect() to drain the connection pool on module teardown', async () => {
      // NestJS calls onModuleDestroy during graceful shutdown. Disconnecting
      // prevents "Connection terminated unexpectedly" errors in Postgres logs.
      await service.onModuleDestroy();

      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });

    it('resolves without error when $disconnect() succeeds', async () => {
      // Happy path — $disconnect resolves and onModuleDestroy completes normally.
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });

    it('propagates errors from $disconnect() so shutdown failures are visible', async () => {
      // A disconnect error must not be swallowed — the NestJS lifecycle caller
      // should observe it and handle shutdown accordingly.
      const shutdownError = new Error('disconnect failed');
      mockDisconnect.mockRejectedValueOnce(shutdownError);

      await expect(service.onModuleDestroy()).rejects.toThrow('disconnect failed');
    });
  });
});
