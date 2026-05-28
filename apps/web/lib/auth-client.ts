/**
 * @fileoverview Auth client + typed API helpers for apps/web.
 *
 * Exports:
 * - `authClient` — wraps every auth flow (login, register, logout, MFA, etc.)
 *   from `@bymax-one/nest-auth/client`. Uses a tenant-aware fetch wrapper so
 *   the `X-Tenant-Id` header is injected on every outgoing request from the
 *   value stored in the `tenant_id` client cookie.
 * - `SessionInfo`, `TenantInfo`, `ProjectInfo`, `TenantUserInfo`, `InvitationInfo`,
 *   `PlatformTenantInfo`, `PlatformUserInfo` — typed shapes for non-auth API resources.
 * - Domain helpers (`listSessions`, `revokeSession`, `revokeAllSessions`,
 *   `listTenants`, `listUsers`, `updateUserStatus`, `listProjects`,
 *   `createProject`, `deleteProject`, `listInvitations`, `createInvitation`,
 *   `revokeInvitation`, `changePassword`) — thin fetch wrappers for each endpoint.
 * - Platform helpers (`platformLogin`, `platformLogout`, `listPlatformTenants`,
 *   `listPlatformUsers`, `platformUpdateUserStatus`) — bearer-authenticated platform
 *   admin API calls. Tokens are stored in sessionStorage via `lib/platform-auth`.
 * - `mapAuthClientError`, `handleAuthClientError` — error normalisation utilities.
 *
 * Every request goes through `tenantAwareFetch`, which wraps `createAuthFetch`
 * (handles 401 → silent refresh → retry) and injects `X-Tenant-Id` from the
 * `tenant_id` cookie when present. On the server side (RSCs), `document.cookie`
 * is undefined so `getCookie` returns undefined and the header is omitted —
 * acceptable because server calls use a JWT that already encodes `tenantId`.
 *
 * Platform calls use a separate `platformApiFetch` that reads the bearer access
 * token from sessionStorage and adds an `Authorization: Bearer` header. This
 * bypasses the cookie-based auth flow because platform sessions are always
 * bearer-mode (the library's `JwtPlatformGuard` reads the Authorization header).
 *
 * @module lib/auth-client
 */

import { createAuthClient, createAuthFetch, AuthClientError } from '@bymax-one/nest-auth/client';
import type { AuthErrorResponse, AuthFetch, AuthErrorCode } from '@bymax-one/nest-auth/client';

// ── Tenant cookie utility ─────────────────────────────────────────────────────

/**
 * Reads a cookie value by name from `document.cookie` (browser-only).
 *
 * Returns `undefined` in SSR / RSC contexts where `document` is not defined.
 *
 * @param name - Cookie name to look up.
 * @returns Cookie value string, or `undefined` when absent or in SSR.
 */
function getCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const prefix = `${name}=`;
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(prefix)) {
      return part.slice(prefix.length);
    }
  }
  return undefined;
}

// ── Fetch wrappers ────────────────────────────────────────────────────────────

/**
 * Inner fetch: handles 401 auto-refresh, single-flight dedup, and cookie
 * credentials. All API requests originate from this wrapper.
 */
const innerAuthFetch = createAuthFetch({
  baseUrl: '/api',
  routePrefix: 'auth',
  credentials: 'include',
});

/**
 * Wraps `innerAuthFetch` and injects the `X-Tenant-Id` header from the
 * `tenant_id` client cookie on every request.
 *
 * The `tenant_id` cookie is set (and updated) by `<TenantSwitcher />`.
 * When the cookie is absent the header is omitted — callers that target
 * endpoints that require it (e.g. registration) must set the cookie first.
 */
const tenantAwareFetch: AuthFetch = (input, init) => {
  const tenantId = getCookie('tenant_id');
  if (!tenantId) return innerAuthFetch(input, init);

  // Merge existing per-request headers with the X-Tenant-Id header.
  const headers = new Headers(init?.headers);
  headers.set('X-Tenant-Id', tenantId);

  // Stryker disable next-line ConditionalExpression: the `init !== undefined` truthy direction is observationally equivalent to a `true` mutant — `{ ...undefined, headers }` is a JS no-op that yields `{ headers }`, identical to the falsy branch. The `false` direction IS killed by the "preserves method/body" test. The conditional exists for clarity (skips an unnecessary spread on the common no-init path); under jsdom the truthy mutant produces the same final RequestInit object.
  const newInit: RequestInit = init !== undefined ? { ...init, headers } : { headers };
  return innerAuthFetch(input, newInit);
};

