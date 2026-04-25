/**
 * @file notifications.module.ts
 * @description NestJS module for the WebSocket notifications gateway and the
 * dev-only push trigger controller.
 *
 * The `NotificationsController` is included in the `controllers` array ONLY when
 * `NODE_ENV !== 'production'`, so no debug routes are ever mounted in production.
 *
 * `JwtModule.registerAsync` is configured with the same `JWT_SECRET` as the auth
 * module so the `NotificationsGateway` can verify access tokens in `handleConnection`
 * without depending on the library's private `JwtService`.
 *
 * `AuthModule` is imported to make `WsJwtGuard` (and all its library dependencies)
 * available in this module's DI container, enabling `@UseGuards(WsJwtGuard)` on
 * the gateway class.
 *
 * `NotificationsGateway` is exported so `UsersModule` and `PlatformModule` can
 * inject it for status-change disconnect propagation.
 *
 * @layer notifications
 * @see docs/DEVELOPMENT_PLAN.md §Phase 10 P10-1, P10-2
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import type { Env } from '../config/env.schema.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { NotificationsGateway } from './notifications.gateway.js';
import { NotificationsController } from './notifications.controller.js';

/**
 * Whether to register the dev-only push controller.
 *
 * Evaluated once at module decoration time so the `controllers` array is fixed
 * before the DI container initialises. `process.env` direct read is the only
 * option here because `@Module()` metadata must be synchronous.
 */
const DEV_CONTROLLERS = process.env['NODE_ENV'] !== 'production' ? [NotificationsController] : [];

/**
 * Notifications module.
 *
 * @public
 */
@Module({
  imports: [
    // AuthModule re-exports BymaxAuthModule, making WsJwtGuard available for DI.
    AuthModule,
    ConfigModule,
    PrismaModule,
    // Independent JwtModule registration so the gateway can verify JWTs in
    // handleConnection without relying on a library-internal JwtService.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.getOrThrow('JWT_SECRET'),
        signOptions: { algorithm: 'HS256' },
      }),
      inject: [ConfigService],
    }),
  ],
  // NotificationsController is only added outside of production builds.
  controllers: [...DEV_CONTROLLERS],
  providers: [NotificationsGateway],
  exports: [NotificationsGateway],
})
export class NotificationsModule {}
