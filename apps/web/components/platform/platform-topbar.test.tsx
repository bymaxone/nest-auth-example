/**
 * @fileoverview Unit tests for the `PlatformTopbar` component.
 *
 * Verifies:
 * - The "PLATFORM ADMIN" label renders.
 * - The sign-out button renders and calls platformLogout on click.
 * - Admin initials are shown when a platform admin is stored.
 *
 * @module components/platform/platform-topbar.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Router mock state ─────────────────────────────────────────────────────────

const mockReplace = vi.fn();
const mockRouter = { push: vi.fn(), replace: mockReplace, refresh: vi.fn() };

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/',
}));

vi.mock('@/lib/auth-client', () => ({
  platformLogout: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/platform-auth', () => ({
  getPlatformAdmin: vi.fn(),
  getPlatformRefreshToken: vi.fn().mockReturnValue('refresh-tok'),
  clearPlatformTokens: vi.fn(),
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { platformLogout } from '@/lib/auth-client';
import {
  getPlatformAdmin,
  clearPlatformTokens,
  getPlatformRefreshToken,
} from '@/lib/platform-auth';
import { PlatformTopbar } from './platform-topbar.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PlatformTopbar rendering', () => {
  it('renders the PLATFORM ADMIN label', () => {
    /*
     * Scenario: the "PLATFORM ADMIN" text must always be visible so the
     * operator cannot confuse this area with the tenant dashboard.
     * Protects: platform context label is always present.
     */
    vi.mocked(getPlatformAdmin).mockReturnValue(null);
    render(<PlatformTopbar />);
    expect(screen.getByText(/platform admin/i)).toBeDefined();
  });

  it('renders the brand name "nest-auth-example"', () => {
    /*
     * Scenario: the app name must appear below the platform label for
     * product identification.
     * Protects: brand name renders inside the topbar.
     */
    vi.mocked(getPlatformAdmin).mockReturnValue(null);
    render(<PlatformTopbar />);
    expect(screen.getByText('nest-auth-example')).toBeDefined();
  });

  it('renders admin initials when platform admin is stored', () => {
    /*
     * Scenario: when a platform admin record is in sessionStorage the avatar
     * must show the admin's initials.
     * Protects: admin initials are derived from admin.name.
     */
    vi.mocked(getPlatformAdmin).mockReturnValue({
      id: 'a1',
      email: 'admin@example.com',
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    });
    render(<PlatformTopbar />);
    expect(screen.getByText('SA')).toBeDefined();
  });

  it('caps initials at TWO characters when the admin name has three or more parts', () => {
    /*
     * Scenario: when an admin name has three or more space-separated parts
     * (e.g. "Anne Marie Smith") the initials must be capped at two
     * characters — anything longer overflows the small avatar circle and
     * looks broken.
     * Protects: `.slice(0, 2)` on the split name — MethodExpression mutant
     * that drops the slice would let "AMS" through.
     */
    vi.mocked(getPlatformAdmin).mockReturnValue({
      id: 'a2',
      email: 'amarie@example.com',
      name: 'Anne Marie Smith',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    });
    render(<PlatformTopbar />);
    expect(screen.getByText('AM')).toBeDefined();
    expect(screen.queryByText('AMS')).toBeNull();
    expect(screen.queryByText('AnneMarieSmith')).toBeNull();
  });

  it('falls back to "PA" initials when the admin record has an empty name', () => {
    /*
     * Scenario: when the stored admin record carries an empty string for
     * name (e.g. a partially-populated record from a legacy migration) the
     * avatar must render the literal "PA" platform-admin fallback so the
     * avatar circle is never blank.
     * Protects:
     * - StringLiteral mutant on `: 'PA'` — empty-string mutant would render
     *   an empty avatar,
     * - the `admin?.name ? … : 'PA'` ternary takes the falsy arm for empty
     *   names (and the surrounding `{admin && (…)}` block still renders
     *   because the admin record itself is truthy).
     */
    vi.mocked(getPlatformAdmin).mockReturnValue({
      id: 'a3',
      email: 'unknown@example.com',
      name: '',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    });
    render(<PlatformTopbar />);
    expect(screen.getByText('PA')).toBeDefined();
  });

  it('renders the sign-out button', () => {
    /*
     * Scenario: the sign-out button must always be visible in the topbar.
     * Protects: sign-out button renders in the platform topbar.
     */
    vi.mocked(getPlatformAdmin).mockReturnValue(null);
    render(<PlatformTopbar />);
    expect(screen.getByRole('button', { name: /sign out/i })).toBeDefined();
  });
});