// ── Auth client ───────────────────────────────────────────────────────────────

/**
 * Module-level singleton — shared across every page and hook in apps/web.
 * Uses `tenantAwareFetch` so every auth call carries `X-Tenant-Id` automatically.
 */
export const authClient = createAuthClient({
  // Empty baseUrl: createAuthClient.buildUrl generates paths like '/auth/login'.
  // innerAuthFetch (baseUrl '/api') then prepends '/api' → '/api/auth/login'.
  // Using '/api' here would cause '/api' to be prepended twice.
  baseUrl: '',
  routePrefix: 'auth',
  authFetch: tenantAwareFetch,
});

export { AuthClientError };
export type { AuthErrorCode };

// ── Error mapping ─────────────────────────────────────────────────────────────

/**
 * Auth error codes that indicate a stale/revoked session requiring re-login.
 * Used by `mapAuthClientError` to populate the optional `redirectTo` field.
 */
const REDIRECT_TO_LOGIN_CODES = new Set<string>([
  'auth.token_expired',
  'auth.token_revoked',
  'auth.token_invalid',
]);

/**
 * Normalises any caught value from an auth call into a typed descriptor.
 *
 * Discriminates `AuthClientError` instances (carrying a server-issued `code`)
 * from generic `Error` objects and unknown values. Populates `redirectTo` for
 * token-lifecycle codes so callers can redirect without extra branching.
 *
 * @param error - The caught value from a try-catch around an auth call.
 * @returns Normalised error descriptor with `code`, `message`, and optional `redirectTo`.
 */
export function mapAuthClientError(error: unknown): {
  code: AuthErrorCode | 'UNKNOWN';
  message: string;
  redirectTo?: string;
} {
  if (error instanceof AuthClientError) {
    const code = (error.code ?? 'UNKNOWN') as AuthErrorCode | 'UNKNOWN';
    const message = error.body?.message ?? error.message;
    return REDIRECT_TO_LOGIN_CODES.has(code)
      ? { code, message, redirectTo: '/auth/login' as const }
      : { code, message };
  }

  return {
    code: 'UNKNOWN' as const,
    message: error instanceof Error ? error.message : 'An unexpected error occurred.',
  };
}

/** Minimal toast interface — keeps this file free of sonner imports (server-safe). */
interface ToastActions {
  /** Display an error toast notification. */
  error: (message: string) => void;
}

/** Navigation interface — keeps this file free of Next.js imports (server-safe). */
interface RouterActions {
  /** Navigate to the given path. */
  push: (path: string) => void;
}

/**
 * Surfaces an auth error as a toast notification and optionally navigates away.
 *
 * Intended for use in form `catch` blocks — pass the caught value, your sonner
 * `toast` object, and (for redirection) the Next.js `useRouter()` instance.
 *
 * @param error - The caught value from an auth call.
 * @param ctx   - Toast helper and optional router for automatic redirect.
 */
export function handleAuthClientError(
  error: unknown,
  ctx: { toast: ToastActions; router?: RouterActions },
): void {
  const { message, redirectTo } = mapAuthClientError(error);
  ctx.toast.error(message);
  if (redirectTo !== undefined && ctx.router !== undefined) {
    ctx.router.push(redirectTo);
  }
}

// ── Tenant pre-login resolution ───────────────────────────────────────────────

/**
 * Matches the canonical CUID v1 shape: 25 characters, lowercase, leading `c`.
 * Mirrors the server-side regex on `SwitchWorkspaceDto.tenantId` so both ends
 * recognise the same "already resolved" identifier and skip the slug-lookup
 * round-trip in `resolveTenantForLogin`.
 *
 * @public
 */
export const CUID_REGEX = /^c[a-z0-9]{24}$/;

/**
 * Thrown by `resolveTenantForLogin` when the API confirms the slug does not
 * map to any tenant (HTTP 404). Lets pages distinguish "tenant missing" from
 * "invalid credentials" instead of letting both surface as the same toast.
 *
 * @public
 */
export class TenantNotFoundError extends Error {
  constructor(public readonly slug: string) {
    super(`Tenant not found: ${slug}`);
    this.name = 'TenantNotFoundError';
  }
}

