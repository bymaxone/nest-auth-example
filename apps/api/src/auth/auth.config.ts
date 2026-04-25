/**
 * @file auth.config.ts
 * @description Factory that builds `BymaxAuthModuleOptions` from the Zod-validated
 * environment, consumed by `BymaxAuthModule.registerAsync` in Phase 7.
 *
 * Keeps configuration concerns separate from module wiring: this file answers
 * "what are the options?" while `auth.module.ts` answers "how is the module wired?".
 *
 * Security contract:
 * - Never logs secrets (JWT_SECRET, MFA_ENCRYPTION_KEY, OAuth client secrets).
 * - `tenantIdResolver` uses no `as` casts — throws on absent or empty header.
 * - `cookies.resolveDomains` is only set in production when PUBLIC_DOMAIN is defined.
 * - `oauth.google` block is only included when all three OAuth env vars are set.
 *
 * @layer auth
 * @see docs/guidelines/nest-auth-guidelines.md
 * @see docs/DEVELOPMENT_PLAN.md §Phase 6.1
 */

import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import type { BymaxAuthModuleOptions } from '@bymax-one/nest-auth';

import type { Env } from '../config/env.schema.js';
import { BLOCKED_USER_STATUSES } from './auth.constants.js';

/**
 * Builds the `BymaxAuthModuleOptions` object for `BymaxAuthModule.registerAsync`.
 *
 * Every option group directly maps to the development plan §6.1 spec. The function
 * is pure — no side effects, no logging, no secret values emitted anywhere.
 *
 * FCM rows covered: #3 (refresh grace), #5 (email verification), #13 (sessions),
 * #14 (FIFO eviction), #16 (brute-force), #18/#19 (RBAC), #20 (tenant resolver),
 * #23 (blocked statuses).
 *
 * @param config - Zod-validated `ConfigService<Env, true>`. Every required variable
 *   is guaranteed present because the app refuses to start on an invalid config.
 * @returns Fully-typed options object ready for `BymaxAuthModule.registerAsync`.
 */
