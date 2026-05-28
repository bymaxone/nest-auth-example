/**
 * @fileoverview Unit tests for the `PlatformSidebar` component.
 *
 * Verifies that the sidebar renders the nav items (Tenants, Users, Security),
 * applies the correct active/inactive className token per branch, and computes
 * `isActive` using the exact vs. prefix rule per item.
 *
 * @module components/platform/platform-sidebar.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  pathname: { value: '/platform/tenants' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => mocks.pathname.value,
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { PlatformSidebar } from './platform-sidebar.js';

beforeEach(() => {
  cleanup();
  mocks.pathname.value = '/platform/tenants';
  vi.clearAllMocks();
});

describe('PlatformSidebar rendering', () => {
  it('renders Tenants, Users and Security nav items as links', () => {
    /*
     * Scenario: the platform sidebar must show links to Tenants, Users and
     * Security so the operator can navigate between admin pages.
     * Protects: PLATFORM_NAV_ITEMS are rendered as links with the expected labels.
     */
    render(<PlatformSidebar />);
    expect(screen.getByRole('link', { name: /tenants/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /users/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /security/i })).toBeDefined();
  });

  it('renders the "Platform Admin Area" label at the bottom', () => {
    /*
     * Scenario: the bottom label must always be visible to reinforce that the
     * operator is in the platform context and not the tenant dashboard.
     * Protects: verbatim "Platform Admin Area" string in the sidebar footer.
     */
    render(<PlatformSidebar />);
    expect(screen.getByText('Platform Admin Area')).toBeDefined();
  });

  it('points each link at its absolute platform href', () => {
    /*
     * Scenario: nav items must use the absolute hrefs declared in
     * PLATFORM_NAV_ITEMS so deep links land on the correct admin page.
     * Protects: href values "/platform/tenants", "/platform/users",
     * "/platform/security" are passed to <Link>.
     */
    render(<PlatformSidebar />);
    expect(screen.getByRole('link', { name: /tenants/i }).getAttribute('href')).toBe(
      '/platform/tenants',
    );
    expect(screen.getByRole('link', { name: /users/i }).getAttribute('href')).toBe(
      '/platform/users',
    );
    expect(screen.getByRole('link', { name: /security/i }).getAttribute('href')).toBe(
      '/platform/security',
    );
  });
});

describe('PlatformSidebar active-state computation', () => {
  it('marks the exact-match Tenants link active on /platform/tenants', () => {
    /*
     * Scenario: pathname equals the exact-match item's href.
     * Protects: pathname === item.href kills the EqualityOperator mutant —
     * with !==, Tenants would not be active.
     */
    mocks.pathname.value = '/platform/tenants';
    render(<PlatformSidebar />);
    expect(screen.getByRole('link', { name: /tenants/i }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('link', { name: /users/i }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: /security/i }).getAttribute('aria-current')).toBeNull();
  });

  it('does NOT mark the exact-match Tenants link active on a sub-path', () => {
    /*
     * Scenario: pathname is below the exact-match item's href.
     * Protects: when item.exact === true the ConditionalExpression picks the
     * `matchesExact` branch — a `false` mutant on the ternary would always
     * use startsWith() and incorrectly activate Tenants on the sub-path.
     */
    mocks.pathname.value = '/platform/tenants/abc123';
    render(<PlatformSidebar />);
    expect(screen.getByRole('link', { name: /tenants/i }).getAttribute('aria-current')).toBeNull();
  });

  it('marks the non-exact Users link active on a sub-path via startsWith', () => {
    /*
     * Scenario: pathname is below the prefix-match item's href.
     * Protects: pathname.startsWith(item.href) kills the MethodExpression
     * mutant (deleted call → undefined → falsy → no aria-current). Also kills
     * the ConditionalExpression `true` mutant (always matchesExact would
     * leave Users inactive on a sub-path).
     */
    mocks.pathname.value = '/platform/users/abc123';
    render(<PlatformSidebar />);
    expect(screen.getByRole('link', { name: /users/i }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /tenants/i }).getAttribute('aria-current')).toBeNull();
  });

  it('marks no item active on an unrelated pathname', () => {
    /*
     * Scenario: pathname does not match any item's href.
     * Protects: none of the items become active when neither matchesExact nor
     * matchesPrefix evaluate to true.
     */
    mocks.pathname.value = '/dashboard';
    render(<PlatformSidebar />);
    expect(screen.getByRole('link', { name: /tenants/i }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: /users/i }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: /security/i }).getAttribute('aria-current')).toBeNull();
  });
});

describe('PlatformSidebar active-state styling', () => {
  it('applies the red-tone active classes to the active link and its icon', () => {
    /*
     * Scenario: the currently active link must carry the unique active-tone
     * className tokens (text-red-300 on the link, text-red-400 on the icon)
     * so the operator visually identifies the current page.
     * Protects: LINK_ACTIVE_CLASS and ICON_ACTIVE_CLASS StringLiteral mutants
     * — verbatim pins of `text-red-300`, `border-l-red-500`, `text-red-400`.
     */
    mocks.pathname.value = '/platform/tenants';
    render(<PlatformSidebar />);
    const tenantsLink = screen.getByRole('link', { name: /tenants/i });
    const tenantsClass = tenantsLink.className;
    expect(tenantsClass).toContain('text-red-300');
    expect(tenantsClass).toContain('border-l-red-500');
    expect(tenantsClass).toContain('bg-[rgba(239,68,68,0.15)]');
    expect(tenantsClass).toContain('font-semibold');
    const tenantsIcon = tenantsLink.querySelector('svg');
    expect(tenantsIcon?.getAttribute('class') ?? '').toContain('text-red-400');
  });

  it('applies the muted inactive classes to non-active links and their icons', () => {
    /*
     * Scenario: links that are NOT the current page must carry the muted
     * inactive-tone className tokens so the active link stands out.
     * Protects: LINK_INACTIVE_CLASS and ICON_INACTIVE_CLASS StringLiteral
     * mutants — verbatim pins of `text-[rgba(255,200,200,0.55)]`,
     * `border-l-transparent`, `font-normal`, and `text-[rgba(255,200,200,0.4)]`.
     */
    mocks.pathname.value = '/platform/tenants';
    render(<PlatformSidebar />);
    const usersLink = screen.getByRole('link', { name: /users/i });
    const usersClass = usersLink.className;
    expect(usersClass).toContain('text-[rgba(255,200,200,0.55)]');
    expect(usersClass).toContain('border-l-transparent');
    expect(usersClass).toContain('font-normal');
    expect(usersClass).toContain('hover:text-red-200');
    const usersIcon = usersLink.querySelector('svg');
    expect(usersIcon?.getAttribute('class') ?? '').toContain('text-[rgba(255,200,200,0.4)]');
  });
});