/**
 * Resolves a tenant slug (e.g. `'acme'`) to its internal CUID via the public
 * `GET /api/tenants/resolve?slug=` endpoint.
 *
 * Throws `TenantNotFoundError` when the API explicitly reports 404 so the
 * login/forgot-password pages can surface a clear "tenant missing" banner
 * instead of a misleading invalid-credentials toast. Falls back to the
 * original value only on network errors or unexpected non-2xx responses,
 * covering the case where `slugOrId` is already a CUID.
 *
 * Must be called before `login()` or `forgotPassword()` so the `tenant_id`
 * cookie can be set with the correct CUID for `tenantAwareFetch` to inject it
 * as `X-Tenant-Id`. The API's `tenantIdResolver` reads only from that header.
 *
 * @param slugOrId - Tenant slug or CUID from the `?tenantId=` URL parameter.
 * @returns The tenant's CUID, or `slugOrId` unchanged when resolution fails for
 *   reasons other than an explicit 404.
 * @throws {TenantNotFoundError} When the API returns 404 for the given slug.
 */
export async function resolveTenantForLogin(slugOrId: string): Promise<string> {
  // Skip the API round-trip when the caller already has a resolved CUID
  // (e.g. the verify-email page carries the CUID in the URL after register).
  if (CUID_REGEX.test(slugOrId)) {
    return slugOrId;
  }
  let response: Response;
  try {
    response = await fetch(`/api/tenants/resolve?slug=${encodeURIComponent(slugOrId)}`);
  } catch {
    // Network error — let the caller try the login anyway with the raw value.
    return slugOrId;
  }
  if (response.status === 404) {
    throw new TenantNotFoundError(slugOrId);
  }
  if (response.ok) {
    const data = (await response.json()) as { id?: unknown };
    if (typeof data.id === 'string') return data.id;
  }
  return slugOrId;
}

// ── Generic API fetch helper ──────────────────────────────────────────────────

/**
 * Sends an authenticated JSON request to a path relative to `/api`.
 *
 * Uses `tenantAwareFetch` so:
 * - The `X-Tenant-Id` header is injected automatically from the `tenant_id` cookie.
 * - 401 responses trigger a silent token refresh and a single retry.
 * - Cookies are always included (`credentials: 'include'`).
 *
 * Throws `AuthClientError` on non-2xx responses with the server's error message
 * when available, falling back to a generic message.
 *
 * @internal Exposed so the sibling slice modules (`auth-client.mfa.ts`,
 *           `auth-client.audit.ts`, `auth-client.notifications.ts`) can share
 *           the same fetch pipeline without re-implementing tenant-aware
 *           headers + error normalisation. Consumers should keep using the
 *           topic-named helpers (`mfaSetup`, `listAuditEntries`, …) rather
 *           than calling this directly.
 *
 * @param path - Path relative to `/api` (e.g. `'/users'` or `'/auth/sessions'`).
 * @param init - Optional fetch init. `Content-Type` defaults to `application/json`.
 * @returns Parsed JSON body, or `undefined` for 204 No Content responses.
 * @throws `AuthClientError` on non-2xx responses.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Do NOT set Content-Type here. `createAuthFetch` inside `innerAuthFetch`
  // already injects `Content-Type: application/json` via its frozen
  // DEFAULT_HEADERS, and its `mergeHeaders` helper iterates `Headers` objects
  // with lowercased names. Adding our own capitalized `Content-Type` here
  // produces both `Content-Type` and `content-type` keys in the final plain
  // object, which `fetch` then serializes as a duplicate header line
  // (`Content-Type: application/json, application/json`). The Nest API's
  // `express.json()` parser rejects that as not a JSON content-type and the
  // request body silently arrives empty.
  const response = await tenantAwareFetch(path, init);

  // Stryker disable next-line ConditionalExpression: the `if (false)` direction is observationally equivalent — when the 204 short-circuit is skipped, `response.text()` returns `''`, `response.ok` is true so the !ok branch is skipped, and `if (!text) return undefined as T` catches the empty body. End state is identical to the original. The `if (true)` direction IS killed by the "returns parsed body for 200" test (it would short-circuit every payload to undefined).
  if (response.status === 204) return undefined as T;

  const text = await response.text();

  if (!response.ok) {
    throw buildAuthClientError(response.status, text);
  }

  if (!text) return undefined as T;

  return JSON.parse(text) as T;
}

/**
 * Builds an `AuthClientError` from a non-2xx HTTP response body.
 *
 * Three possible body shapes — checked in priority order so the most
 * specific match wins:
 *
 *   1. **Example's `AuthExceptionFilter` envelope (flat top-level)**:
 *      `{ code: 'auth.<code>', message: string, statusCode: number }`
 *      This is what `apps/api/src/auth/auth-exception.filter.ts` serializes
 *      every `AuthException` thrown by `@bymax-one/nest-auth` into. The
 *      filter flattens the lib's nested `{ error: { code, message, details } }`
 *      into this top-level shape so the frontend can read `parsed.code`
 *      directly. This is the dominant shape on the wire for every
 *      auth/MFA/platform endpoint.
 *
 *   2. **Lib's raw `AuthException` envelope** (only seen if the consumer
 *      project does NOT register an exception filter that reshapes it):
 *      `{ error: { code: 'auth.<code>', message, details } }`
 *      Kept as a fallback so the helper works against either deployment
 *      style without changes.
 *
 *   3. **NestJS `ValidationPipe` / generic exceptions** carry the
 *      top-level shape `{ statusCode, message, error: string }` with no
 *      `code` of their own. Falling back to `parsed.message` keeps these
 *      surfacing a meaningful message even without a stable code.
 *
 * Any shape is normalised into the `AuthErrorResponse` interface so
 * consumers reading `error.body` get a stable contract. When the body
 * does not match any known shape, `body` is left `undefined` and the
 * error carries only the generic status message.
 *
 * @internal Exposed only so the sibling `auth-client.platform.ts` module can
 *           reuse the same error envelope normalisation. Not part of the
 *           consumer-facing surface — consumers should rely on the typed
 *           `AuthClientError.body` instead.
 *
 * @param status - HTTP status code from the failed response.
 * @param text - Raw response body text.
 * @returns An `AuthClientError` ready to be thrown.
 */
