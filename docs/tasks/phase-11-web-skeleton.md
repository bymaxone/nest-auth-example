# Phase 11 — `apps/web` Skeleton (Next.js 16 + Tailwind + shadcn/ui) — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-11--appsweb-skeleton-nextjs-16--tailwind--shadcnui) §Phase 11
> **Total tasks:** 6
> **Progress:** 🟢 6 / 6 done (100%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID    | Task                                                                 | Status | Priority | Size | Depends on |
| ----- | -------------------------------------------------------------------- | ------ | -------- | ---- | ---------- |
| P11-1 | `apps/web/package.json` + dependency manifest + scripts              | 🟢     | High     | S    | Phase 2    |
| P11-2 | `next.config.mjs` rewrites + `tsconfig.json` path alias              | 🟢     | High     | S    | P11-1      |
| P11-3 | Tailwind CSS v4 setup (`tailwind.config.ts`, `globals.css`, PostCSS) | 🟢     | High     | S    | P11-1      |
| P11-4 | shadcn/ui bootstrap + baseline component set                         | 🟢     | High     | M    | P11-3      |
| P11-5 | `app/layout.tsx` (HTML shell + font) + `app/page.tsx` (landing)      | 🟢     | High     | S    | P11-3      |
| P11-6 | `lib/env.ts` — zod-parsed, frozen env schema                         | 🟢     | High     | S    | P11-1      |

---

## P11-1 — `apps/web/package.json` + dependency manifest + scripts

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S
- **Depends on:** Phase 2

### Description

Create the `apps/web` Next.js package manifest. The app is the reference frontend consumer of `@bymax-one/nest-auth` (linked locally per Phase 2) and must declare every runtime dependency the remaining Phase 11–16 tasks will pull in. ESM-only, matching the library's module system per `docs/DEVELOPMENT_PLAN.md` §2.

### Acceptance Criteria

- [ ] `apps/web/package.json` exists with `"name": "@nest-auth-example/web"`, `"private": true`, `"type": "module"`, `"version": "0.1.0"`.
- [ ] `dependencies`: `next@^16`, `react@^19`, `react-dom@^19`, `@bymax-one/nest-auth` (linked), `zod`, `react-hook-form`, `@hookform/resolvers`, `lucide-react`, `date-fns`, `sonner`, and either `socket.io-client` (preferred for Phase 16) or a note that native `WebSocket` is used — pick one.
- [ ] `devDependencies`: `typescript@^5`, `eslint-config-next`, `tailwindcss@^4`, `@tailwindcss/postcss`, `autoprefixer`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `playwright`, `@playwright/test`, `@types/node`, `@types/react`, `@types/react-dom`.
- [ ] `scripts`: `dev` (`next dev`), `build` (`next build`), `start` (`next start`), `typecheck` (`tsc --noEmit`), `lint` (`next lint`), `test` (`vitest run`), `test:e2e` (`playwright test`).
- [ ] `engines.node: ">=24"`.
- [ ] `pnpm install` at the repo root succeeds and `@bymax-one/nest-auth` resolves to the linked sibling checkout.

### Files to create / modify

- `apps/web/package.json` — new manifest.
- `pnpm-workspace.yaml` — verify `apps/*` glob already includes `apps/web`.

### Agent Execution Prompt

> Role: Senior Next.js 16 / React 19 engineer shipping the first consumer of `@bymax-one/nest-auth`.
> Context: Phase 11 of `nest-auth-example` bootstraps `apps/web`. The app must demonstrate FCM rows #25–#29 later (`useSession`, `useAuth`, `useAuthStatus`, `createAuthProxy`, `createSilentRefreshHandler`, `createClientRefreshHandler`, `createLogoutHandler`), so the dependency list is fixed by `docs/DEVELOPMENT_PLAN.md` §Phase 11.
> Objective: Author `apps/web/package.json` with every runtime + dev dep declared.
> Steps: 1. Create the file with the exact shape listed in Acceptance Criteria. 2. Run `pnpm install` from the repo root and confirm `@bymax-one/nest-auth` resolves via link. 3. Commit no lockfile drift for unrelated apps.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (ESM, pnpm, Node 24, strict TS).
> - Do not add peer-dep overrides without justification.
> - Pin major versions only; let pnpm resolve the exact patch.
>   Verification:
> - `pnpm install` — expected: clean resolution, linked package present.
> - `pnpm --filter @nest-auth-example/web exec next --version` — expected: prints `16.x`.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P11-1 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P11-2 — `next.config.mjs` rewrites + `tsconfig.json` path alias

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S
- **Depends on:** `P11-1`

### Description

Wire Next.js rewrites so the browser always talks to the same origin (`/api/*`) while the server proxies through to the NestJS API at `INTERNAL_API_URL`. Also configure `tsconfig.json` with the `@/*` alias required throughout `apps/web`. This guarantees cookie flows and auth-client calls keep a single registrable domain — a prerequisite for `createAuthProxy` and the three refresh/logout handlers.

### Acceptance Criteria

- [ ] `apps/web/next.config.mjs` exports a default `NextConfig` with `experimental.reactCompiler: true`.
- [ ] `rewrites()` maps `/api/:path*` → `${process.env.INTERNAL_API_URL}/api/:path*` (server-side only; browser keeps same-origin).
- [ ] `apps/web/tsconfig.json` extends the root `tsconfig.base.json` and declares `paths: { "@/*": ["./*"] }`, `jsx: "preserve"`, `module: "esnext"`, `moduleResolution: "bundler"`, `strict: true`.
- [ ] `include` covers `next-env.d.ts`, `**/*.ts`, `**/*.tsx`, `.next/types/**/*.ts`.
- [ ] `pnpm --filter @nest-auth-example/web typecheck` passes on a placeholder `app/page.tsx`.

### Files to create / modify

- `apps/web/next.config.mjs` — new.
- `apps/web/tsconfig.json` — new.
- `apps/web/next-env.d.ts` — created by `next` on first run; commit it.

### Agent Execution Prompt

> Role: Senior Next.js / React engineer.
> Context: FCM row #26 (`createAuthProxy`) and #27 (`createSilentRefreshHandler`, `createClientRefreshHandler`) require the browser to issue all auth-related requests to the same origin. The Next.js rewrite is how that is achieved in the dev stack.
> Objective: Produce a `next.config.mjs` with the `/api/:path*` rewrite and a `tsconfig.json` with the `@/*` alias.
> Steps: 1. Author `next.config.mjs` reading `process.env.INTERNAL_API_URL` (do not import `lib/env.ts` here — the config runs before env parsing in some contexts; rely on Next.js' built-in `.env` loading). 2. Author `tsconfig.json` extending the root base. 3. Run typecheck to confirm.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Do not hardcode URLs; always go through env.
> - Do not create a `next.config.ts` — stick to `.mjs` to match the repo convention.
>   Verification:
> - `pnpm --filter @nest-auth-example/web typecheck` — expected: green.
> - `INTERNAL_API_URL=http://localhost:4000 pnpm --filter @nest-auth-example/web build` — expected: build succeeds (placeholder page only).

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P11-2 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P11-3 — Tailwind CSS v4 setup (`tailwind.config.ts`, `globals.css`, PostCSS)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S
- **Depends on:** `P11-1`

### Description

Install and configure Tailwind CSS v4 — the styling substrate for every page and every shadcn/ui primitive in Phases 11–15. Tailwind v4 uses the new `@tailwindcss/postcss` pipeline and CSS-first configuration; this task lays down the config, the PostCSS plumbing, and the `app/globals.css` entry.

### Acceptance Criteria

- [ ] `apps/web/tailwind.config.ts` exports a `Config` with `content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}']` and `theme.extend` left open for shadcn tokens.
- [ ] `apps/web/postcss.config.mjs` (or `.cjs` if required by the pnpm version) registers `@tailwindcss/postcss` + `autoprefixer`.
- [ ] `apps/web/app/globals.css` starts with `@import "tailwindcss";` and declares CSS variables placeholder blocks for light + dark color tokens (populated in P11-4 by shadcn init).
- [ ] `app/layout.tsx` imports `./globals.css` (even if the layout is a placeholder at this point).
- [ ] `pnpm --filter @nest-auth-example/web build` succeeds with a non-empty CSS chunk.

### Files to create / modify

- `apps/web/tailwind.config.ts` — new.
- `apps/web/postcss.config.mjs` — new.
- `apps/web/app/globals.css` — new.

### Agent Execution Prompt

> Role: Senior frontend engineer familiar with Tailwind v4's CSS-first model.
> Context: shadcn/ui 2025 generators (P11-4) expect Tailwind v4 + `@tailwindcss/postcss`. The repo's UI convention (see `docs/DEVELOPMENT_PLAN.md` §2 — "UI kit") is Tailwind v4 + shadcn/ui exclusively.
> Objective: Produce a working Tailwind v4 pipeline that builds a non-empty CSS chunk.
> Steps: 1. Author `tailwind.config.ts` with the content globs above. 2. Author `postcss.config.mjs` using `@tailwindcss/postcss` (not the legacy `tailwindcss` plugin). 3. Seed `globals.css` with the `@tailwindcss` import and empty `:root` / `.dark` blocks (shadcn will fill them next). 4. Import `globals.css` in a placeholder `app/layout.tsx`.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Do not use the Tailwind v3 three-directive pattern (`@tailwind base/components/utilities`) — v4 uses the single `@import "tailwindcss"`.
> - No Tailwind plugins unless shadcn requires them in P11-4.
>   Verification:
> - `pnpm --filter @nest-auth-example/web build` — expected: success, CSS asset > 1 KB.
> - `pnpm --filter @nest-auth-example/web dev` + open `http://localhost:3000` — expected: base Tailwind reset visible (no FOUC).

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P11-3 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P11-4 — shadcn/ui bootstrap + baseline component set

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** M
- **Depends on:** `P11-3`

### Description

Run `npx shadcn@latest init` in `apps/web` to register the `@/components/ui` alias and install the component baseline required by Phases 12–15: `button`, `input`, `form`, `dialog`, `toast`, `dropdown-menu`, `avatar`, `card`, `tabs`, `badge`, `tooltip`. The `docs/GETTING_STARTED.md` walkthrough must document the exact commands a contributor will re-run in their own checkout.

### Acceptance Criteria

- [ ] `apps/web/components.json` exists with `style: "new-york"` (or the repo's chosen style), `rsc: true`, `tsx: true`, and aliases `components: "@/components"`, `utils: "@/lib/utils"`, `ui: "@/components/ui"`.
- [ ] `apps/web/lib/utils.ts` exports `cn(...)` from shadcn's standard helper.
- [ ] `apps/web/components/ui/` contains: `button.tsx`, `input.tsx`, `form.tsx`, `dialog.tsx`, `toast.tsx` (or `sonner.tsx` wrapper if the generator unified them), `dropdown-menu.tsx`, `avatar.tsx`, `card.tsx`, `tabs.tsx`, `badge.tsx`, `tooltip.tsx`.
- [ ] `app/globals.css` has the generator-populated CSS variables for light + dark themes.
- [ ] `docs/GETTING_STARTED.md` lists the `npx shadcn@latest init` + `npx shadcn@latest add ...` commands in a code block under a "UI primitives" subheading.
- [ ] `pnpm --filter @nest-auth-example/web typecheck` passes across all generated files.

### Files to create / modify

- `apps/web/components.json` — generator output, commit it.
- `apps/web/lib/utils.ts` — `cn` helper.
- `apps/web/components/ui/*.tsx` — eleven generated components.
- `apps/web/app/globals.css` — updated by generator.
- `docs/GETTING_STARTED.md` — add commands (may be created as a stub if absent).

### Agent Execution Prompt

> Role: Senior Next.js engineer shipping a polished reference UI using shadcn/ui 2025.
> Context: FCM rows #25–#28 need a clean UI substrate. The repo mandates shadcn/ui + Tailwind v4 (see `docs/DEVELOPMENT_PLAN.md` §2). Every subsequent page task (P11-5, Phase 12, Phase 13) will import from `@/components/ui/*` — so this generator run is load-bearing.
> Objective: Initialize shadcn/ui and generate eleven baseline primitives.
> Steps: 1. From `apps/web`, run `npx shadcn@latest init` and answer: TypeScript yes, style "new-york", base color `neutral`, CSS variables yes, React Server Components yes, import aliases as per Acceptance Criteria. 2. Run `npx shadcn@latest add button input form dialog dropdown-menu avatar card tabs badge tooltip sonner`. (Use `sonner` for toasts — it pairs with the `sonner` runtime dep declared in P11-1.) 3. Record the exact commands in `docs/GETTING_STARTED.md`. 4. Verify typecheck.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Do not hand-edit generator output except to fix typecheck issues introduced by stricter `tsconfig` flags.
> - Do not install extra primitives — future tasks add them on demand.
>   Verification:
> - `pnpm --filter @nest-auth-example/web typecheck` — expected: green.
> - `ls apps/web/components/ui` — expected: eleven `.tsx` files.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P11-4 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P11-5 — `app/layout.tsx` (HTML shell + font) + `app/page.tsx` (landing)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S
- **Depends on:** `P11-3`, `P11-4`

### Description

Ship the root layout and marketing landing page. The layout owns the `<html>` / `<body>` shell, loads the Inter or Geist font via `next/font`, and imports `globals.css`. The landing page is a minimal "Welcome. Visit `/auth/login`." surface — it's the first deliverable a human sees when running `pnpm dev`, and the Phase 11 definition of done is that it renders without errors.

### Acceptance Criteria

- [ ] `apps/web/app/layout.tsx` is an RSC exporting `default function RootLayout({ children })` with `<html lang="en">` and `<body>` wrapping `{children}`.
- [ ] Uses `next/font` to load Inter or Geist and applies the variable/class to `<body>`.
- [ ] Imports `./globals.css` at the top of the file.
- [ ] Exports `metadata: Metadata` with `title: "nest-auth-example"` and `description` referencing `@bymax-one/nest-auth`.
- [ ] `apps/web/app/page.tsx` renders a centered card with "Welcome" headline and a shadcn `<Button asChild>` linking to `/auth/login`.
- [ ] `pnpm --filter @nest-auth-example/web dev` serves `http://localhost:3000` with no runtime errors, no hydration warnings.

### Files to create / modify

- `apps/web/app/layout.tsx` — new.
- `apps/web/app/page.tsx` — new.

### Agent Execution Prompt

> Role: Senior Next.js 16 / React 19 engineer shipping polished landing UX.
> Context: This is the Phase 11 definition of done — `pnpm dev` must render a landing page. Phase 12 will wrap this layout with `<AuthProvider>`; keep the shell minimal and decomposition-friendly.
> Objective: Ship a working `app/layout.tsx` + `app/page.tsx`.
> Steps: 1. Author `layout.tsx` importing `./globals.css`, loading Inter via `next/font/google` (or Geist via `next/font/local` if preferred), applying the font className to `<body>`. 2. Export `metadata`. 3. Author `page.tsx` with a centered layout using `@/components/ui/card` + `@/components/ui/button`. 4. Smoke-test locally.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Do not add any auth logic here — that's Phase 12.
> - No client components unless strictly necessary — both files should be server components.
> - Keep the landing copy under 2 sentences; link to `/auth/login`.
>   Verification:
> - `pnpm --filter @nest-auth-example/web build` — expected: success, landing route statically rendered.
> - `pnpm --filter @nest-auth-example/web dev`, open `http://localhost:3000` — expected: landing visible, no console errors.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P11-5 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P11-6 — `lib/env.ts` — zod-parsed, frozen env schema

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S
- **Depends on:** `P11-1`

### Description

Define and parse every environment variable `apps/web` will consume, with zod, at module load. Freeze the parsed object so downstream code cannot mutate it. This module is imported by `proxy.ts`, `lib/auth-client.ts`, route handlers, and server components — so a typed, validated singleton is critical. Covers the env surface `AUTH_JWT_SECRET_FOR_PROXY` (HS256 mirror used by the proxy) and the public URLs used by `createAuthClient` and the WebSocket client.

### Acceptance Criteria

- [ ] `apps/web/lib/env.ts` declares `envSchema = z.object({...})` with at minimum:
  - `NEXT_PUBLIC_API_URL: z.string().url()`
  - `INTERNAL_API_URL: z.string().url()`
  - `AUTH_JWT_SECRET_FOR_PROXY: z.string().min(32)`
  - `NEXT_PUBLIC_WS_URL: z.string().url()`
  - `NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED: z.enum(['true', 'false']).transform(v => v === 'true').default('false')`
- [ ] Parses `process.env` at module load and throws with a readable error if validation fails.
- [ ] Exports `export const env = Object.freeze(envSchema.parse(process.env))`.
- [ ] Ships a matching `apps/web/.env.example` with every key and a comment per key.
- [ ] `typeof env` is inferable as a const-shaped record (`export type Env = Readonly<z.infer<typeof envSchema>>`).

### Files to create / modify

- `apps/web/lib/env.ts` — new.
- `apps/web/.env.example` — new.
- `.env.example` (repo root) — append the same keys if they are not already present.

### Agent Execution Prompt

> Role: Senior Next.js engineer shipping a typed, frozen env module.
> Context: FCM rows #26–#28 (`createAuthProxy`, `createSilentRefreshHandler`, `createClientRefreshHandler`, `createLogoutHandler`) all consume values from this module. `AUTH_JWT_SECRET_FOR_PROXY` mirrors the API's HS256 JWT secret so the edge proxy can verify cookies without hitting the API.
> Objective: Ship `lib/env.ts` and `.env.example`.
> Steps: 1. Author the schema with the keys listed in Acceptance Criteria. 2. Parse eagerly; rethrow with a framed error ("Invalid web env:\n" + formatted zod issues). 3. `Object.freeze` the result. 4. Mirror the keys into `.env.example` with one-line comments.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Never access `process.env` anywhere else in `apps/web` — always go through `env`.
> - Distinguish `NEXT_PUBLIC_*` (client-exposed) from server-only vars; document the distinction in comments.
>   Verification:
> - `pnpm --filter @nest-auth-example/web typecheck` — expected: green.
> - `node --input-type=module -e "import('./apps/web/lib/env.ts')"` with the example env set — expected: no throw; with a missing key — expected: framed error.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P11-6 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## Completion log

- P11-1 ✅ 2026-04-25 — `apps/web/package.json` confirmed complete with all runtime + dev deps
- P11-2 ✅ 2026-04-25 — `next.config.mjs` with /api proxy rewrite + `tsconfig.json` with @/\* alias
- P11-3 ✅ 2026-04-25 — Tailwind v4 + PostCSS + globals.css with full orange/dark design system tokens
- P11-4 ✅ 2026-04-25 — shadcn/ui components.json + 11 glassmorphism-styled UI primitives
- P11-5 ✅ 2026-04-25 — Geist font layout + landing page with hero/features/CTA matching ai-product-assistant aesthetic
- P11-6 ✅ 2026-04-25 — lib/env.ts with zod-validated frozen env + .env.example
