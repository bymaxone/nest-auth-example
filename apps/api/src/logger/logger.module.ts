/**
 * @file logger.module.ts
 * @description Pre-configured `nestjs-pino` logger module for `apps/api`.
 *
 * Wires structured Pino logging with:
 * - `LOG_LEVEL` from `ConfigService` (Zod-validated at startup).
 * - `pino-pretty` transport only when `NODE_ENV === 'development'`.
 * - `autoLogging.ignore` to suppress health-check noise from access logs.
 * - Redaction of common secret paths (Authorization, Cookie, passwords, tokens).
 * - A custom `req` serializer that replaces raw header values with the output
 *   of `sanitizeHeaders` from `@bymax-one/nest-auth`, ensuring no sensitive
 *   header is ever logged in cleartext.
 *
 * Import once in `AppModule`; the returned `DynamicModule` configures
 * `nestjs-pino` globally for the whole application.
 *
 * @layer infrastructure
 * @see docs/guidelines/logging-guidelines.md
 */

import type { IncomingMessage } from 'node:http';
import type { DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { sanitizeHeaders } from '@bymax-one/nest-auth';

import type { Env } from '../config/env.schema.js';

/**
 * Configured `nestjs-pino` dynamic module.
 *
 * Uses `ConfigService<Env, true>` (strict mode) to read `LOG_LEVEL` and
 * `NODE_ENV`. Imports `ConfigModule` explicitly so the factory can resolve
 * `ConfigService` even before global providers settle during bootstrap.
 *
 * @public
 */
export const AppLoggerModule: DynamicModule = PinoLoggerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => {
    const level = config.getOrThrow<string>('LOG_LEVEL');
    const isDev = config.getOrThrow('NODE_ENV') === 'development';

    return {
      pinoHttp: {
        level,
        // pino-pretty is a devDependency; never enable in production images.
        ...(isDev ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
        autoLogging: {
          // Suppress per-request access logs for the health probe to avoid
          // flooding log streams with orchestrator liveness checks.
          ignore: (req: IncomingMessage) => req.url === '/api/health',
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-api-key"]',
            'res.headers["set-cookie"]',
            '*.password',
            '*.passwordHash',
            '*.mfaSecret',
            '*.mfaRecoveryCodes',
            '*.token',
            '*.refreshToken',
            '*.accessToken',
            '*.otp',
          ],
          censor: '[REDACTED]',
        },
        serializers: {
          req: (req: {
            id: string;
            method: string;
            url: string;
            headers: Record<string, string | string[] | undefined>;
          }) => ({
            id: req.id,
            method: req.method,
            url: req.url,
            // Delegate header sanitization entirely to the library helper.
            // Never implement a local allowlist — it will drift.
            headers: sanitizeHeaders(req.headers),
          }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
        // Attach requestId and tenantId to every log line for cross-service tracing.
        // tenantId is a runtime property attached by the request pipeline from X-Tenant-Id.
        customProps: (req: IncomingMessage) => ({
          requestId: req.id,
          tenantId: (req as IncomingMessage & { tenantId?: string }).tenantId,
        }),
      },
    };
  },
});
