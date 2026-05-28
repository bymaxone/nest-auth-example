/**
 * @file noop-fallbacks.spec.ts
 * @description Contract tests for `NoOpAuthHooks` and `NoOpEmailProvider`.
 *
 * Both classes are registered automatically by `BymaxAuthModule` when the
 * consumer does not supply custom implementations. These tests verify their
 * no-op contracts so that any breaking change to the library's fallback
 * behaviour surfaces as a test failure in this reference application.
 *
 * `NoOpAuthHooks` — permits all registrations; resolves OAuth logins by
 * linking to an existing user (if found) or creating a new account.
 * `NoOpEmailProvider` — resolves all delivery methods without doing anything.
 *
 * @see docs/DEVELOPMENT_PLAN.md §Appendix B — Library Export → Example File Map
 * @layer test
 */

import { NoOpAuthHooks, NoOpEmailProvider } from '@bymax-one/nest-auth';
import type {
  IEmailProvider,
  HookContext,
  OAuthProfile,
  SafeAuthUser,
  InviteData,
  SessionInfo,
} from '@bymax-one/nest-auth';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal `HookContext` satisfying every required field. */
const CTX: HookContext = {
  ip: '127.0.0.1',
  userAgent: 'jest/test',
  sanitizedHeaders: {},
};

/** Minimal OAuth profile with all required fields. */
const OAUTH_PROFILE: OAuthProfile = {
  provider: 'google',
  providerId: 'google-uid-001',
  email: 'alice@example.test',
};

/** Minimal `SafeAuthUser` representing an already-existing account. */
const EXISTING_USER: SafeAuthUser = {
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
};

/** Minimal `InviteData` for the `sendInvitation` contract test. */
const INVITE_DATA: InviteData = {
  inviterName: 'Admin',
  tenantName: 'Acme Corp',
  inviteToken: 'abc123deadbeef',
  expiresAt: new Date('2099-01-01T00:00:00Z'),
};

/** Minimal `SessionInfo` for the `sendNewSessionAlert` contract test. */
const SESSION_INFO: SessionInfo = {
  device: 'Chrome on macOS',
  ip: '1.2.3.4',
  sessionHash: 'a1b2c3d4',
};

// ── NoOpAuthHooks ─────────────────────────────────────────────────────────────

describe('NoOpAuthHooks', () => {
  // Type as the concrete class so optional interface methods resolve to
  // their concrete implementations on NoOpAuthHooks.
  let hooks: NoOpAuthHooks;

  beforeEach(() => {
    hooks = new NoOpAuthHooks();
  });

  describe('beforeRegister', () => {
    it('always allows registration', async () => {
      /**
       * Scenario: NoOpAuthHooks is the fallback when the consumer provides no custom
       * hooks. Every registration attempt must be permitted so the library can
       * function without wiring up hooks.
       * Rule: `beforeRegister` returns or resolves to `{ allowed: true }`.
       */
      const result = await Promise.resolve(
        hooks.beforeRegister(
          { email: 'new@example.test', name: 'New User', tenantId: 'acme' },
          CTX,
        ),
      );
      expect(result.allowed).toBe(true);
    });
  });

  describe('onOAuthLogin', () => {
    it('returns a defined strategy when an existing user is found', () => {
      /**
       * Scenario: if an account with the OAuth email already exists, the no-op hook
       * signals that the OAuth identity should be linked to the existing account.
       * Rule: `onOAuthLogin` with a non-null existingUser returns a defined result.
       */
      const result = hooks.onOAuthLogin(OAUTH_PROFILE, EXISTING_USER, CTX);
      expect(result).toBeDefined();
      expect(['link', 'create', 'reject']).toContain(result.action);
    });

    it('returns a defined strategy when no existing user is found', () => {
      /**
       * Scenario: if no account matches the OAuth email, the no-op hook signals
       * that a new account should be created for the OAuth identity.
       * Rule: `onOAuthLogin` with `existingUser === null` returns a defined result.
       */
      const result = hooks.onOAuthLogin(OAUTH_PROFILE, null, CTX);
      expect(result).toBeDefined();
      expect(['link', 'create', 'reject']).toContain(result.action);
    });
  });
});

// ── NoOpEmailProvider ─────────────────────────────────────────────────────────

describe('NoOpEmailProvider', () => {
  let provider: IEmailProvider;

  beforeEach(() => {
    provider = new NoOpEmailProvider();
  });

  it('sendPasswordResetToken resolves without sending an email', async () => {
    /**
     * Scenario: the no-op provider is registered when email delivery is not required
     * (local development, CI). The method must resolve so the auth flow completes.
     * Rule: `sendPasswordResetToken` returns a resolved Promise<void>.
     */
    await expect(
      provider.sendPasswordResetToken('alice@example.test', 'token-abc'),
    ).resolves.toBeUndefined();
  });

  it('sendPasswordResetOtp resolves without sending an email', async () => {
    /**
     * Scenario: OTP-based password reset must not fail when no email transport
     * is configured — the user would see the OTP in the server logs instead.
     * Rule: `sendPasswordResetOtp` returns a resolved Promise<void>.
     */
    await expect(
      provider.sendPasswordResetOtp('alice@example.test', '123456'),
    ).resolves.toBeUndefined();
  });

  it('sendEmailVerificationOtp resolves without sending an email', async () => {
    /**
     * Scenario: email verification OTP must succeed without transport so the
     * registration flow can complete in dev/CI environments.
     * Rule: `sendEmailVerificationOtp` returns a resolved Promise<void>.
     */
    await expect(
      provider.sendEmailVerificationOtp('alice@example.test', '654321'),
    ).resolves.toBeUndefined();
  });

  it('sendMfaEnabledNotification resolves without sending an email', async () => {
    /**
     * Scenario: informational MFA-enabled notification must not block the flow
     * when no email transport is wired.
     * Rule: `sendMfaEnabledNotification` returns a resolved Promise<void>.
     */
    await expect(
      provider.sendMfaEnabledNotification('alice@example.test'),
    ).resolves.toBeUndefined();
  });

  it('sendMfaDisabledNotification resolves without sending an email', async () => {
    /**
     * Scenario: informational MFA-disabled notification must not block the flow.
     * Rule: `sendMfaDisabledNotification` returns a resolved Promise<void>.
     */
    await expect(
      provider.sendMfaDisabledNotification('alice@example.test'),
    ).resolves.toBeUndefined();
  });

  it('sendNewSessionAlert resolves without sending an email', async () => {
    /**
     * Scenario: new-session alerts are informational; they must not block login.
     * Rule: `sendNewSessionAlert` returns a resolved Promise<void>.
     */
    await expect(
      provider.sendNewSessionAlert('alice@example.test', SESSION_INFO),
    ).resolves.toBeUndefined();
  });

  it('sendInvitation resolves without sending an email', async () => {
    /**
     * Scenario: invitation delivery is a background concern; a missing transport
     * must not abort the invitation-creation flow.
     * Rule: `sendInvitation` returns a resolved Promise<void>.
     */
    await expect(provider.sendInvitation('bob@example.test', INVITE_DATA)).resolves.toBeUndefined();
  });
});
