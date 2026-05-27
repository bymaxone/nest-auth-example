/**
 * @file audit.controller.spec.ts
 * @description Unit tests for `AuditController` — verifies the route
 * forwards the authenticated user's tenantId to the service without
 * touching the request body or query string.
 *
 * @layer test
 * @see apps/api/src/audit/audit.controller.ts
 */

import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

/** Minimal fake `DashboardJwtPayload` for the controller hand-off. */
function makeUser(overrides: { tenantId?: string } = {}) {
  return {
    sub: 'user-1',
    tenantId: overrides.tenantId ?? 'tenant-1',
    role: 'ADMIN',
  };
}

describe('AuditController', () => {
  let controller: AuditController;
  let listRecent: jest.Mock<() => Promise<unknown[]>>;

  beforeEach(async () => {
    listRecent = jest.fn<() => Promise<unknown[]>>();
    const moduleRef = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditService, useValue: { listRecent } }],
    }).compile();
    controller = moduleRef.get(AuditController);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('listRecent', () => {
    it('forwards user.tenantId from the JWT to the service', async () => {
      /*
       * Scenario: the audit endpoint must never trust client input for
       * tenant scoping — only the verified JWT payload. The controller
       * passes user.tenantId straight through, never reading anything
       * from req.body / req.query. Pinning the (tenantId) hand-off
       * catches a regression that would let an attacker query another
       * tenant's audit log by tampering with a header.
       */
      const expected = [{ id: 'audit-1', event: 'user.login.succeeded' }];
      listRecent.mockResolvedValue(expected);
      const user = makeUser({ tenantId: 'tenant-99' });

      const result = await controller.listRecent(user as never);

      expect(listRecent).toHaveBeenCalledWith('tenant-99');
      expect(result).toBe(expected);
    });
  });
});
