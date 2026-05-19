/**
 * @file config.module.ts
 * @description Global NestJS configuration module wrapping `@nestjs/config`.
 *
 * Deliberately omits `validate` from `ConfigModule.forRoot` so that
 * `ConfigService.get()` reads from live `process.env` at call-time instead of
 * from a snapshot captured at class-decoration time (when module imports are
 * evaluated by the JS engine, before test files can set their env vars).
 *
 * Startup validation is handled by `envValidationProvider`, a factory provider
 * that runs during `compile()` after test files have populated `process.env`.
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

import { envSchema } from './env.schema.js';

/**
 * NestJS injection token that ensures env validation runs at module-init time.
 *
 * @internal
 */
const APP_ENV_VALID = 'APP_ENV_VALID';

/**
 * Factory provider that validates `process.env` via the Zod schema during
 * NestJS module initialization (`compile()`), and writes Zod-coerced values
 * (including schema defaults) back to `process.env`.
 *
 * Running validation here (rather than via `ConfigModule.forRoot.validate`)
 * ensures that e2e test files can override env vars in their module body before
 * `compile()` is called, while still aborting the app on invalid config.
 *
 * Writing defaults back makes them available via `ConfigService.get()` even for
 * vars not explicitly present in the environment file (e.g. `SMTP_FROM` which
 * has a schema default but is often absent in test environments).
 */
const envValidationProvider = {
  provide: APP_ENV_VALID,
  useFactory: (): void => {
    const result = envSchema.safeParse(process.env as Record<string, unknown>);
    if (!result.success) {
      const messages = result.error.issues
        .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n');
      throw new Error(`[Config] Invalid environment variables:\n${messages}`);
    }
    // Write Zod-coerced values and schema defaults back to process.env so that
    // ConfigService.get() can return the correct value for vars that have schema
    // defaults but were not explicitly set in the environment (e.g. SMTP_FROM).
    for (const [key, value] of Object.entries(result.data)) {
      if (process.env[key] === undefined && value !== undefined) {
        process.env[key] = String(value);
      }
    }
  },
};

/**
 * Application-level configuration module.
 *
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
      // In test mode skip the .env file so local-dev values (e.g. wrong
      // REDIS_URL / DATABASE_URL) do not override the test-file env vars.
      // NODE_ENV is set to 'test' by Jest before any module is evaluated.
      ignoreEnvFile: process.env['NODE_ENV'] === 'test',
    }),
  ],
  providers: [envValidationProvider],
})
export class AppConfigModule {}
