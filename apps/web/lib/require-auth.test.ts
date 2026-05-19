/**
 * @fileoverview Unit tests for `requireAuth` and `requireRole` server helpers.
 *
 * These helpers are server-only (use `next/headers` and `next/navigation`) so all
 * Next.js and auth-library modules are mocked. Tests verify the happy path, the
 * missing-token redirect, the invalid-token redirect, and the role guard.
 *
 * @module lib/require-auth.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────────

/** Mutable map backing the fake cookie store. */
const fakeCookies = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: (name: string) => {
      const value = fakeCookies.get(name);
      return value !== undefined ? { value } : undefined;
    },
  })),
}));

const mockRedirect = vi.fn((url: string): never => {
  // Simulate the Next.js NEXT_REDIRECT throw so callers see it as a throw.
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}));

vi.mock('@bymax-one/nest-auth/nextjs', () => ({
  verifyJwtToken: vi.fn(),
  getUserId: vi.fn(),
  getUserRole: vi.fn(),
  getTenantId: vi.fn(),
}));

vi.mock('@bymax-one/nest-auth/shared', () => ({
  AUTH_ACCESS_COOKIE_NAME: 'access_token',
}));

vi.mock('@/lib/env', () => ({
  env: {
    AUTH_JWT_SECRET_FOR_PROXY: 'a-very-long-secret-key-32-chars-min',
    INTERNAL_API_URL: 'http://localhost:3001',
    NEXT_PUBLIC_API_URL: 'http://localhost:3000/api',
    NEXT_PUBLIC_WS_URL: 'ws://localhost:3000',
    NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED: false,
  },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { verifyJwtToken, getUserId, getUserRole, getTenantId } from '@bymax-one/nest-auth/nextjs';
import { requireAuth, requireRole } from './require-auth.js';

beforeEach(() => {
  vi.clearAllMocks();
  fakeCookies.clear();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('requireAuth', () => {
  it('redirects to /auth/login when the access_token cookie is absent', async () => {
    /*
     * Scenario: when no access_token cookie exists requireAuth must redirect to
     * the login page without attempting JWT verification.
     * Protects: missing cookie guard on line 55 (`if (!token) redirect(...)`).
     */
    // fakeCookies is empty — no cookie will be found.
    await expect(requireAuth()).rejects.toThrow('NEXT_REDIRECT:/auth/login');
    expect(verifyJwtToken).not.toHaveBeenCalled();
  });

  it('returns typed identity claims when token is valid', async () => {
    /*
     * Scenario: when the cookie is present and verifyJwtToken succeeds the
     * function must return the userId, role, tenantId, and raw token.
     * Protects: happy path extracts claims via getUserId/getUserRole/getTenantId.
     */
    fakeCookies.set('access_token', 'valid.jwt.token');
    const fakeDecoded = { sub: 'user-1', role: 'MEMBER', tenantId: 'tenant-1' };
    vi.mocked(verifyJwtToken).mockResolvedValue(fakeDecoded as never);
    vi.mocked(getUserId).mockReturnValue('user-1');
    vi.mocked(getUserRole).mockReturnValue('MEMBER');
    vi.mocked(getTenantId).mockReturnValue('tenant-1');

    const session = await requireAuth();

    expect(session).toEqual({
      userId: 'user-1',
      role: 'MEMBER',
      tenantId: 'tenant-1',
      token: 'valid.jwt.token',
    });
  });

  it('returns tenantId as null when getTenantId returns undefined', async () => {
    /*
     * Scenario: platform-admin tokens have no tenantId; getTenantId returns
     * undefined which must be coerced to null.
     * Protects: `getTenantId(decoded) ?? null` coercion on line 62.
     */
    fakeCookies.set('access_token', 'platform.jwt.token');
    vi.mocked(verifyJwtToken).mockResolvedValue({} as never);
    vi.mocked(getUserId).mockReturnValue('admin-1');
    vi.mocked(getUserRole).mockReturnValue('SUPER_ADMIN');
    vi.mocked(getTenantId).mockReturnValue(undefined);

    const session = await requireAuth();

    expect(session.tenantId).toBeNull();
  });

  it('redirects to /auth/login when verifyJwtToken throws', async () => {
    /*
     * Scenario: a tampered or expired token causes verifyJwtToken to throw;
     * the catch block must redirect to /auth/login.
     * Protects: catch block on lines 65-67.
     */
    fakeCookies.set('access_token', 'bad.token');
    vi.mocked(verifyJwtToken).mockRejectedValue(new Error('Invalid signature'));

    await expect(requireAuth()).rejects.toThrow('NEXT_REDIRECT:/auth/login');
  });
});

describe('requireRole', () => {
  it('returns the session when the user role is in the allowed list', async () => {
    /*
     * Scenario: requireRole(['ADMIN', 'OWNER']) must pass through when the user
     * has the ADMIN role, delegating to requireAuth.
     * Protects: role in allowed list → returns session without redirect.
     */
    fakeCookies.set('access_token', 'admin.jwt.token');
    vi.mocked(verifyJwtToken).mockResolvedValue({} as never);
    vi.mocked(getUserId).mockReturnValue('u1');
    vi.mocked(getUserRole).mockReturnValue('ADMIN');
    vi.mocked(getTenantId).mockReturnValue('t1');

    const session = await requireRole(['ADMIN', 'OWNER']);

    expect(session.role).toBe('ADMIN');
  });

  it('redirects to /auth/login when the user role is not in the allowed list', async () => {
    /*
     * Scenario: a MEMBER accessing an ADMIN-only RSC must be redirected.
     * Protects: role not in allowed list → redirect('/auth/login') on line 82.
     */
    fakeCookies.set('access_token', 'member.jwt.token');
    vi.mocked(verifyJwtToken).mockResolvedValue({} as never);
    vi.mocked(getUserId).mockReturnValue('u2');
    vi.mocked(getUserRole).mockReturnValue('MEMBER');
    vi.mocked(getTenantId).mockReturnValue('t1');

    await expect(requireRole(['ADMIN', 'OWNER'])).rejects.toThrow('NEXT_REDIRECT:/auth/login');
  });
});
