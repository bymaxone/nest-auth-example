/**
 * @fileoverview Unit tests for `lib/auth-client`.
 *
 * Verifies:
 * - `mapAuthClientError`: normalises AuthClientError, generic Error, and unknown values.
 * - `handleAuthClientError`: calls toast.error and optionally router.push.
 * - Domain helpers (`listSessions`, `revokeSession`, `revokeAllSessions`,
 *   `listTenants`, `listUsers`, `updateUserStatus`, `listProjects`,
 *   `createProject`, `deleteProject`, `listInvitations`, `createInvitation`,
 *   `revokeInvitation`, `changePassword`, `notifySelf`) call the underlying
 *   fetch with the correct paths and methods.
 * - Platform helpers (`platformLogin`, `platformLogout`, `listPlatformTenants`,
 *   `listPlatformUsers`, `platformUpdateUserStatus`) use bearer auth and correct
 *   paths.
 * - `tenantAwareFetch`: injects `X-Tenant-Id` when `tenant_id` cookie is set,
 *   omits the header when the cookie is absent.
 *
 * Strategy:
 * - `@bymax-one/nest-auth/client` is mocked via `vi.mock` so no real fetch
 *   logic runs from the library.
 * - The global `fetch` is replaced with a `vi.fn()` spy to intercept
 *   `platformApiFetch` calls (which call the native fetch directly).
 * - `document.cookie` is manipulated via Object.defineProperty to simulate
 *   the presence/absence of the `tenant_id` cookie.
 *
 * @module lib/auth-client.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthClientError } from '@bymax-one/nest-auth/client';

// ── Mock @bymax-one/nest-auth/client ──────────────────────────────────────────

/**
 * `vi.hoisted` is required here because `vi.mock` calls are hoisted to the top
 * of the module by Vitest's transformer. Variables declared with `const` after
 * the import are NOT yet in scope when the hoisted mock factory runs — resulting
 * in a ReferenceError. `vi.hoisted` evaluates its factory before any hoisting
 * so the mock function is available when the `vi.mock` factory executes.
 *
 * The tenant-aware fetch wrapper calls `innerAuthFetch` (created by
 * `createAuthFetch`) and injects headers. We replace `createAuthFetch` with a
 * factory that returns a controllable mock so we can verify header injection
 * and response handling without real HTTP.
 */
const mockInnerFetch = vi.hoisted(() =>
  vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(),
);

/**
 * Captures the `authFetch` option passed to `createAuthClient` so tests can
 * call `tenantAwareFetch` directly and cover the `init === undefined` branch
 * at line 86 that is unreachable via the exported domain helpers.
 */
const capturedTenantAwareFetch = vi.hoisted(() => ({
  fn: null as ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null,
}));

vi.mock('@bymax-one/nest-auth/client', async (importOriginal) => {
  // Preserve the real AuthClientError class and its exports from shared.
  const original = await importOriginal<typeof import('@bymax-one/nest-auth/client')>();
  return {
    ...original,
    createAuthFetch: () => mockInnerFetch,
    createAuthClient: (opts: {
      authFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    }) => {
      // Capture tenantAwareFetch so tests can invoke it directly.
      if (opts.authFetch !== undefined) capturedTenantAwareFetch.fn = opts.authFetch;
      return {};
    },
  };
});

// ── Import SUT after mocks are established ────────────────────────────────────

import {
  mapAuthClientError,
  handleAuthClientError,
  listSessions,
  revokeSession,
  revokeAllSessions,
  listTenants,
  listUsers,
  updateUserStatus,
  listProjects,
  createProject,
  deleteProject,
  listInvitations,
  listWorkspaces,
  switchWorkspace,
  getMfaStatus,
  listAuditEntries,
  createInvitation,
  revokeInvitation,
  changePassword,
  notifySelf,
  mfaSetup,
  mfaVerifyEnable,
  mfaDisable,
  mfaRegenerateRecoveryCodes,
  mfaChallengeViaCookie,
  platformLogin,
  platformLogout,
  listPlatformTenants,
  listPlatformUsers,
  platformUpdateUserStatus,
  resolveTenantForLogin,
  TenantNotFoundError,
} from './auth-client.js';
import type { SessionInfo, TenantUserInfo, PlatformUserInfo, MfaSetupInfo } from './auth-client.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Builds a minimal Response object with a JSON body. */
function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Builds a 204 No Content response. */
function make204Response(): Response {
  return new Response(null, { status: 204 });
}

/** Builds a mock SessionInfo record. */
function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'sess-1',
    sessionHash: 'abc123',
    device: 'Chrome on macOS',
    ip: '127.0.0.1',
    isCurrent: true,
    createdAt: 1_700_000_000_000,
    lastActivityAt: 1_700_000_001_000,
    ...overrides,
  };
}

