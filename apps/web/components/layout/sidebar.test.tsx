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

/** Mutable pathname used by the usePathname mock — set per-test. */
const pathnameRef = vi.hoisted(() => ({ current: '/dashboard' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => pathnameRef.current,
}));

vi.mock('@bymax-one/nest-auth/react', () => ({
  useSession: vi.fn(),
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { useSession } from '@bymax-one/nest-auth/react';
import { Sidebar } from './sidebar.js';

beforeEach(() => {
  vi.clearAllMocks();
  pathnameRef.current = '/dashboard';
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

// ── Active-state, aria, and visibility pins ──────────────────────────────────

describe('Sidebar active-state, aria-current, and visibility', () => {
  it('marks the EXACT-match nav item active with aria-current="page" and the brand-orange palette', () => {
    /*
     * Scenario: the Overview item carries `exact: true`. When pathname
     * equals `/dashboard` exactly, the item must surface as active —
     * `aria-current="page"` for SR, brand-orange `#ff6224` palette for
     * visual cue. Pins both the EqualityOperator (`===`) AND the
     * ConditionalExpression that drives `aria-current` / palette.
     */
    pathnameRef.current = '/dashboard';
    vi.mocked(useSession).mockReturnValue(
      mockSession('MEMBER') as unknown as ReturnType<typeof useSession>,
    );
    render(<Sidebar isOpen />);
    const overview = screen.getByText('Overview').closest('a') as HTMLAnchorElement;
    expect(overview.getAttribute('aria-current')).toBe('page');
    expect(overview.className).toContain('#ff6224');
  });

  it('does NOT mark Overview active when pathname is /dashboard/account (exact-match enforced)', () => {
    /*
     * Scenario: the Overview item's `exact: true` flag must reject any
     * non-exact match. Without it, `pathname.startsWith('/dashboard')`
     * would mark Overview active on every dashboard sub-page. Pins the
     * truthy branch of the `item.exact ?` ternary by asserting Overview
     * is NOT active when pathname is a strict descendant.
     */
    pathnameRef.current = '/dashboard/account';
    vi.mocked(useSession).mockReturnValue(
      mockSession('MEMBER') as unknown as ReturnType<typeof useSession>,
    );
    render(<Sidebar isOpen />);
    const overview = screen.getByText('Overview').closest('a') as HTMLAnchorElement;
    expect(overview.getAttribute('aria-current')).toBeNull();
  });

  it('marks PREFIX-match nav items active when pathname starts with item.href', () => {
    /*
     * Scenario: non-exact items (Security, Sessions, etc.) use
     * `pathname.startsWith(item.href)` so deep links under
     * `/dashboard/security/foo` still highlight Security in the sidebar.
     * Pins the MethodExpression on `.startsWith` AND the falsy arm of
     * the `item.exact ?` ternary — a mutation to `.endsWith` would fail
     * because `'/dashboard/security/foo'.endsWith('/dashboard/security')`
     * is false.
     */
    pathnameRef.current = '/dashboard/security/foo';
    vi.mocked(useSession).mockReturnValue(
      mockSession('MEMBER') as unknown as ReturnType<typeof useSession>,
    );
    render(<Sidebar isOpen />);
    const security = screen.getByText('Security').closest('a') as HTMLAnchorElement;
    expect(security.getAttribute('aria-current')).toBe('page');
  });

  it('omits aria-current entirely when the item is not active', () => {
    /*
     * Scenario: SRs interpret `aria-current="page"` as "this is where
     * you are". Items that are NOT active must not surface that
     * attribute at all (the JSX uses `undefined`, which React drops).
     * Pins the falsy arm of `isActive ? 'page' : undefined` AND defends
     * against a regression that hard-coded `'page'` on every item.
     */
    pathnameRef.current = '/dashboard';
    vi.mocked(useSession).mockReturnValue(
      mockSession('MEMBER') as unknown as ReturnType<typeof useSession>,
    );
    render(<Sidebar isOpen />);
    // Account is non-active under /dashboard.
    const account = screen.getByText('Account').closest('a') as HTMLAnchorElement;
    expect(account.getAttribute('aria-current')).toBeNull();
  });

  it('renders the nav with the flex layout class when isOpen=true (mobile visible)', () => {
    /*
     * Scenario: counterpart to the existing isOpen=false test — when the
     * mobile overlay is open the nav must carry the `flex` class so
     * the layout actually renders. Pins the truthy arm of the
     * `isOpen ? 'flex' : 'hidden lg:flex'` ternary.
     */
    vi.mocked(useSession).mockReturnValue(
      mockSession('MEMBER') as unknown as ReturnType<typeof useSession>,
    );
    render(<Sidebar isOpen />);
    const nav = screen.getByRole('navigation', { name: /main navigation/i });
    expect(nav.className).toContain('flex');
    expect(nav.className).not.toContain('hidden');
  });

  it('does NOT call any handler when no onNavClick prop is provided', () => {
    /*
     * Scenario: when the sidebar is rendered without an onNavClick
     * callback the conditional spread `...(onNavClick !== undefined && {…})`
     * must NOT pass any onClick down to the Link. A mutated `true && {…}`
     * could pass an undefined onClick, which React would treat as a
     * non-callable. Pins the falsy arm — the click must not throw
     * AND no callback observable.
     */
    vi.mocked(useSession).mockReturnValue(
      mockSession('MEMBER') as unknown as ReturnType<typeof useSession>,
    );
    render(<Sidebar isOpen />);
    expect(() => fireEvent.click(screen.getByText('Overview'))).not.toThrow();
  });
});
