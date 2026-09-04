# `@bymax-one/nest-auth` Consumption Guidelines

This repository is the canonical consumer of the library. Every feature the library exposes is wired here, and every wiring choice follows the same pattern so the code is copy-paste friendly.

- **Package**: `@bymax-one/nest-auth` `^1.4.5`
- **Subpaths**: core (server), `/shared`, `/client`, `/react`, `/nextjs`
- **Local dev**: `pnpm link` from sibling `../nest-auth` (see [OVERVIEW §7](../OVERVIEW.md))
- **Upstream repo**: https://github.com/bymax-one/nest-auth

---

## When to read this

Before wiring `BymaxAuthModule.registerAsync`, implementing `IUserRepository` / `IPlatformUserRepository` / `IEmailProvider` / `IAuthHooks`, writing `createAuthClient` / `createAuthProxy` / the three route handlers in `apps/web`, or using any library guard/decorator in app code.

---

## Module registration

Register asynchronously so config values are validated before the module initializes.

```ts
// apps/api/src/auth/auth.module.ts — real wiring (abridged)
BymaxAuthModule.registerAsync({
  imports: [ConfigModule, PrismaModule],
  useFactory: (config: ConfigService<Env, true>) => buildAuthOptions(config),
  inject: [ConfigService],
  // controllers.* flags live on registerAsync (module build time), not inside
  // useFactory — returning them from the factory is a startup error (lib v1.1.0+).
  controllers: {
    mfa: true,
    oauth: isGoogleOAuthConfigured(),
    sessions: true,
    platform: true,
    invitations: true,
  },
  // Implementations bind to the library's injection tokens via extraProviders.
  extraProviders: [
    { provide: BYMAX_AUTH_REDIS_CLIENT, useFactory: buildRedisClient, inject: [ConfigService] },
    { provide: BYMAX_AUTH_USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: BYMAX_AUTH_PLATFORM_USER_REPOSITORY, useClass: PrismaPlatformUserRepository },
    { provide: BYMAX_AUTH_EMAIL_PROVIDER, useClass: EmailProviderClass },
    { provide: BYMAX_AUTH_HOOKS, useClass: AppAuthHooks },
    // Optional: swap the offline CommonPasswordChecker for HIBP k-anonymity.
    // { provide: BYMAX_AUTH_BREACH_CHECKER, useValue: new HibpBreachChecker() },
  ],
});
```

The options object itself is built in [`auth.config.ts`](../../apps/api/src/auth/auth.config.ts)
(`buildAuthOptions`) — the authoritative example. Highlights of the current
(v1.4.5) option surface it demonstrates:

- `environment` — explicit `'production' | 'development' | 'test'`; the library
  defaults to production and never sniffs `NODE_ENV`.
- `rateLimit` — REQUIRED group: `{ enabled: true, clientIpSource: 'peer' | 'trusted-proxy' }`
  or `{ enabled: false }`. `clientIpSource` is compile-enforced while enabled.
- `password` — `minLength` (default 15) + `blocklist` (deployment words for the
  offline `CommonPasswordChecker`).
- `jwt.absoluteSessionLifetimeDays` — hard 30-day cap (on by default, 30 max).
- `mfa.totpWindow`, `mfa.recoveryCodeCount` — startup-validated bounds.
- `cookies.trustedOrigins` — arms `TrustedOriginGuard` (CSRF defence in depth).
- `tenantIdResolver` — header-first, `tenant_id` cookie fallback (see rule 5).

### Non-negotiables

1. **`registerAsync`**, never `register`. Config validation must happen first.
2. **`tokenDelivery: 'cookie'`** for this reference. Bearer mode exists but is out of scope — a different branch would demonstrate it.
3. **`redisNamespace`** is required — shared Redis between projects without it collides.
4. **`controllers.*` flags are explicit** — never `controllers: true` as a shortcut; adding a new controller must be an intentional wiring step.
5. **`tenantIdResolver` is a pure function** — no DB reads, no async work. Sources: `X-Tenant-Id` header first, then the `tenant_id` cookie (top-level navigations such as OAuth initiate/callback, which cannot carry a custom header). Never the request body — since lib v1.4.2 a body `tenantId` is refused with `400 auth.validation` when a resolver is configured.

