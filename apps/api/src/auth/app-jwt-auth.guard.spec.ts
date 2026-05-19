/**
 * @file app-jwt-auth.guard.spec.ts
 * @description Unit tests for `AppJwtAuthGuard`.
 *
 * Verifies that:
 * - When `@SkipJwtAuth()` metadata is present, `canActivate` returns `true`
 *   immediately without delegating to `JwtAuthGuard`.
 * - When no `@SkipJwtAuth()` metadata is present, `canActivate` delegates to
 *   the underlying `JwtAuthGuard.canActivate`.
 *
 * These two branches are the entire logic of the guard. The guard exists to
 * allow platform routes to skip cookie-JWT validation while still letting
 * `JwtPlatformGuard` run — unlike `@Public()` which would disable every guard.
 *
 * @layer test
 * @see apps/api/src/auth/app-jwt-auth.guard.ts
 */

import { jest } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '@bymax-one/nest-auth';

import { SKIP_JWT_AUTH_KEY } from './skip-jwt-auth.decorator.js';
import { AppJwtAuthGuard } from './app-jwt-auth.guard.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a minimal `ExecutionContext` stub with controllable handler and class.
 *
 * @param handler - The method handler object (used by `getAllAndOverride`).
 * @param cls - The controller class object (used by `getAllAndOverride`).
 */
function makeContext(handler: object = {}, cls: object = {}): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
  } as unknown as ExecutionContext;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('AppJwtAuthGuard', () => {
  let guard: AppJwtAuthGuard;
  let jwtCanActivate: jest.Mock<() => Promise<boolean>>;
  let getAllAndOverride: jest.Mock<() => boolean | undefined>;

  beforeEach(async () => {
    jwtCanActivate = jest.fn<() => Promise<boolean>>();
    getAllAndOverride = jest.fn<() => boolean | undefined>();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AppJwtAuthGuard,
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jwtCanActivate },
        },
        {
          provide: Reflector,
          useValue: { getAllAndOverride },
        },
      ],
    }).compile();

    guard = moduleRef.get(AppJwtAuthGuard);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('returns true immediately when @SkipJwtAuth() metadata is set — does not call JwtAuthGuard', async () => {
    // Routes decorated with @SkipJwtAuth() must bypass cookie-JWT validation
    // entirely so platform routes can be protected by JwtPlatformGuard instead,
    // without also skipping UserStatusGuard or RolesGuard (FCM platform isolation).
    getAllAndOverride.mockReturnValue(true);
    const ctx = makeContext();

    const result = await Promise.resolve(guard.canActivate(ctx));

    expect(result).toBe(true);
    expect(jwtCanActivate).not.toHaveBeenCalled();
    expect(getAllAndOverride).toHaveBeenCalledWith(SKIP_JWT_AUTH_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
  });

  it('delegates to JwtAuthGuard when @SkipJwtAuth() metadata is absent', async () => {
    // Normal authenticated routes must go through JwtAuthGuard so the
    // cookie-based JWT is verified — the guard must not short-circuit here.
    getAllAndOverride.mockReturnValue(undefined);
    jwtCanActivate.mockResolvedValue(true);
    const ctx = makeContext();

    const result = await Promise.resolve(guard.canActivate(ctx));

    expect(result).toBe(true);
    expect(jwtCanActivate).toHaveBeenCalledWith(ctx);
  });
});
