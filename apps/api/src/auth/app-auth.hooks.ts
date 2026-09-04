/**
 * @file app-auth.hooks.ts
 * @description `IAuthHooks` implementation that persists every auth lifecycle event
 * to the `AuditLog` table for forensic traceability.
 *
 * Design constraints:
 * - Non-blocking: every `AuditLog` insert is wrapped in try/catch so a database
 *   failure never propagates into the auth flow. A missing audit row is preferable
 *   to a failed login.
 * - Secret-free payloads: `passwordHash`, `token`, OTP codes, `mfaSecret`, and
 *   `mfaRecoveryCodes` are never stored in `payload` or logged.
 * - `beforeRegister` always returns `{ allowed: true }` in this reference app but
 *   is wired and exercised by the test suite so consumers see the hook path.
 * - `onOAuthLogin` receives the user matched by OAuth provider id (or null) and
 *   answers `'link'` for an already-linked identity, `'create'` otherwise. Under
 *   lib v1.4.x there is NO silent email-based auto-linking: a first OAuth
 *   sign-in against an email that already has a password account is refused by
 *   the library with `auth.oauth_email_mismatch`.
 *
 * Event slug catalogue (append new slugs here when adding hooks):
 *   user.register.attempted | user.registered | user.login.attempted |
 *   user.login.succeeded | user.login.failed | user.lockout |
 *   user.logout |
 *   mfa.enabled | mfa.disabled | mfa.recovery_codes.regenerated |
 *   session.new | session.evicted | session.reuse_detected |
 *   email.verified |
 *   password.reset.completed |
 *   oauth.login |
 *   invitation.accepted
 *
 * @layer auth
 * @see docs/guidelines/observability-guidelines.md
 * @see docs/guidelines/nest-auth-guidelines.md
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BYMAX_AUTH_EMAIL_PROVIDER,
  type BeforeRegisterResult,
  type HookContext,
  type IAuthHooks,
  type IEmailProvider,
  type OAuthLoginResult,
  type OAuthProfile,
  type SafeAuthUser,
  type SessionAlertInfo,
  sha256,
} from '@bymax-one/nest-auth';
import { UserStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import { isBlockedStatus } from './auth.constants.js';

/**
 * Auth lifecycle hooks that write immutable `AuditLog` rows for every event.
 *
 * Injected via `BYMAX_AUTH_HOOKS` token in `AuthModule`. The hooks
 * class also dispatches the new-session security email — the library does not
 * call `IEmailProvider.sendNewSessionAlert` automatically; consumers wire it
 * inside their own `onNewSession` hook.
 *
 * @public
 */