---

## Implementing repositories

`PrismaUserRepository` and `PrismaPlatformUserRepository` are thin translation layers. No business logic, no cross-table joins beyond what the interface declares.

Since lib v1.4.4 every account-naming method takes a **single object parameter**
carrying the mandatory tenant scope (`TenantScopedUserRef` and friends) — the
object shape makes a stale positional implementation fail to compile instead of
silently mis-binding arguments.

```ts
@Injectable()
export class PrismaUserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById({ id, tenantId }: TenantScopedUserRef) {
    return this.prisma.user.findFirst({ where: { id, tenantId } });
  }

  findByEmail({ email, tenantId }: FindUserByEmailParams) {
    return this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: email.toLowerCase() } },
    });
  }

  updatePassword({ id, tenantId, passwordHash }: UpdatePasswordParams) {
    // Writes MUST be tenant-scoped: updateMany({ where: { id, tenantId } }),
    // never update({ where: { id } }) — ids may not be unique across tenants.
    return this.prisma.user.updateMany({ where: { id, tenantId }, data: { passwordHash } });
  }

  create(data: CreateUserData) {
    return this.prisma.user.create({ data });
  }

  // ... every IUserRepository method
}
```

Rules:

- **Pass-through shapes**: do not reshape the objects the library expects. `passwordHash`, `mfaSecret`, `mfaRecoveryCodes` round-trip verbatim.
- **Every read AND write is scoped by `(id, tenantId)`** — the port contract since lib v1.4.4. Prisma writes use `updateMany` with both fields in the WHERE clause.
- **Email is stored lower-case**; enforce on writes, normalize on reads. Prevents case-only account duplication.
- **Never log any repository argument** — many contain raw credentials.
- **`createdAt` / `updatedAt`** are Prisma-owned; the library only reads them.

---

## Email provider

See [email-guidelines.md](email-guidelines.md). The library's `IEmailProvider` contract is the only input — do not add methods.

---

## Hooks (`IAuthHooks`)

Wire every lifecycle event to `audit_logs`. The library will not persist audit state for you.

```ts
@Injectable()
export class AppAuthHooks implements IAuthHooks {
  constructor(private readonly prisma: PrismaService) {}

  async afterRegister(user: SafeAuthUser, context: HookContext) {
    await this.prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        actorUserId: user.id,
        event: 'user.registered',
        payload: { role: user.role },
        ip: context.ip,
        userAgent: context.userAgent,
      },
    });
  }
  // ... every lifecycle hook, including the failure side (lib v1.1.0+):
  // onLoginFailed, onLockout, onRefreshTokenReuseDetected — see
  // apps/api/src/auth/app-auth.hooks.ts for the full catalogue.
}
```

- Hooks are **non-blocking** in the library's contract — a throw does not roll back the user action. Use the logger to surface errors and let the audit row be missing rather than breaking auth flows.
- Keep payloads **coarse**. Do not log `passwordHash`, raw emails, or MFA codes. Store hashed/coarse references (see [observability-guidelines.md](observability-guidelines.md)).

---

## Decorators & guards (from the library)

Use the ones the library exports. Do not re-implement.

