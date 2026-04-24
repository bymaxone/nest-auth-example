/**
 * @file redis.module.ts
 * @description Global NestJS module that provides the `ioredis` client.
 *
 * Marked `@Global()` so every feature module can inject the client via
 * `BYMAX_AUTH_REDIS_CLIENT` without re-importing `RedisModule`.
 *
 * On `onApplicationShutdown`, the module calls `redis.quit()` to flush
 * pending commands and close the TCP socket before the process exits.
 *
 * @layer infrastructure
 * @see redis.provider.ts
 * @see docs/guidelines/redis-guidelines.md
 */

import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { BYMAX_AUTH_REDIS_CLIENT } from '@bymax-one/nest-auth';

import { redisProvider } from './redis.provider.js';

/**
 * Application-wide Redis module.
 *
 * Exposes a single `ioredis` client under `BYMAX_AUTH_REDIS_CLIENT` to the
 * NestJS DI container. The `@Global()` decorator removes the need to add
 * `RedisModule` to the imports array of every feature module.
 *
 * @public
 */
@Global()
@Module({
  providers: [redisProvider],
  exports: [BYMAX_AUTH_REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(
    @Inject(BYMAX_AUTH_REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  /**
   * Gracefully closes the Redis connection on application shutdown.
   *
   * Calls `QUIT` so the server flushes any in-flight commands before
   * closing the socket, preventing `Error: Connection is closed` on restart.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
