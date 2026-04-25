/**
 * @file app-auth.hooks.spec.ts
 * @description Unit tests for `AppAuthHooks` lifecycle hook implementations.
 *
 * Uses a plain Jest mock for `PrismaService` (only the `auditLog.create` path
 * is exercised here). Tests confirm:
 *   1. The correct `event` slug is written for each hook.
 *   2. Non-secret fields from the hook arguments appear in the `payload`.
 *   3. Database write failures are swallowed — auth flows are never blocked by
 *      a broken audit-log infrastructure.
 *
 * Invitation end-to-end acceptance is covered by
 * `apps/api/test/invitations.e2e-spec.ts`.
 *
 * @layer test
 * @see apps/api/src/auth/app-auth.hooks.ts
 */

import type { HookContext, OAuthProfile, SafeAuthUser } from '@bymax-one/nest-auth';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service.js';
import { AppAuthHooks } from './app-auth.hooks.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a minimal valid `HookContext` with optional overrides. */
function makeContext(overrides?: Partial<HookContext>): HookContext {
  return {
    ip: '127.0.0.1',
    userAgent: 'jest-test-agent',
    sanitizedHeaders: {},
    ...overrides,
  };
}

/** Builds a minimal valid `SafeAuthUser` with optional overrides. */
function makeSafeUser(overrides?: Partial<SafeAuthUser>): SafeAuthUser {
  return {
    id: 'user-1',
    email: 'alice@example.test',
    name: 'Alice Test',
    role: 'MEMBER',
    status: 'ACTIVE',
    tenantId: 'acme',
    emailVerified: true,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('AppAuthHooks', () => {
  let hooks: AppAuthHooks;
  let auditLogCreate: jest.Mock<() => Promise<void>>;

  beforeEach(async () => {
    auditLogCreate = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AppAuthHooks,
        {
          provide: PrismaService,
          useValue: {
            auditLog: { create: auditLogCreate },
          },
        },
      ],
    }).compile();
    hooks = moduleRef.get(AppAuthHooks);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── onOAuthLogin ──────────────────────────────────────────────────────────

  describe('onOAuthLogin', () => {
    const profile: OAuthProfile = {
      provider: 'google',
      providerId: 'google-sub-123',
      email: 'alice@example.test',
      name: 'Alice Test',
    };

    it('returns action=reject and writes a blocked_status audit row when existingUser has a blocked status', async () => {
      // FCM #12/#23 — Already-linked accounts that are BANNED/SUSPENDED/INACTIVE must
      // never receive new tokens. This hook is the sole enforcement point for
      // the OAuth path on pre-linked accounts — the library does not check it.
      const blockedUser = makeSafeUser({ status: 'BANNED' });
      const ctx = makeContext({ tenantId: 'acme', userId: 'user-1' });

      const result = await hooks.onOAuthLogin(profile, blockedUser, ctx);

      expect(result).toEqual({ action: 'reject' });
      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'oauth.login',
            payload: expect.objectContaining({ action: 'reject', reason: 'blocked_status' }),
          }),
        }),
      );
    });

    it('returns action=link when existingUser is present and not blocked', async () => {
      // A non-blocked user who already has an OAuth link re-authenticates via
      // the 'link' action — the library calls userRepo.linkOAuth (effectively a
      // no-op update for an already-linked identity).
      const activeUser = makeSafeUser({ status: 'ACTIVE' });
      const ctx = makeContext({ tenantId: 'acme', userId: 'user-1' });

      const result = await hooks.onOAuthLogin(profile, activeUser, ctx);

      expect(result).toEqual({ action: 'link' });
      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'oauth.login',
            payload: expect.objectContaining({ action: 'link' }),
          }),
        }),
      );
    });

    it('returns action=create when existingUser is null (first-time OAuth sign-in with a new email)', async () => {
      // A brand-new email (no existing row) takes the create path; the library
      // delegates to PrismaUserRepository.createWithOAuth to upsert the row.
      const ctx = makeContext({ tenantId: 'acme' });

      const result = await hooks.onOAuthLogin(profile, null, ctx);

      expect(result).toEqual({ action: 'create' });
      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'oauth.login',
            payload: expect.objectContaining({ action: 'create' }),
          }),
        }),
      );
    });
  });

  // ─── afterInvitationAccepted ────────────────────────────────────────────────

  describe('afterInvitationAccepted', () => {
    it('writes an AuditLog row with event invitation.accepted and expected payload fields', async () => {
      // FCM #21 — When a user accepts an invitation, a tamper-evident audit row must
      // be written so admins can reconstruct the tenant onboarding timeline.
      const user = makeSafeUser({ id: 'invited-1', tenantId: 'acme', role: 'MEMBER' });
      const ctx = makeContext({ userId: 'invited-1', tenantId: 'acme' });

      await hooks.afterInvitationAccepted(user, ctx);

      expect(auditLogCreate).toHaveBeenCalledTimes(1);
      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'invitation.accepted',
            tenantId: 'acme',
            actorUserId: 'invited-1',
            payload: expect.objectContaining({
              userId: 'invited-1',
              tenantId: 'acme',
              role: 'MEMBER',
            }),
          }),
        }),
      );
    });

    it('swallows AuditLog write failures so the invitation flow is never blocked', async () => {
      // Non-blocking audit: a broken DB must not surface as an HTTP 500 during
      // invitation acceptance. The hook logs the error and returns normally.
      auditLogCreate.mockRejectedValue(new Error('DB connection lost'));
      const user = makeSafeUser();
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await expect(hooks.afterInvitationAccepted(user, ctx)).resolves.toBeUndefined();
    });

    it('sets actorUserId from context.userId when available', async () => {
      // The actorUserId in AuditLog must track who accepted — never left as null
      // when the context carries the user identity.
      const user = makeSafeUser({ id: 'user-99' });
      const ctx = makeContext({ userId: 'user-99', tenantId: 'acme' });

      await hooks.afterInvitationAccepted(user, ctx);

      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actorUserId: 'user-99' }),
        }),
      );
    });
  });
});
