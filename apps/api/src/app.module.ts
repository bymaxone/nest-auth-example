/**
 * @file app.module.ts
 * @description Root NestJS module for `@nest-auth-example/api`.
 *
 * Wires infrastructure, auth, and all feature modules. Registers five global
 * `APP_GUARD` providers in the exact order mandated by
 * `docs/guidelines/nest-auth-guidelines.md`: JwtAuthGuard → UserStatusGuard →
 * MfaRequiredGuard → TenantMfaPolicyGuard → RolesGuard. Order must not be
 * changed without an ADR.
 *
 * `TenantMfaPolicyGuard` is app-owned and forces every user in the tenants
 * listed in `MFA_REQUIRED_TENANT_SLUGS` to enrol in MFA before reaching
 * protected endpoints; it composes with the library's `MfaRequiredGuard`
 * rather than replacing it.
 *
 * Import order is intentional:
 * 1. `AppConfigModule` must be first — registers `ConfigService` globally.
 * 2. `createAppLoggerModule()` comes next to capture all subsequent bootstrap logs.
 * 3. `PrismaModule` and `RedisModule` are infrastructure with no ordering constraint.
 * 4. `AuthModule` depends on Prisma + Redis being available.
 * 5. `ThrottlerModule` must be imported before feature modules that apply throttling.
 * 6. `HealthModule`, domain modules, and `DebugModule` follow.
 *
 * @layer root
 * @see docs/guidelines/nest-auth-guidelines.md §Decorators & guards
 */

import { Module } from '@nestjs/common';
import { APP_GUARD, RouterModule } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  BymaxAuthModule,
  MfaRequiredGuard,
  RolesGuard,
  UserStatusGuard,
} from '@bymax-one/nest-auth';

import { AppConfigModule } from './config/config.module.js';
import { createAppLoggerModule } from './logger/logger.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AppJwtAuthGuard } from './auth/app-jwt-auth.guard.js';
import { TenantMfaPolicyGuard } from './auth/tenant-mfa-policy.guard.js';
import { AccountModule } from './account/account.module.js';
import { AuditModule } from './audit/audit.module.js';
import { InvitationsModule } from './invitations/invitations.module.js';
import { TenantsModule } from './tenants/tenants.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { UsersModule } from './users/users.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { DebugModule } from './debug/debug.module.js';

/**
 * Application root module.
 *
 * Contains no business logic — only wires infrastructure, auth, and feature modules.
 * The four global guards enforce the pipeline for every authenticated route.
 *
 * @public
 */
@Module({
  imports: [
    // ── Infrastructure (must come before feature modules) ──────────────────
    AppConfigModule,
    createAppLoggerModule(),
    PrismaModule,
    RedisModule,
    // ── Auth library (depends on Prisma + Redis) ───────────────────────────
    AuthModule,
    // Mount all BymaxAuthModule controllers under the `auth/` path prefix so
    // routes resolve as /api/auth/register, /api/auth/login, etc. The prefix
    // combines with setGlobalPrefix('api') configured in main.ts.
    RouterModule.register([{ path: 'auth', module: BymaxAuthModule }]),
    // ── Throttler ──────────────────────────────────────────────────────────
    // Global rate-limiting baseline: 100 requests per 60 s per IP.
    // Individual auth endpoints apply tighter limits via @Throttle(AUTH_THROTTLE_CONFIGS.*).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    // ── Feature modules ────────────────────────────────────────────────────
    HealthModule,
    AccountModule,
    AuditModule,
    InvitationsModule,
    TenantsModule,
    ProjectsModule,
    UsersModule,
    // Platform admin endpoints under /api/platform/*, protected by
    // JwtPlatformGuard + PlatformRolesGuard.
    PlatformModule,
    // WebSocket notifications gateway at /ws/notifications, guarded by WsJwtGuard.
    // The dev-only POST /api/debug/notify/:userId trigger is included by
    // NotificationsModule itself when NODE_ENV !== 'production'.
    NotificationsModule,
    // DebugModule is conditionally included only outside of production to
    // keep brute-force demo helpers out of production deployments.
    ...(process.env['NODE_ENV'] !== 'production' ? [DebugModule] : []),
  ],
  controllers: [],
  providers: [
    // ── Global guards — ORDER IS CRITICAL; do not reorder without an ADR ──
    // useExisting reuses the singleton instances already created in BymaxAuthModule
    // (where JwtService and other library-internal deps are in scope). Using
    // useClass would create new instances in AppModule's scope where JwtService
    // is not exported, causing a DI resolution failure.
    // 1. AppJwtAuthGuard: extracts and verifies the access-token cookie.
    //    Wraps the library's JwtAuthGuard so @SkipJwtAuth() can bypass it
    //    WITHOUT also bypassing the other guards (unlike @Public() which
    //    disables every guard via IS_PUBLIC_KEY).
    AppJwtAuthGuard,
    { provide: APP_GUARD, useClass: AppJwtAuthGuard },
    // 2. UserStatusGuard: rejects users whose status is in `blockedStatuses`
    //    (BANNED, INACTIVE, SUSPENDED). Runs after JWT is verified so the
    //    user identity is available.
    { provide: APP_GUARD, useExisting: UserStatusGuard },
    // 3. MfaRequiredGuard: enforces MFA challenge completion when the user
    //    has MFA enabled. Routes decorated with @SkipMfa() bypass this guard.
    { provide: APP_GUARD, useExisting: MfaRequiredGuard },
    // 4. TenantMfaPolicyGuard: tenant-level enrolment enforcement. Forces
    //    users in the configured tenant list (MFA_REQUIRED_TENANT_SLUGS) to
    //    enrol in MFA before they can use protected endpoints. Reuses the
    //    same @SkipMfa() decorator as the lib's MfaRequiredGuard, so MFA
    //    setup routes remain reachable. App-owned — not exported by the lib.
    TenantMfaPolicyGuard,
    { provide: APP_GUARD, useExisting: TenantMfaPolicyGuard },
    // 5. RolesGuard: enforces @Roles(...) requirements using the role hierarchy
    //    defined in auth.config.ts. Routes without @Roles() pass through.
    { provide: APP_GUARD, useExisting: RolesGuard },
  ],
})
export class AppModule {}
