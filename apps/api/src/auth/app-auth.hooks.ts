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
 * - `onOAuthLogin` defaults to `'create'` for unknown profiles and `'link'` for
 *   profiles whose email already exists — the standard account-linking flow.
 *
 * Event slug catalogue (append new slugs here when adding hooks):
 *   user.register.attempted | user.registered | user.login.attempted |
 *   user.login.succeeded | user.logout |
 *   mfa.enabled | mfa.disabled |
 *   session.new | session.evicted |
 *   email.verified |
 *   password.reset.completed |
 *   oauth.login |
 *   invitation.accepted
 *
 * Covers FCM row #30 (audit / lifecycle hooks).
 *
 * @layer auth
 * @see docs/guidelines/observability-guidelines.md
 * @see docs/guidelines/nest-auth-guidelines.md
 */

import { Injectable, Logger } from '@nestjs/common';
import type {
  BeforeRegisterResult,
  HookContext,
  IAuthHooks,
  OAuthLoginResult,
  OAuthProfile,
  SafeAuthUser,
  SessionInfo,
} from '@bymax-one/nest-auth';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Auth lifecycle hooks that write immutable `AuditLog` rows for every event.
 *
 * Injected via `BYMAX_AUTH_HOOKS` token in Phase 7's `AuthModule`.
 * The only dependency is `PrismaService` — never inject other services here.
 *
 * @public
 */
@Injectable()
export class AppAuthHooks implements IAuthHooks {
  private readonly logger = new Logger(AppAuthHooks.name);

  constructor(private readonly prisma: PrismaService) {}

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
   * Called when a new session is detected from an unrecognised device or location.
   *
   * Persists the session hash (never the raw token) for incident forensics.
   *
   * @param user - The authenticated user (credentials omitted).
   * @param sessionInfo - Device, IP, and session hash for the new session.
   * @param context - Request metadata.
   */
  async onNewSession(
    user: SafeAuthUser,
    sessionInfo: SessionInfo,
    context: HookContext,
  ): Promise<void> {
    await this.record('session.new', context, {
      userId: user.id,
      tenantId: user.tenantId,
      // Store the hash only — never the raw session token.
      sessionHash: sessionInfo.sessionHash,
      device: sessionInfo.device,
    });
  }

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
   * - If an existing user is found by email → `'link'` (account linking flow).
   * - Otherwise → `'create'` (provision a new account from the OAuth profile).
   *
   * @param profile - Normalised OAuth profile from the provider.
   * @param existingUser - Existing user by email, or null.
   * @param context - Request metadata.
   * @returns The resolved account strategy.
   */
  async onOAuthLogin(
    profile: OAuthProfile,
    existingUser: SafeAuthUser | null,
    context: HookContext,
  ): Promise<OAuthLoginResult> {
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
