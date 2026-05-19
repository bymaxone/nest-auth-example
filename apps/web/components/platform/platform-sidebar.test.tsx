/**
 * @fileoverview Unit tests for the `PlatformSidebar` component.
 *
 * Verifies that the sidebar renders the nav items (Tenants, Users) and the
 * "Platform Admin Area" label at the bottom.
 *
 * @module components/platform/platform-sidebar.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/platform/tenants',
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { PlatformSidebar } from './platform-sidebar.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PlatformSidebar rendering', () => {
  it('renders Tenants and Users nav items', () => {
    /*
     * Scenario: the platform sidebar must show links to Tenants and Users so
     * the operator can navigate between the two admin pages.
     * Protects: PLATFORM_NAV_ITEMS are rendered as links.
     */
    render(<PlatformSidebar />);
    expect(screen.getByRole('link', { name: /tenants/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /users/i })).toBeDefined();
  });

  it('renders the "Platform Admin Area" label at the bottom', () => {
    /*
     * Scenario: the bottom label must always be visible to reinforce that the
     * operator is in the platform context and not the tenant dashboard.
     * Protects: "Platform Admin Area" label renders in the sidebar footer.
     */
    render(<PlatformSidebar />);
    expect(screen.getByText(/platform admin area/i)).toBeDefined();
  });

  it('marks the current page link as active', () => {
    /*
     * Scenario: when pathname === "/platform/tenants" the Tenants link must
     * have aria-current="page".
     * Protects: active state class and aria-current applied to the matching link.
     */
    render(<PlatformSidebar />);
    const tenantsLink = screen.getByRole('link', { name: /tenants/i });
    expect(tenantsLink.getAttribute('aria-current')).toBe('page');
  });

  it('does not mark the Users link as active on tenants page', () => {
    /*
     * Scenario: when pathname is /platform/tenants the Users link must not
     * have aria-current="page".
     * Protects: isActive logic does not mark inactive links as current.
     */
    render(<PlatformSidebar />);
    const usersLink = screen.getByRole('link', { name: /users/i });
    expect(usersLink.getAttribute('aria-current')).toBeNull();
  });
});
