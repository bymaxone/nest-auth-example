# Observability Guidelines

Structured logs + audit rows + health endpoints. No metrics/tracing stack in the reference scope; hooks exist for when you add one.

- **Logs**: Pino (see [logging-guidelines.md](logging-guidelines.md))
- **Audit**: `audit_logs` table, written via `AppAuthHooks` (`IAuthHooks`)
- **Health**: `/health` on the API (DB + Redis + library readiness), `/api/health` on web (liveness)
- **Future hooks**: OpenTelemetry spans, Prometheus metrics, Sentry — none wired today

---

## When to read this

Before writing a log, adding an audit row, adding a metric, wiring a tracer, or tweaking `/health`.

---

## Three layers, three purposes

| Layer                | Lives in           | Retention | Consumer                         |
| -------------------- | ------------------ | --------- | -------------------------------- |
| **Logs**             | stdout / log sink  | 7–30 days | Engineers during incident triage |
| **Audit**            | `audit_logs` table | years     | Compliance, forensic review      |
| **Metrics** (future) | Prometheus / APM   | 90 days   | Dashboards, alerts               |

Do not conflate. An "audit event" that only lives in logs is compliance debt. A "log line" written to `audit_logs` bloats the table and slows queries.

---

## Logs

Full rules in [logging-guidelines.md](logging-guidelines.md). Key invariants for observability:

