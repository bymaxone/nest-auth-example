/**
 * @file skip-jwt-auth.decorator.ts
 * @description Custom metadata decorator that tells `AppJwtAuthGuard` to skip
 * cookie-based JWT validation for routes that use a different auth mechanism
 * (e.g. `JwtPlatformGuard` for platform bearer tokens).
 *
 * Unlike `@Public()` from `@bymax-one/nest-auth`, this does NOT bypass other
 * library guards in the global pipeline (`JwtPlatformGuard`, `UserStatusGuard`,
 * `MfaRequiredGuard`, `RolesGuard`). Use this on controllers (like the platform
 * controller) that authenticate via a non-cookie mechanism but still need the
 * remaining guards to run.
 *
 * @layer auth
 * @see ./app-jwt-auth.guard.ts
 */
import { SetMetadata } from '@nestjs/common';

/** Metadata key consumed by `AppJwtAuthGuard`. */
export const SKIP_JWT_AUTH_KEY = 'skipJwtAuth';

/**
 * Marks a controller or handler so `AppJwtAuthGuard` (the global cookie-JWT
 * guard) lets the request through. Other guards in the pipeline still run.
 *
 * @public
 */
export const SkipJwtAuth = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_JWT_AUTH_KEY, true);