describe('PlatformTopbar sign-out flow', () => {
  it('disables the sign-out button while platformLogout is in flight', async () => {
    /*
     * Scenario: between clicking sign-out and the API responding, the
     * sign-out button must be disabled so the operator cannot double-submit.
     * Protects: BooleanLiteral mutant on `setIsPending(true)` — a `false`
     * mutant would leave the button enabled mid-flight.
     */
    vi.mocked(getPlatformAdmin).mockReturnValue(null);
    let resolveLogout: () => void = () => undefined;
    vi.mocked(platformLogout).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLogout = resolve;
        }),
    );

    render(<PlatformTopbar />);
    const button = screen.getByRole('button', { name: /sign out/i });
    fireEvent.click(button);

    await waitFor(() => expect(platformLogout).toHaveBeenCalled());
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    resolveLogout();
  });

  it('calls platformLogout, clears tokens, and redirects on sign-out', async () => {
    /*
     * Scenario: clicking sign out must call platformLogout with the refresh
     * token, clear platform tokens from sessionStorage, and navigate to login.
     * Protects: handleSignOut flow is complete.
     */
    vi.mocked(getPlatformAdmin).mockReturnValue(null);
    vi.mocked(platformLogout).mockResolvedValue(undefined);

    render(<PlatformTopbar />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => {
      expect(platformLogout).toHaveBeenCalledOnce();
      expect(clearPlatformTokens).toHaveBeenCalledOnce();
      expect(mockReplace).toHaveBeenCalledWith('/platform/login');
    });
  });

  it('clears tokens and redirects even when platformLogout rejects (best-effort revocation)', async () => {
    /*
     * Scenario: when platformLogout fails the catch block swallows the error
     * but the finally block must still clear tokens and redirect to login.
     * Protects: lines 53-58 — catch swallows; finally always clears and redirects.
     */
    vi.mocked(getPlatformAdmin).mockReturnValue(null);
    vi.mocked(platformLogout).mockRejectedValue(new Error('Network error'));

    render(<PlatformTopbar />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => {
      expect(clearPlatformTokens).toHaveBeenCalledOnce();
      expect(mockReplace).toHaveBeenCalledWith('/platform/login');
    });
  });

  it('uses empty string for refresh token when getPlatformRefreshToken returns null', async () => {
    /*
     * Scenario: when getPlatformRefreshToken() returns null the `?? ''` fallback
     * fires and platformLogout is called with an empty string.
     * Protects: line 51 — `getPlatformRefreshToken() ?? ''` null-coalescing branch.
     */
    vi.mocked(getPlatformAdmin).mockReturnValue(null);
    vi.mocked(getPlatformRefreshToken).mockReturnValue(null);
    vi.mocked(platformLogout).mockResolvedValue(undefined);

    render(<PlatformTopbar />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => {
      expect(platformLogout).toHaveBeenCalledWith('');
    });
  });

  it('uses the empty-string fallback for initials when an admin name segment is empty', () => {
    /*
     * Scenario: an admin name with a trailing space produces an empty string
     * segment whose `n[0]` is `undefined`, so the `?? ''` fallback fires.
     * Protects: lines 43-45 — `n[0] ?? ''` null-coalescing branch.
     */
    vi.mocked(getPlatformAdmin).mockReturnValue({
      id: 'a1',
      email: 'admin@example.com',
      // Trailing space forces an empty segment after split.
      name: 'Admin ',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    });
    // Should not throw with the empty name segment.
    expect(() => render(<PlatformTopbar />)).not.toThrow();
    // Initials should be 'A' (empty segment contributes '' not 'undefined').
    expect(screen.getByText('A')).toBeDefined();
  });
});