| Export             | Use                                                                       |
| ------------------ | ------------------------------------------------------------------------- |
| `@CurrentUser()`   | Injects the authenticated user into controllers / WS gateways             |
| `@Roles(...)`      | Route-level RBAC; combine with `RolesGuard`                               |
| `@Public()`        | Skip `JwtAuthGuard` on a route (e.g., `/health`)                          |
| `@SkipMfa()`       | Allow route before MFA challenge completes (e.g., MFA setup form handler) |
| `JwtAuthGuard`     | Global guard in `APP_GUARD`                                               |
| `RolesGuard`       | Global guard in `APP_GUARD`                                               |
| `UserStatusGuard`  | Global guard in `APP_GUARD` — blocks `suspended` / `locked`               |
| `MfaRequiredGuard` | Global guard in `APP_GUARD` — returns `MFA_REQUIRED` pre-challenge        |
| `JwtPlatformGuard` | Platform admin routes only                                                |
| `WsJwtGuard`       | WebSocket gateways                                                        |

Global guard order (set in `APP_GUARD` providers — see `app.module.ts`):

1. `ThrottlerGuard` (`@nestjs/throttler`, app-level route throttling)
2. `AppJwtAuthGuard` (app-owned wrapper over `JwtAuthGuard` / `JwtPlatformGuard`)
3. `UserStatusGuard`
4. `MfaRequiredGuard`
5. `TenantMfaPolicyGuard` (app-owned, honours the library's `SKIP_MFA_KEY`)
6. `RolesGuard`

Any change to this order needs an ADR.

---

## Frontend wiring (apps/web)

Three route handlers, one provider, one proxy. All come from the library.

```ts
// apps/web/lib/auth-client.ts — the /client subpath (framework-free fetch client)
import { createAuthClient, createAuthFetch } from '@bymax-one/nest-auth/client';

const authFetch = createAuthFetch({
  baseUrl: '/api',
  routePrefix: 'auth',
  credentials: 'include',
  // lib v1.4.4+: onSessionExpired fires only on real rejections; every refresh
  // failure (rejected | unavailable | unreachable) reports here.
  onRefreshFailed: reportRefreshFailure,
});
// App-owned wrapper injects X-Tenant-Id from the tenant_id cookie on every call.
export const authClient = createAuthClient({
  baseUrl: '',
  routePrefix: 'auth',
  authFetch: tenantAwareFetch,
});
```

```ts
// apps/web/proxy.ts — Next.js proxy (the /nextjs subpath, Edge-safe)
import { createAuthProxy } from '@bymax-one/nest-auth/nextjs';

const authProxy = createAuthProxy({
  publicRoutes,
  publicRoutesRedirectIfAuthenticated: ['/auth/login', '/auth/register'],
  protectedRoutes, // role-gated ProtectedRoutePattern[]
  loginPath: '/auth/login',
  getDefaultDashboard,
  apiBase: env.INTERNAL_API_URL,
  jwtSecret: env.AUTH_JWT_SECRET_FOR_PROXY, // REQUIRED since lib v1.2.0
  cookieNames,
  userHeaders,
  blockedUserStatuses: ['BANNED', 'INACTIVE', 'SUSPENDED'],
});
export const proxy = authProxy.proxy;
```

```ts
// apps/web/app/api/auth/silent-refresh/route.ts — factory, then export
import { createSilentRefreshHandler } from '@bymax-one/nest-auth/nextjs';
export const GET = createSilentRefreshHandler({
  /* apiBase, cookie names, … */
});
```

Mirror the same factory pattern for `client-refresh/route.ts` (`createClientRefreshHandler` → `POST`) and `logout/route.ts` (`createLogoutHandler` → `POST`). No custom logic — the library owns these.

---

## React hooks

```tsx
'use client';
import { useSession, useAuth, useAuthStatus } from '@bymax-one/nest-auth/react';

export function AccountCard() {
  const { user, tenant } = useSession();
  const { logout } = useAuth();
  const status = useAuthStatus(); // 'loading' | 'authenticated' | 'unauthenticated'
  // ...
}
```

- Mount `<AuthProvider>` in the layout of **each segment whose routes need a
  session** — here `app/auth/layout.tsx` and `app/dashboard/layout.tsx` — not in
  the root `app/layout.tsx`. The provider probes the session as soon as it
  mounts, so a root-level mount makes public routes (the landing page) issue an
  identity request and a token refresh that can only ever be refused. Nesting it
  under a layout that already mounts it is unnecessary; a new authenticated
  segment has to mount it itself.
- Keep app-wide UI that needs no session — the `<Toaster>`, for instance — in the
  root layout rather than inside the provider, so it is not coupled to the auth
  boundary.
- `useSession()` throws outside `<AuthProvider>` — catch this in a root error boundary.
- `useAuthStatus()` is cheap; use it to gate UI states without re-fetching.

---

## Error codes

`AUTH_ERROR_CODES` is the shared vocabulary between backend responses and frontend forms.

```ts
import { AUTH_ERROR_CODES, AUTH_ERROR_STATUS } from '@bymax-one/nest-auth/shared';
// Keys: INVALID_CREDENTIALS | MFA_REQUIRED | ACCOUNT_LOCKED | …
// Values on the wire: 'auth.invalid_credentials', 'auth.mfa_required', …
// AUTH_ERROR_STATUS (lib v1.4.1+) maps each code to its single HTTP status —
// assert statuses from this map instead of hardcoding numbers.
```

- **Never invent new codes** on top of this map. If a new scenario emerges, open an issue against the library.
- Frontend error toast maps each code to an i18n key; do not display raw codes.

---

## Upgrades

Each major bump of the library is a long-lived branch here — see `docs/RELEASES.md` (to be added). Migration steps per bump:

1. Read the library changelog.
2. Bump the dependency in both `apps/api` and `apps/web` `package.json`.
3. Run `pnpm install`, `pnpm typecheck` — TS errors are the primary migration signal.
4. Run the full e2e suite (`docker compose -f docker-compose.test.yml up -d && pnpm -r test:e2e`).
5. Update `docs/OVERVIEW.md` §15 "Versioning & Release Tracking" with the new tag.

---

## Common pitfalls

1. **Re-hashing `passwordHash` in a repository** — locks every user out.
2. **Reshaping user objects** in the repo ("selecting" a few fields to be polite) — library relies on the full shape.
3. **Wrong global guard order** — `MfaRequiredGuard` before `JwtAuthGuard` produces a confusing 401/403 mix.
4. **Skipping the `has_session` cookie** — the edge proxy and `useAuthStatus()` rely on it for a cheap signed-in check.
5. **Wrapping library DTOs** in a project-local DTO — breaks field additions in minor upgrades.
6. **Silent catches in hooks** — audit rows disappear, incident forensics are blind.
7. **Missing `credentials: 'include'` on fetches from `apps/web` to `apps/api`** — cookies never leave the browser, every request looks unauthenticated.
8. **Sending `tenantId` in a request body** — refused with `400 auth.validation` since lib v1.4.2 when a `tenantIdResolver` is configured. The header (or the navigation cookie fallback) is the only channel.
9. **Positional `IUserRepository` signatures** — since lib v1.4.4 every account-naming method takes a single object (`{ id, tenantId }`); writes must be tenant-scoped (`updateMany`).
10. **Seeding legacy `scrypt:{salt}:{hash}` hashes** — only the PHC form (`$scrypt$ln=…,r=…,p=…$…$…`) is parsed since lib v1.1.0; legacy rows cannot log in.
11. **Calling `DELETE /auth/sessions/all`** — moved to `POST /auth/sessions/revoke-all` in lib v1.4.3.
12. **Reading the access token's `status` claim as authoritative** — it is point-in-time only (empty after rotation); read status via `UserStatusGuard`/repository.

---

## References

- Library `README.md` in the sibling checkout
- [OVERVIEW.md §6 Feature Coverage Matrix](../OVERVIEW.md)
- [OVERVIEW.md §7 Library Linking](../OVERVIEW.md)
- [environment-guidelines.md](environment-guidelines.md)
- [observability-guidelines.md](observability-guidelines.md)
