# Environment & Configuration Guidelines

How env vars are defined, validated, and consumed across `apps/api`, `apps/web`, and the Docker stack.

- **Schema location**: `apps/api/src/config/env.schema.ts` (Zod), `apps/web/lib/env.ts` (Zod)
- **Loader (api)**: `@nestjs/config` with `validate: (raw) => envSchema.parse(raw)`
- **Registry**: `docs/DEVELOPMENT_PLAN.md` Appendix A
- **Example files**: `.env.example` (root, full stack) + `apps/<name>/.env.example` (per-app CLI scripts)

---

## When to read this

Before adding, renaming, or removing an env var, tweaking `.env.example`, or changing how a secret is loaded at startup.

---

## Golden rules

1. **Every env var is validated with Zod at boot.** If a required var is missing or malformed, the app refuses to start.
2. **No direct `process.env.*` reads** in application code. All reads go through `ConfigService` (api) or `env` (web).
3. **Secrets never live in the repo.** `.env` is gitignored; `.env.example` carries shape + placeholder values only.
4. **Defaults live in code, not `.env.example`.** Listing `LOG_LEVEL=info` with a default is fine; listing `JWT_SECRET=changeme` is not.
5. **Two-level `.env.example` pattern**: the root `.env.example` is the complete reference for the full Docker Compose stack (all apps + infra). Each app workspace that runs CLI scripts outside NestJS (e.g., `apps/api` with `prisma.config.ts` and `seed.ts`) keeps its own `apps/<name>/.env.example` covering only the vars that those scripts load via `dotenv/config`. The root file is what a new developer copies first; the per-app file is what they reference when working in isolation on a single workspace.
6. **`NEXT_PUBLIC_*`** is the only prefix that may leak into the browser bundle. Everything else is server-only.
7. **Production refuses dev defaults** — Zod refinements reject `EMAIL_PROVIDER=mailpit` when `NODE_ENV=production`.

---

## `.env.example` shape

Each group is headed with a comment block pointing at the owning doc section.

```dotenv
# ---------------------------------------------------------------------------
# Shared environment variables (see docs/DEVELOPMENT_PLAN.md Appendix A)
# ---------------------------------------------------------------------------
NODE_ENV=development
LOG_LEVEL=info

# ---------------------------------------------------------------------------
# Docker Compose -- local infrastructure (docker-compose.yml)
# ---------------------------------------------------------------------------
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres        # change before any non-local environment
POSTGRES_DB=example_app

# ---------------------------------------------------------------------------
# apps/api
# ---------------------------------------------------------------------------
PORT=3001
DATABASE_URL=postgres://postgres:postgres@localhost:5432/example_app
DATABASE_URL_TEST=postgres://postgres:postgres@localhost:55432/example_app_test
REDIS_URL=redis://localhost:6379
REDIS_NAMESPACE=nest-auth-example
JWT_SECRET=                      # openssl rand -hex 64
MFA_ENCRYPTION_KEY=              # openssl rand -base64 32
WEB_ORIGIN=http://localhost:3000
EMAIL_PROVIDER=mailpit
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM=no-reply@nest-auth-example.dev
RESEND_API_KEY=                  # required when EMAIL_PROVIDER=resend
OAUTH_GOOGLE_CLIENT_ID=
OAUTH_GOOGLE_CLIENT_SECRET=
AUTH_ROUTE_PREFIX=auth

# ---------------------------------------------------------------------------
# apps/web
# ---------------------------------------------------------------------------
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Rules:

- Comments above each group, **empty lines between groups** for scannability.
- `KEY=` with no value signals "required, no default, must be filled in".
- Inline annotations (`# openssl rand -hex 64`) only when the generation recipe is non-obvious.

---

## Validation schemas

### API

```ts
// apps/api/src/config/env.schema.ts
import { z } from 'zod';

const base = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  REDIS_NAMESPACE: z.string().min(1).default('nest-auth-example'),

  JWT_SECRET: z.string().min(64, 'JWT_SECRET must be at least 64 hex chars (32 bytes)'),
  MFA_ENCRYPTION_KEY: z
    .string()
    .regex(/^[A-Za-z0-9+/=]+$/)
    .refine((v) => Buffer.from(v, 'base64').length === 32, '32-byte base64 required'),

  WEB_ORIGIN: z.string().url(),
  AUTH_ROUTE_PREFIX: z.string().default('auth'),

  EMAIL_PROVIDER: z.enum(['mailpit', 'resend']),
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_FROM: z.string().email(),
  RESEND_API_KEY: z.string().optional(),

  OAUTH_GOOGLE_CLIENT_ID: z.string().optional(),
  OAUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export const envSchema = base.superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && env.EMAIL_PROVIDER === 'mailpit') {
    ctx.addIssue({
      code: 'custom',
      path: ['EMAIL_PROVIDER'],
      message: 'mailpit is not allowed in production',
    });
  }
  if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['RESEND_API_KEY'],
      message: 'required when EMAIL_PROVIDER=resend',
    });
  }
  if (Boolean(env.OAUTH_GOOGLE_CLIENT_ID) !== Boolean(env.OAUTH_GOOGLE_CLIENT_SECRET)) {
    ctx.addIssue({
      code: 'custom',
      path: ['OAUTH_GOOGLE_CLIENT_ID'],
      message: 'client id and secret must be set together',
    });
  }
});

export type Env = z.infer<typeof envSchema>;
```

