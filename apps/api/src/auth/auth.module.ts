/**
 * @file auth.module.ts
 * @description Phase 7 module that wires `BymaxAuthModule.registerAsync` with all
 * four required implementation bindings: user repository, platform user repository,
 * email provider, and auth hooks.
 *
 * Design notes:
 * - `chooseEmailProviderClass` is evaluated once at module decoration time (before
 *   the DI container is available), reading `process.env.EMAIL_PROVIDER` directly.
 *   This is an accepted exception to the "no direct process.env" rule because NestJS
 *   `@Module()` metadata must be synchronous — see AGENTS.md §Critical Rules.
 * - `controllers.mfa` and `controllers.oauth` are synchronous flags on `registerAsync`
 *   (not inside `useFactory`) because the module is built before `useFactory` resolves.
 * - `BYMAX_AUTH_REDIS_CLIENT` is already provided by the global `RedisModule` and does
 *   not need a duplicate binding here — the token is resolved from the global scope.
 *
 * Covers FCM rows #1–#5, #13–#20, #23, #29–#32 (module-level wiring layer).
 *
 * @layer auth
 * @see docs/guidelines/nest-auth-guidelines.md
 * @see docs/DEVELOPMENT_PLAN.md §Phase 7 P7-1
 */

import { Module } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  BymaxAuthModule,
  BYMAX_AUTH_EMAIL_PROVIDER,
  BYMAX_AUTH_HOOKS,
  BYMAX_AUTH_PLATFORM_USER_REPOSITORY,
  BYMAX_AUTH_USER_REPOSITORY,
} from '@bymax-one/nest-auth';
import type { BymaxAuthModuleOptions, IEmailProvider } from '@bymax-one/nest-auth';

import { PrismaModule } from '../prisma/prisma.module.js';
import { RedisModule } from '../redis/redis.module.js';
import type { Env } from '../config/env.schema.js';
import { buildAuthOptions } from './auth.config.js';
import { AppAuthHooks } from './app-auth.hooks.js';
import { MailpitEmailProvider } from './mailpit-email.provider.js';
import { PrismaUserRepository } from './prisma-user.repository.js';
import { PrismaPlatformUserRepository } from './prisma-platform-user.repository.js';
import { ResendEmailProvider } from './resend-email.provider.js';

/**
 * Returns the email provider class based on `EMAIL_PROVIDER` env var.
 *
 * Evaluated once at module decoration time (synchronous, before DI initialises).
 * `process.env` is the only source available at this stage — this is the accepted
 * exception documented in AGENTS.md §Critical Rules §7.
 *
 * @returns `ResendEmailProvider` when `EMAIL_PROVIDER=resend`; otherwise `MailpitEmailProvider`.
 */
function chooseEmailProviderClass(): Type<IEmailProvider> {
  return (process.env['EMAIL_PROVIDER'] ?? 'mailpit').toLowerCase() === 'resend'
    ? ResendEmailProvider
    : MailpitEmailProvider;
}

/**
 * Returns `true` iff both Google OAuth env vars are set at process startup.
 *
 * Evaluated synchronously on module decoration so the `controllers.oauth` flag
 * is known when NestJS builds the `DynamicModule` — before `useFactory` resolves.
 *
 * @returns Whether Google OAuth should be enabled.
 */
function isGoogleOAuthConfigured(): boolean {
  return (
    typeof process.env['OAUTH_GOOGLE_CLIENT_ID'] === 'string' &&
    process.env['OAUTH_GOOGLE_CLIENT_ID'].length > 0 &&
    typeof process.env['OAUTH_GOOGLE_CLIENT_SECRET'] === 'string' &&
    process.env['OAUTH_GOOGLE_CLIENT_SECRET'].length > 0
  );
}

const EmailProviderClass = chooseEmailProviderClass();

/**
 * Application auth module that registers `BymaxAuthModule` with all four
 * app-owned implementation classes bound to their library injection tokens.
 *
 * Re-exports `BymaxAuthModule` so downstream feature modules can consume
 * library guards and decorators without re-importing the library directly.
 *
 * @public
 */
@Module({
  imports: [
    BymaxAuthModule.registerAsync({
      imports: [ConfigModule, PrismaModule, RedisModule],
      // Cast required because AuthModuleAsyncOptions.useFactory is typed as
      // (...args: unknown[]) => ... but we need a typed ConfigService parameter.
      // This is the standard NestJS async-options pattern: inject ensures the
      // correct type is provided at runtime; the cast satisfies TS contravariance.
      useFactory: ((...args: unknown[]) => {
        const config = args[0] as ConfigService<Env, true>;
        return buildAuthOptions(config);
      }) satisfies (...args: unknown[]) => BymaxAuthModuleOptions,
      inject: [ConfigService],
      controllers: {
        mfa: true,
        oauth: isGoogleOAuthConfigured(),
      },
      extraProviders: [
        { provide: BYMAX_AUTH_USER_REPOSITORY, useClass: PrismaUserRepository },
        { provide: BYMAX_AUTH_PLATFORM_USER_REPOSITORY, useClass: PrismaPlatformUserRepository },
        { provide: BYMAX_AUTH_EMAIL_PROVIDER, useClass: EmailProviderClass },
        { provide: BYMAX_AUTH_HOOKS, useClass: AppAuthHooks },
      ],
    }),
  ],
  exports: [BymaxAuthModule],
})
export class AuthModule {}