export function buildAuthOptions(config: ConfigService<Env, true>): BymaxAuthModuleOptions {
  const jwtSecret = config.getOrThrow<string>('JWT_SECRET');
  const mfaEncryptionKey = config.getOrThrow<string>('MFA_ENCRYPTION_KEY');
  const passwordResetMethod = config.getOrThrow<'token' | 'otp'>('PASSWORD_RESET_METHOD');
  const nodeEnv = config.getOrThrow<string>('NODE_ENV');
  const isProduction = nodeEnv === 'production';

  // Optional OAuth vars — all three must be present to enable Google OAuth.
  const oauthClientId = config.get<string>('OAUTH_GOOGLE_CLIENT_ID');
  const oauthClientSecret = config.get<string>('OAUTH_GOOGLE_CLIENT_SECRET');
  const oauthCallbackUrl = config.get<string>('OAUTH_GOOGLE_CALLBACK_URL');

  // Optional cookie domain for multi-domain production deployments.
  const publicDomain = config.get<string>('PUBLIC_DOMAIN');

  // OAuth config is only included when all three required vars are set.
  // The Zod schema enforces mutual presence; the runtime check satisfies TS narrowing.
  const googleOauth =
    oauthClientId && oauthClientSecret && oauthCallbackUrl
      ? {
          clientId: oauthClientId,
          clientSecret: oauthClientSecret,
          callbackUrl: oauthCallbackUrl,
        }
      : undefined;

  // Cookie domain resolver — only active in production when PUBLIC_DOMAIN is set.
  // The leading dot makes the cookie valid for all sub-domains of the apex domain.
  const resolveDomains =
    isProduction && publicDomain
      ? (_requestDomain: string): string[] => [`.${publicDomain}`]
      : undefined;

  const options: BymaxAuthModuleOptions = {
    // ── JWT ──────────────────────────────────────────────────────────────────
    jwt: {
      secret: jwtSecret,
      accessExpiresIn: '15m',
      refreshExpiresInDays: 7,
      // Prevents race conditions when multiple concurrent requests arrive during
      // the token rotation window — the old token stays valid for 30 s.
      refreshGraceWindowSeconds: 30,
    },

    // ── MFA (TOTP) ───────────────────────────────────────────────────────────
    mfa: {
      encryptionKey: mfaEncryptionKey,
      issuer: 'nest-auth-example',
      recoveryCodeCount: 8,
    },

    // ── Sessions (Redis-backed, FIFO eviction) ────────────────────────────────
    sessions: {
      enabled: true,
      defaultMaxSessions: 5,
      evictionStrategy: 'fifo',
    },

    // ── Brute-force protection ────────────────────────────────────────────────
    bruteForce: {
      maxAttempts: 5,
      windowSeconds: 15 * 60, // 15-minute sliding window
    },

    // ── Password reset ────────────────────────────────────────────────────────
    passwordReset: {
      method: passwordResetMethod,
      tokenTtlSeconds: 10 * 60, // 10 minutes
      otpTtlSeconds: 10 * 60, // 10 minutes
      otpLength: 6,
    },

    // ── Email verification ────────────────────────────────────────────────────
    emailVerification: {
      required: true,
      otpTtlSeconds: 10 * 60, // 10 minutes
    },

    // ── Platform admin (FCM #22 — Platform admin context) ────────────────────
    // Enables JwtPlatformGuard, PlatformRolesGuard, and the platform auth routes
    // under /api/auth/platform/*. Platform users never appear in tenant queries.
    platform: { enabled: true },

    // ── Invitations (FCM #21) ─────────────────────────────────────────────────
    // Token TTL of 48 h gives invitees a business-day window to accept.
    invitations: {
      enabled: true,
      tokenTtlSeconds: 172_800, // 48 hours
    },

    // ── RBAC role hierarchy ───────────────────────────────────────────────────
    // Hierarchy is fully denormalized: each role lists ALL roles it transitively
    // subsumes. hasRole() performs a single-level lookup, not recursive traversal.
    roles: {
      hierarchy: {
        OWNER: ['ADMIN', 'MEMBER', 'VIEWER'],
        ADMIN: ['MEMBER', 'VIEWER'],
        MEMBER: ['VIEWER'],
        VIEWER: [],
      },
      platformHierarchy: {
        SUPER_ADMIN: ['SUPPORT'],
        SUPPORT: [],
      },
    },

    // ── Statuses that block login ─────────────────────────────────────────────
    // BLOCKED_USER_STATUSES is the single source of truth — imported here so
    // the credential path and the OAuth path always enforce the same set.
    blockedStatuses: [...BLOCKED_USER_STATUSES],

    // ── Redis namespace ───────────────────────────────────────────────────────
    // All library-owned keys are prefixed with this namespace. App-owned keys
    // live under `nest-auth-example:app:*` — see redis-guidelines.md.
    redisNamespace: 'nest-auth-example',

    // ── Route prefix ─────────────────────────────────────────────────────────
    // Combined with the global `/api` prefix in main.ts → final: /api/auth/*
    routePrefix: 'auth',

    // ── Cookie security ───────────────────────────────────────────────────────
    secureCookies: isProduction,

    // ── Tenant resolver ───────────────────────────────────────────────────────
    // Reads ONLY from the X-Tenant-Id header. Never from the request body.
    // No `as` cast — explicit type guard prevents silent undefined propagation.
    tenantIdResolver: (req: Request): string => {
      const id = req.headers['x-tenant-id'];
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error('Missing or invalid x-tenant-id header');
      }
      return id;
    },
  };

  // Conditionally merge oauth block — key must be absent (not undefined) when
  // OAuth is not configured, due to exactOptionalPropertyTypes: true.
  if (googleOauth) {
    options.oauth = { google: googleOauth };
  }

  // Conditionally merge cookies block — only set when resolveDomains is needed.
  if (resolveDomains) {
    options.cookies = { resolveDomains };
  }

  return options;
}
