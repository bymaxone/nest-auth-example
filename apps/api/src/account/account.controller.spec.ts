/**
 * @file account.controller.spec.ts
 * @description Unit tests for `AccountController`.
 *
 * Verifies that `POST /account/change-password` delegates to
 * `AccountService.changePassword` with the authenticated user's `id` and
 * `tenantId` and the validated DTO — without the controller performing any
 * business logic itself.
 *
 * @layer test
 * @see apps/api/src/account/account.controller.ts
 */

import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import type { ChangePasswordDto } from './dto/change-password.dto.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a minimal fake `DashboardJwtPayload` sufficient for the account endpoints. */
function makeUser(overrides: { sub?: string; tenantId?: string } = {}) {
  return {
    sub: overrides.sub ?? 'user-1',
    tenantId: overrides.tenantId ?? 'tenant-1',
    role: 'MEMBER',
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('AccountController', () => {
  let controller: AccountController;
  let changePassword: jest.Mock<() => Promise<void>>;

  beforeEach(async () => {
    changePassword = jest.fn<() => Promise<void>>();

    const moduleRef = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [
        {
          provide: AccountService,
          useValue: { changePassword },
        },
      ],
    }).compile();

    controller = moduleRef.get(AccountController);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── changePassword ───────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('calls service.changePassword with user.sub, user.tenantId, and the dto', async () => {
      // The controller must forward the user's sub and tenantId from the JWT
      // claim, not from user input, to prevent cross-account mutations.
      const dto: ChangePasswordDto = {
        currentPassword: 'old-secret',
        newPassword: 'new-secret-12345',
      };
      changePassword.mockResolvedValue(undefined);
      const user = makeUser({ sub: 'user-42', tenantId: 'tenant-99' });

      await controller.changePassword(dto, user as never);

      expect(changePassword).toHaveBeenCalledWith('user-42', 'tenant-99', dto);
    });

    it('resolves with void when the service call succeeds', async () => {
      // HTTP 204 No Content requires the handler to resolve without a body.
      const dto: ChangePasswordDto = {
        currentPassword: 'old-secret',
        newPassword: 'new-secret-12345',
      };
      changePassword.mockResolvedValue(undefined);
      const user = makeUser();

      await expect(controller.changePassword(dto, user as never)).resolves.toBeUndefined();
    });
  });
});
