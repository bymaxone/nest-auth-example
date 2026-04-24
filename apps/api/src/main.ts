/**
 * @file main.ts
 * @description NestJS 11 application entry point for `@nest-auth-example/api`.
 *
 * Wires the Express 5 adapter, structured Pino logging, security headers (Helmet),
 * CORS (single allowed origin via WEB_ORIGIN), cookie-parser (required for HttpOnly
 * cookie delivery by @bymax-one/nest-auth), the `/api` global prefix, a global
 * ValidationPipe, and graceful shutdown hooks.
 *
 * Phase 5: Migrates `API_PORT` and `WEB_ORIGIN` from `process.env.*` reads to
 * `ConfigService<Env, true>`, eliminating the risk of silent `undefined` values
 * that bypassed Zod validation.
 *
 * @layer bootstrap
 */

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module.js';
import { AuthExceptionFilter } from './auth/auth-exception.filter.js';
import type { Env } from './config/env.schema.js';

/**
 * Bootstrap the NestJS application.
 *
 * Reads `API_PORT` and `WEB_ORIGIN` from `ConfigService<Env, true>` after the
 * application module is created so the Zod-validated values are always used.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(), {
    bufferLogs: true,
  });

  // Hand the logger to Nest and flush logs buffered before pino was ready.
  const pinoLogger = app.get(Logger);
  app.useLogger(pinoLogger);
  app.flushLogs();

  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Helmet sets secure response headers (X-Content-Type-Options, X-Frame-Options,
  // Strict-Transport-Security, Referrer-Policy, etc.) before any route responds.
  app.use(helmet());

  // CORS is restricted to the single WEB_ORIGIN; credentials are required for
  // the HttpOnly cookie-based token delivery used by @bymax-one/nest-auth.
  const webOrigin = config.getOrThrow<string>('WEB_ORIGIN');
  app.enableCors({
    origin: webOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Tenant-Id', 'X-Request-Id'],
  });

  // cookie-parser must be registered before setGlobalPrefix so cookies are
  // parsed on every request path, including /api/auth/* routes.
  app.use(cookieParser());
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Maps every AuthException from @bymax-one/nest-auth to { code, message, statusCode }
  // so the frontend error-code map (apps/web/lib/auth-errors.ts) has a deterministic
  // response envelope. Must be registered before the app starts listening.
  app.useGlobalFilters(new AuthExceptionFilter());

  app.enableShutdownHooks();

  const port = config.getOrThrow<number>('API_PORT');

  await app.listen(port);
  pinoLogger.log(`API listening on :${port}`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  // Bootstrap-level crash — Pino is not yet initialised, so write only the
  // error message (never the full chain) to stderr to avoid accidentally
  // printing raw process.env values captured by some config loaders.
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[Bootstrap] Fatal startup error: ${message}\n`);
  process.exit(1);
});
