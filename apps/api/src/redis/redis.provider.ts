/**
 * @file redis.provider.ts
 * @description Factory provider that creates the shared `ioredis` client.
 *
 * The provider token is `BYMAX_AUTH_REDIS_CLIENT` — the exact token exported
 * by `@bymax-one/nest-auth`. A mismatched token silently breaks session
 * storage, brute-force counters, OTPs, and JWT revocation lists at runtime.
 *
 * Connection options:
 * - `lazyConnect: true` — avoids a hard start-up failure when Redis is
 *   temporarily unreachable; the health endpoint surfaces the outage instead.
 * - `maxRetriesPerRequest: null` — required for blocking-command consumers
 *   (e.g. `BRPOP`) elsewhere in the process.
 * - Exponential back-off retry strategy capped at 2 s.
 *
 * @layer infrastructure
 * @see redis.module.ts
 * @see docs/guidelines/redis-guidelines.md
 */

import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { BYMAX_AUTH_REDIS_CLIENT } from '@bymax-one/nest-auth';

import type { Env } from '../config/env.schema.js';

/**
 * NestJS provider that creates the shared `ioredis` client under the
 * `BYMAX_AUTH_REDIS_CLIENT` injection token.
 *
 * Registered and exported by `RedisModule`.
 *
 * @public
 */
export const redisProvider: Provider = {
  provide: BYMAX_AUTH_REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): Redis => {
    const url = config.getOrThrow<string>('REDIS_URL');

    return new Redis(url, {
      lazyConnect: true,
      // Required for blocking commands (BL* family); without this, ioredis
      // queues commands indefinitely instead of failing fast on disconnect.
      maxRetriesPerRequest: null,
      retryStrategy: (times: number) => Math.min(times * 200, 2_000),
    });
  },
};
