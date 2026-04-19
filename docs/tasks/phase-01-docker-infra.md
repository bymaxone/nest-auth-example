# Phase 1 — Local Infrastructure (Docker Compose) — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-1--local-infrastructure-docker-compose) §Phase 1
> **Total tasks:** 5
> **Progress:** 🟢 5 / 5 done (100%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID   | Task                                                                     | Status | Priority | Size | Depends on |
| ---- | ------------------------------------------------------------------------ | ------ | -------- | ---- | ---------- |
| P1-1 | `docker-compose.yml` — postgres 18, redis 7, mailpit                     | 🟢     | High     | S    | —          |
| P1-2 | `docker-compose.override.yml` — dev-only tweaks                          | 🟢     | High     | XS   | P1-1       |
| P1-3 | `docker/postgres/init.sql` + `docker/redis/redis.conf`                   | 🟢     | High     | XS   | —          |
| P1-4 | `docker-compose.test.yml` (alt ports 55432/56379/58025)                  | 🟢     | High     | S    | P1-1, P1-3 |
| P1-5 | Root scripts (`infra:up`/`infra:down`/`infra:logs`) + smoke verification | 🟢     | High     | S    | P1-1..P1-4 |

---

## P1-1 — `docker-compose.yml` (postgres 18, redis 7, mailpit)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S (30–90 min)
- **Depends on:** `—`

### Description

Author the canonical `docker-compose.yml` at the repo root that brings up the three local-stack services the apps depend on: Postgres 18, Redis 7, and Mailpit. Volumes persist Postgres data; healthchecks are required so `depends_on.condition: service_healthy` works later.

### Acceptance Criteria

- [x] `docker-compose.yml` exists at repo root.
- [x] `postgres` service uses `postgres:18-alpine`, maps `127.0.0.1:5432:5432`, mounts the named volume `pg-data:/var/lib/postgresql/data`, reads `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` from env (defaults `postgres`/`postgres`/`example_app`), healthcheck via psql SELECT 1.
- [x] `redis` service uses `redis:7-alpine`, maps `127.0.0.1:6379:6379`, runs `redis-server /usr/local/etc/redis/redis.conf`, healthcheck via `redis-cli ping`.
- [x] `mailpit` service uses `axllent/mailpit:latest`, maps `127.0.0.1:1025:1025` (SMTP) and `127.0.0.1:8025:8025` (UI), no persistence.
- [x] Named volume `pg-data` declared at the bottom of the file.
- [x] `docker compose config` parses successfully.

### Files to create / modify

- `docker-compose.yml` — primary compose definition.

### Agent Execution Prompt

> Role: Senior DevOps / platform engineer.
> Context: Task P1-1 of `docs/DEVELOPMENT_PLAN.md` §Phase 1. See OVERVIEW §8 for the service table. §2 requires Docker Compose v2.
> Objective: Produce `/docker-compose.yml` covering postgres, redis, and mailpit with healthchecks.
> Steps:
>
> 1. Create `/docker-compose.yml` with `services.postgres`, `services.redis`, `services.mailpit`, and the `pg-data` volume.
> 2. Postgres block example:
>    ```yaml
>    postgres:
>      image: postgres:18-alpine
>      restart: unless-stopped
>      environment:
>        POSTGRES_USER: ${POSTGRES_USER:-postgres}
>        POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
>        POSTGRES_DB: ${POSTGRES_DB:-example_app}
>      ports:
>        - '5432:5432'
>      volumes:
>        - pg-data:/var/lib/postgresql/data
>        - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
>      healthcheck:
>        test: ['CMD-SHELL', 'pg_isready -U $${POSTGRES_USER:-postgres}']
>        interval: 5s
>        timeout: 5s
>        retries: 10
>    ```
> 3. Redis block mounts `./docker/redis/redis.conf:/usr/local/etc/redis/redis.conf:ro` and runs `redis-server /usr/local/etc/redis/redis.conf`.
> 4. Mailpit exposes ports 1025 and 8025; no volumes.
> 5. Do NOT set `version:` at the top — Compose v2 no longer needs it.
> 6. Add `volumes: { pg-data: {} }` at the bottom.
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 + Phase 1 deliverables.
> - The bind-mounts for `init.sql` and `redis.conf` resolve files that P1-3 creates; run this after or alongside P1-3 for a smoke test.
>   Verification:
> - `docker compose -f docker-compose.yml config` — expected: valid output, exit 0.

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P1-1 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## P1-2 — `docker-compose.override.yml` (dev-only tweaks)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** XS (<30 min)
- **Depends on:** `P1-1`

### Description

Compose automatically merges `docker-compose.override.yml` when present, so this is where dev-only conveniences live: `restart: unless-stopped`, exposing extra ports, colored logs, etc. This file is tracked in git but documented as dev-only in README.

### Acceptance Criteria

- [x] `docker-compose.override.yml` exists at repo root.
- [x] Sets `restart: unless-stopped` on all three services (already in base; override omits redundant duplicate).
- [x] Pins `logging.driver: json-file` with small size limits for local noise control.
- [x] `docker compose config` (merged) still parses.

### Files to create / modify

- `docker-compose.override.yml`

### Agent Execution Prompt

> Role: Senior DevOps engineer.
> Context: Task P1-2 of `docs/DEVELOPMENT_PLAN.md` §Phase 1.
> Objective: Produce `/docker-compose.override.yml` with dev-only tweaks that Compose auto-merges onto the base file from P1-1.
> Steps:
>
> 1. Create `/docker-compose.override.yml` with:
>    ```yaml
>    services:
>      postgres:
>        restart: unless-stopped
>        logging:
>          driver: json-file
>          options: { max-size: '10m', max-file: '3' }
>      redis:
>        restart: unless-stopped
>        logging:
>          driver: json-file
>          options: { max-size: '10m', max-file: '3' }
>      mailpit:
>        restart: unless-stopped
>        logging:
>          driver: json-file
>          options: { max-size: '10m', max-file: '3' }
>    ```
> 2. Do NOT add production-specific overrides (those belong in `docker-compose.prod.yml` in Phase 19).
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 + Phase 1 deliverables.
>   Verification:
> - `docker compose config` — expected: merged config prints with the override's `restart` + `logging` fields present.

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P1-2 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## P1-3 — `docker/postgres/init.sql` + `docker/redis/redis.conf`

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** XS (<30 min)
- **Depends on:** `—`

### Description

Provide the two container-side config files bind-mounted by the compose services. `init.sql` creates the app DB and its test sibling at first boot. `redis.conf` turns on AOF persistence, bounded memory policy, and disables snapshot saves (the app cache is not our source of truth).

### Acceptance Criteria

- [x] `docker/postgres/init.sql` creates `example_app` and `example_app_test` databases (idempotent with `CREATE DATABASE ... IF NOT EXISTS` via `DO $$` block or using `CREATE DATABASE` gated by a `SELECT` check).
- [x] `docker/redis/redis.conf` sets `appendonly yes`, `maxmemory-policy volatile-lru` (safer than allkeys-lru for auth tokens), `save ""`.
- [x] Both files are UTF-8, LF, final newline (editorconfig compliance).

### Files to create / modify

- `docker/postgres/init.sql`
- `docker/redis/redis.conf`

### Agent Execution Prompt

> Role: Senior DevOps engineer.
> Context: Task P1-3 of `docs/DEVELOPMENT_PLAN.md` §Phase 1. These files are bind-mounted by `docker-compose.yml` (P1-1).
> Objective: Create the Postgres init script and Redis config file.
> Steps:
>
> 1. Create `/docker/postgres/init.sql`:
>    ```sql
>    -- Initial databases for the example app.
>    -- Postgres 18 runs scripts in /docker-entrypoint-initdb.d/ only on first boot.
>    SELECT 'CREATE DATABASE example_app'
>      WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'example_app')\gexec
>    SELECT 'CREATE DATABASE example_app_test'
>      WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'example_app_test')\gexec
>    ```
> 2. Create `/docker/redis/redis.conf`:
>    ```conf
>    # Dev config: AOF for durability, no RDB snapshots, LRU eviction.
>    appendonly yes
>    appendfsync everysec
>    save ""
>    maxmemory 256mb
>    maxmemory-policy allkeys-lru
>    ```
> 3. Make sure both paths exist on disk so the bind-mounts in P1-1 resolve.
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 + Phase 1.
> - Do NOT set a Redis password here; auth is added in Phase 19/20 for prod profiles only.
>   Verification:
> - `test -f docker/postgres/init.sql && test -f docker/redis/redis.conf` — expected: both present.
> - `docker compose run --rm redis redis-server /usr/local/etc/redis/redis.conf --test-memtier` is not required; instead run `docker compose up -d redis` and `docker compose exec redis redis-cli CONFIG GET maxmemory-policy` — expected: `allkeys-lru`.

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P1-3 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## P1-4 — `docker-compose.test.yml` (Alternate Ports)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S (30–90 min)
- **Depends on:** `P1-1`, `P1-3`

### Description

Create a parallel Compose file CI and the e2e test suite will use. Same services, different host ports (`55432`, `56379`, `58025`) so developers can keep their local dev stack running while tests execute on the side. Data is ephemeral (no named volume).

### Acceptance Criteria

- [x] `docker-compose.test.yml` at repo root.
- [x] Postgres on host port `55432`, Redis on `56379`, Mailpit UI on `58025`, Mailpit SMTP on `51025`.
- [x] No persistent volume for Postgres (uses `tmpfs`).
- [x] Network name `nest-auth-example-test` via `name:` key.
- [x] `docker compose -f docker-compose.test.yml config` parses.

### Files to create / modify

- `docker-compose.test.yml`

### Agent Execution Prompt

> Role: Senior DevOps engineer.
> Context: Task P1-4 of `docs/DEVELOPMENT_PLAN.md` §Phase 1. CI e2e tests run against this file; see §Phase 17 for the callers.
> Objective: Produce an ephemeral-infra Compose file that does not collide with the dev stack from P1-1.
> Steps:
>
> 1. Create `/docker-compose.test.yml`:
>
>    ```yaml
>    name: nest-auth-example-test
>
>    services:
>      postgres:
>        image: postgres:18-alpine
>        environment:
>          POSTGRES_USER: postgres
>          POSTGRES_PASSWORD: postgres
>          POSTGRES_DB: example_app_test
>        ports:
>          - '55432:5432'
>        tmpfs:
>          - /var/lib/postgresql/data
>        healthcheck:
>          test: ['CMD-SHELL', 'pg_isready -U postgres']
>          interval: 3s
>          timeout: 3s
>          retries: 10
>
>      redis:
>        image: redis:7-alpine
>        command:
>          ['redis-server', '--save', '', '--appendonly', 'no', '--maxmemory-policy', 'allkeys-lru']
>        ports:
>          - '56379:6379'
>        healthcheck:
>          test: ['CMD-SHELL', 'redis-cli ping | grep -q PONG']
>          interval: 3s
>          timeout: 3s
>          retries: 10
>
>      mailpit:
>        image: axllent/mailpit:latest
>        ports:
>          - '51025:1025'
>          - '58025:8025'
>    ```
>
> 2. Do NOT add a named volume; the database must be fresh per CI run.
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 + Phase 1 (alt ports 55432/56379/58025).
>   Verification:
> - `docker compose -f docker-compose.test.yml config` — expected: exit 0.
> - `docker compose -f docker-compose.test.yml up -d && docker compose -f docker-compose.test.yml ps` — expected: three services healthy.

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P1-4 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## P1-5 — Root Scripts (`infra:up`/`infra:down`/`infra:logs`) + Smoke Verification

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S (30–90 min)
- **Depends on:** `P1-1`, `P1-2`, `P1-3`, `P1-4`

### Description

Gate task for Phase 1 "Definition of done": expose Compose actions as pnpm scripts, then smoke-verify the whole stack end-to-end (Mailpit UI reachable, Postgres `SELECT 1`, Redis `PING`).

### Acceptance Criteria

- [x] Root `package.json` scripts:
  - `"infra:up": "docker compose up -d"`
  - `"infra:down": "docker compose down"`
  - `"infra:nuke": "docker compose down -v"` (destructive; requires intent).
  - `"infra:logs": "docker compose logs -f"`
  - `"infra:test:up": "docker compose -f docker-compose.test.yml up -d"`
  - `"infra:test:down": "docker compose -f docker-compose.test.yml down -v"`
- [x] `pnpm infra:up` starts all three services healthy.
- [x] `curl -sf http://localhost:8025/` returns HTTP 200 (Mailpit UI). ✅
- [x] `docker compose exec -T postgres psql -U postgres -d example_app -c 'SELECT 1'` returns `1`. ✅
- [x] `docker compose exec -T redis redis-cli PING` returns `PONG`. ✅
- [x] `pnpm infra:down` stops them cleanly. ✅

### Files to create / modify

- `package.json` — add `infra:*` scripts.

### Agent Execution Prompt

> Role: Senior DevOps engineer.
> Context: Task P1-5 of `docs/DEVELOPMENT_PLAN.md` §Phase 1. Phase DoD: `pnpm infra:up` brings services up green, Mailpit UI reachable, `psql ... select 1` succeeds.
> Objective: Add the pnpm scripts and smoke-test the local stack.
> Steps:
>
> 1. Edit `/package.json` to add the scripts listed in Acceptance Criteria.
> 2. Separate `infra:down` (preserves the `pg-data` volume) from `infra:nuke` (`down -v`, destroys data). The plan recommends a confirmation for destructive ops; document the distinction in a comment above the script block (or in README).
> 3. Run `pnpm infra:up` and wait ≤30s for health.
> 4. Execute the three smoke commands from Acceptance Criteria. If any fails, diagnose in the corresponding earlier task (P1-1..P1-4).
> 5. Run `pnpm infra:down` to leave the workspace clean.
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 + Phase 1.
> - Do NOT run `docker compose down -v` as part of the default `infra:down` script; destruction is opt-in.
>   Verification:
> - `pnpm infra:up && sleep 10 && docker compose ps --format json` — expected: all services `running` with `healthy` status.
> - `curl -sf -o /dev/null -w "%{http_code}" http://localhost:8025/` — expected: `200`.
> - `docker compose exec -T postgres psql -U postgres -d example_app -c 'select 1;'` — expected: `1` in the output.
> - `docker compose exec -T redis redis-cli PING` — expected: `PONG`.
> - `pnpm infra:down` — expected: exit 0, containers stopped.

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P1-5 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## Completion log

- P1-3 ✅ 2026-04-19 — Created docker/postgres/init.sql (idempotent DB creation with UTF8/C locale) and docker/redis/redis.conf (AOF, volatile-lru, 256mb limit)
- P1-1 ✅ 2026-04-19 — Created docker-compose.yml with postgres:18-alpine, redis:7, mailpit; ports bound to 127.0.0.1; custom local-dev network; healthchecks via psql and redis-cli ping
- P1-2 ✅ 2026-04-19 — Created docker-compose.override.yml with json-file logging (10m/3 files) per service; dev-only comment added
- P1-4 ✅ 2026-04-19 — Created docker-compose.test.yml with ephemeral tmpfs postgres, volatile-lru redis, mailpit healthcheck; alt ports 55432/56379/51025/58025
- P1-5 ✅ 2026-04-19 — Added infra:\* scripts to package.json; smoke verified: Mailpit 200, Postgres SELECT 1, Redis PONG, both databases initialized
