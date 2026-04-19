# Logging Guidelines

Structured, shippable logs for `apps/api`. Frontend logs go through the browser console for dev and the host platform's built-in logs in prod — Pino rules below apply to the backend only.

- **Packages**: `nestjs-pino` `^4.6.x`, `pino` `^10.3.x`, `pino-http` `^11.0.x`
- **Official docs**: https://getpino.io and https://github.com/iamolegga/nestjs-pino

---

## When to read this

Before logging anything, before configuring `LoggerModule`, before shipping `pino` output anywhere (stdout, file, external sink), or when a PR review flags a `console.log`.

---

## Non-negotiables

1. **Never `console.log` / `console.warn` / `console.error` in app code.** Use the injected `Logger` (from `nestjs-pino`) or the Nest `Logger` helper wired to Pino.
2. **Every log is structured JSON.** Strings-only is not enough — downstream log search needs fields.
3. **Never log secrets, tokens, OTPs, passwords, MFA codes, or `passwordHash`.** The redaction list below is enforced at the Pino transport; calling code must still avoid inserting these into `msg` strings.
4. **Every request gets a `requestId`.** Propagate via `pino-http` → `X-Request-Id` header → downstream services.
5. **Audit events go through `IAuthHooks`** (persisted in `audit_logs`) — not the logger. Logs are ephemeral; audit rows are a compliance artifact.

---

## Wiring

```ts
// apps/api/src/app.module.ts
LoggerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => ({
    pinoHttp: {
      level: config.get('LOG_LEVEL') ?? 'info',
      transport:
        config.get('NODE_ENV') === 'development'
          ? { target: 'pino-pretty', options: { singleLine: true } }
          : undefined,
      autoLogging: {
        ignore: (req) => req.url === '/health' || req.url?.startsWith('/metrics') === true,
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'res.headers["set-cookie"]',
          '*.password',
          '*.passwordHash',
          '*.mfaSecret',
          '*.mfaRecoveryCodes',
          '*.token',
          '*.refreshToken',
          '*.accessToken',
          '*.otp',
        ],
        censor: '[REDACTED]',
      },
      customProps: (req) => ({
        requestId: req.id,
        tenantId: (req as { tenantId?: string }).tenantId,
      }),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    },
  }),
});
```

Main entry:

```ts
const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
```

- `bufferLogs` holds early logs until `useLogger` takes over. Without it, the first few lines use Nest's default console logger.
- `autoLogging.ignore` silences health probes to keep noise out of search.

---

## Log levels

| Level   | Meaning                                                       | Examples                                                      |
| ------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| `fatal` | Process must exit.                                            | Startup aborts, unrecoverable DB pool loss.                   |
| `error` | Unexpected failure impacting the request or a background job. | Unhandled exception, Redis circuit broken, hook write failed. |
| `warn`  | Recoverable misbehavior worth watching.                       | Slow Prisma query (>500 ms), retry needed, degraded mode.     |
| `info`  | Business milestones.                                          | App boot, module init, scheduled job run, webhook received.   |
| `debug` | Dev-only detail.                                              | Input/output of a branch, resolved tenant, cache hit/miss.    |
| `trace` | Very-dev. Off in all shared envs.                             | Frame-by-frame flow inside a single function.                 |

Prod defaults to `info`. Raise to `debug` only for a targeted investigation — never as a standing default.

---

## Calling the logger

```ts
@Injectable()
export class ProjectsService {
  constructor(
    @InjectPinoLogger(ProjectsService.name)
    private readonly logger: PinoLogger,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateProjectDto) {
    this.logger.info({ tenantId, userId, name: dto.name }, 'project.create');
    // ...
  }
}
```

Rules:

- **Structured payload first, message last**: `logger.info({ userId }, 'event.name')`.
- **Messages are canonical event names** in `scope.verb` form: `project.create`, `auth.login.mfa_required`, `email.send.failed`.
- Never interpolate user-controlled strings into the message — add them as fields instead.
- Log the **minimum shape**. A log line with 30 fields is harder to triage than one with five.

---

## Request context

`pino-http` creates a child logger per request and exposes it as `req.log`. In NestJS, `nestjs-pino` binds it to the `@InjectPinoLogger` instance automatically when `renameContext` is default.

- `requestId` (`X-Request-Id`) and `tenantId` are attached via `customProps`.
- Guards and interceptors that need per-request logging pull the logger from the request context:
  ```ts
  const req = context.switchToHttp().getRequest<Request>();
  req.log.warn({ roles }, 'auth.roles.rejected');
  ```

---

## Error logging

Always log **the error** and **the context**, never just a string:

```ts
try {
  await this.email.sendPasswordReset(user.email, token);
} catch (err) {
  this.logger.error({ err, userId: user.id }, 'email.password_reset.failed');
  throw new ServiceUnavailableException();
}
```

- Pass the original `err` — Pino's built-in `err` serializer extracts `name`, `message`, `stack`, `code`.
- Re-throw unless the caller genuinely can recover. Swallowing errors + logging hides incidents.
- In exception filters, log once at the filter, not at every layer the error passed through.

---

## Production transport

- Default: raw JSON to `stdout`. Let the host platform (Fly, Railway, ECS, k8s) ship it.
- `pino-pretty` is **dev-only**. It is not installed as a prod dependency.
- For dedicated sinks (Datadog, Elastic, Grafana Loki) use a Pino transport: `pino.transport({ targets: [...] })`. Document the transport config in `docs/DEPLOYMENT.md`.

---

## Testing

- Unit tests inject a Pino stub or use `silent: true` on a real `pino()`.
- Never assert on exact log lines — assert on the **count** of `logger.error` calls or on a structured field. Log wording is cosmetic and changes.
- E2E tests should not assert on logs at all; they assert on observable state (DB rows, HTTP responses, audit log rows).

---

## Common pitfalls

1. **`console.log` in a hot path** — Node buffers differently; interleaves with Pino; evades redaction. Fix at the source.
2. **Logging an entire request body** — DTOs often include secrets. Log only fields that are safe.
3. **Concatenating user input into the message** — ``logger.info(`login ${email}`)`` breaks log search and bypasses field-level redaction. Use `logger.info({ email }, 'auth.login')` and let redaction handle sensitive fields.
4. **`logger.info(err)`** — Pino logs an `Error` best when it's the `err` key: `logger.info({ err }, 'msg')`.
5. **Different `context`/`scope` names across the codebase** — stick to `ClassName` via `@InjectPinoLogger(Class.name)`.
6. **Redaction paths typos** — Pino silently does nothing if a path doesn't match. Add a test that logs a fake password and asserts `[REDACTED]`.
7. **`pino-pretty` in prod** — gigabytes of pretty-printed output that can't be parsed by log shippers.

---

## References

- Pino: https://getpino.io
- `nestjs-pino`: https://github.com/iamolegga/nestjs-pino
- Pino redaction: https://getpino.io/#/docs/redaction
- Audit vs logs: [observability-guidelines.md](observability-guidelines.md)
