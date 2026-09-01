/**
 * @file auth.module.ts
 * @description NestJS module that wires `BymaxAuthModule.registerAsync` with all
 * five required implementation bindings: user repository, platform user repository,
 * Redis client, email provider, and auth hooks.
 *
 * Design notes:
 * - `chooseEmailProviderClass` is evaluated once at module decoration time (before
 *   the DI container is available), reading `process.env.EMAIL_PROVIDER` directly.
 *   This is an accepted exception to the "no direct process.env" rule because NestJS
 *   `@Module()` metadata must be synchronous — see AGENTS.md §Critical Rules.
 * - `controllers.mfa` and `controllers.oauth` are synchronous flags on `registerAsync`
 *   (not inside `useFactory`) because the module is built before `useFactory` resolves.
 * - `BYMAX_AUTH_REDIS_CLIENT` must be in `extraProviders` — the library's `registerAsync`
 *   validates this eagerly and does not check `imports`. The global `RedisModule` provides
 *   a separate client instance for other feature modules (e.g. NotificationsModule).
 *
 * @layer auth
 * @see docs/guidelines/nest-auth-guidelines.md
 */

import { Module } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  AllowAllBreachChecker,
  BYMAX_AUTH_OPTIONS,
  BymaxAuthModule,
  CommonPasswordChecker,
  BYMAX_AUTH_BREACH_CHECKER,
  BYMAX_AUTH_EMAIL_PROVIDER,
  BYMAX_AUTH_HOOKS,
  BYMAX_AUTH_PLATFORM_USER_REPOSITORY,
  BYMAX_AUTH_REDIS_CLIENT,
  BYMAX_AUTH_USER_REPOSITORY,
  HibpBreachChecker,
} from '@bymax-one/nest-auth';
import type {
  BymaxAuthModuleOptions,
  IEmailProvider,
  IPasswordBreachChecker,
  ResolvedOptions,
} from '@bymax-one/nest-auth';
import { Redis } from 'ioredis';

import { PrismaModule } from '../prisma/prisma.module.js';
import type { Env } from '../config/env.schema.js';
import { buildAuthOptions } from './auth.config.js';
import { AppAuthHooks } from './app-auth.hooks.js';
import { MailpitEmailProvider } from './mailpit-email.provider.js';
import { MailpitDefaultEmailProvider } from './default-email.provider.js';
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
 * @returns `ResendEmailProvider` when `EMAIL_PROVIDER=resend`;
 *   `MailpitDefaultEmailProvider` (the library's `DefaultAuthEmailProvider`
 *   over a Mailpit SMTP sink) when `EMAIL_PROVIDER=mailpit-default`;
 *   otherwise `MailpitEmailProvider`.
 */
function chooseEmailProviderClass(): Type<IEmailProvider> {
  const provider = (process.env['EMAIL_PROVIDER'] ?? 'mailpit').toLowerCase();
  if (provider === 'resend') return ResendEmailProvider;
  if (provider === 'mailpit-default') return MailpitDefaultEmailProvider;
  return MailpitEmailProvider;
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
 * Provider for `BYMAX_AUTH_BREACH_CHECKER`, selected from validated config.
 *
 * The token is bound unconditionally so the choice can come from an injected
 * `ConfigService<Env, true>` rather than a raw `process.env` read at module
 * decoration time — the library only skips its own default when the consumer
 * supplies this token, so an "only bind sometimes" shape would force the
 * decision back outside the schema lifecycle.
 *
 * - `hibp` — `HibpBreachChecker` (k-anonymity Have I Been Pwned range queries,
 *   fails open).
 * - `off` — `AllowAllBreachChecker`, every password passes. For e2e suites with
 *   fixed fixtures; the schema refuses it in production.
 * - `common` (default) — `CommonPasswordChecker`, the same class the library
 *   would have bound, constructed with the module options so the configured
 *   `password.blocklist` still applies.
 */
const breachCheckerProvider = {
  provide: BYMAX_AUTH_BREACH_CHECKER,
  inject: [ConfigService, BYMAX_AUTH_OPTIONS],
  useFactory: (
    config: ConfigService<Env, true>,
    options: ResolvedOptions,
  ): IPasswordBreachChecker => {
    const mode = config.getOrThrow<string>('PASSWORD_BREACH_CHECKER');
    if (mode === 'hibp') return new HibpBreachChecker();
    if (mode === 'off') return new AllowAllBreachChecker();
    return new CommonPasswordChecker(options);
  },
};

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
      imports: [ConfigModule, PrismaModule],
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
        // FCM #13 — Session management: mounts /api/auth/sessions/* routes.
        sessions: true,
        // FCM #22 — Platform admin context: mounts /api/auth/platform/* routes.
        platform: true,
        // FCM #21 — Invitation flow: mounts /api/auth/invitations routes.
        invitations: true,
        // Two-step address change (lib v1.1.0+): mounts /api/auth/email/change
        // and /api/auth/email/change/confirm. Requires the bound email provider
        // to implement `sendEmailChangeVerification` — enforced at boot.
        emailChange: true,
      },
      extraProviders: [
        {
          provide: BYMAX_AUTH_REDIS_CLIENT,
          inject: [ConfigService],
          useFactory: (config: ConfigService<Env, true>): Redis => {
            const url = config.getOrThrow<string>('REDIS_URL');
            return new Redis(url, {
              lazyConnect: true,
              maxRetriesPerRequest: null,
              retryStrategy: (times: number) => Math.min(times * 200, 2_000),
            });
          },
        },
        { provide: BYMAX_AUTH_USER_REPOSITORY, useClass: PrismaUserRepository },
        { provide: BYMAX_AUTH_PLATFORM_USER_REPOSITORY, useClass: PrismaPlatformUserRepository },
        { provide: BYMAX_AUTH_EMAIL_PROVIDER, useClass: EmailProviderClass },
        { provide: BYMAX_AUTH_HOOKS, useClass: AppAuthHooks },
        // Breach checker, chosen from validated config — see the provider above.
        breachCheckerProvider,
      ],
    }),
  ],
  exports: [BymaxAuthModule],
})
export class AuthModule {}