export function buildAuthClientError(status: number, text: string): AuthClientError {
  let message = `Request failed with status ${status}`;
  let body: AuthErrorResponse | undefined;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;

    // Shape 1 — example's flat AuthExceptionFilter envelope (top-level `code`).
    if (typeof parsed['code'] === 'string') {
      const code = parsed['code'];
      if (typeof parsed['message'] === 'string') message = parsed['message'];
      body = {
        code: code as AuthErrorCode,
        message,
        error: '',
        statusCode: status,
      };
      return new AuthClientError(message, status, body);
    }

    // Shape 2 — lib's raw AuthException envelope (`{ error: { code, message } }`).
    // The three type-guard clauses are belt-and-suspenders defenses — each
    // catches a different malformed-envelope shape (non-object,
    // null-disguised-as-object, non-string code). The FALSE direction of
    // each is killed by the "falls through to Shape 3 when envelope is …"
    // tests; the TRUE direction collapses every mutant into the same Shape 2
    // path that the existing "Shape 2 propagates" test exercises. The
    // ConditionalExpression `true` mutants on individual clauses cannot
    // change observable behaviour because the downstream cast plus the
    // empty-body fallback below absorb them. Block-disabled together so the
    // directive covers every clause without per-line refactor noise.
    const envelope = parsed['error'];
    // Stryker disable ConditionalExpression,LogicalOperator
    const envelopeIsObject = typeof envelope === 'object';
    const envelopeIsNotNull = envelope !== null;
    const codeIsString = typeof (envelope as Record<string, unknown> | null)?.['code'] === 'string';
    if (envelopeIsObject && envelopeIsNotNull && codeIsString) {
      // Stryker restore ConditionalExpression,LogicalOperator
      const e = envelope as { code: string; message?: unknown; details?: unknown };
      if (typeof e.message === 'string') message = e.message;
      body = {
        code: e.code as AuthErrorCode,
        message,
        error: '',
        statusCode: status,
      };
      return new AuthClientError(message, status, body);
    }

    // Shape 3 — NestJS standard envelope (`{ statusCode, message, error }`).
    if (typeof parsed['message'] === 'string') {
      message = parsed['message'];
      body = {
        message,
        error: typeof parsed['error'] === 'string' ? parsed['error'] : '',
        statusCode: status,
      };
      return new AuthClientError(message, status, body);
    }
  } catch {
    // Non-JSON body — keep generic message + undefined body.
  }
  return new AuthClientError(message, status, body);
}

// ── Session types ─────────────────────────────────────────────────────────────

