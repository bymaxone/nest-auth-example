/**
 * @file app.module.ts
 * @description Root NestJS module for `@nest-auth-example/api`.
 *
 * Phase 3 skeleton: mounts only structured Pino logging and the health-check module.
 * Subsequent phases layer in ConfigModule (Phase 5), PrismaModule (Phase 5),
 * RedisModule (Phase 5), and BymaxAuthModule (Phase 7) without rewriting this shape.
 *
 * @layer root
 */

import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { HealthModule } from './health/health.module.js';

/**
 * Application root module.
 *
 * TODO(phase-5): Replace direct process.env reads below with ConfigService<Env, true>
 * once ConfigModule with the Zod env schema is registered globally.
 *
 * @public
 */
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        // TODO(phase-5): read via ConfigService to enforce Pino level enum.
        level: process.env['LOG_LEVEL'] ?? 'info',
        // Guard strictly on 'development' so that unset NODE_ENV in a production
        // image does not attempt to load pino-pretty (a devDependency only).
        ...(process.env['NODE_ENV'] === 'development'
          ? { transport: { target: 'pino-pretty' } }
          : {}),
      },
    }),
    HealthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
