/**
 * @file tenant-mfa-policy.guard.ts
 * @description Tenant-level MFA enforcement — forces every authenticated user
 * in the configured tenant list to enrol in MFA before they can use any
 * protected endpoint.
 *
 * Complements `@bymax-one/nest-auth`'s `MfaRequiredGuard`:
 *
 *   | Guard                  | Condition that throws                          |
 *   | ---------------------- | ---------------------------------------------- |
 *   | `MfaRequiredGuard`     | `mfaEnabled === true && mfaVerified !== true`  |
 *   |   (lib-provided)       |   → `MFA_REQUIRED` 403 (user must challenge)   |
 *   | `TenantMfaPolicyGuard` | `tenantId ∈ requiredTenants && !mfaEnabled`    |
 *   |   (this file)          |   → `MFA_SETUP_REQUIRED` 403 (must enrol)      |
 *
 * The two compose: a user with MFA on but un-challenged hits the lib's guard
 * first; a user without MFA in a required tenant hits this one. Both honour
 * the `@SkipMfa()` decorator from the lib (same `SKIP_MFA_KEY` reflector
 * metadata) so MFA enrollment endpoints themselves remain reachable.
 *
 * Slug → CUID resolution happens once at module init and is cached in memory.
 * If a configured slug does not match any tenant, the guard logs a warning
 * (visible in app boot) and silently skips that slug — startup does not fail,
 * because the typical case is a developer mis-typing a slug, and refusing to
 * boot the entire API for a guard-policy typo is too aggressive.
 *
 * Configuration is read from `MFA_REQUIRED_TENANT_SLUGS` (see
 * `apps/api/src/config/env.schema.ts`). Default is empty (no enforcement).
 *
 * @layer auth
 * @see docs/guidelines/nestjs-guidelines.md
 * @see docs/guidelines/nest-auth-guidelines.md
 */

import {
  HttpStatus,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AUTH_ERROR_CODES, AuthException, SKIP_MFA_KEY } from '@bymax-one/nest-auth';
import type { DashboardJwtPayload } from '@bymax-one/nest-auth';

import type { Env } from '../config/env.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Reads slugs from `MFA_REQUIRED_TENANT_SLUGS`, splits on `,`, trims, and
 * drops empty entries. Exported so tests can pin the parsing semantics
 * without spinning up Nest's testing module.
 *
 * @internal
 */
export function parseRequiredTenantSlugs(raw: string): string[] {
  return raw
    .split(',')
    .map((slug) => slug.trim())
    .filter((slug) => slug.length > 0);
}

/**
 * Guard that rejects requests from users in MFA-required tenants who have
 * not yet enrolled. Apply globally in `AppModule` after `JwtAuthGuard`,
 * `UserStatusGuard`, and the lib's `MfaRequiredGuard`.
 *
 * @public
 */
@Injectable()
export class TenantMfaPolicyGuard implements CanActivate, OnModuleInit {
  private readonly logger = new Logger(TenantMfaPolicyGuard.name);

  /**
   * Set of tenant CUIDs that require MFA. Populated by `onModuleInit` from
   * the slug list in `MFA_REQUIRED_TENANT_SLUGS`. Empty set means "no
   * enforcement" — the guard short-circuits to `true` on every request.
   */
  private requiredTenantIds: ReadonlySet<string> = new Set();

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Resolves the configured slugs to tenant CUIDs once, at module
   * initialisation. Slugs that do not match any tenant are logged at
   * `warn` and skipped — see file header for rationale.
   */
  async onModuleInit(): Promise<void> {
    const raw = this.config.get<string>('MFA_REQUIRED_TENANT_SLUGS') ?? '';
    const slugs = parseRequiredTenantSlugs(raw);

    if (slugs.length === 0) {
      this.logger.log({
        msg: 'tenant MFA policy disabled — MFA_REQUIRED_TENANT_SLUGS is empty',
      });
      return;
    }

    const rows = await this.prisma.tenant.findMany({
      where: { slug: { in: slugs } },
      select: { id: true, slug: true },
    });

    const found = new Set(rows.map((row) => row.slug));
    const missing = slugs.filter((slug) => !found.has(slug));
    if (missing.length > 0) {
      this.logger.warn({
        msg: 'tenant MFA policy: ignored unknown slugs',
        slugs: missing,
      });
    }

    this.requiredTenantIds = new Set(rows.map((row) => row.id));
    this.logger.log({
      msg: 'tenant MFA policy enabled',
      slugs: rows.map((row) => row.slug),
      tenantCount: rows.length,
    });
  }

  /**
   * Returns `true` when the request is allowed to proceed; throws
   * `AuthException(MFA_SETUP_REQUIRED)` when the policy is violated.
   *
   * Composition order — the guard short-circuits to `true` for:
   *   1. routes decorated with `@SkipMfa()` (same key as the lib's guard)
   *   2. lib auth-flow endpoints under `/api/auth/*` — the user MUST be able
   *      to read `/me`, complete enrolment via `/mfa/setup` + `/mfa/verify-enable`,
   *      rotate tokens via `/refresh`, and log out via `/logout` even before
   *      they have MFA on. Without this carve-out the `AuthProvider`'s mount
   *      effect would 403 on `/me`, the lib's `revalidate` would clear the
   *      session, and the user would be bounced back to `/auth/login` in a
   *      loop with no way out.
   *   3. unauthenticated requests (no `request.user`) — `JwtAuthGuard`
   *      handles the rejection upstream
   *   4. tenants not in the required set
   *   5. users whose JWT already says `mfaEnabled === true`
   */
  canActivate(context: ExecutionContext): boolean {
    if (this.requiredTenantIds.size === 0) {
      return true;
    }

    const skipMfa = this.reflector.getAllAndOverride<boolean>(SKIP_MFA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipMfa) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: DashboardJwtPayload }>();

    // Skip lib auth-flow endpoints — see step 2 in the JSDoc above. Use
    // `originalUrl` because NestJS's `setGlobalPrefix('api')` keeps the
    // global prefix in `originalUrl` but strips it from `url` / `path`
    // depending on the Express adapter version.
    const urlPath = request.originalUrl ?? request.url ?? request.path ?? '';
    if (urlPath.startsWith('/api/auth/') || urlPath.startsWith('/auth/')) {
      return true;
    }

    const user = request.user;
    if (user === undefined) {
      return true;
    }

    if (this.requiredTenantIds.has(user.tenantId) && user.mfaEnabled !== true) {
      throw new AuthException(AUTH_ERROR_CODES.MFA_SETUP_REQUIRED, HttpStatus.FORBIDDEN);
    }

    return true;
  }
}