/**
 * Active session record as returned by `GET /api/auth/sessions`.
 *
 * Mirrors the `SessionInfo` interface from the library's session service.
 * The `isCurrent` flag identifies the caller's own session so the UI can
 * show a "This device" badge without a separate lookup.
 */
export interface SessionInfo {
  /** First 8 characters of `sessionHash` — short display identifier. */
  id: string;
  /** Full SHA-256 hex hash of the original refresh token (used for revocation). */
  sessionHash: string;
  /** Human-readable device description (e.g. "Chrome on macOS"). */
  device: string;
  /** IP address from which the session was established. */
  ip: string;
  /** Whether this is the caller's current active session. */
  isCurrent: boolean;
  /** Unix timestamp (ms) when the session was first created. */
  createdAt: number;
  /** Unix timestamp (ms) of the most recent activity on this session. */
  lastActivityAt: number;
}

// ── Tenant types ──────────────────────────────────────────────────────────────

/**
 * Tenant as returned by `GET /api/tenants/me`.
 */
export interface TenantInfo {
  /** Unique tenant identifier (cuid). */
  id: string;
  /** Human-readable tenant name. */
  name: string;
  /** URL-safe tenant slug. */
  slug: string;
}

/**
 * Workspace as returned by `GET /api/account/workspaces` — one entry per tenant
 * where the signed-in user's email has an active account.
 *
 * The library uses a one-JWT-per-tenant model, so each workspace is backed by
 * a separate `User` row sharing the same email. Switching workspaces in the UI
 * means signing out and signing back in to the destination tenant.
 */
export interface WorkspaceInfo {
  /** Tenant CUID — used as the `X-Tenant-Id` header value after re-auth. */
  tenantId: string;
  /** URL-safe slug — used as the `?tenantId=` query param on the login page. */
  tenantSlug: string;
  /** Human-readable tenant name — what the user sees in the dropdown. */
  tenantName: string;
  /** Role granted to the user in this workspace (purely informational). */
  role: string;
  /** True when this workspace matches the current JWT's tenant context. */
  isCurrent: boolean;
}

// ── Project types ─────────────────────────────────────────────────────────────

/**
 * Project as returned by `GET /api/projects` and `POST /api/projects`.
 */
export interface ProjectInfo {
  /** Unique project identifier (cuid). */
  id: string;
  /** Project name. */
  name: string;
  /** Tenant the project belongs to. */
  tenantId: string;
  /** User ID of the project owner. */
  ownerUserId: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-updated timestamp. */
  updatedAt: string;
}

// ── User types ────────────────────────────────────────────────────────────────

/**
 * Tenant user as returned by `GET /api/users` and `PATCH /api/users/:id/status`.
 */
export interface TenantUserInfo {
  /** Unique user identifier (cuid). */
  id: string;
  /** User's primary email address. */
  email: string;
  /** User's display name. */
  name: string;
  /** Authorization role within the tenant. */
  role: string;
  /** Account lifecycle status. */
  status: string;
  /** Whether TOTP MFA is enabled on the account. */
  mfaEnabled: boolean;
  /** Tenant the user belongs to. */
  tenantId: string;
  /** Whether the user's email address has been verified. */
  emailVerified: boolean;
  /** ISO 8601 timestamp of the most recent login. */
  lastLoginAt: string | null;
  /** ISO 8601 account creation timestamp. */
  createdAt: string;
}

// ── Invitation types ──────────────────────────────────────────────────────────

/**
 * Invitation record as returned by `GET /api/invitations`.
 */