- Every log has a `requestId`. Propagate via `X-Request-Id` (middleware in `apps/api` adds it if absent).
- Every authenticated log has a `tenantId`. The pino `customProps` pull it from `req.tenantId` (set by the library's tenant resolver interceptor).
- Log **events**, not implementation detail: `auth.login.ok`, not `"AuthService.login() returned true"`.
- Level hygiene: `info` for business milestones, `warn` for recoverable misbehavior, `error` for unexpected failures.

---

## Audit (IAuthHooks)

`AppAuthHooks` writes to `audit_logs` for every lifecycle event the library emits:

| Hook                              | Event                           | Required fields                                 |
| --------------------------------- | ------------------------------- | ----------------------------------------------- |
| `onUserCreated`                   | `USER_CREATED`                  | `tenantId`, `actorId=userId`, `ip`, `userAgent` |
| `onLoginSuccess`                  | `AUTH_LOGIN_SUCCESS`            | `actorId`, `ip`, `userAgent`, `sessionId`       |
| `onLoginFailure`                  | `AUTH_LOGIN_FAILURE`            | `tenantId`, `email_sha256`, `ip`, `reason`      |
| `onMfaEnrolled` / `onMfaDisabled` | `MFA_ENROLLED` / `MFA_DISABLED` | `actorId`                                       |
| `onPasswordChanged`               | `PASSWORD_CHANGED`              | `actorId`, `ip`                                 |
| `onSessionRevoked`                | `SESSION_REVOKED`               | `actorId`, `sessionId`, `revokedBy`             |
| `onOAuthLinked`                   | `OAUTH_LINKED`                  | `actorId`, `provider`                           |
| `onInvitationAccepted`            | `INVITATION_ACCEPTED`           | `actorId`, `invitationId`                       |
| `onUserStatusChanged`             | `USER_STATUS_CHANGED`           | `actorId`, `prev`, `next`                       |

Schema (abbreviated):

```prisma
model AuditLog {
  id        String   @id @default(cuid())
  tenantId  String?
  type      String
  actorId   String?
  refId     String?
  ip        String?
  userAgent String?
  metadata  Json?
  createdAt DateTime @default(now())

  @@index([tenantId, createdAt(sort: Desc)])
  @@index([type, createdAt(sort: Desc)])
}
```

Rules:

- **Never store raw credentials, tokens, OTPs, or MFA secrets in `metadata`.** Pin to IDs, enums, and hashes (`email_sha256`).
- **`actorId` can be null** for pre-auth events (failed login by unknown email) — always set `tenantId` when available.
- **Hooks must not throw to the caller.** A DB outage on write degrades auditing, not auth. Catch, log `error.audit.write_failed`, move on.
- **No updates, no deletes** on `audit_logs` from application code. The table is append-only.

Access patterns:

- Last 7 days of tenant activity: `where: { tenantId, createdAt: { gte: sevenDaysAgo } }` with the `[tenantId, createdAt]` index.
- Incident forensics: filter by `type` + time range.
- Export: CSV dump via an admin-only endpoint, gated behind `platform` role.

---

## Health endpoints

### API (`/health`)

`@nestjs/terminus` is the canonical tool but adds a dep we don't otherwise need — roll our own for transparency:

```ts
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async check() {
    const [db, cache] = await Promise.all([
      this.ping('db', () => this.prisma.$queryRaw`SELECT 1`),
      this.ping('redis', () => this.redis.ping()),
    ]);
    const ok = db.ok && cache.ok;
    return ok ? { status: 'ok', db, cache } : { status: 'degraded', db, cache };
  }

  private async ping(name: string, fn: () => Promise<unknown>) {
    const started = Date.now();
    try {
      await fn();
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
    }
  }
}
```

- **Return 200 even in degraded mode** by default — platform health checks gate traffic, not reporting. Flip to 503 for load-balancer use by checking a feature flag.
- **`@Public()`** marks the route as unauthenticated. `autoLogging.ignore` suppresses per-request log spam.

### Web (`/api/health`)

One-liner returning `{ status: 'ok' }`. Useful for the platform's liveness probe.

---

## Tracing (when you add it)

Not wired today. Reserve the following if/when you do:

- **OpenTelemetry**. `@opentelemetry/sdk-node` in `apps/api`, `@opentelemetry/sdk-trace-web` in `apps/web`.
- **Trace ID** in every log line (`traceId`, `spanId`) — Pino + OTel integration covers this via `@opentelemetry/api-logs`.
- **Instrumentation**: HTTP server, Prisma, `ioredis`, Next.js — all ship official OTel plugins.
- **Sampling**: head-sample in dev (1%), tail-sample on errors in prod.

Document the rollout in a dedicated ADR when you commit.

---

## Metrics (when you add it)

Not wired today. Recommended surface:

- `http_request_duration_seconds` (histogram, labels: `route`, `method`, `status`).
- `auth_login_total` (counter, labels: `outcome` ∈ `success` | `invalid` | `locked` | `mfa_required`).
- `redis_command_errors_total`.
- `prisma_query_duration_seconds`.

Expose at `/metrics` on a separate port / behind basic auth. Never the same path tree as `/auth/*`.

---

## Error visibility

- Nest's default exception filter surfaces errors to clients with the right status code — no extra config needed.
- Unhandled exceptions from async handlers must bubble up; `Promise` rejections inside interceptors or handlers must be awaited.
- In `apps/web`, wrap auth flows' network calls in `try/catch` and surface via `toast.error` + error boundary.

---

## What to _not_ log

- `passwordHash`, `mfaSecret`, `mfaRecoveryCodes` — library never returns these to controllers; if they appear, you've leaked.
- OTP codes, reset tokens, JWT strings, refresh tokens.
- Raw request bodies (may contain any of the above).
- PII beyond what the audit table already intentionally stores.

Pino redaction paths (see [logging-guidelines.md](logging-guidelines.md)) are a safety net, not an excuse. Write careful logging calls first; redaction catches mistakes.

---

## Common pitfalls

1. **Audit rows missing because `IAuthHooks` throws.** Wrap writes, log the failure, let auth continue.
2. **Logs duplicating audit events.** Pick one system of record per event.
3. **`/health` behind the JWT guard** — load balancer probes fail, app is cycled incorrectly. Always `@Public()`.
4. **Health check hits every downstream service in sequence** — slow `/health` triggers killings. Parallelize.
5. **Tenant ID missing from logs** — impossible to scope forensics by tenant. Enforce via pino `customProps`.
6. **Logging user-controlled strings in the message** — bypasses field redaction. Put user data in a field, not the message.
7. **Using the logger inside `onApplicationShutdown`** — Nest tears down the logger before your hook. Use `process.stderr.write` as the last resort.

---

## References

- Pino: https://getpino.io
- `@nestjs/terminus` (optional): https://docs.nestjs.com/recipes/terminus
- OpenTelemetry (future): https://opentelemetry.io/docs/instrumentation/js/
- Library `IAuthHooks` contract: [nest-auth-guidelines.md](nest-auth-guidelines.md)
- Log rules: [logging-guidelines.md](logging-guidelines.md)
