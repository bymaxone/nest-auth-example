/**
 * @fileoverview Unit tests for the `Topbar` layout component.
 *
 * Verifies:
 * - The topbar renders with the brand name.
 * - The hamburger button is present and calls onMenuOpen when clicked.
 * - The user avatar initials are shown when a session is active.
 * - The sign-out button is rendered.
 *
 * `@bymax-one/nest-auth/react`, `next/navigation`, `sonner`, and sub-components
 * are mocked to avoid deep integration concerns.
 *
 * @module components/layout/topbar.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
}));

vi.mock('@bymax-one/nest-auth/react', () => ({
  useSession: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  listTenants: vi.fn().mockResolvedValue([]),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { useSession } from '@bymax-one/nest-auth/react';
import { Topbar } from './topbar.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Topbar rendering', () => {
  it('renders the brand name', () => {
    /*
     * Scenario: the brand text "nest-auth-example" must always be visible
     * in the topbar for product identity.
     * Protects: brand span renders correctly.
     */
    vi.mocked(useSession).mockReturnValue({
      user: null,
      session: null,
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof useSession>);
    render(<Topbar onMenuOpen={vi.fn()} />);
    expect(screen.getByText('nest-auth-example')).toBeDefined();
  });

  it('renders the hamburger button that calls onMenuOpen when clicked', () => {
    /*
     * Scenario: the mobile hamburger button must call the onMenuOpen prop
     * when clicked so the sidebar overlay can be toggled.
     * Protects: hamburger button wires onMenuOpen correctly.
     */
    const onMenuOpen = vi.fn();
    vi.mocked(useSession).mockReturnValue({
      user: null,
      session: null,
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof useSession>);
    render(<Topbar onMenuOpen={onMenuOpen} />);
    const hamburger = screen.getByRole('button', { name: /open navigation menu/i });
    fireEvent.click(hamburger);
    expect(onMenuOpen).toHaveBeenCalledOnce();
  });

  it('shows user initials in the avatar when a session is active', () => {
    /*
     * Scenario: when the user is authenticated their initials must appear in
     * the avatar so they can verify their identity.
     * Protects: user initials are derived from user.name and rendered.
     */
    vi.mocked(useSession).mockReturnValue({
      user: { id: 'u1', name: 'Alice Brown', role: 'MEMBER', tenantId: 'tid', mfaEnabled: false },
      session: null,
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof useSession>);
    render(<Topbar onMenuOpen={vi.fn()} />);
    // Initials for "Alice Brown" are "AB".
    expect(screen.getByText('AB')).toBeDefined();
  });

  it('computes "?" initials when user session is null', () => {
    /*
     * Scenario: when user is null the initials variable is "?" — the Avatar
     * receives it as children even if it is not visible in DOM due to no user block.
     * We verify the component does not crash and no user avatar block renders.
     * Protects: fallback initials path executes without throwing when user is null.
     */
    vi.mocked(useSession).mockReturnValue({
      user: null,
      session: null,
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof useSession>);
    // Must not throw when user is null.
    expect(() => render(<Topbar onMenuOpen={vi.fn()} />)).not.toThrow();
    // The desktop user info block is hidden (user is null guard).
    expect(screen.queryByText('MEMBER')).toBeNull();
  });

  it('uses the empty-string fallback for initials when a name segment has no first character', () => {
    /*
     * Scenario: a user whose name contains a trailing space produces an empty
     * string as the last segment after split. `n[0]` on `''` is `undefined`,
     * so the `?? ''` fallback fires to produce an empty string instead of "undefined".
     * Protects: line 41 — `n[0] ?? ''` null-coalescing branch for empty name segments.
     */
    vi.mocked(useSession).mockReturnValue({
      user: {
        id: 'u1',
        // Trailing space creates a split segment '' whose n[0] is undefined.
        name: 'Alice ',
        role: 'MEMBER',
        tenantId: 'tid',
        mfaEnabled: false,
      },
      session: null,
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof useSession>);
    // Should not throw even with the empty segment.
    expect(() => render(<Topbar onMenuOpen={vi.fn()} />)).not.toThrow();
    // Initials should be "A" (only first segment contributes, empty segment is '').
    expect(screen.getByText('A')).toBeDefined();
  });

  it('renders the sign-out button', () => {
    /*
     * Scenario: the topbar must always contain the sign-out button so the user
     * can exit their session from any page.
     * Protects: SignOutButton is rendered inside the topbar.
     */
    vi.mocked(useSession).mockReturnValue({
      user: null,
      session: null,
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof useSession>);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    render(<Topbar onMenuOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: /sign out/i })).toBeDefined();
  });
});
