# Testing Guidelines

Full-stack test strategy: unit, integration, e2e, UI component, browser e2e.

- **`apps/api`**: Jest 30 + supertest
- **`apps/web`**: Vitest 4 (unit/component) + Playwright 1 (browser e2e)
- **Infra for tests**: `docker-compose.test.yml` (isolated Postgres + Redis + Mailpit on dedicated ports)

- **Official docs**: https://jestjs.io, https://vitest.dev, https://playwright.dev, https://testing-library.com, https://github.com/ladjs/supertest

---

## When to read this

Before writing any test, setting up CI, mocking, picking a fixture strategy, or asserting against timers/dates.

---

## Test pyramid (intent)

```
  Playwright (apps/web)         ~5% of tests — critical user journeys
  supertest e2e (apps/api)      ~20% — auth flows end-to-end over HTTP
  Integration                   ~40% — repository / service against real Postgres + Redis
  Unit                          ~35% — pure functions, DTO validation, React components in isolation
```

Ratios are a guideline, not a quota. **Every auth flow** (login, logout, register, MFA, password reset, session revoke, OAuth link, invitation accept) has at least one supertest e2e and one Playwright journey.

---

## Directory layout

```
apps/api/
├── src/**/*.spec.ts          ← unit / integration (Jest)
├── test/**/*.e2e-spec.ts     ← supertest e2e (Jest)
├── jest.config.ts
└── jest.e2e.config.ts

apps/web/
├── src/**/*.test.ts(x)       ← unit / component (Vitest)
├── tests/e2e/**/*.spec.ts    ← Playwright
├── vitest.config.ts
└── playwright.config.ts
```

`.spec.` vs `.test.` convention follows each framework's default; keep it consistent inside an app.

---

## `apps/api` — Jest + supertest

### Config

- `preset: 'ts-jest/presets/default-esm'` with `transform: { '^.+\\.tsx?$': ['ts-jest', { useESM: true }] }`.
- `testEnvironment: 'node'`.
- `setupFilesAfterEach` to `expect.extend({ toBeValidIso: … })` if useful, never to install global mocks.

### Unit tests

```ts
// apps/api/src/projects/projects.service.spec.ts
describe('ProjectsService', () => {
  let service: ProjectsService;
  let prisma: PrismaStub;

  beforeEach(async () => {
    prisma = createPrismaStub();
    const ref = await Test.createTestingModule({
      providers: [ProjectsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = ref.get(ProjectsService);
  });

  it('creates a project scoped to the tenant', async () => {
    prisma.project.create.mockResolvedValueOnce(fakeProject());
    const result = await service.create('tenant_1', 'user_1', { name: 'x' });
    expect(result.tenantId).toBe('tenant_1');
    expect(prisma.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 'tenant_1', ownerId: 'user_1' }),
    });
  });
});
```

Rules:

- **Mock only what you must**: `PrismaService`, `RedisService`, external HTTP clients, `IEmailProvider`.
- **Never mock the library under test** (`@bymax-one/nest-auth`) — if a unit test requires mocking the library, you're at the wrong layer; move to integration.
- **Use `it` titles as full sentences**: "creates a project scoped to the tenant". Every `it` has a short comment block if the scenario name alone is not enough.
- **One behavior per test**; split rather than nesting `expect`s.

### Integration / e2e

```ts
// apps/api/test/auth.e2e-spec.ts
describe('POST /auth/login (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => app.close());

  it('returns access + refresh cookies for valid credentials', async () => {
    await seedUser({ email: 'demo@example.com', password: 'demo1234!' });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Tenant-Id', 'tenant_1')
      .send({ email: 'demo@example.com', password: 'demo1234!' })
      .expect(200);
    expect(res.headers['set-cookie']?.join()).toMatch(/access_token=.+;/);
    expect(res.headers['set-cookie']?.join()).toMatch(/has_session=.+;/);
  });
});
```

Rules:

- **Real Postgres + Redis + Mailpit** via `docker-compose.test.yml`. `DATABASE_URL_TEST` and `REDIS_URL_TEST` point at the test containers.
- **Reset state per file** with `prisma migrate reset --force --skip-seed` + `redis.flushdb()`. Per-test resets are slow; per-file is usually enough.
- **Seed helpers** live under `apps/api/test/helpers/`. Never duplicate seeding across files.
- **Never mock Prisma or Redis in e2e tests**. Cover the wiring as well as the logic.
- **Assert on headers, status codes, and DB state**. Don't assert on log lines.

### Time and randomness

- Fake timers with `jest.useFakeTimers({ now: new Date('2026-01-01Z') })` when the test asserts on timestamps or TTLs.
- Freeze crypto/IDs via dependency injection; never monkey-patch `crypto.randomUUID()`.

---

## `apps/web` — Vitest + Testing Library

### Config

```ts
// apps/web/vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    css: false,
  },
});
```

