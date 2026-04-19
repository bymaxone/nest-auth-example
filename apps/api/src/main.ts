/**
 * @file main.ts
 * @description NestJS 11 application entry point for `@nest-auth-example/api`.
 *
 * Wires the Express 5 adapter, structured Pino logging, security headers (Helmet),
 * CORS (single allowed origin via WEB_ORIGIN), cookie-parser (required for HttpOnly
 * cookie delivery by @bymax-one/nest-auth), the `/api` global prefix, a global
 * ValidationPipe, and graceful shutdown hooks.
 *
 * @layer bootstrap
 */

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module.js';

/**
 * Validates that a port value is a usable integer in the range 1–65535.
 *
 * Uses `process.env.API_PORT` directly because ConfigService (Phase 5) is not
 * available yet at bootstrap time. Phase 5 migrates this to ConfigService with
 * a Zod coerce.number().int().min(1).max(65535) refinement.
 *
 * @returns A validated port number; throws on invalid input to prevent silent misrouting.
 */
function resolvePort(): number {
  const raw = process.env['API_PORT'] ?? '4000';
  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid API_PORT "${raw}": must be an integer in the range 1–65535`);
  }

  return port;
}

/**
 * Bootstrap the NestJS application.
 *
 * Phase 3 reads WEB_ORIGIN and API_PORT directly from process.env.
 * TODO(phase-5): migrate both to ConfigService<Env, true> once ConfigModule
 * with the Zod env schema is in place.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(), {
    bufferLogs: true,
  });

  // Hand the logger to Nest and flush logs buffered before pino was ready.
  const pinoLogger = app.get(Logger);
  app.useLogger(pinoLogger);
  app.flushLogs();

  // Helmet sets secure response headers (X-Content-Type-Options, X-Frame-Options,
  // Strict-Transport-Security, Referrer-Policy, etc.) before any route responds.
  app.use(helmet());

  // CORS is restricted to the single WEB_ORIGIN; credentials are required for
  // the HttpOnly cookie-based token delivery used by @bymax-one/nest-auth.
  // Phase 12 adds the Next.js proxy layer on top; the API keeps its own CORS
  // guard regardless so it is safe when called directly.
  const webOrigin = process.env['WEB_ORIGIN'];
  app.enableCors({
    origin: webOrigin ?? false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableShutdownHooks();

  const port = resolvePort();
  await app.listen(port);
  pinoLogger.log(`API listening on :${port}`, 'Bootstrap');
}

void bootstrap();
