/**
 * @file config.module.ts
 * @description Global NestJS configuration module wrapping `@nestjs/config`.
 *
 * Imports `ConfigModule.forRoot` with Zod validation so the application refuses
 * to start when any required environment variable is missing or malformed.
 *
 * Import once in `AppModule`; `ConfigService<Env, true>` is available globally
 * because `isGlobal: true` is set.
 *
 * @layer config
 * @see env.schema.ts for the full variable registry.
 * @see docs/guidelines/environment-guidelines.md
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { envSchema, type Env } from './env.schema.js';

/**
 * Validates the raw environment object against the Zod schema.
 *
 * Called by `ConfigModule.forRoot` at bootstrap. Throws a descriptive error
 * listing every violation so operators can fix all problems in a single restart.
 *
 * @param raw - The untyped `process.env`-derived record.
 * @returns A fully-typed, validated `Env` object.
 * @throws `Error` when any validation constraint is violated.
 */
function zodValidate(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`[Config] Invalid environment variables:\n${messages}`);
  }
  return result.data;
}

/**
 * Application-level configuration module.
 *
 * Wraps `@nestjs/config`'s `ConfigModule.forRoot` with Zod validation.
 * `isGlobal: true` makes `ConfigService<Env, true>` injectable throughout
 * the application without re-importing this module.
 *
 * @public
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: zodValidate,
    }),
  ],
})
export class AppConfigModule {}
