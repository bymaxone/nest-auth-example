/**
 * @file debug.controller.ts
 * @description Dev-only controller that exposes helpers for demonstrating
 * and testing security features in a local environment.
 *
 * This controller is ONLY registered when `NODE_ENV !== 'production'`
 * (enforced in `AppModule`). It is unconditionally absent from production
 * builds — fail-closed design.
 *
 * Endpoints:
 * - `POST /api/debug/lockout` — forces brute-force lockout for a given
 *   `(tenantId, email)` pair so QA can demo the lockout flow without
 *   manually exhausting failed attempts. Covers FCM row #16.
 *
 * The lockout key format mirrors the library's internal Redis key:
 *   `<redisNamespace>:lf:<sha256(tenantId + ':' + email.toLowerCase())>`
 *
 * @layer debug
 * @see docs/DEVELOPMENT_PLAN.md §Phase 7 P7-5
 */

import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { Redis } from 'ioredis';
import { Public, sha256, BYMAX_AUTH_REDIS_CLIENT } from '@bymax-one/nest-auth';

/**
 * DTO for the lockout demo endpoint.
 */
class LockoutDto {
  /** Target tenant identifier. */
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  /** Target user email address (lowercased before hashing). */
  @IsEmail()
  email!: string;
}

/**
 * Response shape returned by `POST /api/debug/lockout`.
 */
interface LockoutResponse {
  /** Always `true` after the key is set. */
  locked: boolean;
  /** The Redis key that was set, for inspection by QA. */
  key: string;
}

/**
 * Dev-only debug controller.
 *
 * Registered conditionally in `AppModule` based on `NODE_ENV`. The `@Public()`
 * decorator bypasses `JwtAuthGuard` so the endpoint is callable without a token,
 * making it easy to use in demo scripts and CI pipelines.
 *
 * @public
 */
@Controller('debug')
export class DebugController {
  // Maximum failed-attempt count — mirrors `bruteForce.maxAttempts` from auth.config.ts.
  // Setting the counter to maxAttempts + 1 guarantees the next login is rejected.
  private static readonly MAX_ATTEMPTS = 5;

  // TTL in seconds — mirrors `bruteForce.windowSeconds` from auth.config.ts.
  private static readonly WINDOW_SECONDS = 900;

  // Redis namespace prefix from auth.config.ts `redisNamespace` field.
  private static readonly REDIS_NAMESPACE = 'nest-auth-example';

  constructor(
    @Inject(BYMAX_AUTH_REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  /**
   * Forces a brute-force lockout for the given `(tenantId, email)` pair.
   *
   * Sets the library's internal login-failure counter to `maxAttempts + 1`
   * so the very next login attempt returns `ACCOUNT_LOCKED`. The key expires
   * after `windowSeconds` seconds (900 s / 15 minutes), matching the lockout
   * window configured in `auth.config.ts`.
   *
   * POST /api/debug/lockout
   *
   * @param dto - Validated lockout payload.
   * @returns Confirmation with the Redis key that was set.
   */
  @Post('lockout')
  @Public()
  @HttpCode(HttpStatus.OK)
  async lockout(@Body() dto: LockoutDto): Promise<LockoutResponse> {
    // Belt-and-suspenders: AppModule already excludes this module from production,
    // but guard here too in case the module is accidentally wired in.
    if (process.env['NODE_ENV'] === 'production') {
      throw new ForbiddenException('Not available');
    }

    const normalizedEmail = dto.email.toLowerCase();
    // Key format mirrors the library's brute-force implementation in BruteForceService.
    const hash = sha256(`${dto.tenantId}:${normalizedEmail}`);
    const key = `${DebugController.REDIS_NAMESPACE}:lf:${hash}`;

    await this.redis.set(
      key,
      String(DebugController.MAX_ATTEMPTS + 1),
      'EX',
      DebugController.WINDOW_SECONDS,
    );

    return { locked: true, key };
  }
}
