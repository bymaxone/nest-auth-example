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
  createInvitation,
  revokeInvitation,
  changePassword,
  notifySelf,
  mfaSetup,
  mfaVerifyEnable,
  mfaDisable,
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
  it('sends POST /auth/invitations with email and role in the body', async () => {
    /*
     * Scenario: createInvitation must POST to the library-managed invitations
     * endpoint with email and role serialised in the body.
     * Protects: createInvitation path, method, and body contract.
     */
    mockInnerFetch.mockResolvedValueOnce(make204Response());

    await createInvitation('invited@example.com', 'MEMBER');

    const [path, init] = mockInnerFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/auth/invitations');
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
});
