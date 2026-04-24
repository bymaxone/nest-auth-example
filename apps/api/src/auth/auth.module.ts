/**
 * @file auth.module.ts
 * @description Phase 6 stub module that registers all `@bymax-one/nest-auth`
 * implementation classes as NestJS providers.
 *
 * Phase 7 replaces this file with a full `BymaxAuthModule.registerAsync(...)` call
 * that binds each class to its library injection token
 * (`BYMAX_AUTH_USER_REPOSITORY`, `BYMAX_AUTH_EMAIL_PROVIDER`, etc.).
 *
 * Email provider selection:
 * Provider class selection happens at module decoration time because the DI
 * container is not yet available at that stage. This is a recognised NestJS pattern
 * when conditional provider registration cannot use `registerAsync` — the env var
 * is read via `process.env` once at startup and is validated by the Zod schema
 * before any request is processed.
 *
 * @layer auth
 * @see docs/guidelines/nest-auth-guidelines.md
 * @see docs/DEVELOPMENT_PLAN.md §Phase 6.6
 */

import { Module } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import type { IEmailProvider } from '@bymax-one/nest-auth';

import { PrismaModule } from '../prisma/prisma.module.js';
import { AppAuthHooks } from './app-auth.hooks.js';
import { MailpitEmailProvider } from './mailpit-email.provider.js';
import { PrismaUserRepository } from './prisma-user.repository.js';
import { PrismaPlatformUserRepository } from './prisma-platform-user.repository.js';
import { ResendEmailProvider } from './resend-email.provider.js';

/**
 * Selects the email provider implementation class based on `EMAIL_PROVIDER`.
 *
 * Called once at module decoration time (before DI container initialisation).
 * `process.env` is the only available source of config at this stage — an accepted
 * exception to the "no direct process.env" rule documented in AGENTS.md §Critical Rules.
 *
 * @returns The email provider class to be instantiated via NestJS DI.
 */
function resolveEmailProviderClass(): Type<IEmailProvider> {
  return (process.env['EMAIL_PROVIDER'] ?? 'mailpit') === 'resend'
    ? ResendEmailProvider
    : MailpitEmailProvider;
}

const EmailProviderClass = resolveEmailProviderClass();

/**
 * Phase 6 stub module — provides all auth implementation classes.
 *
 * Does not yet call `BymaxAuthModule.registerAsync()`. Phase 7 will extend
 * this module to register the library module with proper injection tokens.
 *
 * Exports all implementations so they can be injected by feature modules during
 * development before Phase 7 wires the full library module.
 *
 * @public
 */
@Module({
  imports: [PrismaModule],
  providers: [
    PrismaUserRepository,
    PrismaPlatformUserRepository,
    AppAuthHooks,
    // Phase 6 stub: registered by class token so NestJS resolves constructor deps.
    // Phase 7 replaces this entry with BymaxAuthModule.registerAsync() using the
    // library's BYMAX_AUTH_EMAIL_PROVIDER injection token — do NOT add a second
    // provider under that token here or the class will be instantiated twice.
    EmailProviderClass,
  ],
  exports: [PrismaUserRepository, PrismaPlatformUserRepository, AppAuthHooks, EmailProviderClass],
})
export class AuthModule {}