Wired in `AppModule`:

```ts
ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  validate: (raw) => envSchema.parse(raw),
});
```

Inject `ConfigService<Env, true>` (strict mode) everywhere. Use `.getOrThrow('KEY')` for required vars.

### Web

```ts
// apps/web/lib/env.ts
import { z } from 'zod';

const schema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(),
});

export const env = schema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
});
```

- **Explicit mapping** (not `schema.parse(process.env)`) — keeps the client bundle free of server-only keys. Next.js inlines only `NEXT_PUBLIC_*` at build time, but listing the keys you read makes intent explicit and static-analyzable.
- Imported from server components directly; client components re-import the same symbol (safe because every key is `NEXT_PUBLIC_*`).

---

## Secret hygiene

- Generate with `openssl rand -hex 64` (JWT) or `openssl rand -base64 32` (MFA key). Document in `.env.example` comment.
- Pipe into a secret manager in production (1Password CLI, Doppler, AWS Secrets Manager, Fly Secrets). Do not paste into CI UI directly — rotate on checkout.
- Rotating `JWT_SECRET` uses the library's rolling-secret feature (`jwt.previousSecrets`). Document rotation in `docs/DEPLOYMENT.md`.
- **Never log secrets.** Pino `redact` paths cover obvious keys; your code must not defeat them with string concatenation.

---

## Per-environment matrices

| Var              | Dev           | Test               | Staging                 | Production              |
| ---------------- | ------------- | ------------------ | ----------------------- | ----------------------- |
| `NODE_ENV`       | `development` | `test`             | `production`            | `production`            |
| `EMAIL_PROVIDER` | `mailpit`     | `mailpit`          | `resend`                | `resend`                |
| `LOG_LEVEL`      | `info`        | `warn`             | `info`                  | `info`                  |
| Cookie `secure`  | `false`       | `false`            | `true`                  | `true`                  |
| `JWT_SECRET`     | throwaway     | throwaway          | rotated, secret manager | rotated, secret manager |
| DB target        | `example_app` | `example_app_test` | separate instance       | separate cluster        |

`NODE_ENV=production` also unlocks `cookies.secure: true` via derivation inside `auth.config.ts`.

---

## CLI scripts and standalone tools

Prisma CLI scripts (`prisma.config.ts`, `prisma/seed.ts`) run outside NestJS and have no access to `ConfigService`. These are the **only** locations where `process.env` reads and direct `dotenv` usage are allowed.

```ts
// First line of any standalone CLI script
import 'dotenv/config';

// Then read env vars directly — acceptable only here
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('[seed] DATABASE_URL is not set.');
```

**Rules for CLI scripts**:

- `import 'dotenv/config'` must be the first import — it populates `process.env` before anything else runs.
- Validate required vars with an explicit `if (!value) throw` — no silent `undefined` propagation.
- Use bracket notation (`process.env['KEY']`) to satisfy the no-direct-env-access linter rule that applies to application code.
- Never read `process.env` directly inside `src/` — that is NestJS application code and must go through `ConfigService`.

---

## Runtime fetches

- **Never read env vars at request time** inside hot paths. Pull them once in `ConfigService` (api) or `env` (web) at bootstrap.
- **Never** pass env values in query strings or logs. Pass IDs that map to server-owned config.

---

## CI / CD

- GitHub Actions reads the validated schema via `envSchema.parse`. CI has its own set of env vars (dummy values where possible); production secrets are injected at deploy time only.
- Boot tests in CI assert that `envSchema.parse({})` fails with the expected list of errors — regression-tests the validation itself.

---

## Common pitfalls

1. **`process.env.X` in app code** — bypasses validation. Typos silently become `undefined`.
2. **Adding a variable to `.env.example` but not the schema** — at runtime, the variable is read as a raw string; defaults and coercion are missing.
3. **Leaking secret-bearing vars to the browser** — any var not prefixed `NEXT_PUBLIC_` should never appear inside `apps/web/`.
4. **Committing `.env`** — pre-commit hook + `.gitignore` both block it; don't fight them. Use the secret manager.
5. **Shared `.env`** between dev and test — a migration in test wipes dev. Split files (`.env`, `.env.test`) when they genuinely diverge, or use the test compose stack.
6. **Optional var with a default in `.env.example`** — a stale example hides a real requirement. If a key is required, document it as blank.
7. **Reading config inside a constructor** before `ConfigModule.forRoot` finishes — impossible with `registerAsync` + `inject`, trivial to miss with direct imports.

---

## References

- `@nestjs/config`: https://docs.nestjs.com/techniques/configuration
- Zod: https://zod.dev
- Next.js env vars: https://nextjs.org/docs/app/building-your-application/configuring/environment-variables
- `docs/DEVELOPMENT_PLAN.md` Appendix A
