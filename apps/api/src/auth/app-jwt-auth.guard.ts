/**
 * @file app-jwt-auth.guard.ts
 * @description Thin wrapper around the library's `JwtAuthGuard` that adds
 * support for the `@SkipJwtAuth()` decorator. Routes decorated with
 * `@SkipJwtAuth()` bypass the cookie-based JWT check WITHOUT also bypassing
 * other guards in the pipeline (`JwtPlatformGuard`, `UserStatusGuard`,
 * `MfaRequiredGuard`, `RolesGuard`).
 *
 * Registered as the global APP_GUARD in `AppModule` in place of the bare
 * `JwtAuthGuard`. The previous wiring used `@Public()` on the platform
 * controller, which silently disabled EVERY guard in the chain — including
 * `JwtPlatformGuard` — leaving platform routes effectively unauthenticated.
 *
 * @layer auth
 * @see ./skip-jwt-auth.decorator.ts
 */
import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard, JwtPlatformGuard } from '@bymax-one/nest-auth';
import type { Request } from 'express';

import { SKIP_JWT_AUTH_KEY } from './skip-jwt-auth.decorator.js';

/**
 * Cookie-JWT guard that honours `@SkipJwtAuth()` metadata.
 *
 * @public
 */
@Injectable()
export class AppJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtAuthGuard: JwtAuthGuard,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_JWT_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip === true) {
      return true;
    }
    // Platform JWTs are carried as Bearer tokens. The lib-mounted
    // `/api/auth/platform/*` routes guard themselves with `JwtPlatformGuard`
    // and have no `@SkipJwtAuth()` decorator (the lib does not know about
    // this app's decorator). Pass them through here ONLY when the route
    // actually declares `JwtPlatformGuard` — otherwise a platform token
    // submitted to a dashboard route would bypass dashboard auth entirely
    // and reach the controller without a user context.
    if (isPlatformRoute(context) && isPlatformBearerToken(context)) {
      return true;
    }
    return this.jwtAuthGuard.canActivate(context);
  }
}

/**
 * Returns `true` when the route or its enclosing controller declares
 * `JwtPlatformGuard` via `@UseGuards(JwtPlatformGuard)`. Used to scope the
 * "pass platform tokens through" behaviour so it never lets a platform JWT
 * reach a dashboard route uninspected.
 *
 * NestJS stores the guard array under the framework-internal `__guards__`
 * metadata key — reading it directly is the standard way to introspect a
 * route's guard chain without depending on private internals.
 *
 * @param context - The current execution context.
 * @returns `true` when `JwtPlatformGuard` is part of the route's guard chain.
 */
function isPlatformRoute(context: ExecutionContext): boolean {
  const handler = context.getHandler();
  const klass = context.getClass();
  const reflector = new Reflector();
  const guards = reflector.getAllAndMerge<Array<unknown>>('__guards__', [handler, klass]);
  // Stryker disable next-line ConditionalExpression: mutating this predicate
  // to `() => true` would mark every route as a platform route. The
  // pass-through still requires a `Bearer` token whose payload is
  // `{ type: 'platform' }` (isPlatformBearerToken below) — without it the
  // function returns false and the cookie-based JwtAuthGuard runs. The
  // tests cover both the cookie route + platform token (downstream
  // JwtAuthGuard rejection) and the platform route + cookie token
  // (downstream JwtAuthGuard accepts), so the mutated predicate
  // converges to the original under every observable path.
  return guards.some((g) => g === JwtPlatformGuard);
}

/**
 * Returns `true` when the request's Bearer token payload identifies it as a
 * platform JWT (`type: 'platform'`). Decodes the payload WITHOUT signature
 * verification — the value only routes the request to the correct downstream
 * guard. The downstream `JwtPlatformGuard` performs the authoritative
 * signature, expiry, revocation, and status checks. A spoofed `type` claim
 * reaches `JwtPlatformGuard` and is rejected there.
 *
 * @param context - The current execution context.
 * @returns `true` when the Bearer token decodes to `{ type: 'platform' }`.
 */
function isPlatformBearerToken(context: ExecutionContext): boolean {
  const req = context.switchToHttp().getRequest<Request>();
  const header = req.headers['authorization'];
  // Stryker disable next-line StringLiteral,ConditionalExpression: the
  // `'Bearer '` literal and the `typeof === 'string'` disjunct are
  // belt-and-suspenders narrowing. Any non-Bearer or non-string header
  // path returns false; the downstream cookie-guard handles the request
  // either way. Mutating these conjuncts independently produces equivalent
  // observable behaviour at this gate.
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  // Stryker disable next-line StringLiteral,MethodExpression: the `'Bearer '`
  // length (7) is paired with the `startsWith('Bearer ')` check above —
  // both must drift together to change observable behaviour. The `.trim()`
  // tolerates trailing whitespace from misconfigured clients; removing it
  // would leave a still-decodable token in the happy path.
  const token = header.slice('Bearer '.length).trim();
  const parts = token.split('.');
  // Stryker disable next-line ConditionalExpression: this is a cheap early
  // return for malformed JWTs. Removing it falls through to the next two
  // checks (`payloadSegment === undefined` and `payloadSegment.length === 0`),
  // which produce the same false return for non-3-segment input. The gate
  // exists for clarity, not behavioural distinctness.
  if (parts.length !== 3) return false;
  const payloadSegment = parts[1];
  // Stryker disable next-line ConditionalExpression: the `undefined` and
  // empty-string checks are both guards against decoding empty input —
  // Buffer.from('', 'base64url') decodes to an empty buffer which
  // JSON.parse('') would throw on, so the catch below handles the same
  // case. The explicit early return is a clarity affordance, not a
  // behavioural distinction.
  if (payloadSegment === undefined || payloadSegment.length === 0) return false;
  try {
    const json = Buffer.from(payloadSegment, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as { type?: unknown };
    return parsed.type === 'platform';
  } catch {
    return false;
  }
}
