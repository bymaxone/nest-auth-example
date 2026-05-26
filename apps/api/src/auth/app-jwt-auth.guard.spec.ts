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
import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { JwtAuthGuard, JwtPlatformGuard } from '@bymax-one/nest-auth';

import { SKIP_JWT_AUTH_KEY } from './skip-jwt-auth.decorator.js';
import { AppJwtAuthGuard } from './app-jwt-auth.guard.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a minimal `ExecutionContext` stub with controllable handler, class,
 * and request. The optional `request` override is what the platform-token
 * pass-through reads via `context.switchToHttp().getRequest()` — pass a
 * partial Request that carries the `authorization` header you want to
 * exercise.
 *
 * @param handler - The method handler object (used by `getAllAndOverride`).
 * @param cls - The controller class object (used by `getAllAndOverride`).
 * @param request - Partial Express request returned by `switchToHttp()`.
 */
function makeContext(
  handler: object = {},
  cls: object = {},
  request: { headers?: Record<string, string | undefined> } = {},
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

/**
 * Encodes a payload object into a JWS-shaped string `header.payload.signature`.
 * The signature segment is a non-empty placeholder — the guard's
 * `isPlatformBearerToken` only base64-decodes the payload and never verifies
 * the signature (the downstream `JwtPlatformGuard` performs the
 * authoritative validation).
 *
 * @param payload - The JWT body to inline into the encoded token.
 */
function encodeFakeJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature-placeholder`;
}

/**
 * Marks a handler / class pair as a `JwtPlatformGuard`-protected route.
 * `Reflector.getAllAndMerge('__guards__', [...])` reads through both via
 * `Reflect.getMetadata`, so defining the same array on each target keeps
 * the merge deterministic.
 */
function markAsPlatformRoute(handler: object, cls: object): void {
  Reflect.defineMetadata('__guards__', [JwtPlatformGuard], handler);
  Reflect.defineMetadata('__guards__', [JwtPlatformGuard], cls);
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

  // ─── Platform-token pass-through ──────────────────────────────────────────

  describe('platform Bearer token pass-through', () => {
    /**
     * Verifies the happy path: when the route declares `JwtPlatformGuard` AND
     * the incoming Authorization header carries a Bearer JWT whose payload
     * decodes to `{ type: 'platform' }`, the guard short-circuits to `true`
     * so the downstream `JwtPlatformGuard` can perform the authoritative
     * signature/expiry/revocation checks. The cookie-based `JwtAuthGuard`
     * must NOT run — it would 401 because no auth cookie is present on
     * Bearer-style platform requests.
     */
    it('returns true for a platform JWT on a JwtPlatformGuard-protected route', () => {
      getAllAndOverride.mockReturnValue(undefined);
      const handler = {};
      const cls = {};
      markAsPlatformRoute(handler, cls);
      const ctx = makeContext(handler, cls, {
        headers: { authorization: `Bearer ${encodeFakeJwt({ type: 'platform', sub: 'p-1' })}` },
      });

      const result = guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(jwtCanActivate).not.toHaveBeenCalled();
    });

    /**
     * Verifies the cross-context isolation invariant: a platform JWT
     * submitted to a non-platform route must NOT bypass dashboard auth.
     * The `__guards__` metadata is absent, so the route is classified as
     * "not a platform route" and the guard falls through to `JwtAuthGuard`
     * (which will reject the Bearer-only request because there is no
     * `access_token` cookie). Pinning this branch closes the security
     * hole the legacy `@Public()` wiring left open.
     */
    it('falls through to JwtAuthGuard when the route is NOT JwtPlatformGuard-protected', async () => {
      getAllAndOverride.mockReturnValue(undefined);
      jwtCanActivate.mockResolvedValue(false);
      const handler = {};
      const cls = {};
      // No markAsPlatformRoute — `__guards__` metadata stays unset.
      const ctx = makeContext(handler, cls, {
        headers: { authorization: `Bearer ${encodeFakeJwt({ type: 'platform' })}` },
      });

      const result = await Promise.resolve(guard.canActivate(ctx));

      expect(result).toBe(false);
      expect(jwtCanActivate).toHaveBeenCalledWith(ctx);
    });

    /**
     * Verifies that a request lacking the Authorization header falls through
     * even when the route IS a platform route. Without a Bearer token we
     * cannot identify it as platform-typed, so the standard cookie-JWT path
     * runs. Pins the `header missing` early-return branch.
     */
    it('falls through to JwtAuthGuard when the Authorization header is missing', async () => {
      getAllAndOverride.mockReturnValue(undefined);
      jwtCanActivate.mockResolvedValue(true);
      const handler = {};
      const cls = {};
      markAsPlatformRoute(handler, cls);
      const ctx = makeContext(handler, cls, { headers: {} });

      const result = await Promise.resolve(guard.canActivate(ctx));

      expect(result).toBe(true);
      expect(jwtCanActivate).toHaveBeenCalledWith(ctx);
    });

    /**
     * Verifies that a non-Bearer auth scheme (e.g. `Basic`) falls through.
     * Pins the `!header.startsWith('Bearer ')` guard so a future change
     * that loosens it (matching any auth scheme) is caught.
     */
    it('falls through when the Authorization header is not a Bearer token', async () => {
      getAllAndOverride.mockReturnValue(undefined);
      jwtCanActivate.mockResolvedValue(true);
      const handler = {};
      const cls = {};
      markAsPlatformRoute(handler, cls);
      const ctx = makeContext(handler, cls, {
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });

      const result = await Promise.resolve(guard.canActivate(ctx));

      expect(result).toBe(true);
      expect(jwtCanActivate).toHaveBeenCalledWith(ctx);
    });

    /**
     * Verifies the Bearer-token-shape gate: a token that does not split into
     * three dot-separated segments cannot be a JWT. The guard must NOT
     * attempt base64-decoding on a malformed string — falling through is
     * the safe default. Pins the `parts.length !== 3` early return.
     */
    it('falls through when the Bearer token is not a JWT (wrong segment count)', async () => {
      getAllAndOverride.mockReturnValue(undefined);
      jwtCanActivate.mockResolvedValue(true);
      const handler = {};
      const cls = {};
      markAsPlatformRoute(handler, cls);
      const ctx = makeContext(handler, cls, {
        headers: { authorization: 'Bearer not-a-jwt' },
      });

      const result = await Promise.resolve(guard.canActivate(ctx));

      expect(result).toBe(true);
      expect(jwtCanActivate).toHaveBeenCalledWith(ctx);
    });

    /**
     * Verifies the empty-payload-segment guard. A JWT shaped like
     * `header..signature` parses into three parts but the middle segment is
     * empty — base64-decoding it would produce `''` and `JSON.parse('')`
     * would throw. Catching the empty case upfront skips the failing parse.
     */
    it('falls through when the JWT payload segment is empty', async () => {
      getAllAndOverride.mockReturnValue(undefined);
      jwtCanActivate.mockResolvedValue(true);
      const handler = {};
      const cls = {};
      markAsPlatformRoute(handler, cls);
      const ctx = makeContext(handler, cls, {
        headers: { authorization: 'Bearer header..signature' },
      });

      const result = await Promise.resolve(guard.canActivate(ctx));

      expect(result).toBe(true);
      expect(jwtCanActivate).toHaveBeenCalledWith(ctx);
    });

    /**
     * Verifies that a malformed base64/JSON payload triggers the `catch` and
     * falls through. Pinning this branch documents that decoding errors are
     * non-fatal — the request just isn't treated as a platform token.
     */
    it('falls through when the JWT payload is not valid base64-encoded JSON', async () => {
      getAllAndOverride.mockReturnValue(undefined);
      jwtCanActivate.mockResolvedValue(true);
      const handler = {};
      const cls = {};
      markAsPlatformRoute(handler, cls);
      const ctx = makeContext(handler, cls, {
        headers: { authorization: 'Bearer header.@@@not-json@@@.signature' },
      });

      const result = await Promise.resolve(guard.canActivate(ctx));

      expect(result).toBe(true);
      expect(jwtCanActivate).toHaveBeenCalledWith(ctx);
    });

    /**
     * Verifies that a JWT whose payload decodes to a non-platform `type`
     * (e.g. `'dashboard'`) does NOT trigger the pass-through. The guard
     * falls through to `JwtAuthGuard` for cookie-based validation.
     * Pinning this distinguishes "platform-typed" from "any-typed" tokens.
     */
    it('falls through when the JWT payload type is not "platform"', async () => {
      getAllAndOverride.mockReturnValue(undefined);
      jwtCanActivate.mockResolvedValue(true);
      const handler = {};
      const cls = {};
      markAsPlatformRoute(handler, cls);
      const ctx = makeContext(handler, cls, {
        headers: { authorization: `Bearer ${encodeFakeJwt({ type: 'dashboard' })}` },
      });

      const result = await Promise.resolve(guard.canActivate(ctx));

      expect(result).toBe(true);
      expect(jwtCanActivate).toHaveBeenCalledWith(ctx);
    });
  });
});
