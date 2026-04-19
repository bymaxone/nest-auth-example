# Phase 18 — Documentation (docs/*) — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-18--documentation-docs) §Phase 18
> **Total tasks:** 11
> **Progress:** 🔴 0 / 11 done (0%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID | Task | Status | Priority | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| P18-1 | `docs/GETTING_STARTED.md` — 5-minute quickstart | 🔴 | High | S | Phase 17 |
| P18-2 | `docs/FEATURES.md` — one section per FCM row | 🔴 | High | M | Phase 17 |
| P18-3 | `docs/ARCHITECTURE.md` — module boundaries & subpath map | 🔴 | High | S | Phase 17 |
| P18-4 | `docs/ENVIRONMENT.md` — env-var reference | 🔴 | High | S | Phase 17 |
| P18-5 | `docs/DATABASE.md` — Prisma schema walkthrough | 🔴 | Medium | S | Phase 17 |
| P18-6 | `docs/REDIS.md` — key namespaces + TTLs | 🔴 | Medium | S | Phase 17 |
| P18-7 | `docs/EMAIL.md` — Mailpit → Resend swap | 🔴 | Medium | S | Phase 17 |
| P18-8 | `docs/DEPLOYMENT.md` — production checklist | 🔴 | High | S | Phase 17 |
| P18-9 | `docs/TROUBLESHOOTING.md` — errors → fixes | 🔴 | Medium | S | Phase 17 |
| P18-10 | `docs/RELEASES.md` — library ↔ example version table | 🔴 | Medium | S | Phase 17 |
| P18-11 | OVERVIEW §6 status column sweep | 🔴 | High | S | P18-2 |

---

## P18-1 — `docs/GETTING_STARTED.md` — 5-minute quickstart

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** `Phase 17`

### Description
Write the guided quickstart promised by `docs/OVERVIEW.md` §5. A reviewer on a clean machine must reach "logged in as admin@acme.test" following this doc alone.

### Acceptance Criteria
- [ ] `docs/GETTING_STARTED.md` exists.
- [ ] Covers prerequisites (Node 24, pnpm 10, Docker Desktop v2, a sibling checkout of `../nest-auth`).
- [ ] Step-by-step: clone, `scripts/link-library.sh`, `pnpm install`, `pnpm infra:up`, `pnpm --filter api prisma:migrate dev`, `pnpm --filter api prisma:seed`, `pnpm dev`.
- [ ] Lists seeded credentials (admin + member) and Mailpit URL `http://localhost:8025`.
- [ ] Cross-links: `ENVIRONMENT.md`, `TROUBLESHOOTING.md`, `ARCHITECTURE.md`.
- [ ] Screenshots under `docs/assets/getting-started/` for login success + Mailpit inbox.

### Files to create / modify
- `docs/GETTING_STARTED.md` — new.
- `docs/assets/getting-started/` — new screenshots.

### Agent Execution Prompt

> Role: Developer advocate writing first-run docs.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §18, first bullet. Every command must match the scripts built in Phases 0–16.
>
> Objective: Let a new developer reach "logged in as admin@acme.test" in under five minutes from a clean clone.
>
> Outline:
> 1. Prerequisites.
> 2. Clone + link the library.
> 3. Install + boot infra.
> 4. Migrate + seed.
> 5. Run `pnpm dev`.
> 6. Log in + check Mailpit.
> 7. Where to go next (links to other docs).
>
> Steps:
> 1. Verify every command by running it in a fresh clone; correct any drift from the scripts defined earlier in the plan.
> 2. Capture screenshots at the login success screen and Mailpit inbox with one captured message.
> 3. Add a troubleshooting callout linking to `TROUBLESHOOTING.md` for the three most common snags.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - English only. All headings in sentence case.
> - Relative links (e.g., `./ENVIRONMENT.md`) — never absolute URLs to the repo.
>
> Verification:
> - `npx markdown-link-check docs/GETTING_STARTED.md` — expected: all links resolve.
> - Manually follow the doc on a fresh clone — expected: logged in within 5 minutes.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P18-1 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P18-2 — `docs/FEATURES.md` — one section per FCM row

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `Phase 17`

### Description
Expand the Phase 8 stub into a full feature tour. One `##` section per Feature Coverage Matrix row (#1–#32 in `OVERVIEW.md` §6). Each section has a short intro, the library API used with file:line anchors, a reproducible user journey (click-by-click or `curl`), and a screenshot where useful.

### Acceptance Criteria
- [ ] `docs/FEATURES.md` has exactly 32 `##`-level feature sections, indexed at the top.
- [ ] Each section: 1-2 sentence intro, **Library API** subsection with file:line links, **How to reproduce** subsection (UI clicks or `curl`), and an optional **Screenshot**.
- [ ] Every file:line link points to a real file under `apps/api/` or `apps/web/`.
- [ ] Screenshots committed under `docs/assets/features/` where they clarify the flow.
- [ ] Cross-links out to `ARCHITECTURE.md`, `EMAIL.md`, `DATABASE.md`, `REDIS.md` where relevant.
- [ ] Any intentionally-not-demonstrated export (per Phase 20) is called out with a GitHub issue link.

### Files to create / modify
- `docs/FEATURES.md` — rewrite / extend.
- `docs/assets/features/` — screenshots as needed.

### Agent Execution Prompt

> Role: Technical writer + NestJS/React engineer.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §18 (FEATURES.md bullet). The FCM lives in `docs/OVERVIEW.md` §6.
>
> Objective: Produce a feature tour that reads like a manual and doubles as proof-of-coverage for Phase 20.
>
> Outline:
> 1. Intro (what this doc is, how it maps to the library).
> 2. Table of contents (32 rows).
> 3. One section per matrix row (#1–#32), in matrix order.
> 4. Appendix: fallbacks / not-demonstrated exports.
> 5. Link to CHANGELOG + RELEASES for version pins.
>
> Steps:
> 1. Walk the matrix in order. For each row, identify the primary file in `apps/api/` or `apps/web/`, cite it as `apps/api/src/...#Lstart-Lend`.
> 2. For UI features, record a short click path (`Dashboard → Security → Enable MFA → ...`).
> 3. For API features, include a `curl` sequence with placeholder envs.
> 4. Verify each file:line anchor exists by opening the file.
> 5. Cross-link: every time you mention cookies, link to ARCHITECTURE; every time you mention email, link to EMAIL.md.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - English, sentence-case headings.
> - Screenshots under `docs/assets/features/` only.
>
> Verification:
> - `grep -c '^## ' docs/FEATURES.md` — expected: ≥ 32 (one per FCM row).
> - `npx markdown-link-check docs/FEATURES.md` — expected: all links resolve.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P18-2 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P18-3 — `docs/ARCHITECTURE.md` — module boundaries & subpath map

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** `Phase 17`

### Description
Deeper dive into the diagram in `OVERVIEW.md` §3. Documents which `@bymax-one/nest-auth` subpath is consumed where, the request/cookie lifecycle, and module boundaries between host and library.

### Acceptance Criteria
- [ ] `docs/ARCHITECTURE.md` exists.
- [ ] Section: subpath-of-library mapping table (`/server`, `/shared`, `/client`, `/react`, `/nextjs`) with host consumers.
- [ ] Request/response lifecycle diagram (Mermaid) for login → cookies → proxy → refresh.
- [ ] Module boundaries list for `apps/api` and `apps/web`.
- [ ] Cross-links to `FEATURES.md`, `ENVIRONMENT.md`, `REDIS.md`, `DATABASE.md`.

### Files to create / modify
- `docs/ARCHITECTURE.md` — new.
- `docs/assets/architecture/` — diagrams if PNG.

### Agent Execution Prompt

> Role: Senior software architect documenting a NestJS + Next.js reference app.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §18 (ARCHITECTURE.md bullet). Expands `OVERVIEW.md` §3.
>
> Objective: Leave no ambiguity about which library subpath lives where and how cookies flow.
>
> Outline:
> 1. Layered overview (reuse OVERVIEW §3 diagram, refine).
> 2. Library subpath → host consumer table.
> 3. Request/cookie lifecycle with Mermaid.
> 4. Module boundaries (api + web).
> 5. Error propagation (`AuthException` → HTTP → client).
> 6. Further reading.
>
> Steps:
> 1. Enumerate library subpaths from Appendix B of the plan; map each to `apps/api` or `apps/web` files.
> 2. Draw Mermaid `sequenceDiagram` for login + silent refresh.
> 3. Describe how `createAuthProxy` (edge) and `JwtAuthGuard` (origin) coordinate.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Use Mermaid diagrams inline; prefer them over PNG where possible.
>
> Verification:
> - `npx markdown-link-check docs/ARCHITECTURE.md` — expected: all links resolve.
> - Render the file in a Mermaid-aware viewer — expected: diagrams render.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P18-3 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P18-4 — `docs/ENVIRONMENT.md` — env-var reference

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** `Phase 17`

### Description
Full reference for every environment variable used across api + web, mirroring Appendix A of `DEVELOPMENT_PLAN.md`. Documents defaults, validation rules (via the zod schemas), generation commands for secrets, and required-vs-optional status.

### Acceptance Criteria
- [ ] `docs/ENVIRONMENT.md` exists.
- [ ] Tables match Appendix A exactly (shared / `apps/api` / `apps/web` groups).
- [ ] Each row has: name, required, example, notes, validation (zod rule).
- [ ] Generation commands listed for `JWT_SECRET` (`openssl rand -hex 64`) and `MFA_ENCRYPTION_KEY` (`openssl rand -base64 32`).
- [ ] Cross-links to `GETTING_STARTED.md`, `DEPLOYMENT.md`, `TROUBLESHOOTING.md`.
- [ ] Note on how to keep this doc in sync with `env.schema.ts` + `lib/env.ts`.

### Files to create / modify
- `docs/ENVIRONMENT.md` — new.

### Agent Execution Prompt

> Role: Technical writer with zod + NestJS ConfigModule familiarity.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §18 (ENVIRONMENT.md bullet) and Appendix A.
>
> Objective: One canonical place to look up any env var the stack consumes.
>
> Outline:
> 1. How config is loaded (order of precedence).
> 2. Shared vars.
> 3. `apps/api` vars.
> 4. `apps/web` vars.
> 5. Generating secrets.
> 6. Keeping this in sync (link to `env.schema.ts` + `lib/env.ts`).
>
> Steps:
> 1. Copy Appendix A tables verbatim; add a "Validation" column citing the zod rule.
> 2. For `JWT_SECRET`, include the 32-char minimum and generation command.
> 3. For `MFA_ENCRYPTION_KEY`, state the base64 32-byte requirement.
> 4. Add a callout: "If you change this file, update `apps/api/src/config/env.schema.ts` and `apps/web/lib/env.ts` in the same PR."
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - No secrets in examples — always use placeholders.
>
> Verification:
> - `npx markdown-link-check docs/ENVIRONMENT.md` — expected: all links resolve.
> - Cross-check every row against `apps/api/src/config/env.schema.ts` — expected: one-to-one.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P18-4 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P18-5 — `docs/DATABASE.md` — Prisma schema walkthrough

- **Status:** 🔴 Not Started
- **Priority:** Medium
- **Size:** S
- **Depends on:** `Phase 17`

### Description
Walk through `prisma/schema.prisma` table by table, explaining why each field exists and how it maps to the library's `IUserRepository` / `IPlatformUserRepository` contracts.

### Acceptance Criteria
- [ ] `docs/DATABASE.md` exists.
- [ ] Sections: `users`, `platform_users`, `tenants`, `invitations`, `audit_logs`, `projects`.
- [ ] Each section lists fields, nullability, and the library mapping (`passwordHash`, `mfaSecret`, `mfaRecoveryCodes` explicitly noted as "store exactly as library returns").
- [ ] Migration strategy section: `prisma migrate dev` (local) vs `prisma migrate deploy` (CI/prod).
- [ ] Seed strategy and demo data overview.
- [ ] Cross-links to `FEATURES.md` and the library's repository interfaces in Appendix B.

### Files to create / modify
- `docs/DATABASE.md` — new.

### Agent Execution Prompt

> Role: Database-focused backend engineer documenting a Prisma schema.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §18 (DATABASE.md bullet). Schema built in Phase 4.
>
> Objective: Explain every field so a reader could fork the schema for their own app without guessing.
>
> Outline:
> 1. ER diagram (Mermaid).
> 2. Tables (one subsection each).
> 3. Library mapping rules (exact-store fields).
> 4. Migrations.
> 5. Seeds.
> 6. Further reading.
>
> Steps:
> 1. Draw a Mermaid erDiagram from the schema.
> 2. For each table, produce a field table with types + constraints + purpose.
> 3. Call out the three library-owned fields (`passwordHash`, `mfaSecret`, `mfaRecoveryCodes`) with a warning not to re-hash.
> 4. Describe the seed script and what it produces.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Never include real connection strings.
>
> Verification:
> - `npx markdown-link-check docs/DATABASE.md` — expected: all links resolve.
> - Compare field lists against `apps/api/prisma/schema.prisma` — expected: one-to-one.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P18-5 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P18-6 — `docs/REDIS.md` — key namespaces + TTLs

- **Status:** 🔴 Not Started
- **Priority:** Medium
- **Size:** S
- **Depends on:** `Phase 17`

### Description
Document every Redis key produced by the library + this app, with prefix `nest-auth-example:*`, their purpose, TTLs, and ownership (library vs host).

### Acceptance Criteria
- [ ] `docs/REDIS.md` exists.
- [ ] Table expands `OVERVIEW.md` §11 with a new TTL column.
- [ ] Explains the `nest-auth-example` namespace choice.
- [ ] Notes persistence requirements (appendonly on in prod).
- [ ] Cross-links to `DEPLOYMENT.md` (persistence) and `FEATURES.md` #14/#16.
- [ ] One `redis-cli` inspection snippet per key pattern.

### Files to create / modify
- `docs/REDIS.md` — new.

### Agent Execution Prompt

> Role: Platform engineer documenting cache/session topology.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §18 (REDIS.md bullet). Namespace is `nest-auth-example:*`.
>
> Objective: Give operators a precise map of every Redis key, its TTL, and who owns it.
>
> Outline:
> 1. Namespace rationale.
> 2. Key table (pattern · purpose · TTL · owner).
> 3. Inspection commands.
> 4. Persistence + durability.
> 5. Flushing safely in dev.
>
> Steps:
> 1. For each key pattern in OVERVIEW §11, add TTL from the library config defaults (or override in `auth.config.ts`).
> 2. Document `redis-cli --scan --pattern 'nest-auth-example:*' | head`.
> 3. Warn about flushing: `FLUSHDB` kicks all users offline.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Keep TTLs sourced from code — link to the config file.
>
> Verification:
> - `npx markdown-link-check docs/REDIS.md` — expected: all links resolve.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P18-6 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P18-7 — `docs/EMAIL.md` — Mailpit → Resend swap

- **Status:** 🔴 Not Started
- **Priority:** Medium
- **Size:** S
- **Depends on:** `Phase 17`

### Description
How to switch `EMAIL_PROVIDER` from `mailpit` to `resend` (or any custom `IEmailProvider`), override templates, and handle locales.

### Acceptance Criteria
- [ ] `docs/EMAIL.md` exists.
- [ ] Covers `EMAIL_PROVIDER` switching (env + DI binding path).
- [ ] Lists every transactional email produced (`IEmailProvider` methods mapped to FCM rows #5/#6/#7/#15/#21).
- [ ] Shows how to subclass `MailpitEmailProvider` or `ResendEmailProvider` to override templates.
- [ ] Notes DNS records for production (SPF, DKIM, DMARC) with cross-link to `DEPLOYMENT.md`.
- [ ] Locale handling: where strings live, how to add a new locale.

### Files to create / modify
- `docs/EMAIL.md` — new.

### Agent Execution Prompt

> Role: Technical writer + backend engineer documenting pluggable transports.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §18 (EMAIL.md bullet).
>
> Objective: Make provider swaps and template overrides trivial for a new consumer.
>
> Outline:
> 1. Email flow overview.
> 2. Provider selection (`EMAIL_PROVIDER`).
> 3. Each transactional template listed + when it fires.
> 4. Overriding templates.
> 5. Locales.
> 6. Production considerations (link to DEPLOYMENT).
>
> Steps:
> 1. Cite the DI binding in `apps/api/src/auth/auth.module.ts` where the provider is chosen.
> 2. For each template, show subject + key variables.
> 3. Document how to register a custom `IEmailProvider` (provide + export via a module).
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Real API keys never appear in examples.
>
> Verification:
> - `npx markdown-link-check docs/EMAIL.md` — expected: all links resolve.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P18-7 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P18-8 — `docs/DEPLOYMENT.md` — production checklist

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** `Phase 17`

### Description
Production checklist. Expands `OVERVIEW.md` §14 with concrete instructions for cookie domain strategy, JWT rotation via `jwt.previousSecrets`, Redis persistence, HTTPS, DNS for email, and shipping `audit_logs` to a SIEM.

### Acceptance Criteria
- [ ] `docs/DEPLOYMENT.md` exists.
- [ ] Sections: topology, cookies, HTTPS, JWT rotation (`jwt.previousSecrets`), Redis persistence, email DNS, logging/SIEM, health checks, rollout strategy.
- [ ] Checklist at the bottom (copy-pasteable into a release PR template).
- [ ] Cross-links to `ENVIRONMENT.md`, `EMAIL.md`, `REDIS.md`, `TROUBLESHOOTING.md`.

### Files to create / modify
- `docs/DEPLOYMENT.md` — new.

### Agent Execution Prompt

> Role: SRE + backend engineer writing a prod playbook.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §18 (DEPLOYMENT.md bullet), expanding OVERVIEW §14.
>
> Objective: A team should be able to tick this list end-to-end on release day.
>
> Outline:
> 1. Target topology (api + web services).
> 2. Cookies (domain + flags).
> 3. HTTPS + HSTS.
> 4. JWT rotation procedure.
> 5. Redis persistence.
> 6. Email DNS.
> 7. Logging + audit log shipping.
> 8. Release checklist.
>
> Steps:
> 1. Describe rolling `JWT_SECRET` with `jwt.previousSecrets` (old secret moves to previous array, new secret becomes primary, grace window).
> 2. Spell out cookie flags (`Secure`, `SameSite`, `Domain`) for same-registrable-domain vs cross-subdomain cases.
> 3. Include a final checklist of 15-20 items.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Real secrets never appear.
>
> Verification:
> - `npx markdown-link-check docs/DEPLOYMENT.md` — expected: all links resolve.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P18-8 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P18-9 — `docs/TROUBLESHOOTING.md` — errors → fixes

- **Status:** 🔴 Not Started
- **Priority:** Medium
- **Size:** S
- **Depends on:** `Phase 17`

### Description
Common errors and fixes, keyed by the error message or symptom a new developer is likely to see. Covers JWT secret length, CORS, cookies not sticking, Mailpit unreachable, pnpm link drift, `prisma migrate` vs `prisma db push` confusion.

### Acceptance Criteria
- [ ] `docs/TROUBLESHOOTING.md` exists.
- [ ] One `###` per common error: symptom, cause, fix, related doc link.
- [ ] Covers at minimum: `JWT_SECRET must be at least 32 characters`, CORS preflight rejection, cookies missing on `localhost`, Mailpit connection refused, library link stale after rebuild.
- [ ] Cross-links to `GETTING_STARTED.md`, `ENVIRONMENT.md`, `DEPLOYMENT.md`.

### Files to create / modify
- `docs/TROUBLESHOOTING.md` — new.

### Agent Execution Prompt

> Role: Developer support engineer.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §18 (TROUBLESHOOTING.md bullet).
>
> Objective: Short, scannable answers to the ten most common first-run problems.
>
> Outline:
> 1. How to use this doc (search by error message).
> 2. Setup/install errors.
> 3. Config/env errors.
> 4. Runtime errors (api).
> 5. Runtime errors (web).
> 6. Test failures.
>
> Steps:
> 1. Mine Phase 0–16 task files for any "common gotcha" notes and lift them here.
> 2. For each entry: **Symptom** (exact message), **Cause**, **Fix** (numbered steps), **See also**.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Keep each entry under 15 lines.
>
> Verification:
> - `npx markdown-link-check docs/TROUBLESHOOTING.md` — expected: all links resolve.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P18-9 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P18-10 — `docs/RELEASES.md` — library ↔ example version table

- **Status:** 🔴 Not Started
- **Priority:** Medium
- **Size:** S
- **Depends on:** `Phase 17`

### Description
Release tracker: library version ↔ example commit/tag ↔ notes. Seeded with the initial `@bymax-one/nest-auth@1.0.0` pairing; updated automatically by the release workflow (Phase 19).

### Acceptance Criteria
- [ ] `docs/RELEASES.md` exists.
- [ ] Table columns: example tag, library version, date, notes, upgrade link.
- [ ] Seeded with the Phase-20 row `v1.0.0 · @bymax-one/nest-auth@1.0.0 · YYYY-MM-DD · Initial reference app`.
- [ ] Section explaining the auto-update via `release.yml` (Phase 19).
- [ ] Cross-links to `CHANGELOG.md`, `DEPLOYMENT.md`, library repo.

### Files to create / modify
- `docs/RELEASES.md` — new.

### Agent Execution Prompt

> Role: Release manager documenting version tracking.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §18 (RELEASES.md bullet). Auto-update comes from the release workflow in Phase 19.
>
> Objective: Single source of truth for "which library version does this branch / tag track?"
>
> Outline:
> 1. How to read this table.
> 2. Release table (newest first).
> 3. How entries are added (manual + auto).
> 4. Deprecation / branch-per-major policy.
>
> Steps:
> 1. Seed with the v1.0.0 row.
> 2. Document the release.yml bot commit that appends new rows.
> 3. Link upgrade notes to per-version subsections of `CHANGELOG.md`.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
>
> Verification:
> - `npx markdown-link-check docs/RELEASES.md` — expected: all links resolve.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P18-10 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P18-11 — OVERVIEW §6 status column sweep

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** `P18-2`

### Description
Walk the Feature Coverage Matrix in `docs/OVERVIEW.md` §6 row by row. For each row, confirm the "Demonstrated in" column points to real files, then append a ✅ marker indicating that row is actually demonstrated. Resolves the "Update OVERVIEW §6 status column as each row goes green" bullet in `DEVELOPMENT_PLAN.md` §18.

### Acceptance Criteria
- [ ] Every row in `OVERVIEW.md` §6 has its "Demonstrated in" cell verified against the actual repo.
- [ ] For every verified row, a ✅ is appended either to the "Demonstrated in" cell or to a new "Status" column (pick one consistently).
- [ ] Broken file references are fixed in the same commit.
- [ ] Any row that cannot be verified is marked ⚠️ and linked to a GitHub issue.
- [ ] Cross-check against `FEATURES.md` (P18-2) — every row there = a ✅ here.

### Files to create / modify
- `docs/OVERVIEW.md` — update §6 rows.

### Agent Execution Prompt

> Role: Technical editor doing a traceability sweep.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §18 (final bullet). Pairs with `docs/FEATURES.md` (P18-2) and Appendix B of the plan.
>
> Objective: Make §6 truthful — every green row corresponds to a real file the reader can open.
>
> Outline (per row):
> 1. Read the "Demonstrated in" cell.
> 2. Open the cited file(s).
> 3. Confirm the feature is exercised there.
> 4. Append ✅ (or ⚠️ + issue link).
>
> Steps:
> 1. Walk rows #1–#32 in order.
> 2. Use the audit script from Phase 20 (if available) as a cross-check — exports referenced but no row pointing to them → gap.
> 3. Commit the final pass with a message `docs(overview): sweep §6 after phase 17 completion`.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Do not silently change feature descriptions — open an issue for any drift.
>
> Verification:
> - `grep -c '✅' docs/OVERVIEW.md` — expected: ≥ 32 (one per FCM row, ignoring pre-existing ticks).
> - `npx markdown-link-check docs/OVERVIEW.md` — expected: all links resolve.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P18-11 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## Completion log
