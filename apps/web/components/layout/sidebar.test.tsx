/**
 * @fileoverview Unit tests for the `Sidebar` layout component.
 *
 * Verifies:
 * - Nav items render for all authenticated users.
 * - Admin-only items (Team, Invitations) are hidden for MEMBER users.
 * - Admin-only items are visible for ADMIN users.
 * - The user footer renders the user name and role when a session is active.
 *
 * `@bymax-one/nest-auth/react` and `next/navigation` are mocked.
 *
 * @module components/layout/sidebar.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard',
}));

vi.mock('@bymax-one/nest-auth/react', () => ({
  useSession: vi.fn(),
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { useSession } from '@bymax-one/nest-auth/react';
import { Sidebar } from './sidebar.js';

beforeEach(() => {
  vi.clearAllMocks();
});

/** Creates a minimal mock session object for useSession. */
function mockSession(role: string, name = 'Alice', tenantId = 'tenant-1') {
  return {
    user: { id: 'u1', role, name, tenantId, mfaEnabled: false },
    session: null,
    isPending: false,
    error: null,
  };
}

describe('Sidebar rendering', () => {
  it('renders common nav items visible to all roles', () => {
    /*
     * Scenario: nav items like Overview, Account, Security, Sessions, and Projects
     * must always appear regardless of the user's role.
     * Protects: non-adminOnly NAV_ITEMS always render.
     */
    vi.mocked(useSession).mockReturnValue(
      mockSession('MEMBER') as unknown as ReturnType<typeof useSession>,
    );
    render(<Sidebar isOpen />);
    expect(screen.getByText('Overview')).toBeDefined();
    expect(screen.getByText('Account')).toBeDefined();
    expect(screen.getByText('Security')).toBeDefined();
    expect(screen.getByText('Sessions')).toBeDefined();
    expect(screen.getByText('Projects')).toBeDefined();
  });

  it('hides Team and Invitations for MEMBER role', () => {
    /*
     * Scenario: MEMBER users must not see admin-only nav items to avoid
     * accessing admin pages they are not allowed to visit.
     * Protects: adminOnly filter hides items when user role is not ADMIN/OWNER.
     */
    vi.mocked(useSession).mockReturnValue(
      mockSession('MEMBER') as unknown as ReturnType<typeof useSession>,
    );
    render(<Sidebar isOpen />);
    expect(screen.queryByText('Team')).toBeNull();
    expect(screen.queryByText('Invitations')).toBeNull();
  });

  it('shows Team and Invitations for ADMIN role', () => {
    /*
     * Scenario: ADMIN users must see the Team and Invitations nav items.
     * Protects: adminOnly filter shows items when user is ADMIN.
     */
    vi.mocked(useSession).mockReturnValue(
      mockSession('ADMIN') as unknown as ReturnType<typeof useSession>,
    );
    render(<Sidebar isOpen />);
    expect(screen.getByText('Team')).toBeDefined();
    expect(screen.getByText('Invitations')).toBeDefined();
  });

  it('shows Team and Invitations for OWNER role', () => {
    /*
     * Scenario: OWNER users must also see admin-only nav items.
     * Protects: ADMIN_ROLES set includes OWNER.
     */
    vi.mocked(useSession).mockReturnValue(
      mockSession('OWNER') as unknown as ReturnType<typeof useSession>,
    );
    render(<Sidebar isOpen />);
    expect(screen.getByText('Team')).toBeDefined();
    expect(screen.getByText('Invitations')).toBeDefined();
  });

  it('renders the user name and role in the footer', () => {
    /*
     * Scenario: the sidebar footer must display the logged-in user's name and
     * role so they can verify their identity without navigating away.
     * Protects: user footer renders correctly when session is active.
     */
    vi.mocked(useSession).mockReturnValue(
      mockSession('MEMBER', 'Bob Smith') as unknown as ReturnType<typeof useSession>,
    );
    render(<Sidebar isOpen />);
    expect(screen.getByText('Bob Smith')).toBeDefined();
    expect(screen.getByText('MEMBER')).toBeDefined();
  });

  it('does not render the footer when user is null', () => {
    /*
     * Scenario: when the session has no user the footer section must not render.
     * Protects: user && guard hides the footer when unauthenticated.
     */
    vi.mocked(useSession).mockReturnValue({
      user: null,
      session: null,
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof useSession>);
    render(<Sidebar isOpen />);
    expect(screen.queryByText('MEMBER')).toBeNull();
  });

  it('renders nav as hidden on mobile when isOpen=false', () => {
    /*
     * Scenario: when isOpen=false the nav element must have the "hidden" class
     * so it is not visible on mobile.
     * Protects: CSS toggling on isOpen prop.
     */
    vi.mocked(useSession).mockReturnValue(
      mockSession('MEMBER') as unknown as ReturnType<typeof useSession>,
    );
    render(<Sidebar isOpen={false} />);
    const nav = screen.getByRole('navigation', { name: /main navigation/i });
    expect(nav.className).toContain('hidden');
  });

  it('calls onNavClick when a nav link is clicked and onNavClick is provided', () => {
    /*
     * Scenario: when onNavClick is passed as a prop, clicking a nav link must
     * invoke it so the mobile overlay can be closed.
     * Protects: lines 66 and 128 — conditional spread of onNavClick onto Link and
     * SidebarNavItem only when onNavClick is defined (true branch of the ternary).
     */
    vi.mocked(useSession).mockReturnValue(
      mockSession('MEMBER') as unknown as ReturnType<typeof useSession>,
    );
    const onNavClick = vi.fn();
    render(<Sidebar isOpen onNavClick={onNavClick} />);
    // Click one of the nav links — "Overview" is always visible.
    fireEvent.click(screen.getByText('Overview'));
    expect(onNavClick).toHaveBeenCalledOnce();
  });
});