/** Builds a minimal PlatformUserInfo record. */
function makePlatformUser(overrides: Partial<PlatformUserInfo> = {}): PlatformUserInfo {
  return {
    id: 'user-1',
    email: 'user@example.com',
    name: 'Test User',
    role: 'MEMBER',
    status: 'ACTIVE',
    tenantId: 'tenant-1',
    emailVerified: true,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * Sets `document.cookie` via Object.defineProperty for cookie simulation in jsdom.
 * jsdom's document.cookie setter works natively — this helper just uses direct
 * assignment which triggers the standard cookie jar mechanism.
 */
function setCookieValue(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/`;
}

/** Clears a named cookie by setting max-age=0. */
function clearCookie(name: string): void {
  document.cookie = `${name}=; max-age=0; path=/`;
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockInnerFetch.mockReset();
  vi.stubGlobal('fetch', vi.fn());
  clearCookie('tenant_id');
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── mapAuthClientError ────────────────────────────────────────────────────────

describe('mapAuthClientError', () => {
  it('normalises an AuthClientError with a code into { code, message }', () => {
    /*
     * Scenario: the most common case — an AuthClientError with a server-issued
     * auth code. The function must extract and return the code and message.
     * Protects: correct extraction of typed error codes for callers.
     */
    const err = new AuthClientError('Invalid credentials', 401, {
      code: 'auth.invalid_credentials',
      message: 'Invalid credentials',
      error: 'Unauthorized',
      statusCode: 401,
    });
    const result = mapAuthClientError(err);
    expect(result.code).toBe('auth.invalid_credentials');
    expect(result.message).toBe('Invalid credentials');
    expect(result.redirectTo).toBeUndefined();
  });

  it('sets redirectTo when the error code is auth.token_expired', () => {
    /*
     * Scenario: token-lifecycle codes (expired/revoked/invalid) must trigger a
     * redirect to /auth/login via the `redirectTo` field, eliminating branching
     * in call sites.
     * Protects: REDIRECT_TO_LOGIN_CODES set — token_expired maps to redirect.
     */
    const err = new AuthClientError('Token expired', 401, {
      code: 'auth.token_expired',
      message: 'Token expired',
      error: 'Unauthorized',
      statusCode: 401,
    });
    const result = mapAuthClientError(err);
    expect(result.redirectTo).toBe('/auth/login');
  });

  it('sets redirectTo when the error code is auth.token_revoked', () => {
    /*
     * Scenario: a revoked-token error must also trigger a redirect.
     * Protects: REDIRECT_TO_LOGIN_CODES set — token_revoked maps to redirect.
     */
    const err = new AuthClientError('Token revoked', 401, {
      code: 'auth.token_revoked',
      message: 'Token revoked',
      error: 'Unauthorized',
      statusCode: 401,
    });
    const result = mapAuthClientError(err);
    expect(result.redirectTo).toBe('/auth/login');
  });

  it('sets redirectTo when the error code is auth.token_invalid', () => {
    /*
     * Scenario: an invalid-token error must trigger a redirect.
     * Protects: REDIRECT_TO_LOGIN_CODES set — token_invalid maps to redirect.
     */
    const err = new AuthClientError('Token invalid', 401, {
      code: 'auth.token_invalid',
      message: 'Token invalid',
      error: 'Unauthorized',
      statusCode: 401,
    });
    const result = mapAuthClientError(err);
    expect(result.redirectTo).toBe('/auth/login');
  });

  it('uses the body.message over error.message when body is present', () => {
    /*
     * Scenario: when the AuthClientError carries a parsed body with a `message`
     * field, that message must take precedence over the base Error message.
     * Protects: correct message extraction — body.message > error.message.
     */
    const err = new AuthClientError('Generic message', 400, {
      code: 'auth.invalid_credentials',
      message: 'Body-level message',
      error: 'Bad Request',
      statusCode: 400,
    });
    const result = mapAuthClientError(err);
    expect(result.message).toBe('Body-level message');
  });

  it('falls back to error.message when AuthClientError has no code', () => {
    /*
     * Scenario: an AuthClientError constructed without a body (no server code)
     * must map its code to UNKNOWN and use error.message as the message.
     * Protects: graceful handling of partial AuthClientError without a code.
     */
    const err = new AuthClientError('Something went wrong', 500);
    const result = mapAuthClientError(err);
    expect(result.code).toBe('UNKNOWN');
    expect(result.message).toBe('Something went wrong');
    expect(result.redirectTo).toBeUndefined();
  });

  it('normalises a generic Error instance to code=UNKNOWN', () => {
    /*
     * Scenario: non-library errors (network failures, etc.) must be normalised
     * to `code: UNKNOWN` with the error message preserved.
     * Protects: graceful handling of non-AuthClientError Error instances.
     */
    const err = new Error('Network failure');
    const result = mapAuthClientError(err);
    expect(result.code).toBe('UNKNOWN');
    expect(result.message).toBe('Network failure');
    expect(result.redirectTo).toBeUndefined();
  });

  it('normalises an unknown non-Error value to a generic message', () => {
    /*
     * Scenario: a thrown string or object that is not an Error instance must
     * produce the generic fallback message.
     * Protects: robustness against catch blocks that receive non-Error values.
     */
    const result = mapAuthClientError('some string error');
    expect(result.code).toBe('UNKNOWN');
    expect(result.message).toBe('An unexpected error occurred.');
  });

  it('normalises null to the generic message', () => {
    /*
     * Scenario: null thrown values (extremely rare but possible) must not throw
     * inside mapAuthClientError.
     * Protects: null safety for the normalisation function.
     */
    const result = mapAuthClientError(null);
    expect(result.code).toBe('UNKNOWN');
    expect(result.message).toBe('An unexpected error occurred.');
  });
});

// ── handleAuthClientError ─────────────────────────────────────────────────────

describe('handleAuthClientError', () => {
  it('calls toast.error with the mapped error message', () => {
    /*
     * Scenario: handleAuthClientError must surface the normalised message via
     * toast.error so the user sees feedback on any auth failure.
     * Protects: toast is always called with the correct message string.
     */
    const toast = { error: vi.fn() };
    handleAuthClientError(new Error('Some error'), { toast });
    expect(toast.error).toHaveBeenCalledWith('Some error');
  });

  it('calls router.push when error has a redirectTo and router is provided', () => {
    /*
     * Scenario: when a token-lifecycle error is caught, handleAuthClientError
     * must navigate the user to /auth/login automatically when a router is given.
     * Protects: automatic redirect on auth.token_expired / auth.token_revoked / auth.token_invalid.
     */
    const toast = { error: vi.fn() };
    const router = { push: vi.fn() };
    const err = new AuthClientError('Token expired', 401, {
      code: 'auth.token_expired',
      message: 'Token expired',
      error: 'Unauthorized',
      statusCode: 401,
    });
    handleAuthClientError(err, { toast, router });
    expect(router.push).toHaveBeenCalledWith('/auth/login');
  });

  it('does not call router.push when redirectTo is set but router is not provided', () => {
    /*
     * Scenario: when no router is supplied (e.g. in server components), the
     * function must still call toast.error but skip the navigation call.
     * Protects: router is optional — absent router must not cause a runtime error.
     */
    const toast = { error: vi.fn() };
    const err = new AuthClientError('Token expired', 401, {
      code: 'auth.token_expired',
      message: 'Token expired',
      error: 'Unauthorized',
      statusCode: 401,
    });
    // Should not throw even though no router is passed.
    expect(() => handleAuthClientError(err, { toast })).not.toThrow();
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it('does not call router.push for errors without a redirectTo', () => {
    /*
     * Scenario: for non-lifecycle errors (e.g. invalid credentials) there is
     * no redirectTo, so router.push must not be called.
     * Protects: router.push is only called for token-lifecycle codes.
     */
    const toast = { error: vi.fn() };
    const router = { push: vi.fn() };
    const err = new AuthClientError('Invalid credentials', 401, {
      code: 'auth.invalid_credentials',
      message: 'Invalid credentials',
      error: 'Unauthorized',
      statusCode: 401,
    });
    handleAuthClientError(err, { toast, router });
    expect(router.push).not.toHaveBeenCalled();
  });
});

// ── tenantAwareFetch via domain helpers ───────────────────────────────────────

describe('getCookie — SSR guard', () => {
  it('does not inject X-Tenant-Id when document is not defined (SSR environment)', async () => {
    /*
     * Scenario: in SSR contexts (RSC, middleware) `document` is not available.
     * getCookie must return undefined, causing tenantAwareFetch to skip header
     * injection and call innerAuthFetch without X-Tenant-Id.
     * Protects: line 48 — `if (typeof document === 'undefined') return undefined`.
     */
    // Pre-set the cookie in jsdom before removing document.
    setCookieValue('tenant_id', 'tenant-ssr');

    // Stub document to undefined to simulate SSR.
    vi.stubGlobal('document', undefined);

    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse([]));
    await listSessions();

    // innerAuthFetch is called directly (no X-Tenant-Id header).
    expect(mockInnerFetch).toHaveBeenCalledOnce();

    // Restore document.
    vi.unstubAllGlobals();
    clearCookie('tenant_id');
  });
});

describe('readPlatformToken — SSR guard', () => {
  it('does not inject Authorization header when sessionStorage is not defined (SSR)', async () => {
    /*
     * Scenario: in SSR contexts `sessionStorage` is not available.
     * readPlatformToken must return null, so no Authorization header is added.
     * Protects: line 698 — `if (typeof sessionStorage === 'undefined') return null`.
     */
    vi.stubGlobal('sessionStorage', undefined);

    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(makeJsonResponse([]));
    vi.stubGlobal('fetch', mockFetch);

    await listPlatformTenants();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    // No Authorization header since sessionStorage was undefined.
    expect(headers['Authorization']).toBeUndefined();

    vi.unstubAllGlobals();
  });
});

describe('tenantAwareFetch — X-Tenant-Id injection', () => {
  it('injects X-Tenant-Id header when tenant_id cookie is present', async () => {
    /*
     * Scenario: when `tenant_id` cookie is set, every API call through
     * tenantAwareFetch must include the `X-Tenant-Id` header so the server
     * can scope the request to the correct tenant.
     * Protects: multi-tenant isolation — X-Tenant-Id injected from cookie.
     */
    setCookieValue('tenant_id', 'tenant-abc');
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse([]));

    await listSessions();

    expect(mockInnerFetch).toHaveBeenCalledOnce();
    const [, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    const headers = init?.headers as Headers;
    expect(headers.get('X-Tenant-Id')).toBe('tenant-abc');

    clearCookie('tenant_id');
  });

  it('omits X-Tenant-Id header when tenant_id cookie is absent', async () => {
    /*
     * Scenario: when no `tenant_id` cookie is set, tenantAwareFetch must call
     * innerAuthFetch without modifying headers — the X-Tenant-Id header must
     * be absent.
     * Protects: header is not injected when there is no tenant context.
     */
    // Ensure no tenant_id cookie exists.
    clearCookie('tenant_id');
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse([]));

    await listSessions();

    expect(mockInnerFetch).toHaveBeenCalledOnce();
    // When tenant_id is absent, innerAuthFetch is called directly with the
    // original init (which has no X-Tenant-Id header set).
    const [, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit | undefined];
    if (init?.headers instanceof Headers) {
      expect(init.headers.get('X-Tenant-Id')).toBeNull();
    } else if (init?.headers && typeof init.headers === 'object') {
      expect((init.headers as Record<string, string>)['X-Tenant-Id']).toBeUndefined();
    }
    // If init is undefined (no headers passed at all), that is also acceptable.
  });

  it('builds newInit with only headers when called with no init argument (line 86 false branch)', async () => {
    /*
     * Scenario: when tenantAwareFetch is invoked with only the input argument
     * (init === undefined) and a tenant_id cookie is present, the function must
     * construct newInit as `{ headers }` rather than spreading an undefined value.
     * Protects: line 86 — `init !== undefined ? { ...init, headers } : { headers }`
     * false branch (init is undefined).
     */
    setCookieValue('tenant_id', 'tenant-direct');
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse({}));

    // Call tenantAwareFetch directly with no init argument to exercise the false branch.
    await capturedTenantAwareFetch.fn!('/test-path');

    expect(mockInnerFetch).toHaveBeenCalledOnce();
    const [calledPath, calledInit] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(calledPath).toBe('/test-path');
    // newInit is { headers } — a Headers instance with X-Tenant-Id set.
    const headers = calledInit.headers as Headers;
    expect(headers.get('X-Tenant-Id')).toBe('tenant-direct');

    clearCookie('tenant_id');
  });
});

// ── apiFetch — response handling ──────────────────────────────────────────────

describe('apiFetch response handling', () => {
  it('returns undefined for 204 No Content responses', async () => {
    /*
     * Scenario: DELETE and some POST endpoints return 204 with no body.
     * apiFetch must return undefined for these rather than trying to parse
     * an empty body.
     * Protects: 204 short-circuit — no JSON.parse attempt on empty body.
     */
    mockInnerFetch.mockResolvedValueOnce(make204Response());
    const result = await revokeAllSessions();
    expect(result).toBeUndefined();
  });

  it('throws AuthClientError with server message on non-2xx JSON error response', async () => {
    /*
     * Scenario: the server returns a 400 with a JSON body containing `message`.
     * apiFetch must extract the message and throw an AuthClientError.
     * Protects: structured error propagation for non-2xx responses.
     */
    mockInnerFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Email already in use' }), { status: 400 }),
    );
    await expect(listUsers()).rejects.toThrow(AuthClientError);
  });

  it('throws AuthClientError with generic message on non-2xx non-JSON error response', async () => {
    /*
     * Scenario: the server returns a 500 with a non-JSON body. apiFetch must
     * fall back to the generic status message and throw AuthClientError.
     * Protects: graceful error when body is not JSON.
     */
    mockInnerFetch.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }));
    await expect(listUsers()).rejects.toThrow(AuthClientError);
  });

  it('returns undefined when response body is empty but status is 2xx', async () => {
    /*
     * Scenario: some endpoints return 200 with an empty body (non-standard but
     * possible). apiFetch must return undefined rather than failing to parse.
     * Protects: empty body guard — `if (!text) return undefined as T`.
     */
    mockInnerFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
    const result = await revokeAllSessions();
    expect(result).toBeUndefined();
  });

  it('propagates the example AuthExceptionFilter flat envelope code through to AuthClientError.code', async () => {
    /*
     * Scenario: the API's `AuthExceptionFilter` reshapes every
     * `AuthException` thrown by `@bymax-one/nest-auth` into a FLAT
     * top-level shape `{ code, message, statusCode }` (see
     * `apps/api/src/auth/auth-exception.filter.ts`). This is the
     * dominant shape on the wire — apiFetch must read `code` at the
     * top level and propagate it so call sites can route through
     * `translateAuthError(code)`. Without this, the user sees the
     * generic "An unexpected error occurred" toast on a wrong TOTP
     * during the OAuth-MFA challenge.
     * Protects: the primary "Shape 1" branch that handles the
     * example's serialized envelope.
     */
    mockInnerFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'auth.mfa_invalid_code',
          message: 'Invalid MFA code',
          statusCode: 401,
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    let caught: unknown;
    try {
      await listUsers();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthClientError);
    const err = caught as AuthClientError;
    expect(err.code).toBe('auth.mfa_invalid_code');
    expect(err.body?.message).toBe('Invalid MFA code');
    expect(err.message).toBe('Invalid MFA code');
    expect(err.status).toBe(401);
  });

  it('propagates the lib AuthException nested envelope code through to AuthClientError.code', async () => {
    /*
     * Scenario: the lib's `AuthException` wraps the body under
     * `{ error: { code, message, details } }` when no consumer-side
     * exception filter reshapes it. apiFetch must unwrap that envelope
     * as a fallback so the helper works against either deployment style
     * — apps that register a flattening filter (Shape 1) and apps that
     * forward the lib's raw envelope (Shape 2). Protects the secondary
     * fallback branch.
     */
    mockInnerFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'auth.mfa_invalid_code',
            message: 'Invalid MFA code',
            details: null,
          },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    let caught: unknown;
    try {
      await listUsers();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthClientError);
    const err = caught as AuthClientError;
    expect(err.code).toBe('auth.mfa_invalid_code');
    expect(err.body?.message).toBe('Invalid MFA code');
    expect(err.status).toBe(403);
  });

  it('keeps the generic status message when the flat envelope omits message', async () => {
    /*
     * Scenario: a defence-in-depth case — the flat envelope carries
     * `code` but `message` is missing or non-string. apiFetch must
     * still build a body with the resolved code, falling back to the
     * generic "Request failed with status N" message rather than
     * blowing up on the missing field. Protects the false branch of
     * `if (typeof parsed.message === 'string')` inside the Shape 1
     * branch.
     */
    mockInnerFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'auth.unknown',
          statusCode: 500,
          // No `message` field — exercises the false branch.
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    let caught: unknown;
    try {
      await listUsers();
    } catch (err) {
      caught = err;
    }
    const err = caught as AuthClientError;
    expect(err.code).toBe('auth.unknown');
    expect(err.body?.message).toBe('Request failed with status 500');
  });

  it('falls back to top-level NestJS message shape when no error envelope is present', async () => {
    /*
     * Scenario: a NestJS ValidationPipe 400 carries the top-level shape
     * `{ statusCode, message, error }` with no `code` field and no
     * nested `error.code`. apiFetch must read the top-level `message`
     * and surface a structured body even though there is no stable code.
     * Protects: the tertiary "Shape 3" branch.
     */
    mockInnerFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          statusCode: 400,
          message: 'email must be an email',
          error: 'Bad Request',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    let caught: unknown;
    try {
      await listUsers();
    } catch (err) {
      caught = err;
    }
    const err = caught as AuthClientError;
    expect(err.code).toBeUndefined();
    expect(err.body?.message).toBe('email must be an email');
    expect(err.body?.error).toBe('Bad Request');
  });

  it('keeps body undefined when JSON body has neither envelope nor message', async () => {
    /*
     * Scenario: defence-in-depth — a server returns a JSON object that
     * does not match either of the two known shapes (no `error.code`,
     * no top-level `message`). apiFetch must fall through both
     * branches, leaving `body === undefined`, and still throw an
     * `AuthClientError` with the generic status message. Protects the
     * "neither shape matched" exit of the JSON.parse branch.
     */
    mockInnerFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ statusCode: 500, unrelated: 'field' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    let caught: unknown;
    try {
      await listUsers();
    } catch (err) {
      caught = err;
    }
    const err = caught as AuthClientError;
    expect(err.code).toBeUndefined();
    expect(err.body).toBeUndefined();
    expect(err.message).toBe('Request failed with status 500');
  });

  it('keeps the generic status message when the nested AuthException envelope omits message', async () => {
    /*
     * Scenario: a defence-in-depth case — the lib's raw `AuthException`
     * envelope carries `code` but `message` is missing or non-string.
     * apiFetch must still build a body with the resolved code, falling
     * back to the generic "Request failed with status N" message rather
     * than blowing up on the missing field. Protects the false branch
     * of `if (typeof e.message === 'string')` inside Shape 2.
     */
    mockInnerFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'auth.unknown',
            // No `message` field — exercises the false branch.
            details: null,
          },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    let caught: unknown;
    try {
      await listUsers();
    } catch (err) {
      caught = err;
    }
    const err = caught as AuthClientError;
    expect(err.code).toBe('auth.unknown');
    expect(err.body?.message).toBe('Request failed with status 500');
  });
});

// ── Session helpers ───────────────────────────────────────────────────────────

describe('listSessions', () => {
  it('fetches GET /auth/sessions and returns the array', async () => {
    /*
     * Scenario: listSessions calls apiFetch with the correct path, the inner
     * fetch resolves, and the parsed result is returned to the caller.
     * Protects: listSessions path and return-value contract.
     */
    const sessions = [makeSession()];
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse(sessions));

    const result = await listSessions();

    expect(result).toEqual(sessions);
    const [path] = mockInnerFetch.mock.calls[0] as [string];
    expect(path).toBe('/auth/sessions');
  });
});

describe('revokeSession', () => {
  it('sends DELETE /auth/sessions/:hash', async () => {
    /*
     * Scenario: revokeSession must call DELETE on the session-specific path
     * using the provided session hash.
     * Protects: revokeSession constructs the correct URL for the target session.
     */
    mockInnerFetch.mockResolvedValueOnce(make204Response());

    await revokeSession('deadbeef1234');

    const [path, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/auth/sessions/deadbeef1234');
    expect(init.method).toBe('DELETE');
  });
});

describe('revokeAllSessions', () => {
  it('sends DELETE /auth/sessions/all', async () => {
    /*
     * Scenario: revokeAllSessions must send a DELETE to the bulk-revocation path.
     * Protects: revokeAllSessions uses the correct path and method.
     */
    mockInnerFetch.mockResolvedValueOnce(make204Response());

    await revokeAllSessions();

    const [path, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/auth/sessions/all');
    expect(init.method).toBe('DELETE');
  });
});

describe('getMfaStatus', () => {
  it('fetches GET /account/mfa and returns the status snapshot', async () => {
    /*
     * Scenario: getMfaStatus is the data source for the Security page's
     * recovery-code counter and the dashboard shell's MFA-required
     * redirect gate. It must call apiFetch with the path `/account/mfa`
     * and return the parsed body verbatim — the API computes
     * `recoveryCodesRemaining`, `recoveryCodesTotal`, and `required`
     * server-side so the client does NO derivation.
     * Protects: getMfaStatus' path and return-value contract.
     */
    const snapshot = {
      enabled: true,
      recoveryCodesRemaining: 5,
      recoveryCodesTotal: 8,
      required: false,
    };
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse(snapshot));

    const result = await getMfaStatus();

    expect(result).toEqual(snapshot);
    const [path] = mockInnerFetch.mock.calls[0] as [string];
    expect(path).toBe('/account/mfa');
  });
});

describe('listAuditEntries', () => {
  it('fetches GET /audit and returns the array', async () => {
    /*
     * Scenario: the dashboard audit page reads from GET /api/audit
     * (admin-gated server-side). The client helper must call the
     * correct path and return the parsed body verbatim — the API
     * already orders newest-first and caps at 100, so no client-side
     * re-ordering is required.
     * Protects: listAuditEntries' path and return-value contract.
     */
    const entries = [
      {
        id: 'audit-1',
        event: 'user.login.succeeded',
        actorUserId: 'user-1',
        payload: { reason: 'password' },
        ip: '10.0.0.1',
        userAgent: 'Mozilla/5.0',
        createdAt: '2026-05-26T14:00:00.000Z',
      },
    ];
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse(entries));

    const result = await listAuditEntries();

    expect(result).toEqual(entries);
    const [path] = mockInnerFetch.mock.calls[0] as [string];
    expect(path).toBe('/audit');
  });
});

describe('listWorkspaces', () => {
  it('fetches GET /account/workspaces and returns the array', async () => {
    /*
     * Scenario: listWorkspaces is the data source for the dashboard's tenant
     * switcher dropdown. It must call apiFetch with `/account/workspaces` and
     * return the parsed array verbatim — the API already sorts current-first
     * + alphabetical, so the client does no re-ordering.
     * Protects: listWorkspaces' path and return-value contract.
     */
    const workspaces = [
      {
        tenantId: 'tid-1',
        tenantSlug: 'acme',
        tenantName: 'Acme Corp',
        role: 'ADMIN',
        isCurrent: true,
      },
      {
        tenantId: 'tid-2',
        tenantSlug: 'globex',
        tenantName: 'Globex Inc',
        role: 'ADMIN',
        isCurrent: false,
      },
    ];
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse(workspaces));

    const result = await listWorkspaces();

    expect(result).toEqual(workspaces);
    const [path] = mockInnerFetch.mock.calls[0] as [string];
    expect(path).toBe('/account/workspaces');
  });
});

describe('switchWorkspace', () => {
  it('POSTs the destination tenantId to /account/switch-workspace and returns the user projection', async () => {
    /*
     * Scenario: the tenant switcher dropdown calls `switchWorkspace(cuid)`
     * to mint a session for the caller's sibling User row in another
     * tenant without re-prompting for a password. The helper must hit
     * `/account/switch-workspace` with `POST`, carry the CUID in the
     * body, and return the lib's `CookieAuthResponse.user` projection
     * so the dropdown can update its `useSession()` state from the
     * response.
     * Protects: switchWorkspace path, method, body, and return contract.
     */
    const userProjection = {
      user: {
        id: 'user-target',
        email: 'admin@example.dev',
        name: 'Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        tenantId: 'tid-2',
        emailVerified: true,
        mfaEnabled: false,
      },
    };
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse(userProjection));

    const result = await switchWorkspace('tid-2');

    expect(result).toEqual(userProjection);
    const [path, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/account/switch-workspace');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ tenantId: 'tid-2' }));
  });
});

// ── Tenant helpers ────────────────────────────────────────────────────────────

describe('listTenants', () => {
  it('fetches GET /tenants/me and returns the array', async () => {
    /*
     * Scenario: listTenants must call the correct path and return the parsed
     * array of tenant records.
     * Protects: listTenants path contract.
     */
    const tenants = [{ id: 't-1', name: 'Acme', slug: 'acme' }];
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse(tenants));

    const result = await listTenants();

    expect(result).toEqual(tenants);
    const [path] = mockInnerFetch.mock.calls[0] as [string];
    expect(path).toBe('/tenants/me');
  });
});

// ── User helpers ──────────────────────────────────────────────────────────────

describe('listUsers', () => {
  it('fetches GET /users and returns the array', async () => {
    /*
     * Scenario: listUsers must fetch the correct path and return all users.
     * Protects: listUsers path contract.
     */
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse([]));

    const result = await listUsers();

    expect(result).toEqual([]);
    const [path] = mockInnerFetch.mock.calls[0] as [string];
    expect(path).toBe('/users');
  });
});

describe('updateUserStatus', () => {
  it('sends PATCH /users/:id/status with the new status in the body', async () => {
    /*
     * Scenario: updateUserStatus must PATCH the correct path and serialise
     * the status into the request body.
     * Protects: updateUserStatus path, method, and body contract.
     */
    const updated: TenantUserInfo = {
      id: 'u-1',
      email: 'a@b.com',
      name: 'User',
      role: 'MEMBER',
      status: 'SUSPENDED',
      mfaEnabled: false,
      tenantId: 't-1',
      emailVerified: true,
      lastLoginAt: null,
      createdAt: '2026-01-01T00:00:00Z',
    };
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse(updated));

    const result = await updateUserStatus('u-1', 'SUSPENDED');

    expect(result).toEqual(updated);
    const [path, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/users/u-1/status');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ status: 'SUSPENDED' }));
  });
});

// ── Project helpers ───────────────────────────────────────────────────────────

describe('listProjects', () => {
  it('fetches GET /projects', async () => {
    /*
     * Scenario: listProjects calls apiFetch with the /projects path.
     * Protects: listProjects path contract.
     */
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse([]));
    await listProjects();
    const [path] = mockInnerFetch.mock.calls[0] as [string];
    expect(path).toBe('/projects');
  });
});

describe('createProject', () => {
  it('sends POST /projects with name in the body', async () => {
    /*
     * Scenario: createProject must POST to /projects with the project name
     * serialised in the body.
     * Protects: createProject path, method, and body contract.
     */
    const created = {
      id: 'p-1',
      name: 'New Project',
      tenantId: 't-1',
      ownerUserId: 'u-1',
      createdAt: '',
      updatedAt: '',
    };
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse(created));

    await createProject('New Project');

    const [path, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/projects');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'New Project' }));
  });
});

describe('deleteProject', () => {
  it('sends DELETE /projects/:id', async () => {
    /*
     * Scenario: deleteProject must send DELETE to the project-specific path.
     * Protects: deleteProject path and method contract.
     */
    mockInnerFetch.mockResolvedValueOnce(make204Response());

    await deleteProject('p-1');

    const [path, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/projects/p-1');
    expect(init.method).toBe('DELETE');
  });
});

// ── Invitation helpers ────────────────────────────────────────────────────────

describe('listInvitations', () => {
  it('fetches GET /invitations', async () => {
    /*
     * Scenario: listInvitations must call the /invitations path.
     * Protects: listInvitations path contract.
     */
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse([]));
    await listInvitations();
    const [path] = mockInnerFetch.mock.calls[0] as [string];
    expect(path).toBe('/invitations');
  });
});

describe('createInvitation', () => {
  it('sends POST /invitations with email and role in the body', async () => {
    /*
     * Scenario: createInvitation must POST to the app-side invitations endpoint
     * so the row is persisted in the same Prisma table the dashboard reads
     * from. The lib's `/auth/invitations` endpoint stores in Redis only, so
     * using it here would silently send the email but never surface the
     * invitation in the UI.
     * Protects: createInvitation path, method, and body contract.
     */
    mockInnerFetch.mockResolvedValueOnce(make204Response());

    await createInvitation('invited@example.com', 'MEMBER');

    const [path, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/invitations');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ email: 'invited@example.com', role: 'MEMBER' }));
  });
});

describe('revokeInvitation', () => {
  it('sends DELETE /invitations/:id', async () => {
    /*
     * Scenario: revokeInvitation must DELETE the invitation-specific path.
     * Protects: revokeInvitation path and method contract.
     */
    mockInnerFetch.mockResolvedValueOnce(make204Response());

    await revokeInvitation('inv-1');

    const [path, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/invitations/inv-1');
    expect(init.method).toBe('DELETE');
  });
});

// ── Account helpers ───────────────────────────────────────────────────────────

describe('changePassword', () => {
  it('sends POST /account/change-password with the password input in the body', async () => {
    /*
     * Scenario: changePassword must POST to the account change-password endpoint
     * with both currentPassword and newPassword serialised in the body.
     * Protects: changePassword path, method, and body contract.
     */
    mockInnerFetch.mockResolvedValueOnce(make204Response());

    await changePassword({ currentPassword: 'old-pass', newPassword: 'new-pass' });

    const [path, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/account/change-password');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(
      JSON.stringify({ currentPassword: 'old-pass', newPassword: 'new-pass' }),
    );
  });
});

// ── Notification helpers ──────────────────────────────────────────────────────

describe('notifySelf', () => {
  it('sends POST /debug/notify/self with an empty payload by default', async () => {
    /*
     * Scenario: notifySelf called without arguments must POST to the debug
     * endpoint with an empty JSON object `{}` as the body.
     * Protects: notifySelf default payload serialization.
     */
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse({ delivered: 1 }));

    const result = await notifySelf();

    expect(result).toEqual({ delivered: 1 });
    const [path, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/debug/notify/self');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({}));
  });

  it('sends the provided title and body in the request', async () => {
    /*
     * Scenario: when notifySelf is called with a payload, both title and body
     * must be included in the serialised request body.
     * Protects: notifySelf custom payload serialization.
     */
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse({ delivered: 2 }));

    await notifySelf({ title: 'Hello', body: 'World' });

    const [, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ title: 'Hello', body: 'World' }));
  });
});

// ── Platform helpers — platformApiFetch ──────────────────────────────────────

describe('platformLogin', () => {
  it('POSTs to /api/auth/platform/login with email and password', async () => {
    /*
     * Scenario: platformLogin must send a POST to the platform login endpoint
     * with credentials in the body. The global fetch (not innerAuthFetch) is
     * used because platform calls bypass the cookie-auth flow.
     * Protects: platformLogin path, method, and credentials body.
     */
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      makeJsonResponse({
        admin: {
          id: 'a-1',
          email: 'admin@x.com',
          name: 'Admin',
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
        },
        accessToken: 'jwt-access',
        refreshToken: 'refresh-opaque',
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await platformLogin('admin@x.com', 'secret');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [path, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/auth/platform/login');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ email: 'admin@x.com', password: 'secret' }));
  });

  it('injects Authorization: Bearer header when a platform token is in sessionStorage', async () => {
    /*
     * Scenario: if a platform access token is already stored (e.g. mid-session
     * call), platformApiFetch must add `Authorization: Bearer <token>`.
     * Protects: bearer auth injection in platformApiFetch.
     */
    sessionStorage.setItem('platform_access_token', 'stored-jwt');
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(makeJsonResponse([]));
    vi.stubGlobal('fetch', mockFetch);

    await listPlatformTenants();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer stored-jwt');

    sessionStorage.removeItem('platform_access_token');
  });

  it('omits the Authorization header when no platform token is in sessionStorage', async () => {
    /*
     * Scenario: when no platform token is stored (pre-login), the Authorization
     * header must be absent from the request.
     * Protects: bearer header is only set when a token is available.
     */
    sessionStorage.removeItem('platform_access_token');
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(makeJsonResponse([]));
    vi.stubGlobal('fetch', mockFetch);

    await listPlatformTenants();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });
});

describe('platformGetMe', () => {
  it('fetches GET /api/auth/platform/me and returns the parsed body', async () => {
    /*
     * Scenario: the platform security page calls platformGetMe on
     * mount to know whether to render the setup or disable card. The
     * helper must hit /api/auth/platform/me and return the parsed
     * `PlatformMeInfo` shape (email, name, role, mfaEnabled).
     * Protects path + return-value contract.
     */
    sessionStorage.setItem('platform_access_token', 'platform-access');
    const me = {
      email: 'admin@platform.test',
      name: 'Platform Tester',
      role: 'SUPER_ADMIN',
      mfaEnabled: true,
    };
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(makeJsonResponse(me));
    vi.stubGlobal('fetch', mockFetch);

    const result = await import('./auth-client.js').then((m) => m.platformGetMe());

    expect(result).toEqual(me);
    const [path] = mockFetch.mock.calls[0] as [string];
    expect(path).toBe('/api/auth/platform/me');
  });
});

describe('platformMfaSetup / verify-enable / disable / regenerate', () => {
  it('platformMfaSetup posts to /api/auth/platform/mfa/setup with bearer auth and returns MfaSetupInfo', async () => {
    /*
     * Scenario: a platform admin clicks "Set up authenticator" on the
     * platform security page. The helper must hit the platform-prefixed
     * route (NOT /api/auth/mfa/setup), include the bearer token from
     * sessionStorage, and return the parsed setup payload verbatim.
     * Protects: platformMfaSetup path + bearer-auth wiring.
     */
    sessionStorage.setItem('platform_access_token', 'platform-access');
    const setupBody = {
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:admin?secret=JBSWY3DPEHPK3PXP&issuer=Example',
      recoveryCodes: ['AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'],
    };
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(makeJsonResponse(setupBody));
    vi.stubGlobal('fetch', mockFetch);

    const result = await import('./auth-client.js').then((m) => m.platformMfaSetup());

    expect(result).toEqual(setupBody);
    const [path, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/auth/platform/mfa/setup');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer platform-access');
  });

  it('platformMfaVerifyEnable posts the TOTP to /api/auth/platform/mfa/verify-enable', async () => {
    /*
     * Scenario: after scanning the QR + entering the first TOTP on the
     * platform security page, the helper must persist the code to the
     * platform-specific verify-enable route. Protects path + body.
     */
    sessionStorage.setItem('platform_access_token', 'platform-access');
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(make204Response());
    vi.stubGlobal('fetch', mockFetch);

    await import('./auth-client.js').then((m) => m.platformMfaVerifyEnable('123456'));

    const [path, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/auth/platform/mfa/verify-enable');
    expect(init.body).toBe(JSON.stringify({ code: '123456' }));
  });

  it('platformMfaDisable posts the TOTP to /api/auth/platform/mfa/disable', async () => {
    /*
     * Scenario: the platform security page exposes a Disable button for
     * admins with MFA on. The helper must hit the platform-specific
     * disable route so the lib's MfaService routes to the platform
     * user repo (not the dashboard one). Protects path + body.
     */
    sessionStorage.setItem('platform_access_token', 'platform-access');
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(make204Response());
    vi.stubGlobal('fetch', mockFetch);

    await import('./auth-client.js').then((m) => m.platformMfaDisable('654321'));

    const [path, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/auth/platform/mfa/disable');
    expect(init.body).toBe(JSON.stringify({ code: '654321' }));
  });

  it('platformMfaRegenerateRecoveryCodes posts the TOTP and returns the new codes', async () => {
    /*
     * Scenario: a platform admin rotates their recovery codes from the
     * platform security card. Must hit the platform-specific
     * recovery-codes route and return the freshly-issued plain codes
     * for the modal display.
     */
    sessionStorage.setItem('platform_access_token', 'platform-access');
    const fresh = { recoveryCodes: ['1111-2222-3333-4444-5555-6666'] };
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(makeJsonResponse(fresh));
    vi.stubGlobal('fetch', mockFetch);

    const result = await import('./auth-client.js').then((m) =>
      m.platformMfaRegenerateRecoveryCodes('789012'),
    );

    expect(result).toEqual(fresh);
    const [path, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/auth/platform/mfa/recovery-codes');
    expect(init.body).toBe(JSON.stringify({ code: '789012' }));
  });
});

describe('platformLogout', () => {
  it('POSTs to /api/auth/platform/logout with the refresh token', async () => {
    /*
     * Scenario: platformLogout must send a POST to the platform logout endpoint
     * with the refresh token serialised in the body.
     * Protects: platformLogout path, method, and refresh token body.
     */
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    await platformLogout('refresh-opaque');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [path, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/auth/platform/logout');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ refreshToken: 'refresh-opaque' }));
  });

  it('injects Authorization: Bearer header when a platform token is stored', async () => {
    /*
     * Scenario: platformLogout reads the platform access token to add the
     * Bearer header so the server can blacklist the JTI.
     * Protects: platformLogout includes the bearer token for JTI blacklisting.
     */
    sessionStorage.setItem('platform_access_token', 'logout-jwt');
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    await platformLogout('refresh-token');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer logout-jwt');

    sessionStorage.removeItem('platform_access_token');
  });

  it('omits the Authorization header on platformLogout when no platform token is stored', async () => {
    /*
     * Scenario: an admin clicks Logout but the sessionStorage token
     * already evaporated (e.g. background tab cleanup). The helper must
     * still POST the logout — without inventing a `Bearer null` /
     * `Bearer undefined` Authorization header. Pinning the negative
     * space defends the `if (token !== null)` guard.
     */
    sessionStorage.removeItem('platform_access_token');
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    await platformLogout('refresh-token');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('sends Content-Type: application/json and credentials: include on platformLogout', async () => {
    /*
     * Scenario: platformLogout MUST set `Content-Type: application/json`
     * (Express's `express.json()` parser otherwise rejects the body
     * silently and the refresh-token never reaches the server) AND
     * `credentials: 'include'` so any cookie-based auth fallback still
     * forwards. Pinning the verbatim header value AND the credentials
     * mode defends both invariants.
     */
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    await platformLogout('refresh-token');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.credentials).toBe('include');
  });
});

describe('platformApiFetch — Content-Type + credentials + 204 boundary', () => {
  it('sends Content-Type: application/json + credentials: include on every platform API call', async () => {
    /*
     * Scenario: every platformApiFetch call (including bearer-auth GET
     * requests with no body) must carry `Content-Type: application/json`
     * AND `credentials: 'include'`. The Content-Type header keeps the
     * server's parser happy on POSTs; credentials:'include' keeps any
     * cookie-based fallback channel alive. Pinning both verbatim values
     * defends the request-shape invariants for the whole platform
     * surface in a single test.
     */
    sessionStorage.setItem('platform_access_token', 'tok');
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(makeJsonResponse([]));
    vi.stubGlobal('fetch', mockFetch);

    await listPlatformTenants();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.credentials).toBe('include');

    sessionStorage.removeItem('platform_access_token');
  });

  it('returns the parsed body (NOT undefined) for a 200 OK with a JSON payload', async () => {
    /*
     * Scenario: pins the falsy arm of `if (response.status === 204)`
     * inside platformApiFetch — a mutated `if (true)` would short-
     * circuit every payload to undefined, silently dropping every
     * platform API response.
     */
    sessionStorage.setItem('platform_access_token', 'tok');
    const payload = [{ id: 't-1', name: 'Acme' }];
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(makeJsonResponse(payload));
    vi.stubGlobal('fetch', mockFetch);

    const result = await listPlatformTenants();
    expect(result).not.toBeUndefined();
    expect(result).toEqual(payload);

    sessionStorage.removeItem('platform_access_token');
  });
});

describe('platform MFA helpers use POST verbatim', () => {
  it('platformMfaDisable uses the verbatim "POST" method', async () => {
    /*
     * Scenario: each MFA helper is a thin wrapper around platformApiFetch
     * that pins the HTTP method as the literal string `'POST'`. A
     * regression that mutated the literal to `""` or another verb would
     * silently downgrade the request to a GET (no body sent) and the
     * server would reject the missing TOTP. Pinning the verbatim method
     * defends each helper. (platformMfaVerifyEnable + platformMfaRegenerateRecoveryCodes
     * are pinned by the existing path+body tests, which would fail if
     * the body went out without POST; this test adds the explicit
     * method pin to defend the literal directly.)
     */
    sessionStorage.setItem('platform_access_token', 'tok');
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(make204Response());
    vi.stubGlobal('fetch', mockFetch);

    await import('./auth-client.js').then((m) => m.platformMfaDisable('123456'));

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');

    sessionStorage.removeItem('platform_access_token');
  });

  it('platformMfaVerifyEnable uses the verbatim "POST" method', async () => {
    /*
     * Scenario: companion pin for the verify-enable helper. Same
     * reasoning as above — defends the literal `'POST'` against a
     * silent downgrade.
     */
    sessionStorage.setItem('platform_access_token', 'tok');
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(make204Response());
    vi.stubGlobal('fetch', mockFetch);

    await import('./auth-client.js').then((m) => m.platformMfaVerifyEnable('123456'));

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');

    sessionStorage.removeItem('platform_access_token');
  });

  it('platformMfaRegenerateRecoveryCodes uses the verbatim "POST" method', async () => {
    /*
     * Scenario: companion pin for the regenerate-recovery-codes helper.
     */
    sessionStorage.setItem('platform_access_token', 'tok');
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(makeJsonResponse({ recoveryCodes: ['x'] }));
    vi.stubGlobal('fetch', mockFetch);

    await import('./auth-client.js').then((m) => m.platformMfaRegenerateRecoveryCodes('123456'));

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');

    sessionStorage.removeItem('platform_access_token');
  });
});

describe('listPlatformTenants', () => {
  it('fetches GET /api/platform/tenants', async () => {
    /*
     * Scenario: listPlatformTenants must call the correct platform tenants path.
     * Protects: listPlatformTenants path contract.
     */
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(makeJsonResponse([]));
    vi.stubGlobal('fetch', mockFetch);

    const result = await listPlatformTenants();

    expect(result).toEqual([]);
    const [path] = mockFetch.mock.calls[0] as [string];
    expect(path).toBe('/api/platform/tenants');
  });
});

describe('listPlatformUsers', () => {
  it('fetches GET /api/platform/users?tenantId=:id', async () => {
    /*
     * Scenario: listPlatformUsers must include the tenantId as a query param.
     * Protects: listPlatformUsers path and query-param contract.
     */
    const users = [makePlatformUser()];
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(makeJsonResponse(users));
    vi.stubGlobal('fetch', mockFetch);

    const result = await listPlatformUsers('tenant-xyz');

    expect(result).toEqual(users);
    const [path] = mockFetch.mock.calls[0] as [string];
    expect(path).toBe('/api/platform/users?tenantId=tenant-xyz');
  });
});

describe('platformUpdateUserStatus', () => {
  it('sends PATCH /api/platform/users/:id/status with the status in the body', async () => {
    /*
     * Scenario: platformUpdateUserStatus must PATCH the correct platform path
     * with the new status serialised in the body.
     * Protects: platformUpdateUserStatus path, method, and body contract.
     */
    const updated = makePlatformUser({ status: 'SUSPENDED' });
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(makeJsonResponse(updated));
    vi.stubGlobal('fetch', mockFetch);

    const result = await platformUpdateUserStatus('user-1', 'SUSPENDED');

    expect(result).toEqual(updated);
    const [path, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/platform/users/user-1/status');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ status: 'SUSPENDED' }));
  });
});

// ── MFA helpers ───────────────────────────────────────────────────────────────

describe('mfaSetup', () => {
  it('sends POST /auth/mfa/setup and returns MfaSetupInfo', async () => {
    /*
     * Scenario: mfaSetup must POST to the MFA setup endpoint and return the
     * secret, QR code URI, and recovery codes.
     * Protects: line 507 — mfaSetup path and method contract.
     */
    const setupInfo: MfaSetupInfo = {
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP',
      recoveryCodes: ['REC-1', 'REC-2'],
    };
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse(setupInfo));

    const result = await mfaSetup();

    expect(result).toEqual(setupInfo);
    const [path, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/auth/mfa/setup');
    expect(init.method).toBe('POST');
  });
});

describe('mfaVerifyEnable', () => {
  it('sends POST /auth/mfa/verify-enable with the TOTP code in the body', async () => {
    /*
     * Scenario: mfaVerifyEnable must POST to the verify-enable endpoint with the
     * TOTP code serialised in the body.
     * Protects: line 518 — mfaVerifyEnable path, method, and body contract.
     */
    mockInnerFetch.mockResolvedValueOnce(make204Response());

    await mfaVerifyEnable('123456');

    const [path, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/auth/mfa/verify-enable');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ code: '123456' }));
  });
});

describe('mfaDisable', () => {
  it('sends POST /auth/mfa/disable with the TOTP code in the body', async () => {
    /*
     * Scenario: mfaDisable must POST to the disable endpoint with the TOTP code
     * serialised in the body.
     * Protects: line 531 — mfaDisable path, method, and body contract.
     */
    mockInnerFetch.mockResolvedValueOnce(make204Response());

    await mfaDisable('654321');

    const [path, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/auth/mfa/disable');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ code: '654321' }));
  });
});

describe('mfaRegenerateRecoveryCodes', () => {
  it('sends POST /auth/mfa/recovery-codes with the TOTP code and returns the new codes', async () => {
    /*
     * Scenario: the security page's "Regenerate" button calls
     * mfaRegenerateRecoveryCodes after the user confirms a current TOTP. The
     * helper must hit the lib's `POST /auth/mfa/recovery-codes` endpoint
     * (shipped in @bymax-one/nest-auth ≥ 1.0.6) with the code in the body
     * and return the freshly issued plain-text codes verbatim.
     * Protects: mfaRegenerateRecoveryCodes path, method, body, and the
     *   parsed return shape `{ recoveryCodes }`.
     */
    const fresh = {
      recoveryCodes: ['AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', '1111-2222-3333-4444-5555-6666'],
    };
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse(fresh));

    const result = await mfaRegenerateRecoveryCodes('123456');

    const [path, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/auth/mfa/recovery-codes');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ code: '123456' }));
    expect(result).toEqual(fresh);
  });
});

describe('mfaChallengeViaCookie', () => {
  it('sends POST /auth/mfa/challenge with the code only — no mfaTempToken in body', async () => {
    /*
     * Scenario: the OAuth + MFA flow plants an HttpOnly `mfa_temp_token`
     * cookie that the page cannot read. The helper must POST just the
     * `code` — the browser carries the cookie automatically because
     * `tenantAwareFetch` includes credentials, and the lib's
     * `MfaController.challenge` reads the token from the cookie when
     * the body is missing it (lib v1.0.7+).
     * Protects: the path + the no-token body shape that is the
     * difference between this helper and `authClient.mfaChallenge`.
     */
    mockInnerFetch.mockResolvedValueOnce(make204Response());

    await mfaChallengeViaCookie('123456');

    const [path, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/auth/mfa/challenge');
    expect(init.method).toBe('POST');
    // body is typed as BodyInit | null in RequestInit, which is too wide
    // for `.toContain` — narrow to the actual string value we passed.
    const bodyString = init.body as string;
    expect(bodyString).toBe(JSON.stringify({ code: '123456' }));
    // mfaTempToken MUST NOT appear in the body — that's the whole point
    // of the cookie-driven flow.
    expect(bodyString).not.toContain('mfaTempToken');
  });
});

describe('platformApiFetch — 204 and error handling', () => {
  it('returns undefined for 204 No Content responses', async () => {
    /*
     * Scenario: DELETE platform endpoints return 204; platformApiFetch must
     * handle this gracefully without attempting to parse an empty body.
     * Protects: 204 short-circuit in platformApiFetch.
     */
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(make204Response());
    vi.stubGlobal('fetch', mockFetch);

    // listPlatformTenants returns T[] but with 204 it returns undefined as T.
    const result = await listPlatformTenants();
    expect(result).toBeUndefined();
  });

  it('throws AuthClientError with server message on non-2xx response', async () => {
    /*
     * Scenario: a 403 JSON error from the platform API must be thrown as
     * AuthClientError with the server-provided message.
     * Protects: structured error from platformApiFetch on non-2xx.
     */
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 }),
      );
    vi.stubGlobal('fetch', mockFetch);

    await expect(listPlatformTenants()).rejects.toThrow(AuthClientError);
  });

  it('throws AuthClientError with generic message when error body is not JSON', async () => {
    /*
     * Scenario: a non-JSON error body must fall back to a generic status message.
     * Protects: graceful fallback in platformApiFetch when body is not JSON.
     */
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('Server Error', { status: 500 }));
    vi.stubGlobal('fetch', mockFetch);

    await expect(listPlatformTenants()).rejects.toThrow(AuthClientError);
  });

  it('propagates the example flat envelope code through to AuthClientError.code', async () => {
    /*
     * Scenario: the platform API also passes every `AuthException`
     * through `AuthExceptionFilter`, which serializes the flat
     * `{ code, message, statusCode }` shape. platformApiFetch must read
     * the top-level `code` so platform-side toasts route through
     * `translateAuthError(code)`. Without this, every platform MFA
     * failure (and the regenerate / disable variants) would surface as
     * the generic "An unexpected error occurred" toast.
     * Protects: Shape 1 in platformApiFetch.
     */
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'auth.mfa_invalid_code',
          message: 'Invalid MFA code',
          statusCode: 401,
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    let caught: unknown;
    try {
      await listPlatformTenants();
    } catch (err) {
      caught = err;
    }
    const err = caught as AuthClientError;
    expect(err).toBeInstanceOf(AuthClientError);
    expect(err.code).toBe('auth.mfa_invalid_code');
    expect(err.body?.message).toBe('Invalid MFA code');
  });

  it('propagates the lib AuthException nested envelope through platformApiFetch', async () => {
    /*
     * Scenario: parallel to the apiFetch test — platformApiFetch must
     * also fall back to unwrapping the lib's raw `{ error: { code, ... } }`
     * envelope so the helper works regardless of whether a consumer
     * registers a flattening filter.
     * Protects: Shape 2 in platformApiFetch.
     */
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'auth.mfa_invalid_code',
            message: 'Invalid MFA code',
            details: null,
          },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    let caught: unknown;
    try {
      await listPlatformTenants();
    } catch (err) {
      caught = err;
    }
    const err = caught as AuthClientError;
    expect(err).toBeInstanceOf(AuthClientError);
    expect(err.code).toBe('auth.mfa_invalid_code');
    expect(err.body?.message).toBe('Invalid MFA code');
  });

  it('keeps body undefined when platform JSON body has neither envelope nor message', async () => {
    /*
     * Scenario: parallel defence-in-depth for the platform path — a
     * JSON body matching neither known shape must fall through to the
     * generic message with `body === undefined`. Protects the
     * "neither shape matched" exit in platformApiFetch.
     */
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ statusCode: 500, unrelated: 'field' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    let caught: unknown;
    try {
      await listPlatformTenants();
    } catch (err) {
      caught = err;
    }
    const err = caught as AuthClientError;
    expect(err.code).toBeUndefined();
    expect(err.body).toBeUndefined();
    expect(err.message).toBe('Request failed with status 500');
  });

  it('keeps the generic status message when the platform envelope omits message', async () => {
    /*
     * Scenario: parallel defence-in-depth — the platform path must
     * handle the AuthException envelope with code-but-no-message
     * identically to the dashboard variant. Protects the false branch
     * of `if (typeof e.message === 'string')` in platformApiFetch.
     */
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'auth.unknown',
            details: null,
          },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    let caught: unknown;
    try {
      await listPlatformTenants();
    } catch (err) {
      caught = err;
    }
    const err = caught as AuthClientError;
    expect(err.code).toBe('auth.unknown');
    expect(err.body?.message).toBe('Request failed with status 500');
  });

  it('falls back to top-level NestJS message shape when no error envelope is present (platform)', async () => {
    /*
     * Scenario: a NestJS ValidationPipe 400 (or any non-AuthException
     * NestJS exception) carries the flat `{ statusCode, message, error }`
     * shape. platformApiFetch must surface `message` from the top level
     * — same handling as the apiFetch variant. Protects the "Shape 2"
     * branch in the platform path.
     */
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          statusCode: 400,
          message: 'invalid request',
          error: 'Bad Request',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', mockFetch);

    let caught: unknown;
    try {
      await listPlatformTenants();
    } catch (err) {
      caught = err;
    }
    const err = caught as AuthClientError;
    expect(err.code).toBeUndefined();
    expect(err.body?.message).toBe('invalid request');
    expect(err.body?.error).toBe('Bad Request');
  });

  it('returns undefined when response body is empty but status is 2xx', async () => {
    /*
     * Scenario: a 200 with an empty body must return undefined without throwing.
     * Protects: empty body guard in platformApiFetch.
     */
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const result = await listPlatformTenants();
    expect(result).toBeUndefined();
  });
});

describe('resolveTenantForLogin', () => {
  it('short-circuits when the input already matches CUID_REGEX', async () => {
    /*
     * Scenario: the register flow stores the resolved CUID in the URL and
     * the verify-email page re-uses it on the next API call. Hitting the
     * resolve endpoint with a CUID would always return 404 (the API only
     * indexes slugs) and the helper would mis-throw `TenantNotFoundError`.
     * The CUID_REGEX guard bypasses the fetch entirely and returns the
     * input unchanged so the surrounding flow keeps working.
     * Protects: the `CUID_REGEX.test(slugOrId)` short-circuit branch in
     * `resolveTenantForLogin`.
     */
    const mockFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', mockFetch);

    const cuid = 'cmo60aidg00017jf2voxw88ug';
    const result = await resolveTenantForLogin(cuid);

    expect(result).toBe(cuid);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns the CUID from the resolve endpoint when the slug is valid', async () => {
    /*
     * Scenario: the login page passes `?tenantId=acme` and the API resolves it
     * to a CUID. The helper returns that CUID so the caller can write it to
     * the `tenant_id` cookie for X-Tenant-Id injection.
     * Protects: happy-path slug → CUID translation (line 219, 227-229).
     */
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(makeJsonResponse({ id: 'cuid-acme' }));
    vi.stubGlobal('fetch', mockFetch);

    const result = await resolveTenantForLogin('acme');

    expect(result).toBe('cuid-acme');
    expect(mockFetch).toHaveBeenCalledWith('/api/tenants/resolve?slug=acme');
  });

  it('throws TenantNotFoundError carrying the slug when the API returns 404', async () => {
    /*
     * Scenario: a workspace slug that no longer exists. The error surface lets
     * the login/forgot-password pages render a clear "Workspace X not found"
     * banner instead of falling through to a misleading invalid-credentials toast.
     * Protects: 404 → TenantNotFoundError branch (line 224-225).
     */
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    vi.stubGlobal('fetch', mockFetch);

    // Single invocation — chaining two `await expect(...).rejects` would call
    // resolveTenantForLogin twice but `mockResolvedValueOnce` only primes one
    // call. Capture the thrown value once and assert both properties on it.
    const thrown = await resolveTenantForLogin('missing').catch((err: unknown) => err);
    expect(thrown).toBeInstanceOf(TenantNotFoundError);
    expect((thrown as TenantNotFoundError).slug).toBe('missing');
  });

  it('falls back to the input value on network errors (fetch rejection)', async () => {
    /*
     * Scenario: the API is unreachable (no network, DNS failure, etc.). The
     * helper returns the raw slug so the subsequent login attempt fails with
     * the API's own error rather than blocking the user on resolve infra.
     * Protects: fetch-throws catch branch (line 220-222).
     */
    const mockFetch = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('network down'));
    vi.stubGlobal('fetch', mockFetch);

    const result = await resolveTenantForLogin('acme');

    expect(result).toBe('acme');
  });

  it('falls back to the input value on non-2xx, non-404 responses (e.g. 500)', async () => {
    /*
     * Scenario: an internal-server-error from the resolve endpoint. The helper
     * does not throw — it returns the raw input so the caller can attempt the
     * login and surface whatever error the actual auth endpoint reports.
     * Protects: status !== 404 && !response.ok branch (line 231 fallthrough).
     */
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', mockFetch);

    const result = await resolveTenantForLogin('acme');

    expect(result).toBe('acme');
  });

  it('falls back to the input value when the 200 body lacks a string id', async () => {
    /*
     * Scenario: defensive guard — if the resolve endpoint ever returns a 200
     * with a non-string `id` (schema drift), the helper falls back to the raw
     * input rather than coercing a non-string into the tenant cookie.
     * Protects: typeof data.id check (line 229 false branch).
     */
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(makeJsonResponse({ id: 42 }));
    vi.stubGlobal('fetch', mockFetch);

    const result = await resolveTenantForLogin('acme');

    expect(result).toBe('acme');
  });

  it('throws a TenantNotFoundError carrying the verbatim "Tenant not found: <slug>" message and a stable .name', async () => {
    /*
     * Scenario: pinning both the verbatim Error.message template and the
     * `.name` property — error-tracking dashboards group by `name` and
     * support docs link to the exact message string. Truncating either
     * would silently break the grouping AND the docs cross-reference.
     */
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    vi.stubGlobal('fetch', mockFetch);

    const thrown = (await resolveTenantForLogin('globex').catch(
      (err: unknown) => err,
    )) as TenantNotFoundError;

    expect(thrown).toBeInstanceOf(TenantNotFoundError);
    expect(thrown.message).toBe('Tenant not found: globex');
    expect(thrown.name).toBe('TenantNotFoundError');
  });
});

// ── Stryker-killing strengthenings ───────────────────────────────────────────

describe('tenantAwareFetch — cookie discrimination and init merging', () => {
  it('does NOT inject X-Tenant-Id when document.cookie contains a different cookie than tenant_id', async () => {
    /*
     * Scenario: another cookie (e.g. `other_id=foo`) is set but
     * `tenant_id` is absent. The `getCookie` helper iterates
     * `document.cookie.split('; ')` and uses `part.startsWith(prefix)`
     * to find the matching cookie — without the startsWith guard, a
     * mutated `if (true)` would return the FIRST cookie's value
     * regardless of name, and tenantAwareFetch would inject the wrong
     * value into the X-Tenant-Id header. Pinning the negative space
     * (no header) defends the startsWith guard.
     */
    setCookieValue('other_id', 'wrong-value');
    clearCookie('tenant_id');
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse([]));

    await listSessions();

    const [, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit | undefined];
    if (init?.headers instanceof Headers) {
      expect(init.headers.get('X-Tenant-Id')).toBeNull();
    } else if (init?.headers && typeof init.headers === 'object') {
      expect((init.headers as Record<string, string>)['X-Tenant-Id']).toBeUndefined();
    }
    clearCookie('other_id');
  });

  it('preserves other init fields (method, body) when injecting the X-Tenant-Id header', async () => {
    /*
     * Scenario: a caller passes init with `method: 'POST'` and a body.
     * The `init !== undefined ? { ...init, headers } : { headers }`
     * spread must preserve those fields — a mutated `false ?` would
     * fall to `{ headers }` only, silently dropping the method and
     * body so the request degrades to GET with no payload. Pins the
     * truthy arm of the init-spread conditional.
     */
    setCookieValue('tenant_id', 'tenant-merge');
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse({}));

    await capturedTenantAwareFetch.fn!('/test-path', {
      method: 'POST',
      body: JSON.stringify({ probe: true }),
    });

    const [, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ probe: true }));
    const headers = init.headers as Headers;
    expect(headers.get('X-Tenant-Id')).toBe('tenant-merge');

    clearCookie('tenant_id');
  });
});

describe('apiFetch — 204 short-circuit boundary', () => {
  it('returns the parsed body (NOT undefined) for a 200 OK with a JSON payload', async () => {
    /*
     * Scenario: a 200 with a real body must parse the body. Pins the
     * falsy arm of `if (response.status === 204)` — a mutated
     * `if (true)` would short-circuit every response to undefined,
     * silently dropping every successful payload. The negative
     * assertion (NOT undefined, IS the expected array) defends the
     * 204-specific short-circuit.
     */
    const payload = [{ id: 'sess-1' }];
    mockInnerFetch.mockResolvedValueOnce(makeJsonResponse(payload));

    const result = await listSessions();
    expect(result).not.toBeUndefined();
    expect(result).toEqual(payload);
  });
});

describe('buildAuthClientError — body.error verbatim empty string', () => {
  it('sets body.error to the empty string when Shape 1 (flat envelope) builds the body', async () => {
    /*
     * Scenario: the Shape 1 builder pins `error: ''` because the flat
     * envelope does not carry a separate `error` field (NestJS uses
     * that field only in the Shape 3 ValidationPipe envelope). Pinning
     * the verbatim empty string defends against a regression that
     * stuffed `'Stryker'` or the status name into that slot — both
     * would surface in error-tracking dashboards as a false breadcrumb.
     */
    mockInnerFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'auth.unknown', message: 'boom', statusCode: 500 }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const thrown = (await listUsers().catch((err: unknown) => err)) as AuthClientError;
    expect(thrown.body?.error).toBe('');
  });

  it('sets body.error to the empty string when Shape 2 (nested envelope) builds the body', async () => {
    /*
     * Scenario: same empty-string pin for the Shape 2 builder. Both
     * builders use the same `''` literal — pinning each one
     * independently defends against a divergence where one was
     * silently changed.
     */
    mockInnerFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'auth.unknown', message: 'boom' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const thrown = (await listUsers().catch((err: unknown) => err)) as AuthClientError;
    expect(thrown.body?.error).toBe('');
  });

  it('falls back to body.error="" when Shape 3 body has a non-string `error` field', async () => {
    /*
     * Scenario: a NestJS-style envelope where `error` is a number or
     * boolean (defensive — never happens in well-behaved APIs, but the
     * guard exists). The `typeof parsed.error === 'string' ? ... : ''`
     * ternary's falsy arm must run, producing `body.error = ''`. Pins
     * both the type-check ternary AND the empty-string fallback.
     */
    mockInnerFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ statusCode: 400, message: 'boom', error: 42 }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const thrown = (await listUsers().catch((err: unknown) => err)) as AuthClientError;
    expect(thrown.body?.message).toBe('boom');
    expect(thrown.body?.error).toBe('');
  });
});

describe('buildAuthClientError — Shape 2 envelope type-guard', () => {
  it('falls through Shape 2 to Shape 3 when parsed.error is a NUMBER (not an object)', async () => {
    /*
     * Scenario: a hostile or buggy server returns `{ error: 42, message:
     * 'fail' }`. The `typeof envelope === 'object'` guard MUST reject the
     * number — otherwise the cast `(envelope as Record).code` would
     * surface `undefined` downstream and crash the typeof check. Pins
     * the `typeof envelope === 'object'` clause of the Shape 2 guard
     * by asserting the parser falls through to Shape 3 (which reads
     * the top-level `message`).
     */
    mockInnerFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 42, message: 'fell through to shape 3' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const thrown = (await listUsers().catch((err: unknown) => err)) as AuthClientError;
    expect(thrown.body?.message).toBe('fell through to shape 3');
  });

  it('falls through Shape 2 to Shape 3 when parsed.error is NULL', async () => {
    /*
     * Scenario: same guard, different bad shape — `{ error: null, ... }`
     * must reject the null because `typeof null === 'object'` is true,
     * so the secondary `envelope !== null` check carries the
     * disambiguation. Pinning that the parser falls through to Shape 3
     * defends the `envelope !== null` clause.
     */
    mockInnerFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: null, message: 'null envelope falls through' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const thrown = (await listUsers().catch((err: unknown) => err)) as AuthClientError;
    expect(thrown.body?.message).toBe('null envelope falls through');
  });

  it('falls through Shape 2 to Shape 3 when parsed.error.code is a NUMBER (not a string)', async () => {
    /*
     * Scenario: the Shape 2 envelope's `code` field is the wrong type
     * (e.g. a numeric status mistakenly serialized in the slot). The
     * `typeof (envelope as Record).code === 'string'` guard must
     * reject non-string codes so the parser falls through. Defends the
     * code-type clause of the Shape 2 guard.
     */
    mockInnerFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: 500, message: 'numeric code falls through' },
          message: 'numeric code falls through',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const thrown = (await listUsers().catch((err: unknown) => err)) as AuthClientError;
    expect(thrown.body?.message).toBe('numeric code falls through');
  });
});
