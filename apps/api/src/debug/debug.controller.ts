/**
 * @file debug.controller.ts
 * @description Dev-only controller that exposes helpers for demonstrating
 * and testing security features in a local environment.
 *
 * This controller is ONLY registered when `NODE_ENV !== 'production'`
 * (enforced in `AppModule`). It is unconditionally absent from production
 * builds — fail-closed design.
 *
 * Endpoints (all read the tenant from the `X-Tenant-Id` header, matching the
 * API-wide `tenantIdResolver` convention):
 * - `POST /api/debug/lockout` — forces a brute-force lockout by replaying
 *   wrong-password logins through the REAL library path, so the demo also
 *   fires the `onLoginFailed` and `onLockout` audit hooks.
 * - `GET /api/debug/lockout` — reads the lockout state via the library's
 *   `AuthService.isAccountLockedOut` / `getAccountLockoutSeconds`.
 * - `DELETE /api/debug/lockout` — clears the lockout early via
 *   `AuthService.unlockAccount` (the admin "unlock account" surface).
 *
 * The library's brute-force keyspace is private (HMAC-derived identifiers) —
 * this controller never touches Redis keys directly and stays valid across
 * library keyspace migrations.
 *
 * @layer debug
 */

import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { IsEmail } from 'class-validator';
import { AuthException, AuthService, Public } from '@bymax-one/nest-auth';

/**
 * DTO for the lockout force/unlock endpoints. The tenant comes from the
 * `X-Tenant-Id` header — never the body — mirroring the API-wide resolver rule.
 */
class LockoutDto {
  /** Target user email address. */
  @IsEmail()
  email!: string;
}

/**
 * DTO for the lockout status read. Separate from {@link LockoutDto} because it
 * arrives as a query string, but validated the same way: a primitive
 * `@Query('email')` carries no validation metadata, so the global pipe cannot
 * see it and a missing or malformed value would reach the library as an
 * internal error instead of a 400.
 */
class LockoutStatusQueryDto {
  /** Target user email address. */
  @IsEmail()
  email!: string;
}

/**
 * Response shape returned by `GET /api/debug/lockout`.
 */
interface LockoutStatusResponse {
  /** Whether the account is currently locked out. */
  locked: boolean;
  /** Seconds until the lockout window expires (0 when not locked). */
  retryAfterSeconds: number;
}

/**
 * Reads the tenant id from the `X-Tenant-Id` header or refuses the request.
 *
 * Debug endpoints are `@Public()` (no JWT), so the tenant cannot come from a
 * token claim — the header is the single source, same as the library resolver.
 *
 * @param req - Incoming Express request.
 * @returns The non-empty tenant id.
 * @throws {ForbiddenException} When the header is absent or empty.
 */
function requireTenantHeader(req: Request): string {
  const id = req.headers['x-tenant-id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new ForbiddenException('X-Tenant-Id header is required');
  }
  return id;
}

/**
 * Dev-only debug controller.
 *
 * Registered conditionally in `AppModule` based on `NODE_ENV`. The `@Public()`
 * decorator bypasses `JwtAuthGuard` so the endpoints are callable without a
 * token, making them easy to use in demo scripts and CI pipelines.
 *
 * @public
 */
@Controller('debug')
export class DebugController {
  // Mirrors `bruteForce.maxAttempts` from auth.config.ts — the number of failed
  // logins needed to cross the lockout threshold.
  private static readonly MAX_ATTEMPTS = 5;

  constructor(private readonly authService: AuthService) {}

  /**
   * Guards every endpoint against accidental production wiring.
   *
   * Belt-and-suspenders: AppModule already excludes this module from
   * production, but each handler re-checks in case the module is wired in.
   *
   * @throws {ForbiddenException} In production.
   */
  private static assertNotProduction(): void {
    if (process.env['NODE_ENV'] === 'production') {
      throw new ForbiddenException('Not available');
    }
  }

  /**
   * Forces a brute-force lockout for `(X-Tenant-Id, email)`.
   *
   * Replays `maxAttempts` wrong-password logins through the real
   * `AuthService.login` path instead of poking Redis internals. This exercises
   * the exact code production traffic hits — including the `onLoginFailed`
   * hook per attempt and the `onLockout` hook on the attempt that crosses the
   * threshold, both visible in the audit log after calling this endpoint.
   *
   * POST /api/debug/lockout
   *
   * @param dto - Validated payload naming the target email.
   * @param req - Incoming request; the library resolver reads `X-Tenant-Id` from it.
   * @returns Confirmation with the resulting lockout window.
   */
  @Post('lockout')
  @Public()
  @HttpCode(HttpStatus.OK)
  async lockout(@Body() dto: LockoutDto, @Req() req: Request): Promise<LockoutStatusResponse> {
    DebugController.assertNotProduction();
    const tenantId = requireTenantHeader(req);

    // A password no account stores — random per call so the attempt can never
    // accidentally succeed. Each refused login increments the library counter.
    const wrongPassword = `debug-lockout-${randomUUID()}`;
    for (let attempt = 0; attempt < DebugController.MAX_ATTEMPTS; attempt += 1) {
      try {
        // `tenantId` stays out of the DTO — the configured tenantIdResolver
        // (X-Tenant-Id header) decides the tenant, as everywhere else.
        await this.authService.login({ email: dto.email, password: wrongPassword }, req);
      } catch (err: unknown) {
        // Expected: auth.invalid_credentials until the threshold, then
        // auth.account_locked. Anything else is a real failure.
        if (!(err instanceof AuthException)) {
          throw err;
        }
      }
    }

    const [locked, retryAfterSeconds] = await Promise.all([
      this.authService.isAccountLockedOut(dto.email, tenantId),
      this.authService.getAccountLockoutSeconds(dto.email, tenantId),
    ]);
    return { locked, retryAfterSeconds };
  }

  /**
   * Reads the lockout state for `(X-Tenant-Id, email)`.
   *
   * Demonstrates the read side of the lockout surface added in lib v1.4.4:
   * `isAccountLockedOut` + `getAccountLockoutSeconds` are independent reads and
   * safe to issue in parallel.
   *
   * GET /api/debug/lockout?email=…
   *
   * @param query - Validated query carrying the target email address.
   * @param req - Incoming request carrying the `X-Tenant-Id` header.
   * @returns Current lockout state and remaining window.
   */
  @Get('lockout')
  @Public()
  async lockoutStatus(
    @Query() query: LockoutStatusQueryDto,
    @Req() req: Request,
  ): Promise<LockoutStatusResponse> {
    DebugController.assertNotProduction();
    const tenantId = requireTenantHeader(req);
    const [locked, retryAfterSeconds] = await Promise.all([
      this.authService.isAccountLockedOut(query.email, tenantId),
      this.authService.getAccountLockoutSeconds(query.email, tenantId),
    ]);
    return { locked, retryAfterSeconds };
  }

  /**
   * Clears an active lockout for `(X-Tenant-Id, email)` before the window expires.
   *
   * Demonstrates `AuthService.unlockAccount` — the method a host app calls from
   * its own support tooling ("unlock account" button) after verifying the
   * owner's identity out-of-band.
   *
   * DELETE /api/debug/lockout
   *
   * @param dto - Validated payload naming the target email.
   * @param req - Incoming request carrying the `X-Tenant-Id` header.
   */
  @Delete('lockout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlock(@Body() dto: LockoutDto, @Req() req: Request): Promise<void> {
    DebugController.assertNotProduction();
    const tenantId = requireTenantHeader(req);
    await this.authService.unlockAccount(dto.email, tenantId);
  }
}
