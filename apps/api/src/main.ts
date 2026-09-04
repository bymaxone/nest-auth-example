/**
 * @file main.ts
 * @description NestJS 11 application entry point for `@nest-auth-example/api`.
 *
 * Wires the Express 5 adapter, structured Pino logging, security headers (Helmet),
 * CORS (single allowed origin via WEB_ORIGIN), cookie-parser (required for HttpOnly
 * cookie delivery by @bymax-one/nest-auth), the `/api` global prefix, a global
 * validation pipe built with the library's `createAuthValidationPipe`, and
 * graceful shutdown hooks.
 *
 * @layer bootstrap
 */

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { type LoggerService } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { Application } from 'express';
import { WsAdapter } from '@nestjs/platform-ws';
import { ConfigService } from '@nestjs/config';
import { createAuthValidationPipe } from '@bymax-one/nest-auth';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module.js';
import { AuthExceptionFilter } from './auth/auth-exception.filter.js';
import type { Env } from './config/env.schema.js';

/**
 * Strips the NestJS `LegacyRouteConverter` warning that fires twice on boot
 * because the Express 5 adapter normalizes the `/api/*` global-prefix mount
 * through `path-to-regexp@^8`. The adapter auto-converts `*` → `*path`, so the
 * warning is cosmetic and obscures real boot-time signal. Every other log line
 * (including warnings from other contexts) passes through untouched.
 */
class LegacyRouteWarningFilter implements LoggerService {
  constructor(private readonly inner: LoggerService) {}
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.inner.log(message, ...optionalParams);
  }
  error(message: unknown, ...optionalParams: unknown[]): void {
    this.inner.error(message, ...optionalParams);
  }
  warn(message: unknown, ...optionalParams: unknown[]): void {
    if (optionalParams.includes('LegacyRouteConverter')) return;
    this.inner.warn(message, ...optionalParams);
  }
  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.inner.debug?.(message, ...optionalParams);
  }
  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.inner.verbose?.(message, ...optionalParams);
  }
  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.inner.fatal?.(message, ...optionalParams);
  }
  setLogLevels?(levels: Parameters<NonNullable<LoggerService['setLogLevels']>>[0]): void {
    this.inner.setLogLevels?.(levels);
  }
}

/**
 * Narrows the HTTP adapter's underlying instance to an Express application.
 *
 * `getInstance()` is untyped, so this guard is what lets `trust proxy` be set
 * without an unchecked cast.
 *
 * @param value - The adapter instance returned by Nest.
 * @returns True when the instance exposes Express's `set` settings API.
 */
function isExpressApplication(value: unknown): value is Application {
  // An Express application is a callable request handler with methods hung off
  // it, so `typeof` is 'function', not 'object'. Checking only for 'object'
  // rejects the real adapter and aborts the boot.
  const isObjectLike = typeof value === 'function' || (typeof value === 'object' && value !== null);
  return isObjectLike && typeof (value as Application).set === 'function';
}

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
  // Wrap pino with a filter that drops the cosmetic LegacyRouteConverter
  // warning emitted by NestJS 11 + Express 5's path-to-regexp v8 upgrade.
  const pinoLogger = app.get(Logger);
  app.useLogger(new LegacyRouteWarningFilter(pinoLogger));
  app.flushLogs();

  // Switch to the plain WebSocket adapter (ws library) so the notifications
  // gateway can be connected to with standard WebSocket clients.
  // Must be set before app.listen() so the adapter is in place when the gateway binds.
  app.useWebSocketAdapter(new WsAdapter(app));

  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Tell Express how many proxies sit in front of us, so `req.ip` is the real
  // client rather than the nearest hop. The auth rate limiter keys on this:
  // the library's `clientIpSource` is derived from the SAME env var in
  // auth.config.ts precisely so the two can never disagree. A count that is
  // too low charges every browser to the proxy's address and lets one user's
  // failed logins lock out everybody; too high lets a client prepend a forged
  // `X-Forwarded-For` entry and impersonate any address. Zero means the API is
  // reached directly and no forwarded header is trusted at all.
  const trustedProxyHops = Number(config.get('TRUSTED_PROXY_HOPS') ?? 0);
  const httpInstance: unknown = app.getHttpAdapter().getInstance();
  if (!isExpressApplication(httpInstance)) {
    // `trust proxy` is a security control, not a nicety: without it the rate
    // limiter reads an untrusted forwarded chain. Refuse to boot rather than
    // start with it silently unset.
    throw new Error('Expected an Express HTTP adapter to configure `trust proxy`');
  }
  httpInstance.set('trust proxy', trustedProxyHops);

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

  // A plain global `new ValidationPipe(...)` would SHADOW the library's own
  // pipe on /api/auth/* routes and answer DTO failures with Nest's default
  // envelope instead of the `auth.validation` shape clients rely on
  // (documented hazard since lib v1.4.3). `createAuthValidationPipe` is a
  // drop-in factory that keeps the same class-validator options while
  // emitting the library's error envelope everywhere.
  app.useGlobalPipes(
    createAuthValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Answers every failure in the library envelope, `{ error: { code, message,
  // details } }` — the shape `createAuthClient` parses, so the frontend error
  // map (apps/web/lib/auth-errors.ts) reads a code rather than falling back to
  // its generic sentence. Must be registered before the app starts listening.
  //
  // The configured secrets are handed over so the filter can strip them from an
  // unhandled driver error's own message before logging it; Pino's redact paths
  // match structured fields and never reach an interpolated string. `filter`
  // drops the ones this deployment has not set.
  const loggableSecrets = [
    config.get<string>('DATABASE_URL'),
    config.get<string>('REDIS_URL'),
    config.get<string>('JWT_SECRET'),
    config.get<string>('MFA_ENCRYPTION_KEY'),
    config.get<string>('RESEND_API_KEY'),
    config.get<string>('OAUTH_GOOGLE_CLIENT_SECRET'),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  app.useGlobalFilters(new AuthExceptionFilter(loggableSecrets));

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
