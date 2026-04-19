# `@bymax-one/nest-auth` Consumption Guidelines

This repository is the canonical consumer of the library. Every feature the library exposes is wired here, and every wiring choice follows the same pattern so the code is copy-paste friendly.

- **Package**: `@bymax-one/nest-auth` `^1.0.0`
- **Subpaths**: core (server), `/shared`, `/react`, `/nextjs`
- **Local dev**: `pnpm link` from sibling `../nest-auth` (see [OVERVIEW §7](../OVERVIEW.md))
- **Upstream repo**: https://github.com/bymax-one/nest-auth

---

## When to read this

Before wiring `BymaxAuthModule.registerAsync`, implementing `IUserRepository` / `IPlatformUserRepository` / `IEmailProvider` / `IAuthHooks`, writing `createAuthClient` / `createAuthProxy` / the three route handlers in `apps/web`, or using any library guard/decorator in app code.

---

## Module registration

Register asynchronously so config values are validated before the module initializes.

```ts
// apps/api/src/auth/auth.module.ts
BymaxAuthModule.registerAsync({
  imports: [PrismaModule, RedisModule, ConfigModule],
  useFactory: (
    config: ConfigService<Env, true>,
    users: PrismaUserRepository,
    platformUsers: PrismaPlatformUserRepository,
    email: IEmailProvider,
    hooks: AppAuthHooks,
    redis: RedisService,
  ): ResolvedOptions => ({
    // ─── Transport ─────────────────────────────────────────────
    tokenDelivery: 'cookie',
    cookies: {
      secure: config.get('NODE_ENV') === 'production',
      sameSite: 'lax',
      resolveDomains: resolveCookieDomains(config),
      hasSessionCookieName: 'has_session',
    },

    // ─── JWT ───────────────────────────────────────────────────
    jwt: {
      secret: config.getOrThrow('JWT_SECRET'),
      accessTokenTtl: '15m',
      refreshTokenTtl: '14d',
      refreshGraceWindow: '30s',
    },

    // ─── MFA ───────────────────────────────────────────────────
    mfa: {
      issuer: 'nest-auth-example',
      encryptionKey: config.getOrThrow('MFA_ENCRYPTION_KEY'),
      recoveryCodeCount: 10,
    },

    // ─── Sessions ──────────────────────────────────────────────
    sessions: {
      defaultMaxSessions: 5,
      newSessionEmailAlert: true,
    },

    // ─── Password reset ────────────────────────────────────────
    passwordReset: {
      method: 'token',
      tokenTtl: '30m',
    },

    // ─── Email verification ────────────────────────────────────
    emailVerification: 'required',

    // ─── Brute force ───────────────────────────────────────────
    bruteForce: {
      maxAttempts: 5,
      lockoutDuration: '15m',
    },

    // ─── Roles ─────────────────────────────────────────────────
    roles: {
      hierarchy: { owner: ['admin', 'member'], admin: ['member'] },
      defaultRole: 'member',
    },

    // ─── Controllers enabled ───────────────────────────────────
    controllers: {
      register: true,
      login: true,
      sessions: true,
      passwordReset: true,
      mfa: true,
      oauth: Boolean(config.get('OAUTH_GOOGLE_CLIENT_ID')),
      invitations: true,
      platform: true,
    },

    // ─── Tenant resolver ──────────────────────────────────────
    tenantIdResolver: (req) => req.headers['x-tenant-id'] as string | undefined,

    // ─── Dependencies ──────────────────────────────────────────
    userRepository: users,
    platformUserRepository: platformUsers,
    emailProvider: email,
    hooks,
    redis,
    redisNamespace: 'nest-auth-example',
  }),
  inject: [
    ConfigService,
    PrismaUserRepository,
    PrismaPlatformUserRepository,
    EMAIL_PROVIDER,
    AppAuthHooks,
    RedisService,
  ],
});
```

### Non-negotiables

1. **`registerAsync`**, never `register`. Config validation must happen first.
2. **`tokenDelivery: 'cookie'`** for this reference. Bearer mode exists but is out of scope — a different branch would demonstrate it.
3. **`redisNamespace`** is required — shared Redis between projects without it collides.
4. **`controllers.*` flags are explicit** — never `controllers: true` as a shortcut; adding a new controller must be an intentional wiring step.
5. **`tenantIdResolver` is a pure function** — no DB reads, no async work. The header must be the only source of truth.

---

## Implementing repositories

`PrismaUserRepository` and `PrismaPlatformUserRepository` are thin translation layers. No business logic, no cross-table joins beyond what the interface declares.

```ts
@Injectable()
export class PrismaUserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(tenantId: string, email: string) {
    return this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: email.toLowerCase() } },
    });
  }

  create(data: CreateUserInput) {
    return this.prisma.user.create({ data });
  }

  // ... every IUserRepository method
}
```

Rules:

- **Pass-through shapes**: do not reshape the objects the library expects. `passwordHash`, `mfaSecret`, `mfaRecoveryCodes` round-trip verbatim.
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

  async onUserCreated(ctx: HookContext, user: User) {
    await this.prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        type: 'USER_CREATED',
        actorId: user.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { oauthProvider: user.oauthProvider },
      },
    });
  }
  // ... every lifecycle hook
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

Global guard order (set in `APP_GUARD` providers):

1. `JwtAuthGuard`
2. `UserStatusGuard`
3. `MfaRequiredGuard`
4. `RolesGuard`

Any change to this order needs an ADR.

---

## Frontend wiring (apps/web)

Three route handlers, one provider, one proxy. All come from the library.

```ts
// apps/web/lib/auth-client.ts
import { createAuthClient } from '@bymax-one/nest-auth/nextjs';

export const authClient = createAuthClient({
  apiBaseUrl: process.env.NEXT_PUBLIC_API_URL!,
  cookies: { hasSessionCookieName: 'has_session' },
});
```

```ts
// apps/web/proxy.ts — Next.js middleware
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

export const config = { matcher: ['/((?!api|_next|static|favicon.ico).*)'] };
```

```ts
// apps/web/app/api/auth/silent-refresh/route.ts
export { createSilentRefreshHandler as GET } from '@bymax-one/nest-auth/nextjs';
```

Mirror the same pattern for `client-refresh/route.ts` and `logout/route.ts`. No custom logic — the library owns these.

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

- Wrap the app in `<AuthProvider>` **once** in `app/layout.tsx`.
- `useSession()` throws outside `<AuthProvider>` — catch this in a root error boundary.
- `useAuthStatus()` is cheap; use it to gate UI states without re-fetching.

---

## Error codes

`AUTH_ERROR_CODES` is the shared vocabulary between backend responses and frontend forms.

```ts
import { AUTH_ERROR_CODES } from '@bymax-one/nest-auth/shared';
// e.g. 'INVALID_CREDENTIALS' | 'MFA_REQUIRED' | 'ACCOUNT_LOCKED' | ...
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

---

## References

- Library `README.md` in the sibling checkout
- [OVERVIEW.md §6 Feature Coverage Matrix](../OVERVIEW.md)
- [OVERVIEW.md §7 Library Linking](../OVERVIEW.md)
- [environment-guidelines.md](environment-guidelines.md)
- [observability-guidelines.md](observability-guidelines.md)