@Injectable()
export class AppAuthHooks implements IAuthHooks {
  private readonly logger = new Logger(AppAuthHooks.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BYMAX_AUTH_EMAIL_PROVIDER)
    private readonly emailProvider: IEmailProvider,
  ) {}

  /**
   * Inserts one `AuditLog` row for the given event.
   *
   * Wrapped in try/catch — a write failure is logged and swallowed so auth
   * flows are never blocked by audit infrastructure.
   *
   * @param event - Event slug (e.g. 'user.login.succeeded').
   * @param ctx - Request context (IP, user agent, tenant, actor IDs).
   * @param payload - Non-secret event payload (never include tokens, hashes, or OTPs).
   */
  private async record(
    event: string,
    ctx: HookContext,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId ?? null,
          actorUserId: ctx.userId ?? null,
          // HookContext does not expose a platform user ID — actorPlatformUserId
          // is always null for hook-originated rows. Platform actor attribution
          // requires a library change to surface platform identity via HookContext.
          actorPlatformUserId: null,
          event,
          payload: payload as Prisma.InputJsonValue,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
      });
    } catch (err: unknown) {
      // Never let audit failures surface to callers — log and continue.
      this.logger.error({
        msg: 'AuditLog write failed',
        event,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Called before a new user account is persisted.
   *
   * Always allows registration in this reference app. Override `modifiedData`
   * here to enforce domain allowlists or assign non-default roles at signup.
   *
   * @param data - Registration payload (email, name, tenantId).
   * @param context - Request metadata.
   * @returns `{ allowed: true }` unconditionally.
   */
  async beforeRegister(
    data: { email: string; name: string; tenantId: string },
    context: HookContext,
  ): Promise<BeforeRegisterResult> {
    await this.record('user.register.attempted', context, {
      tenantId: data.tenantId,
    });
    return { allowed: true };
  }

  /**
   * Called after a new user account is created successfully.
   *
   * @param user - The newly registered user (credentials omitted).
   * @param context - Request metadata.
   */
  async afterRegister(user: SafeAuthUser, context: HookContext): Promise<void> {
    await this.record('user.registered', context, {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });
  }

  /**
   * Called before credentials are validated during a login attempt.
   *
   * Throwing here aborts the login — use it for IP allowlists or maintenance gates.
   * This reference app does not block any login at the hook level.
   *
   * @param email - Submitted email address.
   * @param tenantId - Tenant context.
   * @param context - Request metadata.
   */
  async beforeLogin(email: string, tenantId: string, context: HookContext): Promise<void> {
    await this.record('user.login.attempted', context, { tenantId, email });
  }

  /**
   * Called after a successful login and token issuance.
   *
   * @param user - The authenticated user (credentials omitted).
   * @param context - Request metadata.
   */
  async afterLogin(user: SafeAuthUser, context: HookContext): Promise<void> {
    await this.record('user.login.succeeded', context, {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });
  }

  /**
   * Called after the user's session has been invalidated (logout).
   *
   * @param userId - Internal user ID.
   * @param context - Request metadata.
   */
  async afterLogout(userId: string, context: HookContext): Promise<void> {
    await this.record('user.logout', context, { userId });
  }

  /**
   * Called when a login attempt is refused (lib v1.1.0+).
   *
   * The `reason` discriminates why: bad credentials, blocked status, unverified
   * email, or an active lockout window. Feeds SIEM-style alerting — a burst of
   * `invalid_credentials` rows for one email is a credential-stuffing signal.
   *
   * @param details - Email, tenant, optional userId, and the refusal reason.
   * @param context - Request metadata.
   */
  async onLoginFailed(
    details: {
      email: string;
      tenantId: string;
      userId?: string;
      reason: 'invalid_credentials' | 'account_blocked' | 'email_not_verified' | 'locked_out';
    },
    context: HookContext,
  ): Promise<void> {
    // A failed login carries whatever address was submitted, which for
    // credential-stuffing traffic is an arbitrary third party's — often with no
    // account here at all. Storing the digest keeps the row correlatable across
    // attempts without accumulating other people's addresses in a long-retained
    // table (observability-guidelines.md § metadata: "pin to IDs, enums, and
    // hashes (email_sha256)").
    await this.record('user.login.failed', context, {
      emailSha256: sha256(details.email),
      tenantId: details.tenantId,
      userId: details.userId ?? null,
      reason: details.reason,
    });
  }

  /**
   * Called when brute-force protection locks an account (lib v1.1.0+).
   *
   * Fires once per lockout, not once per refused attempt — the row marks when
   * the threshold was crossed. `AuthService.unlockAccount` (exposed via the
   * debug controller in this example) clears the window early.
   *
   * @param details - Email, tenant, and seconds until the window expires.
   * @param context - Request metadata.
   */
  async onLockout(
    details: { email: string; tenantId: string; retryAfterSeconds: number },
    context: HookContext,
  ): Promise<void> {
    // Same reasoning as `onLoginFailed`: a lockout is reached through failed
    // attempts, so the address is equally untrusted.
    await this.record('user.lockout', context, {
      emailSha256: sha256(details.email),
      tenantId: details.tenantId,
      retryAfterSeconds: details.retryAfterSeconds,
    });
  }

  /**
   * Called when refresh-token reuse is detected (lib v1.1.0+).
   *
   * A previously rotated-out refresh token was replayed — either a stolen token
   * or a badly-behaved client. The library has already revoked the whole token
   * lineage (`familyId`); this hook records the incident for forensics.
   *
   * @param details - The affected user and the revoked token family.
   * @param context - Request metadata (carries the replayer's real IP/user-agent
   *   since lib v1.4.4).
   */
  async onRefreshTokenReuseDetected(
    details: { userId: string; familyId: string },
    context: HookContext,
  ): Promise<void> {
    await this.record('session.reuse_detected', context, {
      userId: details.userId,
      familyId: details.familyId,
    });
  }

  /**
   * Called after TOTP MFA has been enabled on a user account.
   *
   * @param user - The user who enabled MFA (credentials omitted).
   * @param context - Request metadata.
   */
  async afterMfaEnabled(user: SafeAuthUser, context: HookContext): Promise<void> {
    await this.record('mfa.enabled', context, {
      userId: user.id,
      tenantId: user.tenantId,
    });
  }

  /**
   * Called after TOTP MFA has been disabled on a user account.
   *
   * @param user - The user who disabled MFA (credentials omitted).
   * @param context - Request metadata.
   */
  async afterMfaDisabled(user: SafeAuthUser, context: HookContext): Promise<void> {
    await this.record('mfa.disabled', context, {
      userId: user.id,
      tenantId: user.tenantId,
    });
  }

  /**
   * Called after the user's MFA recovery codes have been regenerated (lib v1.4.x).
   *
   * The old code set is now invalid; the audit row lets security teams correlate
   * a regeneration with a support ticket or a suspected compromise.
   *
   * @param user - The user whose codes were regenerated (credentials omitted).
   * @param context - Request metadata.
   */
  async afterMfaRecoveryCodesRegenerated(user: SafeAuthUser, context: HookContext): Promise<void> {
    await this.record('mfa.recovery_codes.regenerated', context, {
      userId: user.id,
      tenantId: user.tenantId,
    });
  }

  /**
   * Called when a new session is detected from an unrecognised device or location.
   *
   * Persists the session hash (never the raw token) for incident forensics.
   *
   * Arrow function — the library destructures this method from the hooks object
   * (`const { onNewSession } = this.hooks`) which loses the prototype `this`
   * binding. Using an arrow function ensures `this` is always the class instance.
   *
   * @param user - The authenticated user (credentials omitted).
   * @param sessionInfo - Device, IP, and session hash for the new session.
   * @param context - Request metadata.
   */
  onNewSession = async (
    user: SafeAuthUser,
    sessionInfo: SessionAlertInfo,
    context: HookContext,
  ): Promise<void> => {
    await this.record('session.new', context, {
      userId: user.id,
      tenantId: user.tenantId,
      // Store the hash only — never the raw session token.
      sessionHash: sessionInfo.sessionHash,
      device: sessionInfo.device,
    });

    // Dispatch the new-session security email. The library never
    // calls `sendNewSessionAlert` itself — consumers are responsible for the
    // dispatch, typically from this hook. The method is optional on
    // `IEmailProvider` (lib v1.2.0+), hence the `?.` call. Wrap in try/catch
    // so an email failure never blocks the login response.
    try {
      await this.emailProvider.sendNewSessionAlert?.(user.tenantId, user.email, sessionInfo);
    } catch (err: unknown) {
      this.logger.error({
        msg: 'sendNewSessionAlert dispatch failed',
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  /**
   * Called after the user's email address has been verified.
   *
   * @param user - The user whose email was verified (credentials omitted).
   * @param context - Request metadata.
   */
  async afterEmailVerified(user: SafeAuthUser, context: HookContext): Promise<void> {
    await this.record('email.verified', context, {
      userId: user.id,
      tenantId: user.tenantId,
    });

    // Self-registered accounts are created PENDING. Verifying the address is
    // the step that clears that, so promote here — otherwise a verified user
    // stays PENDING forever, and the team roster shows them next to an
    // "Activate" control that nothing in the product ever needs pressed.
    // `updateMany` keeps the write tenant-scoped and makes it idempotent: a
    // user who is already ACTIVE, or was suspended between the two events,
    // matches nothing and is left alone.
    await this.prisma.user.updateMany({
      where: { id: user.id, tenantId: user.tenantId, status: UserStatus.PENDING },
      data: { status: UserStatus.ACTIVE },
    });
  }

  /**
   * Called after a successful password reset.
   *
   * @param user - The user who reset their password (credentials omitted).
   * @param context - Request metadata.
   */
  async afterPasswordReset(user: SafeAuthUser, context: HookContext): Promise<void> {
    await this.record('password.reset.completed', context, {
      userId: user.id,
      tenantId: user.tenantId,
    });
  }

  /**
   * Called when a user authenticates via OAuth and a profile has been retrieved.
   *
   * Strategy:
   * - `existingUser` non-null (user found by OAuth ID) → `'link'`: re-authenticates
   *   an already-linked identity via `userRepo.linkOAuth` (effectively a no-op update).
   * - `existingUser` null (OAuth ID not yet in the database) → `'create'`: delegates
   *   to `PrismaUserRepository.createWithOAuth`, which inserts. The library has
   *   already refused the address if it belongs to an account, and the unique
   *   constraint on `(tenantId, email)` refuses it again if a registration wins
   *   the race — surfacing as `auth.oauth_email_mismatch` either way. Nothing
   *   attaches an OAuth identity to an account this flow did not create.
   *
   * @param profile - Normalised OAuth profile from the provider.
   * @param existingUser - Existing user found by OAuth provider ID, or null.
   * @param context - Request metadata.
   * @returns The resolved account strategy.
   */
  async onOAuthLogin(
    profile: OAuthProfile,
    existingUser: SafeAuthUser | null,
    context: HookContext,
  ): Promise<OAuthLoginResult> {
    // Statuses that must never receive tokens, mirroring auth.config.ts blockedStatuses.
    // The library's OAuthService does not enforce this guard — we must enforce it here
    // for already-linked accounts (existingUser found by OAuth provider ID).
    // For first-time OAuth sign-ins (existingUser null), the guard lives in
    // PrismaUserRepository.createWithOAuth which has tenantId in scope.
    if (existingUser !== null && isBlockedStatus(existingUser.status)) {
      await this.record('oauth.login', context, {
        provider: profile.provider,
        action: 'reject',
        existingUserId: existingUser.id,
        reason: 'blocked_status',
      });
      return { action: 'reject' };
    }

    const action = existingUser ? 'link' : 'create';
    await this.record('oauth.login', context, {
      provider: profile.provider,
      action,
      existingUserId: existingUser?.id ?? null,
    });
    return { action };
  }

  /**
   * Called after an invited user has accepted their invitation.
   *
   * @param user - The user who accepted the invitation (credentials omitted).
   * @param context - Request metadata.
   */
  async afterInvitationAccepted(user: SafeAuthUser, context: HookContext): Promise<void> {
    await this.record('invitation.accepted', context, {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });
  }

  /**
   * Called when the session manager evicts a session to make room for a new one
   * (FIFO eviction strategy).
   *
   * Persists the evicted session hash (never the raw token) so security teams
   * can detect unexpected evictions that may signal an account takeover attempt.
   *
   * @param userId - The internal ID of the user whose session was evicted.
   * @param evictedSessionHash - SHA-256 hash of the evicted refresh token.
   * @param context - Request metadata.
   */
  async onSessionEvicted(
    userId: string,
    evictedSessionHash: string,
    context: HookContext,
  ): Promise<void> {
    await this.record('session.evicted', context, {
      userId,
      // Store the hash only — never the raw refresh token.
      evictedSessionHash,
    });
  }
}
