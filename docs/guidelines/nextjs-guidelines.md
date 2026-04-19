# Next.js Guidelines

Next.js 16 App Router for `apps/web`.

- **Package**: `next` `^16.2.x`
- **Router**: App Router only (`app/`), no Pages Router
- **Runtime**: Node.js `>=24`, React 19, ESM (`"type": "module"`)
- **Styling**: Tailwind CSS 4 (see [tailwind-guidelines.md](tailwind-guidelines.md))
- **Official docs**: https://nextjs.org/docs

---

## When to read this

Before creating or editing anything under `apps/web/app/`, `apps/web/proxy.ts` (middleware), any `route.ts` handler, `next.config.*`, or anything that touches the Server ↔ Client boundary.

---

## App Router fundamentals

- **All routes live under `app/`**. File-based routing — folder = segment, `page.tsx` = rendered page, `route.ts` = API handler, `layout.tsx` = shared wrapper.
- **Server Components by default**; add `'use client'` only when a file (or its subtree) needs hooks, state, event handlers, or browser APIs.
- **Route groups** `(name)/` organize files without affecting URLs. We use `(auth)/` for public auth pages and an unnamed group for the dashboard layout.
- **Dynamic segments** are `[param]`; catch-all `[...slug]`; optional catch-all `[[...slug]]`. Keep them shallow.
- **Parallel routes** (`@slot`) and **intercepting routes** (`(.)`) — avoid unless you genuinely need them. Tab switchers do not require parallel routes.

### File conventions we use

| File            | Role                                                       |
| --------------- | ---------------------------------------------------------- |
| `layout.tsx`    | Shared wrapper; injects `<AuthProvider>`, Tailwind globals |
| `page.tsx`      | Actual rendered route                                      |
| `loading.tsx`   | Suspense fallback for the segment                          |
| `error.tsx`     | Client error boundary (`'use client'` required)            |
| `not-found.tsx` | 404 boundary                                               |
| `route.ts`      | Route handler (GET/POST/…)                                 |
| `default.tsx`   | Default for parallel routes                                |

Do not combine `page.tsx` + `route.ts` in the same folder.

---

## Server vs Client Components

Rules we live by:

1. **Default to Server Components.** They don't ship JS, they can `await` data directly, they can read cookies/headers.
2. **Add `'use client'` at the leaf.** Push the directive as far down the tree as possible; a client leaf can still be rendered from a server parent.
3. **Never pass functions, class instances, or non-serializable objects** from a server parent to a client child. Only serializable props cross the boundary.
4. **Never import a server-only module** (e.g., a `prisma` client, a secret-using helper) from a client component. Use `import 'server-only'` to enforce.
5. **Authenticated data** comes through the library's client hooks (`useSession`, `useAuth`) — do not re-fetch session from a server component and then pass it to a client one; use `<AuthProvider>` plus a server-rendered fallback only when SSR matters for SEO (it does not on an authed dashboard).

```tsx
// app/dashboard/page.tsx (Server Component)
import { cookies } from 'next/headers';
import { DashboardShell } from './dashboard-shell';

export default async function Page() {
  const theme = (await cookies()).get('theme')?.value ?? 'system';
  return <DashboardShell theme={theme} />;
}
```

```tsx
// app/dashboard/dashboard-shell.tsx (Client Component)
'use client';
import { useSession } from '@bymax-one/nest-auth/react';
import type { ComponentProps } from 'react';

export function DashboardShell(props: { theme: string }) {
  const { user } = useSession();
  return <section data-theme={props.theme}>Hello {user.name}</section>;
}
```

---

## Route handlers (`route.ts`)

API endpoints hosted by Next.js. In this repo three handlers exist and **all three are imported directly from the library** — never reimplemented.

```ts
// app/api/auth/silent-refresh/route.ts
export { createSilentRefreshHandler as GET } from '@bymax-one/nest-auth/nextjs';

// app/api/auth/client-refresh/route.ts
export { createClientRefreshHandler as POST } from '@bymax-one/nest-auth/nextjs';

// app/api/auth/logout/route.ts
export { createLogoutHandler as POST } from '@bymax-one/nest-auth/nextjs';
```

For any route handler **we** add:

- Validate input with Zod (see [validation-guidelines.md](validation-guidelines.md)). No unchecked `await req.json()` usage downstream.
- Return `Response` or `NextResponse`. Do not return raw objects.
- Set explicit cache headers when the handler must stay dynamic; dynamic APIs (`cookies()`, `headers()`) already opt out of the full-route cache.
- Never read `process.env` directly — go through the typed `env` helper.

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

