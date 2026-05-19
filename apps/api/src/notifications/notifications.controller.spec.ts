/**
 * @file notifications.controller.spec.ts
 * @description Unit tests for `NotificationsController`.
 *
 * Exercises every public method:
 *   - `notifySelf`: production guard → `ForbiddenException`; non-production →
 *     calls `gateway.emitNewNotification` with `user.sub` and default/supplied content.
 *   - `notify`: production guard → `ForbiddenException`; user not in tenant →
 *     `NotFoundException`; success → calls `gateway.emitNewNotification` with userId.
 *
 * Uses plain mock objects — no NestJS testing module bootstrap needed for a
 * controller unit test. Guards and pipes are not activated here; those are
 * exercised by e2e tests.
 *
 * @layer test
 * @see apps/api/src/notifications/notifications.controller.ts
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { DashboardJwtPayload } from '@bymax-one/nest-auth';
import { NotificationsController } from './notifications.controller.js';
import type { NotifyDto, NotifySelfDto } from './dto/notify.dto.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a minimal `DashboardJwtPayload` stub.
 *
 * @param overrides - Fields to override on the default payload.
 */
function makeUser(overrides?: Partial<DashboardJwtPayload>): DashboardJwtPayload {
  return {
    sub: 'user-001',
    email: 'alice@example.test',
    tenantId: 'tenant-001',
    role: 'ADMIN',
    type: 'dashboard',
    iat: 0,
    exp: 9999999999,
    jti: 'jti-001',
    ...overrides,
  } as DashboardJwtPayload;
}

/**
 * Builds mock dependencies for `NotificationsController`.
 *
 * @param nodeEnv - Simulated `NODE_ENV` value (default `'test'`).
 * @param findFirstResult - Value returned by `prisma.user.findFirst`.
 */