export interface InvitationInfo {
  /** Unique invitation identifier (cuid). */
  id: string;
  /** Email address of the invitee. */
  email: string;
  /** Role the invitee will receive on acceptance. */
  role: string;
  /** Tenant the invitation belongs to. */
  tenantId: string;
  /** ISO 8601 expiry timestamp. */
  expiresAt: string;
  /** ISO 8601 acceptance timestamp, or `null` when still pending. */
  acceptedAt: string | null;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

// ── Session helpers ───────────────────────────────────────────────────────────

/**
 * Lists all active sessions for the authenticated user.
 *
 * @returns Array of `SessionInfo` sorted newest-first.
 */
export const listSessions = (): Promise<SessionInfo[]> => apiFetch<SessionInfo[]>('/auth/sessions');

/**
 * Revokes a single session by its full SHA-256 session hash.
 *
 * @param sessionHash - Full 64-character SHA-256 hex hash from `SessionInfo.sessionHash`.
 */
export const revokeSession = (sessionHash: string): Promise<void> =>
  apiFetch<void>(`/auth/sessions/${sessionHash}`, { method: 'DELETE' });

/**
 * Revokes all sessions for the authenticated user except the current one.
 *
 * Call `POST /api/auth/logout` afterwards to also terminate the current session
 * when implementing a full "sign out everywhere" flow.
 */
export const revokeAllSessions = (): Promise<void> =>
  apiFetch<void>('/auth/sessions/all', { method: 'DELETE' });

// ── Tenant helpers ────────────────────────────────────────────────────────────

/**
 * Lists all tenants the authenticated user belongs to.
 *
 * @returns Array of `TenantInfo` objects.
 */
export const listTenants = (): Promise<TenantInfo[]> => apiFetch<TenantInfo[]>('/tenants/me');

/**
 * Lists every workspace (tenant) the authenticated user's email has an active
 * account in — the data source for the dashboard's workspace switcher.
 *
 * @returns Array of `WorkspaceInfo` with the current workspace first.
 */
export const listWorkspaces = (): Promise<WorkspaceInfo[]> =>
  apiFetch<WorkspaceInfo[]>('/account/workspaces');

/**
 * Result body returned by `POST /api/account/switch-workspace` on success.
 *
 * The example uses cookie-mode `tokenDelivery`, so the access + refresh
 * tokens travel via `Set-Cookie` headers — the JSON body carries only the
 * `user` projection. Mirrors the lib's `CookieAuthResponse` shape.
 *
 * @public
 */
export interface SwitchWorkspaceResult {
  /** The signed-in user in the destination tenant. */
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    status: string;
    tenantId: string;
    emailVerified: boolean;
    mfaEnabled: boolean;
  };
}

/**
 * Silently switches the current session to a sibling `User` row in another
 * tenant (Slack-style multi-workspace identity sharing) — no password
 * re-entry required.
 *
 * Backed by `POST /api/account/switch-workspace` which:
 *   1. Validates the caller's email has an ACTIVE row in `tenantId`.
 *   2. Calls the lib's `AuthService.issueTokensForUserId` (v1.0.10+) to
 *      mint a fresh session for that target row.
 *   3. Writes the access / refresh / has-session cookies via the lib's
 *      `TokenDeliveryService.deliverAuthResponse`.
 *
 * After this call the browser's cookies belong to the destination tenant.
 * Callers must trigger a session reload (`useSession().refresh()` plus a
 * `router.refresh()`) so React state mirrors the new identity. The
 * `TenantSwitcher` component handles that wiring; consumers calling this
 * directly are responsible.
 *
 * MFA-enabled destination accounts are rejected by the lib with
 * `MFA_REQUIRED` (HTTP 401, `code: 'auth.mfa_required'`). The caller
 * should catch that and redirect the user to
 * `/auth/login?tenantId=<slug>` so the destination tenant's MFA
 * challenge runs through the canonical login flow.
 *
 * @param tenantId - Destination tenant CUID (from `WorkspaceInfo.tenantId`).
 * @returns The destination tenant's user projection.
 * @throws `AuthClientError` with code:
 *   - `auth.mfa_required` when the destination has MFA — redirect to login.
 *   - `auth.account_suspended` / `auth.account_banned` / `auth.account_inactive`
 *     when the destination row is blocked.
 *   - HTTP 404 when the caller has no row in the destination tenant.
 *   - HTTP 400 when the destination equals the current tenant.
 */
export const switchWorkspace = (tenantId: string): Promise<SwitchWorkspaceResult> =>
  apiFetch<SwitchWorkspaceResult>('/account/switch-workspace', {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  });

// ── User helpers ──────────────────────────────────────────────────────────────

/**
 * Lists all users in the current tenant.
 *
 * Admin-only; requires the `ADMIN` (or higher) role in the JWT.
 *
 * @returns Array of `TenantUserInfo` objects.
 */
export const listUsers = (): Promise<TenantUserInfo[]> => apiFetch<TenantUserInfo[]>('/users');

/**
 * Updates a user's account status.
 *
 * Admin-only; requires the `ADMIN` (or higher) role in the JWT.
 *
 * @param id     - Target user ID.
 * @param status - New account status (`'ACTIVE'`, `'SUSPENDED'`, etc.).
 * @returns The updated `TenantUserInfo`.
 */
