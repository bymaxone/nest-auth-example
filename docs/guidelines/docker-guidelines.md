# Docker & Compose Guidelines

Local infrastructure: PostgreSQL, Redis, Mailpit. One compose file drives everything; a sibling test file spins an isolated stack for CI.

- **Compose**: v2 (the `docker compose` command, not legacy `docker-compose`)
- **Files**: `docker-compose.yml`, `docker-compose.override.yml`, `docker-compose.test.yml`
- **Configs**: `docker/postgres/init.sql`, `docker/redis/redis.conf`
- **Official docs**: https://docs.docker.com/compose/

---

## When to read this

Before editing a compose file, image, port mapping, volume, healthcheck, or anything under `docker/`.

---

## Scripts

```bash
pnpm infra:up          # docker compose up -d           (postgres + redis + mailpit)
pnpm infra:down        # docker compose down            (keep volumes)
pnpm infra:nuke        # docker compose down -v         (drop volumes — destroys data!)
pnpm infra:logs        # docker compose logs -f
pnpm infra:test:up     # docker compose -f docker-compose.test.yml up -d
pnpm infra:test:down   # docker compose -f docker-compose.test.yml down -v
```

Use these over raw `docker compose ...` — they guard against running against the wrong file by accident.

---

## `docker-compose.yml` (primary)

Services:

| Service  | Image                      | Host port             | Purpose                      |
| -------- | -------------------------- | --------------------- | ---------------------------- |
| postgres | `postgres:18-alpine`       | `127.0.0.1:5432`      | Primary DB; volume-persisted |
| redis    | `redis:7-alpine`           | `127.0.0.1:6379`      | Sessions, brute-force, OTPs  |
| mailpit  | `axllent/mailpit@sha256:…` | `127.0.0.1:1025,8025` | SMTP sink + web UI           |

Rules:

1. **Bind to `127.0.0.1` only.** Never `0.0.0.0:5432:5432` — exposes the database to every network interface on the host.
2. **Pin images.** Official versions (`postgres:18-alpine`, `redis:7-alpine`) are acceptable; third-party images use a `@sha256:…` digest (see the Mailpit entry).
3. **Named volumes** for anything stateful (`pg-data`, `redis-data`). Bind mounts are fine for **read-only configs** (`./docker/redis/redis.conf:/usr/local/etc/redis/redis.conf:ro`).
4. **Healthchecks on every service**. `depends_on: { service: { condition: service_healthy } }` is the only dependency model allowed when order matters.
5. **`restart: unless-stopped`** everywhere. `restart: always` interferes with `infra:down`; `no` leaves dead containers after crashes.
6. **Single network** (`local-dev`) — isolates this stack from other local compose projects.

---

## `docker-compose.override.yml`

Development-only extras. Loaded by `docker compose` automatically when present.

Use cases:

- Extra debug ports.
- Bind-mounting seed scripts during development.
- Running `apps/api` / `apps/web` in containers (profile `full`) for parity testing.

Rules:

- **Never** ship secrets here — `.env` drives those.
- **Opt-in profiles** (`profiles: ['full']`) for heavy setups, so `pnpm infra:up` stays fast by default.
- This file is gitignored in production images but committed for local dev.

---

## `docker-compose.test.yml`

Separate stack for the CI test suite. Isolation is the whole point.

- Dedicated ports: `55432` (Postgres), `56379` (Redis), `11025`/`18025` (Mailpit).
- `POSTGRES_DB=example_app_test`.
- No shared volumes — each spin-up starts empty.
- `restart: "no"` — tests run, tear down, move on.
- **Never** point tests at the primary stack; a stray `prisma migrate reset` would wipe dev data.

```bash
# Canonical test run:
pnpm infra:test:up
pnpm --filter @nest-auth-example/api test:e2e
pnpm infra:test:down
```

---

## Images we **don't** add

- Elasticsearch/OpenSearch: not required for the reference scope.
- NGINX: `apps/web` talks to `apps/api` directly in dev; reverse proxy belongs to deployment docs.
- Adminer/pgAdmin: `pnpm --filter @nest-auth-example/api prisma:studio` replaces it.

If you genuinely need another service (e.g., a queue in a future phase), open a PR with a rationale in `docs/decisions/`.

---

## Config volumes

`./docker/postgres/init.sql` runs **only on first boot** of the `pg-data` volume. After that, the init script is ignored — changes require `pnpm infra:nuke` to re-run.

`./docker/redis/redis.conf` is read every time the container starts. Safe to tweak and `docker compose restart redis` without touching data.

Both are mounted **read-only** (`:ro`). The containers do not need write access to the config files.

---

## Networking

- Services reach each other by **service name** (`postgres`, `redis`, `mailpit`) inside the compose network. Host processes (dev apps running outside Docker) use `localhost`.
- Do not hardcode internal container IPs.
- Each service exposes **only** the ports the app needs. Postgres does not need 5433; Redis does not need 26379.

---

## Secrets

- **Never** bake secrets into the compose file. Use `${VAR}` interpolation from `.env` at the repo root.
- Dev defaults (`POSTGRES_PASSWORD=postgres`) are intentional — tagged in `.env.example` with a warning. Production deploys inject real secrets via the host platform's secret manager.

---

## Healthchecks

Standard shape used in this repo:

```yaml
healthcheck:
  test: ['CMD-SHELL', 'pg_isready -U $${POSTGRES_USER:-postgres} -d $${POSTGRES_DB:-example_app}']
  interval: 5s
  timeout: 5s
  retries: 10
```

Rules:

- Use `CMD-SHELL` when the command needs env expansion; `CMD` when it's fixed.
- **Escape `$`** as `$$` inside compose YAML so it reaches the shell intact.
- Healthcheck failure blocks `depends_on … condition: service_healthy`.

---

## CI

GitHub Actions uses `docker compose -f docker-compose.test.yml` (not the primary file). The runner has Docker available by default; no `services:` block in the workflow is required.

Budget: under 60 seconds from "compose up" to "healthy." If a new service blows the budget, either trim it or split the job.

---

## Common pitfalls

1. **Binding to `0.0.0.0`** — Postgres exposed to the network. Always `127.0.0.1:…`.
2. **Unpinned third-party images** (`axllent/mailpit:latest`) — silent break when upstream re-tags. Use `@sha256:…`.
3. **Forgetting `:ro` on config mounts** — `redis.conf` ends up writable inside the container.
4. **`docker compose down` thinking volumes are deleted** — they are not. `-v` does that, and `-v` loses data. Label the script (`infra:nuke`) accordingly.
5. **Running dev and test stacks simultaneously without port separation** — e2e tests silently hit the dev DB. Test file uses 55432/56379 for this reason.
6. **Editing `init.sql` expecting it to run** — it runs only on an empty Postgres volume. Nuke and restart, or apply the change via a Prisma migration.
7. **Adding a service to the primary compose without a healthcheck** — dependent services start before it's ready.
8. **`latest` tag on `postgres`** — a major upgrade ships silently. Pin to a major + distro.

---

## References

- Docker Compose: https://docs.docker.com/compose/
- Compose file reference: https://docs.docker.com/reference/compose-file/
- `postgres` image docs: https://hub.docker.com/_/postgres
- `redis` image docs: https://hub.docker.com/_/redis
- Mailpit image: https://github.com/axllent/mailpit
- Project config files: `docker-compose.yml`, `docker-compose.override.yml`, `docker-compose.test.yml`