function makeDeps(
  nodeEnv = 'test',
  findFirstResult: { id: string } | null = { id: 'user-target' },
) {
  const emitNewNotification = jest
    .fn<(userId: string, payload: { title: string; body: string }) => number>()
    .mockReturnValue(1);

  const gateway = { emitNewNotification } as unknown as ConstructorParameters<
    typeof NotificationsController
  >[0];

  const prisma = {
    user: {
      findFirst: jest.fn<() => Promise<{ id: string } | null>>().mockResolvedValue(findFirstResult),
    },
  } as unknown as ConstructorParameters<typeof NotificationsController>[1];

  const configGet = jest.fn<(key: string) => string | undefined>().mockImplementation((key) => {
    if (key === 'NODE_ENV') return nodeEnv;
    return undefined;
  });

  const config = {
    get: configGet,
    getOrThrow: jest.fn(),
  } as unknown as ConstructorParameters<typeof NotificationsController>[2];

  return { gateway, prisma, config, emitNewNotification };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('NotificationsController', () => {
  // ── notifySelf ─────────────────────────────────────────────────────────────

  describe('notifySelf', () => {
    it('throws ForbiddenException when NODE_ENV is production', () => {
      // Belt-and-suspenders guard: even if the module is wired in a production
      // build, the method rejects immediately with 403 to prevent abuse.
      const { gateway, prisma, config } = makeDeps('production');
      const controller = new NotificationsController(gateway, prisma, config);
      const user = makeUser();
      const dto: NotifySelfDto = {};

      expect(() => controller.notifySelf(user, dto)).toThrow(ForbiddenException);
    });

    it('calls gateway.emitNewNotification with user.sub and default title/body when dto is empty', () => {
      // FCM #24 — the self-notification path must use the JWT payload's `sub` as the
      // target, preventing callers from injecting an arbitrary userId via the body.
      const { gateway, prisma, config, emitNewNotification } = makeDeps('test');
      const controller = new NotificationsController(gateway, prisma, config);
      const user = makeUser({ sub: 'user-001' });
      const dto: NotifySelfDto = {};

      const result = controller.notifySelf(user, dto);

      expect(emitNewNotification).toHaveBeenCalledWith('user-001', {
        title: 'Hello',
        body: 'This is a test notification.',
      });
      expect(result).toEqual({ delivered: 1 });
    });

    it('calls gateway.emitNewNotification with supplied title and body when dto is provided', () => {
      // When the caller supplies custom content it must be forwarded verbatim —
      // the default values are only used when the dto fields are undefined.
      const { gateway, prisma, config, emitNewNotification } = makeDeps('development');
      const controller = new NotificationsController(gateway, prisma, config);
      const user = makeUser({ sub: 'user-002' });
      const dto: NotifySelfDto = { title: 'Custom Title', body: 'Custom Body' };

      const result = controller.notifySelf(user, dto);

      expect(emitNewNotification).toHaveBeenCalledWith('user-002', {
        title: 'Custom Title',
        body: 'Custom Body',
      });
      expect(result).toEqual({ delivered: 1 });
    });

    it('returns { delivered: 0 } when the gateway reports no connected sockets', () => {
      // A user with no open WebSocket connections must receive delivered=0 rather
      // than an error — the demo endpoint is best-effort and fire-and-forget.
      const { gateway, prisma, config, emitNewNotification } = makeDeps('test');
      emitNewNotification.mockReturnValue(0);
      const controller = new NotificationsController(gateway, prisma, config);
      const user = makeUser();
      const dto: NotifySelfDto = {};

      const result = controller.notifySelf(user, dto);

      expect(result).toEqual({ delivered: 0 });
    });
  });

  // ── notify ─────────────────────────────────────────────────────────────────

  describe('notify', () => {
    it('throws ForbiddenException when NODE_ENV is production', async () => {
      // Same belt-and-suspenders guard as notifySelf — the admin path is equally
      // unavailable in production builds.
      const { gateway, prisma, config } = makeDeps('production');
      const controller = new NotificationsController(gateway, prisma, config);
      const admin = makeUser();
      const dto: NotifyDto = { title: 'T', body: 'B' };

      await expect(controller.notify('user-target', admin, dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when the target userId is not found in the admin tenant', async () => {
      // Tenant isolation: a userId that does not belong to the admin's tenant must
      // return 404 — identical to UsersService.updateStatus to prevent enumeration.
      const { gateway, prisma, config } = makeDeps('test', null);
      const controller = new NotificationsController(gateway, prisma, config);
      const admin = makeUser({ tenantId: 'tenant-001' });
      const dto: NotifyDto = { title: 'T', body: 'B' };

      await expect(controller.notify('user-foreign', admin, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('queries prisma with userId and admin tenantId for tenant isolation', async () => {
      // The findFirst call must scope by both id and tenantId — using only id would
      // allow cross-tenant notification injection by an admin on another tenant.
      const { gateway, prisma, config } = makeDeps('test', { id: 'user-target' });
      const controller = new NotificationsController(gateway, prisma, config);
      const admin = makeUser({ tenantId: 'tenant-001' });
      const dto: NotifyDto = { title: 'T', body: 'B' };

      await controller.notify('user-target', admin, dto);

      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-target', tenantId: 'tenant-001' },
        }),
      );
    });

    it('calls gateway.emitNewNotification with userId and dto on success', async () => {
      // On successful tenant-isolation check the notification must be forwarded to
      // the gateway using the path-parameter userId (not admin.sub).
      const { gateway, prisma, config, emitNewNotification } = makeDeps('test', {
        id: 'user-target',
      });
      const controller = new NotificationsController(gateway, prisma, config);
      const admin = makeUser({ tenantId: 'tenant-001' });
      const dto: NotifyDto = { title: 'Alert', body: 'Your session was revoked.' };

      const result = await controller.notify('user-target', admin, dto);

      expect(emitNewNotification).toHaveBeenCalledWith('user-target', dto);
      expect(result).toEqual({ delivered: 1 });
    });

    it('returns { delivered: 0 } when the gateway reports no connected sockets', async () => {
      // Best-effort delivery: even if the target user has no open sockets the
      // endpoint must succeed (200 OK) with delivered=0.
      const { gateway, prisma, config, emitNewNotification } = makeDeps('test', {
        id: 'user-target',
      });
      emitNewNotification.mockReturnValue(0);
      const controller = new NotificationsController(gateway, prisma, config);
      const admin = makeUser();
      const dto: NotifyDto = { title: 'T', body: 'B' };

      const result = await controller.notify('user-target', admin, dto);

      expect(result).toEqual({ delivered: 0 });
    });
  });
});
