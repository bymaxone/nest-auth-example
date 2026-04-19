# Redis Guidelines

Session store, brute-force counters, OTPs, JWT revocation blacklist, and app-owned pub/sub.

- **Package**: `ioredis` `^5.10.x`
- **Server version**: Redis 7 (Alpine in dev)
- **Dev port**: `6379` (`127.0.0.1` bind only)
- **Config**: `docker/redis/redis.conf` (AOF on, volatile-LRU eviction, 256 MB)
- **Official docs**: https://redis.io/docs/ and https://ioredis.readthedocs.io

---

## When to read this

Before opening a Redis connection, designing a key, setting a TTL, publishing on a channel, or touching `docker/redis/redis.conf`.

---

## Ownership of keys

The library owns the `nest-auth-example:*` namespace (set via `redisNamespace` on `BymaxAuthModule.registerAsync`). Keys **we** add must live under a **different** prefix so the library's scans and deletions never collide:

| Owner    | Prefix                    | Examples                                                                  |
| -------- | ------------------------- | ------------------------------------------------------------------------- |
| Library  | `nest-auth-example:*`     | `…:sess:<userId>`, `…:lf:<hash>`, `…:rev:<jti>`, `…:otp:…`, `…:rt:<hash>` |
| This app | `nest-auth-example:app:*` | `…:app:notify:<userId>`, `…:app:lock:<resource>`                          |

Any key that is not under one of these prefixes is a bug. Scans must always be prefix-scoped.

---

## Connection

Single `ioredis` client per app process. Exposed as `RedisService` and injected everywhere.

```ts
// apps/api/src/redis/redis.service.ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(url: string) {
    super(url, {
      lazyConnect: false,
      enableAutoPipelining: true,
      maxRetriesPerRequest: 3,
      reconnectOnError: (err) => err.message.includes('READONLY'), // failover
    });
  }

  async onModuleDestroy() {
    await this.quit();
  }
}
```

- **Never** `new Redis()` outside `RedisService`. Multiple sockets per process waste file descriptors and silently drift in pub/sub channels.
- `enableAutoPipelining` batches round-trips — ~2× throughput for auth bursts.
- `maxRetriesPerRequest: 3` — above that, fail fast and let Nest's exception filter surface the outage.

The library wires the same instance to its own `IRedisClient` token:

```ts
BymaxAuthModule.registerAsync({
  useFactory: (redis: RedisService, config: ConfigService<Env, true>) => ({
    redis, // ← same client
    redisNamespace: config.getOrThrow('REDIS_NAMESPACE'),
    // ...
  }),
  inject: [RedisService, ConfigService],
});
```

---

## Key design

Rules that apply to every new key:

1. **Prefix with `nest-auth-example:app:`**. No exceptions for app-owned keys.
2. **Delimit with `:`** — `…:app:notify:<userId>`, never `…:app.notify.<userId>`.
3. **One concern per key**. Combining "unread count" + "latest message" into a hash is fine; combining "notifications" + "session metadata" is not.
4. **Lower-case keys**, IDs can keep their original casing (CUIDs are lower-case, UUIDs are either).
5. **No user-controlled input in a key** without `sha256` — prevents key injection when input contains `:` or `*`.

### TTLs are mandatory

`redis.conf` uses `volatile-lru`, which evicts only keys with a TTL. **A key without a TTL is a leak.**

```ts
await this.redis.set(`nest-auth-example:app:notify:${userId}`, json, 'EX', 300);
```

| Use                                | TTL                                   |
| ---------------------------------- | ------------------------------------- |
| Ephemeral notifications fan-out    | 5 min                                 |
| Idempotency keys                   | 24 h                                  |
| Locks                              | 30 s                                  |
| Long-lived cache (rare)            | ≤ 24 h                                |
| Sessions / brute-force / OTP / JWT | Library-managed — do not set manually |

---

## Commands and atomicity

- **`SET ... NX EX`** for locks — never `SET` followed by `EXPIRE` (two round trips, a crash between them leaks a non-expiring key).
- **`MULTI`/`EXEC`** for multi-key atomic updates.
- **Lua scripts** when a read-modify-write sequence must be atomic across keys — ioredis exposes `defineCommand` for named scripts.
- **Scans, not `KEYS`**: `KEYS *` blocks the event loop on large keyspaces. Always `SCAN` with `MATCH` and `COUNT`.

```ts
let cursor = '0';
do {
  const [next, keys] = await this.redis.scan(
    cursor,
    'MATCH',
    'nest-auth-example:app:notify:*',
    'COUNT',
    500,
  );
  await this.redis.del(...keys);
  cursor = next;
} while (cursor !== '0');
```

---

## Pub/Sub

App-owned channels only. Library does not use pub/sub.

- Channel names: `nest-auth-example:app:channel:<topic>` — same prefix rule.
- A subscriber uses a **separate** ioredis connection (ioredis forbids commands on a subscriber socket). Create a second `Redis` with `lazyConnect: true` inside the feature module, do not reuse `RedisService`.
- Unsubscribe in `OnModuleDestroy`. Leaked subscribers keep the app alive past SIGTERM.

---

## Testing

- Spin up an isolated Redis (`docker-compose.test.yml`, port `56379`) per test suite. Never point tests at `localhost:6379` — a test `FLUSHDB` wipes dev sessions.
- `afterAll`: `await redis.flushdb(); await redis.quit();`
- Library-owned behavior (session eviction, OTP expiry) is tested via the library's e2e suite — do not re-test those here.

---

## Operations in production

- Persistence: **AOF on**, `appendfsync everysec`. RDB off (the library tolerates cold sessions via re-login; trading durability for latency isn't worth it).
- Memory: `maxmemory 256mb` is a dev ceiling. Prod sizes scale with active session count × ~1 KB + brute-force counters. Observe `used_memory_dataset`.
- Eviction: `volatile-lru`. **Never** `allkeys-lru` in prod — it evicts the library's JWT revocation list and breaks security guarantees.
- Dangerous commands (`FLUSHALL`, `CONFIG`, `DEBUG`) are not renamed in dev config. Production config must rename or disable them; see the warning header in `docker/redis/redis.conf`.
- No `requirepass` in dev (container network is private). **Always** set `requirepass` (or use ACLs) in any shared environment.

---

## Common pitfalls

1. **Missing TTL** — key accumulates forever, eventually memory pressure hits and `volatile-lru` cannot free anything → OOM.
2. **`KEYS` in production code paths** — blocks the Redis event loop; affects every other client.
3. **Shared ioredis connection for pub/sub and commands** — ioredis throws on the second; the workaround of "silencing" the error is worse.
4. **Writing raw bytes without JSON framing** — future readers can't decode. Always `JSON.stringify` / `JSON.parse` a small schema.
5. **Trusting `INCR` for rate limiting without `EXPIRE`** — counter persists, first user after the window gets blocked. Use the library's rate limiter or a pipelined `MULTI { INCR, EXPIRE NX }`.
6. **Using app keys with the library's prefix** — breaks the library's scan-delete flows.
7. **`FLUSHDB` in a non-test environment** — nukes sessions. Gate destructive commands behind feature flags in ops scripts.

---

## References

- `ioredis` docs: https://ioredis.readthedocs.io
- Redis 7 commands: https://redis.io/commands/
- Data model playbook: https://redis.io/docs/data-types/
- Library wiring: [nest-auth-guidelines.md](nest-auth-guidelines.md)