`tests/setup.ts` extends `expect` with `@testing-library/jest-dom`.

### Component tests

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { LoginForm } from './login-form';

vi.mock('@/lib/auth-client', () => ({
  authClient: { login: vi.fn().mockResolvedValue(undefined) },
}));

it('submits login with trimmed email and password', async () => {
  const user = userEvent.setup();
  render(<LoginForm />);

  await user.type(screen.getByLabelText(/email/i), 'demo@example.com');
  await user.type(screen.getByLabelText(/password/i), 'demo1234!');
  await user.click(screen.getByRole('button', { name: /sign in/i }));

  const { authClient } = await import('@/lib/auth-client');
  expect(authClient.login).toHaveBeenCalledWith({
    email: 'demo@example.com',
    password: 'demo1234!',
  });
});
```

Rules:

- **Query by role and accessible name first**, then by label, then by text. Never by `data-testid` unless nothing else works — testids are a code smell.
- **Mock only at module boundary** (`vi.mock('@/lib/auth-client')`). Don't spy on internals.
- **Async interactions use `userEvent`**, not `fireEvent`. Matches real browser timing.
- **`act()` warnings are bugs**. Track them down; do not suppress.

### MSW (optional)

For page-level tests that need fetch mocking without coupling to specific modules, use `msw` (Mock Service Worker). Add only when module mocks become a burden.

---

## `apps/web` — Playwright

### Config

```ts
// apps/web/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @nest-auth-example/api start',
      url: 'http://localhost:3001/health',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter @nest-auth-example/web start',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

Rules:

- **Run against the production Next.js build + the built Nest app**, not `next dev` / `nest start --watch`. Dev-mode warnings and hydration timing differ.
- **Infra via `docker-compose.test.yml`**. Playwright does not manage Postgres/Redis.
- **Seed via API calls** or a dedicated `POST /test/seed` endpoint gated by `NODE_ENV==='test'`. Never reach into the DB from a spec.
- **One user journey per spec file**. `login.spec.ts` covers email+password happy path; separate specs for MFA, password reset, OAuth.
- **Assert on visible UI** (`await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible()`), not on DOM internals.
- **Page Object Model** for anything beyond a single form; one class per page under `tests/e2e/pages/`.

---

## Shared rules

### Comment policy

Every `it` / `test` block gets a short comment describing the scenario and the rule it protects when the test name alone doesn't make it obvious.

```ts
// A suspended user must never receive a fresh access token, even if credentials are correct.
// Protects the UserStatusGuard wiring against accidental reordering.
it('rejects login for suspended users', async () => {
  /* … */
});
```

Do not copy the spec name into the comment; add context.

### Fixtures

- Backend fixtures: factory functions returning `Partial<Model>` overrides, composed into full entities by `seedUser`, `seedProject`, etc.
- Frontend fixtures: tiny builders in `tests/fixtures/`, no external library (Factory Bot, etc.) — too much indirection for this size.

### Snapshots

- **Banned** for anything other than static markup output (`<svg>`, `MDX` renderer). Snapshots that grow with the codebase become rubber stamps.
- If you need snapshot-like assertions, serialize just the fields you care about.

### Flake policy

- A flaky test is treated as a broken test. Mark `.skip` and open an issue; fix or delete within the sprint.
- Re-running a spec until it passes is not a strategy.

### Coverage

- Ambition, not a CI gate: ≥ 80% per app, ≥ 100% on library-wiring code (`apps/api/src/auth/*.ts`).
- Coverage reports are generated via `--coverage` in CI for visibility. We do not fail builds on coverage percentages.

---

## Common pitfalls

1. **Mocking `@bymax-one/nest-auth`** — you lose the only reason to have a reference app. Test against the real library.
2. **Using `localhost:5432` in tests** — collides with dev. Always `DATABASE_URL_TEST` on dedicated ports (`55432`, `56379`, `18025`).
3. **Leaking connections** — forgot `await app.close()` or `await redis.quit()`. Jest hangs on shutdown.
4. **Timezone-sensitive assertions** — server runs UTC; test asserts local time. Pin clock or compare ISO strings.
5. **Asserting on exact error messages** — wording changes. Assert on the status code and/or the library error `code`.
6. **Playwright against `next dev`** — dev mode ships extra scripts, hydration races, warning popups. Use the prod build.
7. **Leaving `console.log` in tests** — noise in CI. Lint or self-discipline.
8. **Global test state** — a single mutable seeded fixture shared across files creates order dependence. Seed per-file.
9. **Over-reliance on `data-testid`** — couples tests to implementation detail; breaks on refactors. Query by role/label/text.

---

## References

- Jest: https://jestjs.io/docs/getting-started
- Vitest: https://vitest.dev
- Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- Playwright: https://playwright.dev/docs/intro
- supertest: https://github.com/ladjs/supertest
- Comment policy in tests: [coding-style.md](coding-style.md)
