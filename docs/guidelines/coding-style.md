# Coding Style

Project-wide style + the **mandatory code documentation policy** that covers every non-trivial file, every exported symbol, and every test.

- Pairs with [typescript-guidelines.md](typescript-guidelines.md) (language) and [lint-format-guidelines.md](lint-format-guidelines.md) (tooling).

---

## When to read this

Before opening a PR. Especially before writing new files, new exports, new tests, or any non-obvious code.

---

## Filesystem layout

```
apps/
├── api/
│   ├── prisma/
│   ├── src/
│   │   ├── auth/              library wiring (config, repos, hooks, email)
│   │   ├── config/            env schema + ConfigModule glue
│   │   ├── prisma/            PrismaService + module
│   │   ├── redis/             RedisService + module
│   │   ├── health/
│   │   ├── <feature>/         one module per domain (tenants, projects, platform, ...)
│   │   │   ├── dto/
│   │   │   ├── <feature>.controller.ts
│   │   │   ├── <feature>.service.ts
│   │   │   ├── <feature>.module.ts
│   │   │   └── <feature>.spec.ts
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── test/                  supertest e2e specs
│   └── tsconfig.json
└── web/
    ├── app/                   Next.js App Router
    ├── components/
    │   ├── auth/              feature-scoped components
    │   └── ui/                shadcn primitives (owned, copied in)
    ├── lib/                   env, auth-client, cn, helpers
    ├── hooks/                 cross-feature custom hooks
    ├── tests/e2e/             Playwright
    └── tsconfig.json
```

Rules:

- **One module/folder per domain.** Never group unrelated concerns.
- **Feature-local sub-folders** (`dto/`, `_hooks/`, `_components/`) when a feature grows beyond ~5 files.
- **Top-level files** reserved for cross-cutting modules (`app.module.ts`, `main.ts`, root-layouts).
- **`components/ui/`** is shadcn territory. Feature components live in `components/<feature>/`.

---

## Naming

| Kind                   | Convention                   | Example                                 |
| ---------------------- | ---------------------------- | --------------------------------------- |
| TS file                | kebab-case                   | `prisma-user.repository.ts`             |
| React component file   | kebab-case                   | `login-form.tsx`                        |
| React component symbol | PascalCase                   | `LoginForm`                             |
| Hook                   | camelCase, `use*`            | `useAuthFormState`                      |
| NestJS class           | PascalCase + suffix          | `ProjectsService`, `ProjectsController` |
| NestJS module          | PascalCase + `Module`        | `ProjectsModule`                        |
| NestJS provider token  | UPPER_SNAKE `Symbol('…')`    | `EMAIL_PROVIDER`, `REDIS_CLIENT`        |
| Type / interface       | PascalCase                   | `AuthenticatedUser`, `Env`              |
| Union literal value    | snake_case                   | `'password_reset_sent'`                 |
| Folder                 | kebab-case                   | `password-reset/`                       |
| DB column              | snake_case                   | `created_at`, `tenant_id`               |
| DB table               | plural snake_case            | `users`, `audit_logs`                   |
| Env var                | UPPER_SNAKE                  | `JWT_SECRET`, `NEXT_PUBLIC_API_URL`     |
| Boolean                | `is/has/should/can` prefix   | `isLoading`, `hasPermission`            |
| Route file (Next)      | kebab-case inside `(group)/` | `app/(auth)/forgot-password/page.tsx`   |

---

## Formatting

- Single quotes, semicolons, 2-space indent, 100-col wrap, trailing comma `'all'`.
- Managed by Prettier 3 — do not hand-format.
- Imports grouped in this order, separated by a blank line:
  1. Node built-ins and external packages
  2. Internal absolute imports (`@/*`)
  3. Type-only imports (`import type { … }`)
  4. Parent (`../`)
  5. Sibling (`./`)
- Within a group, alphabetical. ESLint can enforce with `eslint-plugin-import` if added.

---

## Code documentation — mandatory

This codebase is authored and maintained by humans **and** AI agents. Documentation is how we keep the loop healthy.

### File header

Every non-trivial file (`.ts`, `.tsx`) starts with a JSDoc block:

```ts
/**
 * Prisma-backed implementation of the library's {@link IUserRepository} contract.
 *
 * Layer: auth/library wiring.
 * Constraint: never mutate passwordHash / mfaSecret / mfaRecoveryCodes — they are
 * produced by the library and consumed as opaque blobs.
 */
```

Skip the header on trivial files: pure re-exports, a single-line `index.ts` barrel, a `.d.ts` augmentation.

### JSDoc on exports

Every exported function, class, hook, component, service, DTO gets a JSDoc block:

```ts
/**
 * Creates a project scoped to the caller's tenant. Writes an audit row on success.
 *
 * @param tenantId Tenant resolved from the X-Tenant-Id header.
 * @param actorId  Authenticated user ID. Stored as `ownerId` and on the audit row.
 * @param input    Validated CreateProjectDto. `name` is trimmed + min length 1.
 * @returns        The created project entity (raw Prisma shape).
 * @throws         ConflictException when the name collides within the tenant.
 */
async create(tenantId: string, actorId: string, input: CreateProjectDto) { /* ... */ }
```

Rules:

- Document **why** when the behavior isn't obvious — a business rule, a platform quirk, a workaround linking an issue.
- Do not restate the type signature; name the parameter + the constraint on it.
- Update JSDoc in the same commit as the code it describes. Stale docs are bugs.

### Inline comments

Allowed, not mandatory. Guidelines:

- Explain the **why**, not the **what**. The code says _what_ already.
- One-line only unless the situation genuinely requires a paragraph.
- Link to an issue, RFC, or ADR when the decision sits outside the file.
- No commented-out code. Git remembers.

### Tests

Every `it` / `test` block has a short comment describing the **scenario** and the **rule** it protects. See [testing-guidelines.md](testing-guidelines.md) → "Comment policy".

---

## Control flow

- **Early returns** over nested `if / else`. Fewer levels of indent, clearer happy path.
- **Guard clauses** at the top of the function: reject invalid inputs immediately.
- **No `else` after `return`.** Lint does not enforce; code review does.
- **`switch`** is fine for exhaustive unions; rely on `noFallthroughCasesInSwitch`. When over 5 branches, consider a map.
- **Ternaries** limited to one level. Nested ternaries hurt more than a plain `if`.

---

## Error handling

- Throw specific Nest exceptions (`BadRequestException`, …) on the API.
- Throw `Error` (or a project-local subclass) for unexpected internal conditions.
- `try/catch (err)` — `err` is `unknown`. Narrow with `err instanceof Error` before reading fields.
- Never swallow errors. Either re-throw or explicitly log + degrade (`onHookFailed`).
- No `throw 'string'`. Throw objects.

---

## Imports

Rules that go beyond the import ordering:

- **Named imports** over namespace imports. `import { X } from 'lib'` over `import * as lib from 'lib'`.
- **Alias `@/`** over deep relatives. No `../../` beyond one level.
- **Type-only imports** use `import type { X } from '…'` (required by `verbatimModuleSyntax`).
- **No side-effect imports** (`import 'some-module/polyfill'`) unless centralized in `main.ts` / `layout.tsx`.

---

## Functions

- Keep them small. Target ≤ 40 lines including signature; break up when larger.
- Avoid flag arguments (`createUser(data, isAdmin)`) — split into two functions.
- Prefer pure functions in `services/` and `utils/`. Side effects live at the edge (controllers, hooks).
- Async over callbacks. Never return `Promise<void>` and also fire-and-forget from the caller — either await or document the intentional fire-and-forget.

---

## Classes

- Only where the framework expects them (NestJS services/controllers, Prisma client wrappers).
- **Constructor injection**, `readonly` fields.
- No static factories unless the class genuinely has multiple construction modes.
- No inheritance for code reuse; use composition. The one exception is extending `PrismaClient` in `PrismaService` because Prisma's client is that kind of API.

---

## React-specific style

Covered in [react-guidelines.md](react-guidelines.md). One-liner reminders:

- `export function Foo()` + `type FooProps = { … }`. No `React.FC`.
- Conditional classes via `cn(...)`. No template-literal class names.
- State lifted to the nearest common ancestor; no global state libraries in this project.

---

## Anti-patterns

- **Silent defaults**. A function that accepts `undefined` and returns "the right thing" is a trap. Validate, or require.
- **God modules** that import from every other module.
- **Utility dumping grounds** (`utils.ts` with 40 unrelated helpers).
- **Premature optimization** (`React.memo`, `useMemo`, `useCallback` without a measured reason).
- **Copy-paste DTOs** — extend via `PartialType` / `PickType` where possible.
- **Manual date math** (`new Date().getTime() + 1000 * 60 * 60`). Use `date-fns`.
- **Throwing strings or numbers**. Always an `Error` subclass.
- **Dead code with "we might need this"** comment. Delete; git log preserves it.

---

## Done criteria for a change

1. TS compiles, ESLint clean, Prettier clean, tests pass.
2. New / changed exports carry a JSDoc block.
3. New non-trivial files have a file header.
4. New tests carry a scenario comment.
5. No debug `console.*` left; no commented-out code.
6. Docs updated when the change is visible to consumers (README, `docs/*.md`, a guideline).

---

## References

- [typescript-guidelines.md](typescript-guidelines.md)
- [lint-format-guidelines.md](lint-format-guidelines.md)
- [testing-guidelines.md](testing-guidelines.md) → Comment policy
- [nestjs-guidelines.md](nestjs-guidelines.md)
- [react-guidelines.md](react-guidelines.md)