const schema = z.object({ feedback: z.string().min(1).max(2000) });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
  // ...
  return NextResponse.json({ ok: true });
}
```

---

## Middleware (`apps/web/proxy.ts`)

The library ships `createAuthProxy` — this repo re-exports it as the Next.js middleware. Do not introduce a parallel middleware.

```ts
// apps/web/proxy.ts
import { createAuthProxy } from '@bymax-one/nest-auth/nextjs';

export default createAuthProxy({
  apiBaseUrl: process.env.NEXT_PUBLIC_API_URL!,
  protectedRoutes: ['/dashboard', '/platform'],
  publicRoutes: [
    '/',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
  ],
});

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
```

- Matcher excludes `api/`, `_next/*`, and the favicon. Add to the exclusion list if new static assets appear.
- Middleware runs on every eligible request — keep the library's config declarative. Any app-specific logic goes inside a route handler or layout, not the middleware.

---

## Data fetching

- **Server-fetch at the Server Component layer**. Use `fetch` with `cache: 'no-store'` for authenticated data, or `cache: 'force-cache'` with `revalidate` for static-ish data.
- **Never fetch from `apps/api` on the client** without `credentials: 'include'`. Without it, cookies are stripped and every request looks unauthenticated.
- **Prefer same-origin fetch through the library's `authClient`**. This gives you silent refresh and error-code mapping for free.
- **Mutations** use Server Actions or a client-side call through `authClient` — pick one per feature and stay consistent.

---

## Environment access

`process.env.*` reads are centralized in `lib/env.ts` with a Zod schema. Client components only read `NEXT_PUBLIC_*` values (Next.js inlines them at build time); never read a server-only secret in a file that might get bundled into the client.

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

Never import `lib/env.ts` from a client component unless you intend to expose every field to the bundle.

---

## Rendering boundaries

- **Streaming**: return a server component that awaits upstream data — Next.js streams HTML as it resolves. Use `loading.tsx` for the segment-level Suspense boundary.
- **`dynamic = 'force-dynamic'`** — set at the route level only when the route reads authenticated cookies and you explicitly want to skip all caching. The library's silent-refresh handler is already dynamic.
- **`revalidate`**: numeric seconds or `false`. Do not mix with `dynamic = 'force-dynamic'`; they conflict.
- **`cookies()`, `headers()`, `draftMode()`** are async — always `await` them. Skipping the await is a TS error in Next.js 16.

---

## Error handling

- `error.tsx` at each boundary that should recover locally. Root-level `app/error.tsx` is the last line of defense.
- Global errors (chunk load, hydration failure) go in `app/global-error.tsx`.
- Never `try/catch { throw new Error('...') }` without logging — the browser console is the only signal otherwise.

---

## Images, fonts, metadata

- **`next/image`** over `<img>`. Always provide `width`, `height`, and `alt`.
- **`next/font`** for local and Google Fonts. Never `<link>` a stylesheet manually; breaks font-display CSS.
- **Metadata**: export a `metadata` object or `generateMetadata` from `page.tsx`. Do not `document.title = …` from a client component.

---

## Testing

- **Unit / component**: Vitest 4 + `@testing-library/react` (see [testing-guidelines.md](testing-guidelines.md)). Render server-safe components directly; mark client components with `'use client'` and mock library hooks.
- **E2E**: Playwright 1, against a real Next.js build + Nest API via `docker-compose.test.yml`.
- **Never test middleware directly** — drive it through Playwright hitting protected routes.

---

## Common pitfalls

1. **`'use client'` on a layout** — turns the entire subtree into a client boundary; lose streaming and server data access.
2. **`cookies()` / `headers()` called without `await`** — TS error in 16; in 15 it silently returned a thenable and code paths missed the values.
3. **Reading a server secret in a `'use client'` file** — bundle embeds nothing for server-only vars, the value is `undefined` at runtime.
4. **Client fetch to `apps/api` without `credentials: 'include'`** — cookies never attach.
5. **`fetch` inside a Server Component with implicit caching** — 16 defaults to no-store for dynamic routes, but explicit `cache:` keeps intent clear.
6. **Duplicated middleware** — someone adds a `middleware.ts` next to `proxy.ts`. Next only runs one file; the library's proxy must remain the single source.
7. **Using `useRouter` from `next/router`** — legacy Pages Router. App Router uses `next/navigation`.
8. **`<a href>` for internal navigation** — bypass client-side routing. Use `<Link>` from `next/link`.

---

## References

- Next.js docs: https://nextjs.org/docs
- App Router conventions: https://nextjs.org/docs/app/getting-started
- Server & Client Components: https://nextjs.org/docs/app/getting-started/server-and-client-components
- Route handlers: https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- `createAuthProxy`, `createAuthClient`: [nest-auth-guidelines.md](nest-auth-guidelines.md)