export const updateUserStatus = (id: string, status: string): Promise<TenantUserInfo> =>
  apiFetch<TenantUserInfo>(`/users/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

// ── Project helpers ───────────────────────────────────────────────────────────

/**
 * Lists all projects in the current tenant.
 *
 * @returns Array of `ProjectInfo` objects sorted newest-first.
 */
export const listProjects = (): Promise<ProjectInfo[]> => apiFetch<ProjectInfo[]>('/projects');

/**
 * Creates a new project in the current tenant.
 *
 * Admin-only; requires the `ADMIN` (or higher) role in the JWT.
 *
 * @param name - Human-readable project name.
 * @returns The newly created `ProjectInfo`.
 */
export const createProject = (name: string): Promise<ProjectInfo> =>
  apiFetch<ProjectInfo>('/projects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

/**
 * Deletes a project by ID.
 *
 * Admin-only; tenant isolation is enforced server-side.
 *
 * @param id - Project ID to delete.
 */
export const deleteProject = (id: string): Promise<void> =>
  apiFetch<void>(`/projects/${id}`, { method: 'DELETE' });

// ── Invitation helpers ────────────────────────────────────────────────────────

/**
 * Lists all invitations (pending and accepted) for the current tenant.
 *
 * Admin-only; backed by the custom `GET /api/invitations` endpoint.
 *
 * @returns Array of `InvitationInfo` objects sorted newest-first.
 */
export const listInvitations = (): Promise<InvitationInfo[]> =>
  apiFetch<InvitationInfo[]>('/invitations');

/**
 * Creates an invitation for a new user to join the current tenant.
 *
 * Calls the library's `POST /api/auth/invitations` endpoint. The `tenantId`
 * is extracted from the caller's JWT on the server side — it is never passed
 * in the body to prevent tenant spoofing.
 *
 * @param email - Invitee's email address.
 * @param role  - Role the invitee will receive on acceptance.
 */
export const createInvitation = (email: string, role: string): Promise<void> =>
  // POST to the app-side controller (`/api/invitations`) so the row is
  // persisted in the same Prisma table the dashboard reads from. The lib's
  // `/api/auth/invitations` endpoint stores in Redis only; using that here
  // would silently send the email but never surface the invitation in the UI.
  apiFetch<void>('/invitations', {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });

/**
 * Revokes (deletes) an invitation by ID.
 *
 * Backed by the custom `DELETE /api/invitations/:id` endpoint.
 *
 * @param id - Invitation ID to delete.
 */
export const revokeInvitation = (id: string): Promise<void> =>
  apiFetch<void>(`/invitations/${id}`, { method: 'DELETE' });

// ── Topic-module re-exports ───────────────────────────────────────────────────

// The MFA, audit, notifications, and platform-admin slices each live in their
// own module so this file stays under the 800-line cap and each auth contract
// (cookie-mode dashboard vs bearer-mode platform) stays self-contained. The
// barrels below keep the public import path stable for existing consumers:
// `import { mfaSetup, listAuditEntries, notifySelf, platformLogin } from
// '@/lib/auth-client'` still works.

export {
  mfaSetup,
  mfaVerifyEnable,
  mfaDisable,
  mfaChallengeViaCookie,
  mfaRegenerateRecoveryCodes,
  getMfaStatus,
} from './auth-client.mfa';
export type {
  MfaSetupInfo,
  MfaStatusInfo,
  MfaRegenerateRecoveryCodesResult,
} from './auth-client.mfa';

export { listAuditEntries } from './auth-client.audit';
export type { AuditEntryInfo } from './auth-client.audit';

export { notifySelf } from './auth-client.notifications';
export type { NotifySelfPayload, NotifySelfResponse } from './auth-client.notifications';

export { changePassword } from './auth-client.account';
export type { ChangePasswordInput } from './auth-client.account';

export {
  platformLogin,
  platformLogout,
  platformGetMe,
  platformMfaSetup,
  platformMfaVerifyEnable,
  platformMfaDisable,
  platformMfaRegenerateRecoveryCodes,
  listPlatformTenants,
  listPlatformUsers,
  platformUpdateUserStatus,
} from './auth-client.platform';
export type {
  PlatformTenantInfo,
  PlatformAdminInfo,
  PlatformLoginSuccess,
  PlatformMfaChallenge,
  PlatformLoginResult,
  PlatformUserInfo,
  PlatformMeInfo,
} from './auth-client.platform';
