# Redis key namespaces & TTLs

Every Redis key produced by `@bymax-one/nest-auth` and this app, with its purpose, type, time-to-live, and owner. Expands [OVERVIEW §11](./OVERVIEW.md) with a TTL column and corrects it against the live keyspace and the library source.

> The tables below were verified two ways: by reading the library's key builder (`AuthRedisService` in `@bymax-one/nest-auth`) and by scanning the running dev Redis (`docker exec … redis-cli --scan`). TTLs are **sourced from code** — the values come from [`auth.config.ts`](../apps/api/src/auth/auth.config.ts).

---

## Namespace rationale

The library prefixes **every** key it owns with `{redisNamespace}:`. This example sets `redisNamespace: 'nest-auth-example'` in [`auth.config.ts`](../apps/api/src/auth/auth.config.ts) (overridable via `REDIS_NAMESPACE`) so multiple projects can share one Redis instance without colliding. The prefix is applied centrally in `AuthRedisService.prefix()`:

```ts
private prefix(key: string): string {
  return `${this.namespace}:${key}`; // e.g. 'rt:abc' → 'nest-auth-example:rt:abc'
}
```

App-owned keys (if any) must live under `nest-auth-example:app:*`. Any key outside these prefixes is a bug (see [AGENTS.md §Critical rule 9](../AGENTS.md)).

---

## Library keys (namespaced)

All prefixed with `nest-auth-example:`. TTL "source" links the config value the library applies.

| Pattern (after prefix)       | Purpose                                         | Type   | TTL (source)                                                    | Owner   |
| ---------------------------- | ----------------------------------------------- | ------ | --------------------------------------------------------------- | ------- |
| `sess:{userId}`              | SET of a user's active session members          | set    | ~7 days (`jwt.refreshExpiresInDays: 7`)                         | Library |
| `sd:{sessionHash}`           | Session detail (device, IP, timestamp)          | string | ~7 days (refresh lifetime)                                      | Library |
| `rt:{sha256(refreshToken)}`  | **Dashboard** (tenant) refresh token            | string | ~7 days (refresh lifetime)                                      | Library |
| `prt:{sha256(refreshToken)}` | **Platform-admin** refresh token                | string | ~7 days (refresh lifetime)                                      | Library |
| `rp:{…}` / `prp:{…}`         | Refresh rotation pointer (old→new during grace) | string | ~30 s (`jwt.refreshGraceWindowSeconds: 30`)                     | Library |
| `lf:{sha256(tenant+email)}`  | Brute-force login-failure counter               | string | 15 min (`bruteForce.windowSeconds: 900`)                        | Library |
| `otp:{purpose}:{identifier}` | OTPs — email verification & password reset      | string | 10 min (`emailVerification`/`passwordReset.otpTtlSeconds: 600`) | Library |
| `os:{state}`                 | OAuth `state` nonce (CSRF protection)           | string | ~10 min (OAuth flow window)                                     | Library |
| `inv:{sha256(token)}`        | Invitation token                                | string | 48 h (`invitations.tokenTtlSeconds: 172800`)                    | Library |

Live scan confirmed `sess`/`sd`/`rt`/`prt` at ~7-day TTLs and `inv` at ~48 h. The session SET stores its members as key **suffixes** (`rt:{hash}`, `prt:{hash}`); the library reconstructs the full namespaced key when invalidating a user's sessions.

## The one un-namespaced key: `rv:{jti}`

| Pattern    | Purpose                           | Type   | TTL                                   | Owner   |
| ---------- | --------------------------------- | ------ | ------------------------------------- | ------- |
| `rv:{jti}` | Access-token revocation blacklist | string | Remaining access-token life (≤15 min) | Library |

`rv:{jti}` is written and read through the **raw** ioredis client, not `AuthRedisService` — so it carries **no namespace prefix**. This is deliberate: every guard context (HTTP `JwtAuthGuard`, `JwtPlatformGuard`, and the WebSocket gateway) checks it via the raw client without needing to know the namespace. It is set on logout/suspension with the token's remaining TTL (the library's `auth.service.ts`; the app mirrors the check in [`notifications.gateway.ts`](../apps/api/src/notifications/notifications.gateway.ts)).

## App-owned keys

The `nest-auth-example:app:*` namespace is **reserved** for this app but currently **unused**: the WebSocket notification fan-out keeps its `userId → sockets` registry **in memory** in [`NotificationsGateway`](../apps/api/src/notifications/notifications.gateway.ts), not in Redis. (OVERVIEW §11 lists an `app:notify:{userId}` key; that is aspirational — no such key exists today.)

---

## Inspecting keys

```bash
# Count keys
docker exec nest-auth-example-redis-1 redis-cli DBSIZE

# List all library keys (SCAN, never KEYS — KEYS blocks the event loop)
docker exec nest-auth-example-redis-1 redis-cli --scan --pattern 'nest-auth-example:*' | head

# Inspect one key's type and remaining TTL
docker exec nest-auth-example-redis-1 redis-cli TYPE 'nest-auth-example:rt:<hash>'
docker exec nest-auth-example-redis-1 redis-cli TTL  'nest-auth-example:rt:<hash>'

# See a user's active sessions
docker exec nest-auth-example-redis-1 redis-cli SMEMBERS 'nest-auth-example:sess:<userId>'

# Revocation entries are un-namespaced
docker exec nest-auth-example-redis-1 redis-cli --scan --pattern 'rv:*' | head
```

---

## Persistence & durability

- **Production:** run Redis with `appendonly yes` so the keyspace survives restarts.
- Losing Redis forces every user to re-authenticate (sessions, refresh tokens, and the revocation list are gone) but causes **no durable data loss** — that lives in Postgres.
- Every key the library sets has a TTL, so an eviction policy of `volatile-lru` is safe; without TTLs it could not evict. See [deployment → Redis persistence](./DEPLOYMENT.md#redis-persistence).

## Flushing safely in development

```bash
# Wipes the dev keyspace — logs EVERY user out. Never run against prod.
docker exec nest-auth-example-redis-1 redis-cli FLUSHDB
```

`FLUSHDB` clears sessions, refresh tokens, OTPs, brute-force counters, and the revocation list. Use it to reset local auth state; never point it at a shared or production instance.

---

## Further reading

- [Features](./FEATURES.md) — session limit & FIFO eviction (#14) and brute-force protection (#16) that produce `sess:`/`sd:` and `lf:` keys.
- [Deployment](./DEPLOYMENT.md) — Redis persistence and eviction in production.
- [Environment](./ENVIRONMENT.md) — `REDIS_URL` and `REDIS_NAMESPACE`.
- [`auth.config.ts`](../apps/api/src/auth/auth.config.ts) — the source of every TTL above.
