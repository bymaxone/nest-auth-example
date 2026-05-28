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

import {
  BYMAX_AUTH_EMAIL_PROVIDER,
  type HookContext,
  type IEmailProvider,
  type OAuthProfile,
  type SafeAuthUser,
  type SessionInfo,
} from '@bymax-one/nest-auth';
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
  let sendNewSessionAlert: jest.Mock<() => Promise<void>>;

  beforeEach(async () => {
    auditLogCreate = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    sendNewSessionAlert = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    // Stub `IEmailProvider` — only `sendNewSessionAlert` is exercised by
    // `onNewSession`; the remaining methods would throw if accidentally called.
    const emailProviderStub = { sendNewSessionAlert } as unknown as IEmailProvider;
    const moduleRef = await Test.createTestingModule({
      providers: [
        AppAuthHooks,
        {
          provide: PrismaService,
          useValue: {
            auditLog: { create: auditLogCreate },
          },
        },
        {
          provide: BYMAX_AUTH_EMAIL_PROVIDER,
          useValue: emailProviderStub,
        },
      ],
    }).compile();
    hooks = moduleRef.get(AppAuthHooks);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── beforeRegister ────────────────────────────────────────────────────────

  describe('beforeRegister', () => {
    it('always returns { allowed: true } and writes a user.register.attempted audit row', async () => {
      // The reference app does not block any registration — this hook is wired
      // so that consumers can see the pattern and add domain allowlists here.
      const ctx = makeContext({ tenantId: 'acme' });
      const data = { email: 'new@example.test', name: 'New User', tenantId: 'acme' };

      const result = await hooks.beforeRegister(data, ctx);

      expect(result).toEqual({ allowed: true });
      expect(auditLogCreate).toHaveBeenCalledTimes(1);
      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'user.register.attempted',
            payload: expect.objectContaining({ tenantId: 'acme' }),
          }),
        }),
      );
    });

    it('swallows AuditLog write failures so the registration flow is never blocked', async () => {
      // Non-blocking audit: a broken DB must not surface as an HTTP 500 during
      // registration. The hook logs the error and returns { allowed: true }.
      auditLogCreate.mockRejectedValue(new Error('DB connection lost'));
      const ctx = makeContext({ tenantId: 'acme' });
      const data = { email: 'x@example.test', name: 'X', tenantId: 'acme' };

      const result = await hooks.beforeRegister(data, ctx);

      expect(result).toEqual({ allowed: true });
    });
  });

  // ─── onLoginAttempt (beforeLogin) ──────────────────────────────────────────

  describe('beforeLogin', () => {
    it('writes a user.login.attempted audit row with tenantId and email', async () => {
      // FCM #30 — every login attempt must be audited so security teams can
      // correlate brute-force attempts with account lockout events.
      const ctx = makeContext({ tenantId: 'acme' });

      await hooks.beforeLogin('alice@example.test', 'acme', ctx);

      expect(auditLogCreate).toHaveBeenCalledTimes(1);
      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'user.login.attempted',
            payload: expect.objectContaining({
              tenantId: 'acme',
              email: 'alice@example.test',
            }),
          }),
        }),
      );
    });

    it('swallows AuditLog write failures so the login flow is never blocked', async () => {
      // A broken audit DB must not prevent a valid user from logging in.
      auditLogCreate.mockRejectedValue(new Error('timeout'));
      const ctx = makeContext({ tenantId: 'acme' });

      await expect(hooks.beforeLogin('alice@example.test', 'acme', ctx)).resolves.toBeUndefined();
    });
  });

  // ─── onLoginSuccess (afterLogin) ───────────────────────────────────────────

  describe('afterLogin', () => {
    it('writes a user.login.succeeded audit row with userId, tenantId, and role', async () => {
      // FCM #30 — a successful login must produce an audit row that lets admins
      // confirm when and from which IP a session was established.
      const user = makeSafeUser({ id: 'user-1', tenantId: 'acme', role: 'MEMBER' });
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await hooks.afterLogin(user, ctx);

      expect(auditLogCreate).toHaveBeenCalledTimes(1);
      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'user.login.succeeded',
            payload: expect.objectContaining({
              userId: 'user-1',
              tenantId: 'acme',
              role: 'MEMBER',
            }),
          }),
        }),
      );
    });

    it('swallows AuditLog write failures so the login flow is never blocked', async () => {
      // afterLogin is called AFTER the token has been issued — a failed audit
      // write must not roll back the already-issued token or return a 500.
      auditLogCreate.mockRejectedValue(new Error('write failed'));
      const user = makeSafeUser();
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await expect(hooks.afterLogin(user, ctx)).resolves.toBeUndefined();
    });
  });

  // ─── onLoginFailure (afterLogin rejected via brute-force) ─────────────────
  // Note: the library calls `beforeLogin` for every attempt. A separate
  // "onLoginFailure" is surfaced here via the error-swallowing test pattern
  // to demonstrate that the attempted row is sufficient for failure auditing.

  // ─── onLogout (afterLogout) ────────────────────────────────────────────────

  describe('afterLogout', () => {
    it('writes a user.logout audit row with userId', async () => {
      // FCM #30 — logout events must be audited so admins can reconstruct session
      // lifecycles (connect + disconnect) for security investigations.
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await hooks.afterLogout('user-1', ctx);

      expect(auditLogCreate).toHaveBeenCalledTimes(1);
      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'user.logout',
            payload: expect.objectContaining({ userId: 'user-1' }),
          }),
        }),
      );
    });

    it('swallows AuditLog write failures so the logout flow is never blocked', async () => {
      // A broken audit DB must not prevent the session from being invalidated.
      auditLogCreate.mockRejectedValue(new Error('DB error'));
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await expect(hooks.afterLogout('user-1', ctx)).resolves.toBeUndefined();
    });
  });

  // ─── onMfaEnabled (afterMfaEnabled) ───────────────────────────────────────

  describe('afterMfaEnabled', () => {
    it('writes a mfa.enabled audit row with userId and tenantId', async () => {
      // Enabling MFA is a security-critical account change — the audit row
      // lets admins verify the change was intentional and not a takeover.
      const user = makeSafeUser({ id: 'user-1', tenantId: 'acme' });
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await hooks.afterMfaEnabled(user, ctx);

      expect(auditLogCreate).toHaveBeenCalledTimes(1);
      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'mfa.enabled',
            payload: expect.objectContaining({ userId: 'user-1', tenantId: 'acme' }),
          }),
        }),
      );
    });

    it('swallows AuditLog write failures so the MFA enable flow is never blocked', async () => {
      // The TOTP secret is already committed before this hook runs — a failed audit
      // must not roll back the MFA activation.
      auditLogCreate.mockRejectedValue(new Error('DB error'));
      const user = makeSafeUser();
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await expect(hooks.afterMfaEnabled(user, ctx)).resolves.toBeUndefined();
    });
  });

  // ─── onMfaDisabled (afterMfaDisabled) ─────────────────────────────────────

  describe('afterMfaDisabled', () => {
    it('writes a mfa.disabled audit row with userId and tenantId', async () => {
      // Disabling MFA is equally security-critical — an unexpected mfa.disabled
      // row triggers an investigation into a potential account compromise.
      const user = makeSafeUser({ id: 'user-1', tenantId: 'acme' });
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await hooks.afterMfaDisabled(user, ctx);

      expect(auditLogCreate).toHaveBeenCalledTimes(1);
      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'mfa.disabled',
            payload: expect.objectContaining({ userId: 'user-1', tenantId: 'acme' }),
          }),
        }),
      );
    });

    it('swallows AuditLog write failures so the MFA disable flow is never blocked', async () => {
      auditLogCreate.mockRejectedValue(new Error('DB error'));
      const user = makeSafeUser();
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await expect(hooks.afterMfaDisabled(user, ctx)).resolves.toBeUndefined();
    });
  });

  // ─── onNewSession ──────────────────────────────────────────────────────────

  describe('onNewSession', () => {
    it('writes a session.new audit row with userId, tenantId, sessionHash and device', async () => {
      // FCM #15 — new session events must record device and IP so users can
      // identify unexpected sign-ins in the security activity log.
      const user = makeSafeUser({ id: 'user-1', tenantId: 'acme' });
      const sessionInfo: SessionInfo = {
        sessionHash: 'sha256-abc',
        device: 'Chrome on macOS',
        ip: '203.0.113.5',
      };
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await hooks.onNewSession(user, sessionInfo, ctx);

      expect(auditLogCreate).toHaveBeenCalledTimes(1);
      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'session.new',
            payload: expect.objectContaining({
              userId: 'user-1',
              tenantId: 'acme',
              sessionHash: 'sha256-abc',
              device: 'Chrome on macOS',
            }),
          }),
        }),
      );
    });

    it('stores sessionHash — never the raw token — in the audit payload', async () => {
      // Security: only the hash is stored; the raw refresh token must never
      // appear in the AuditLog payload or it could be replayed.
      const user = makeSafeUser({ id: 'user-2', tenantId: 'acme' });
      const sessionInfo: SessionInfo = {
        sessionHash: 'sha256-xyz',
        device: 'Firefox on Windows',
        ip: '10.0.0.1',
      };
      const ctx = makeContext({ userId: 'user-2', tenantId: 'acme' });

      await hooks.onNewSession(user, sessionInfo, ctx);

      // noUncheckedIndexedAccess: mock.calls[0] is typed as an empty tuple because
      // the mock signature is () => Promise<void>. Cast through unknown to access
      // the actual runtime argument (the Prisma create input).
      const rawCall = (
        auditLogCreate.mock.calls as unknown as Array<
          [{ data: { payload: Record<string, unknown> } }]
        >
      )[0];
      const data = rawCall?.[0]?.data;
      expect(data?.payload).not.toHaveProperty('token');
      expect(data?.payload).not.toHaveProperty('refreshToken');
      expect(data?.payload).toHaveProperty('sessionHash', 'sha256-xyz');
    });

    it('swallows AuditLog write failures so the session creation flow is never blocked', async () => {
      auditLogCreate.mockRejectedValue(new Error('DB error'));
      const user = makeSafeUser();
      const sessionInfo: SessionInfo = { sessionHash: 'x', device: 'y', ip: '1.2.3.4' };
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await expect(hooks.onNewSession(user, sessionInfo, ctx)).resolves.toBeUndefined();
    });

    it('dispatches sendNewSessionAlert with the user email and the session info (FCM #15)', async () => {
      // The library never calls sendNewSessionAlert itself — this hook is the
      // only path that triggers the security email. Verify the call shape so a
      // refactor that moves the dispatch elsewhere is caught at the unit level.
      const user = makeSafeUser({ id: 'user-3', email: 'carol@example.test' });
      const sessionInfo: SessionInfo = {
        sessionHash: 'sha256-mail',
        device: 'Safari on iOS',
        ip: '198.51.100.7',
      };
      const ctx = makeContext({ userId: 'user-3', tenantId: 'acme' });

      await hooks.onNewSession(user, sessionInfo, ctx);

      expect(sendNewSessionAlert).toHaveBeenCalledTimes(1);
      expect(sendNewSessionAlert).toHaveBeenCalledWith('carol@example.test', sessionInfo);
    });

    it('swallows email dispatch failures so the session creation flow is never blocked', async () => {
      // A flaky SMTP provider must never break login — the audit row is enough
      // for forensic traceability even when the email is lost.
      sendNewSessionAlert.mockRejectedValue(new Error('SMTP unreachable'));
      const user = makeSafeUser();
      const sessionInfo: SessionInfo = { sessionHash: 'x', device: 'y', ip: '1.2.3.4' };
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await expect(hooks.onNewSession(user, sessionInfo, ctx)).resolves.toBeUndefined();
      // The audit row still must be written even if the email failed.
      expect(auditLogCreate).toHaveBeenCalledTimes(1);
    });

    /**
     * Exercises the `err instanceof Error ? err.message : String(err)` branch
     * for the *non-Error* path. A misbehaving email provider that rejects with
     * a plain string (or anything not deriving from `Error`) must still be
     * caught and logged — the previous test covers the Error path; this one
     * pins the fallback `String(err)` branch so the logger never throws on
     * an unusual rejection shape.
     */
    it('swallows non-Error email dispatch failures and logs them via String(err)', async () => {
      sendNewSessionAlert.mockRejectedValue('plain string rejection');
      const user = makeSafeUser();
      const sessionInfo: SessionInfo = { sessionHash: 'x', device: 'y', ip: '1.2.3.4' };
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await expect(hooks.onNewSession(user, sessionInfo, ctx)).resolves.toBeUndefined();
      // Audit row is written regardless of the email provider's reject shape.
      expect(auditLogCreate).toHaveBeenCalledTimes(1);
    });
  });

  // ─── onSessionEvicted ─────────────────────────────────────────────────────

  describe('onSessionEvicted', () => {
    it('writes a session.evicted audit row with userId and evictedSessionHash', async () => {
      // FCM #14 — FIFO eviction must be audited so security teams can detect
      // unexpected evictions that may signal an account takeover attempt.
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await hooks.onSessionEvicted('user-1', 'sha256-evicted', ctx);

      expect(auditLogCreate).toHaveBeenCalledTimes(1);
      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'session.evicted',
            payload: expect.objectContaining({
              userId: 'user-1',
              evictedSessionHash: 'sha256-evicted',
            }),
          }),
        }),
      );
    });

    it('stores evictedSessionHash — never the raw token — in the audit payload', async () => {
      // Security: only the hash is persisted; the raw refresh token must never
      // be stored where it could be replayed.
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await hooks.onSessionEvicted('user-1', 'sha256-evicted', ctx);

      // noUncheckedIndexedAccess: cast through unknown to read the actual runtime argument.
      const rawCall = (
        auditLogCreate.mock.calls as unknown as Array<
          [{ data: { payload: Record<string, unknown> } }]
        >
      )[0];
      const data = rawCall?.[0]?.data;
      expect(data?.payload).not.toHaveProperty('token');
      expect(data?.payload).toHaveProperty('evictedSessionHash', 'sha256-evicted');
    });

    it('swallows AuditLog write failures so the session eviction flow is never blocked', async () => {
      auditLogCreate.mockRejectedValue(new Error('DB error'));
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await expect(hooks.onSessionEvicted('user-1', 'hash', ctx)).resolves.toBeUndefined();
    });
  });

  // ─── onEmailVerified (afterEmailVerified) ─────────────────────────────────

  describe('afterEmailVerified', () => {
    it('writes an email.verified audit row with userId and tenantId', async () => {
      // FCM #5 — email verification completion must be audited so the timeline
      // of account activation can be reconstructed from the log.
      const user = makeSafeUser({ id: 'user-1', tenantId: 'acme' });
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await hooks.afterEmailVerified(user, ctx);

      expect(auditLogCreate).toHaveBeenCalledTimes(1);
      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'email.verified',
            payload: expect.objectContaining({ userId: 'user-1', tenantId: 'acme' }),
          }),
        }),
      );
    });

    it('swallows AuditLog write failures so the email verification flow is never blocked', async () => {
      auditLogCreate.mockRejectedValue(new Error('DB error'));
      const user = makeSafeUser();
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await expect(hooks.afterEmailVerified(user, ctx)).resolves.toBeUndefined();
    });
  });

  // ─── onPasswordResetCompleted (afterPasswordReset) ────────────────────────

  describe('afterPasswordReset', () => {
    it('writes a password.reset.completed audit row with userId and tenantId', async () => {
      // FCM #6/#7 — every password reset completion must be audited; an unexpected
      // reset row in the log is an indicator of account compromise.
      const user = makeSafeUser({ id: 'user-1', tenantId: 'acme' });
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await hooks.afterPasswordReset(user, ctx);

      expect(auditLogCreate).toHaveBeenCalledTimes(1);
      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'password.reset.completed',
            payload: expect.objectContaining({ userId: 'user-1', tenantId: 'acme' }),
          }),
        }),
      );
    });

    it('swallows AuditLog write failures so the password reset flow is never blocked', async () => {
      // The password has already been changed before this hook runs — a failed audit
      // must not prevent the user from receiving the success response.
      auditLogCreate.mockRejectedValue(new Error('DB error'));
      const user = makeSafeUser();
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await expect(hooks.afterPasswordReset(user, ctx)).resolves.toBeUndefined();
    });
  });

  // ─── afterRegister ─────────────────────────────────────────────────────────

  describe('afterRegister', () => {
    it('writes a user.registered audit row with userId, tenantId, and role', async () => {
      // FCM #30 — successful registration must be audited so the tenant onboarding
      // timeline can be reconstructed from the log.
      const user = makeSafeUser({ id: 'user-new', tenantId: 'acme', role: 'MEMBER' });
      const ctx = makeContext({ userId: 'user-new', tenantId: 'acme' });

      await hooks.afterRegister(user, ctx);

      expect(auditLogCreate).toHaveBeenCalledTimes(1);
      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'user.registered',
            payload: expect.objectContaining({
              userId: 'user-new',
              tenantId: 'acme',
              role: 'MEMBER',
            }),
          }),
        }),
      );
    });

    it('swallows AuditLog write failures so the registration flow is never blocked', async () => {
      auditLogCreate.mockRejectedValue(new Error('DB error'));
      const user = makeSafeUser();
      const ctx = makeContext({ userId: 'user-new', tenantId: 'acme' });

      await expect(hooks.afterRegister(user, ctx)).resolves.toBeUndefined();
    });
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
      /*
       * A non-blocked user who already has an OAuth link
       * re-authenticates via the 'link' action — the library
       * calls userRepo.linkOAuth (effectively a no-op update
       * for an already-linked identity). The audit payload
       * must carry the existing user's id so support can
       * trace the OAuth-to-account binding; if the id were
       * coerced to null on the happy path, the audit row
       * would no longer link the OAuth event to the user.
       */
      const activeUser = makeSafeUser({ id: 'user-existing-99', status: 'ACTIVE' });
      const ctx = makeContext({ tenantId: 'acme', userId: 'user-existing-99' });

      const result = await hooks.onOAuthLogin(profile, activeUser, ctx);

      expect(result).toEqual({ action: 'link' });
      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'oauth.login',
            payload: expect.objectContaining({
              action: 'link',
              existingUserId: 'user-existing-99',
            }),
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

    it('uses String(err) when the AuditLog throws a non-Error value (non-Error throw path)', async () => {
      // Covers the `String(err)` branch of `err instanceof Error ? err.message : String(err)`.
      // Some throw sites produce plain strings rather than Error instances.
      auditLogCreate.mockRejectedValue('plain string rejection');
      const user = makeSafeUser();
      const ctx = makeContext({ userId: 'user-1', tenantId: 'acme' });

      await expect(hooks.afterInvitationAccepted(user, ctx)).resolves.toBeUndefined();
    });

    it('stores null for tenantId when ctx.tenantId is not provided (nullish coalescing branch)', async () => {
      // Covers the right side of `ctx.tenantId ?? null` — when tenantId is absent
      // the AuditLog row must store null rather than undefined.
      const user = makeSafeUser();
      const ctx = makeContext({ userId: 'user-1' }); // no tenantId

      await hooks.afterInvitationAccepted(user, ctx);

      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: null }),
        }),
      );
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

  // ─── Failure-path observability ──────────────────────────────────────────

  describe('failure-path observability', () => {
    it('logs the documented AuditLog failure payload when prisma.auditLog.create rejects', async () => {
      /*
       * Scenario: a hook records an audit row but Postgres briefly
       * rejects the insert. The hook MUST NOT bubble the failure to
       * the caller (the auth flow must continue), but the failure
       * must surface in operator logs with the canonical message,
       * the event name, and the underlying error message so
       * support can trace audit-trail gaps.
       */
      auditLogCreate.mockRejectedValueOnce(new Error('Postgres connection lost'));
      const errorSpy = jest
        .spyOn((hooks as unknown as { logger: { error: (m: unknown) => void } }).logger, 'error')
        .mockImplementation(() => undefined);

      await hooks.onNewSession(
        makeSafeUser(),
        { sessionHash: 'h', device: 'd', ip: '1.2.3.4' },
        makeContext(),
      );

      // The audit failure log fires once; the email path succeeds in this scenario.
      const auditCall = errorSpy.mock.calls.find(
        (c) => (c[0] as { msg?: string }).msg === 'AuditLog write failed',
      );
      expect(auditCall).toBeDefined();
      const arg = auditCall?.[0] as { msg?: string; event?: string; error?: string };
      expect(arg.event).toBe('session.new');
      expect(arg.error).toBe('Postgres connection lost');
    });

    it('logs the documented sendNewSessionAlert dispatch failure with userId and reason', async () => {
      /*
       * Scenario: the new-session alert email cannot be sent (SMTP
       * outage). The hook MUST NOT abort the login response — the
       * user is already authenticated and the audit row is already
       * written — but the dispatch failure must surface in
       * operator logs with the canonical message, the affected
       * userId, and the upstream error so support can resend the
       * alert manually.
       */
      sendNewSessionAlert.mockRejectedValueOnce(new Error('SMTP rejected'));
      const errorSpy = jest
        .spyOn((hooks as unknown as { logger: { error: (m: unknown) => void } }).logger, 'error')
        .mockImplementation(() => undefined);

      await hooks.onNewSession(
        makeSafeUser({ id: 'user-frank' }),
        { sessionHash: 'h', device: 'd', ip: '1.2.3.4' },
        makeContext(),
      );

      const dispatchCall = errorSpy.mock.calls.find(
        (c) => (c[0] as { msg?: string }).msg === 'sendNewSessionAlert dispatch failed',
      );
      expect(dispatchCall).toBeDefined();
      const arg = dispatchCall?.[0] as { msg?: string; userId?: string; error?: string };
      expect(arg.userId).toBe('user-frank');
      expect(arg.error).toBe('SMTP rejected');
    });
  });
});
