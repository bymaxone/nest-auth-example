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
import { JwtAuthGuard } from '@bymax-one/nest-auth';

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
    return this.jwtAuthGuard.canActivate(context);
  }
}
