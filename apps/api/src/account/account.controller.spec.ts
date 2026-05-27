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
import { AuthService, TokenDeliveryService } from '@bymax-one/nest-auth';
import type { Request, Response } from 'express';

import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import type { ChangePasswordDto } from './dto/change-password.dto.js';
import type { SwitchWorkspaceDto } from './dto/switch-workspace.dto.js';

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
  let listWorkspaces: jest.Mock<() => Promise<unknown[]>>;
  let getMfaStatus: jest.Mock<() => Promise<unknown>>;
  let findSwitchTarget: jest.Mock<
    () => Promise<{ targetUserId: string; targetTenantSlug: string }>
  >;
  let issueTokensForUserId: jest.Mock<() => Promise<unknown>>;
  let deliverAuthResponse: jest.Mock<() => unknown>;

  beforeEach(async () => {
    changePassword = jest.fn<() => Promise<void>>();
    listWorkspaces = jest.fn<() => Promise<unknown[]>>();
    getMfaStatus = jest.fn<() => Promise<unknown>>();
    findSwitchTarget = jest.fn<() => Promise<{ targetUserId: string; targetTenantSlug: string }>>();
    issueTokensForUserId = jest.fn<() => Promise<unknown>>();
    deliverAuthResponse = jest.fn<() => unknown>();

    const moduleRef = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [
        {
          provide: AccountService,
          useValue: { changePassword, listWorkspaces, getMfaStatus, findSwitchTarget },
        },
        // AuthService + TokenDeliveryService are public exports of
        // `@bymax-one/nest-auth` v1.0.10+. The controller injects them to
        // run the silent workspace-switch flow; we stub the surfaces the
        // controller actually calls so the unit test does not need to
        // construct the full BymaxAuthModule under test.
        {
          provide: AuthService,
          useValue: { issueTokensForUserId },
        },
        {
          provide: TokenDeliveryService,
          useValue: { deliverAuthResponse },
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

  // ─── listWorkspaces ───────────────────────────────────────────────────────

  describe('listWorkspaces', () => {
    it('forwards user.sub and user.tenantId from the JWT to the service', async () => {
      // The controller must read the identity claims from the validated JWT —
      // never trust client-supplied input — and pass them straight through.
      const expected = [
        {
          tenantId: 't-acme',
          tenantSlug: 'acme',
          tenantName: 'Acme Corp',
          role: 'ADMIN',
          isCurrent: true,
        },
      ];
      listWorkspaces.mockResolvedValue(expected);
      const user = makeUser({ sub: 'user-42', tenantId: 'tenant-99' });

      const result = await controller.listWorkspaces(user as never);

      expect(listWorkspaces).toHaveBeenCalledWith('user-42', 'tenant-99');
      expect(result).toBe(expected);
    });
  });

  // ─── getMfaStatus ─────────────────────────────────────────────────────────

  describe('getMfaStatus', () => {
    it('forwards user.sub and user.tenantId from the JWT to the service', async () => {
      /*
       * Scenario: GET /api/account/mfa is JWT-protected; the controller must
       * read the user's identity from the verified payload and pass it
       * straight through. Pinning the (sub, tenantId) hand-off catches a
       * future refactor that pulls the values from the request body or query
       * string — both attacker-controlled.
       */
      const expected = { enabled: true, recoveryCodesRemaining: 5, recoveryCodesTotal: 8 };
      getMfaStatus.mockResolvedValue(expected);
      const user = makeUser({ sub: 'user-42', tenantId: 'tenant-99' });

      const result = await controller.getMfaStatus(user as never);

      expect(getMfaStatus).toHaveBeenCalledWith('user-42', 'tenant-99');
      expect(result).toBe(expected);
    });
  });

  // ─── switchWorkspace ──────────────────────────────────────────────────────

  describe('switchWorkspace', () => {
    /** Builds a minimal Express Request stub for the controller. */
    function makeReq(): Request {
      return { ip: '203.0.113.1', headers: { 'user-agent': 'TestBrowser/1.0' } } as Request;
    }

    /** Builds a minimal Express Response stub (passthrough mode). */
    function makeRes(): Response {
      return { cookie: jest.fn(), clearCookie: jest.fn() } as unknown as Response;
    }

    it('threads JWT identity + DTO + request context through the silent-switch pipeline', async () => {
      /*
       * Scenario: the silent switch endpoint must (a) call the service's
       * `findSwitchTarget` with the JWT's sub + tenantId AND the DTO's
       * destination tenantId, (b) call the lib's `issueTokensForUserId`
       * with the validated target plus the request's IP + UA, and (c)
       * delegate cookie writing to `TokenDeliveryService.deliverAuthResponse`.
       * Pinning every hand-off here catches a future regression that
       * silently bypasses one of the three security-critical hops.
       * Protects: ownership-validation → token-issuance → cookie-delivery
       * chain in the switch flow.
       */
      const targetUserId = 'user-target-globex';
      const targetTenantSlug = 'globex';
      findSwitchTarget.mockResolvedValue({ targetUserId, targetTenantSlug });
      const authResult = { user: { id: targetUserId }, accessToken: 'jwt', rawRefreshToken: 'rt' };
      issueTokensForUserId.mockResolvedValue(authResult);
      const deliveredBody = { user: { id: targetUserId } };
      deliverAuthResponse.mockReturnValue(deliveredBody);

      const dto: SwitchWorkspaceDto = { tenantId: 'cmtarget0000globex0000xx' };
      const user = makeUser({ sub: 'user-acme', tenantId: 'cmcurrent000acme0000xx' });
      const req = makeReq();
      const res = makeRes();

      const result = await controller.switchWorkspace(dto, user as never, req, res);

      expect(findSwitchTarget).toHaveBeenCalledWith(
        'user-acme',
        'cmcurrent000acme0000xx',
        'cmtarget0000globex0000xx',
      );
      expect(issueTokensForUserId).toHaveBeenCalledWith(
        targetUserId,
        '203.0.113.1',
        'TestBrowser/1.0',
      );
      expect(deliverAuthResponse).toHaveBeenCalledWith(res, authResult, req);
      expect(result).toBe(deliveredBody);
    });

    it('falls back to empty ip + user-agent when the request omits them', async () => {
      /*
       * Scenario: defence-in-depth — if a buggy proxy strips `ip` or
       * the `user-agent` header, the controller must NOT crash on
       * `undefined` and must still mint a session. Empty strings match
       * the lib's password-login behaviour so the audit log shape stays
       * uniform. Protects: the `??` / `String(...)` coercions in the
       * controller's IP / UA extraction.
       */
      findSwitchTarget.mockResolvedValue({
        targetUserId: 't-user',
        targetTenantSlug: 'globex',
      });
      issueTokensForUserId.mockResolvedValue({ user: {}, accessToken: 'a', rawRefreshToken: 'b' });
      deliverAuthResponse.mockReturnValue({});

      const dto: SwitchWorkspaceDto = { tenantId: 'cmtarget0000globex0000xx' };
      const user = makeUser();
      // No `ip`, no `user-agent`.
      const req = { headers: {} } as unknown as Request;
      const res = makeRes();

      await controller.switchWorkspace(dto, user as never, req, res);

      expect(issueTokensForUserId).toHaveBeenCalledWith('t-user', '', '');
    });

    it('propagates errors from findSwitchTarget without minting a session', async () => {
      /*
       * Scenario: `AccountService.findSwitchTarget` throws when ownership
       * validation fails (BadRequest on self-switch, NotFound on missing
       * email match, Forbidden on inactive destination, Unauthorized on
       * missing caller row). The controller must NOT call
       * `issueTokensForUserId` in that case — otherwise a 403/404
       * ownership failure would silently issue tokens for an unrelated
       * userId. Protects: ownership gate cannot be skipped by an
       * upstream throw.
       */
      const err = new Error('forbidden');
      findSwitchTarget.mockRejectedValue(err);

      await expect(
        controller.switchWorkspace(
          { tenantId: 'cmtarget0000globex0000xx' } as SwitchWorkspaceDto,
          makeUser() as never,
          makeReq(),
          makeRes(),
        ),
      ).rejects.toBe(err);
      expect(issueTokensForUserId).not.toHaveBeenCalled();
      expect(deliverAuthResponse).not.toHaveBeenCalled();
    });

    it('propagates errors from issueTokensForUserId without delivering cookies', async () => {
      /*
       * Scenario: the lib's `issueTokensForUserId` throws when the target
       * has MFA enabled (MFA_REQUIRED), is suspended (ACCOUNT_SUSPENDED),
       * or fails any other status guard. The controller must NOT call
       * `deliverAuthResponse` — otherwise a half-cooked response state
       * could leak cookies for a forbidden path. Protects: token-issuance
       * failures abort the cookie write.
       */
      findSwitchTarget.mockResolvedValue({
        targetUserId: 't-user',
        targetTenantSlug: 'globex',
      });
      const err = new Error('mfa required');
      issueTokensForUserId.mockRejectedValue(err);

      await expect(
        controller.switchWorkspace(
          { tenantId: 'cmtarget0000globex0000xx' } as SwitchWorkspaceDto,
          makeUser() as never,
          makeReq(),
          makeRes(),
        ),
      ).rejects.toBe(err);
      expect(deliverAuthResponse).not.toHaveBeenCalled();
    });
  });
});
