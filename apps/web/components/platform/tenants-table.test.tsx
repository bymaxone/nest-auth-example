/**
 * @fileoverview Unit tests for the `TenantsTable` component.
 *
 * Verifies loading, empty, and populated states, and that the "View users"
 * button navigates to the correct URL.
 *
 * @module components/platform/tenants-table.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ── Router mock state ─────────────────────────────────────────────────────────

const mockPush = vi.fn();
const mockRouter = { push: mockPush, replace: vi.fn(), refresh: vi.fn() };

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/platform/tenants',
}));

vi.mock('@/lib/auth-client', () => ({
  listPlatformTenants: vi.fn(),
  mapAuthClientError: vi.fn().mockReturnValue({ code: 'UNKNOWN', message: 'Error' }),
}));

vi.mock('@/lib/auth-errors', () => ({
  translateAuthError: vi.fn().mockReturnValue('Error'),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { listPlatformTenants } from '@/lib/auth-client';
import type { PlatformTenantInfo } from '@/lib/auth-client';
import { TenantsTable } from './tenants-table.js';

const mockTenants: PlatformTenantInfo[] = [
  {
    id: 'tid-1',
    name: 'Acme Corp',
    slug: 'acme',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tid-2',
    name: 'Beta Ltd',
    slug: 'beta',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPush.mockReset();
});

describe('TenantsTable states', () => {
  it('shows loading text while fetching tenants', () => {
    /*
     * Scenario: before listPlatformTenants resolves the loading paragraph must
     * be visible.
     * Protects: isLoading guard renders loading state.
     */
    vi.mocked(listPlatformTenants).mockReturnValue(new Promise(() => undefined));
    render(<TenantsTable />);
    expect(screen.getByText(/loading tenants/i)).toBeDefined();
  });

  it('shows empty state when no tenants are returned', async () => {
    /*
     * Scenario: when listPlatformTenants resolves with [] the empty state with
     * "No tenants found" must be displayed.
     * Protects: empty array condition renders the empty-state message.
     */
    vi.mocked(listPlatformTenants).mockResolvedValue([]);
    render(<TenantsTable />);
    await waitFor(() => {
      expect(screen.getByText(/no tenants found/i)).toBeDefined();
    });
  });

  it('renders tenant names and slugs when tenants are returned', async () => {
    /*
     * Scenario: each tenant must appear in a table row with its name and slug.
     * Protects: tenant data is rendered inside TableRow cells.
     */
    vi.mocked(listPlatformTenants).mockResolvedValue(mockTenants);
    render(<TenantsTable />);
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeDefined();
      expect(screen.getByText('acme')).toBeDefined();
    });
  });

  it('navigates to the users page when "View users" is clicked', async () => {
    /*
     * Scenario: clicking the "View users" button for a tenant must navigate to
     * /platform/users?tenantId=<id>.
     * Protects: View users button onClick calls router.push with the correct URL.
     */
    vi.mocked(listPlatformTenants).mockResolvedValue(mockTenants);
    render(<TenantsTable />);
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /view users/i })).toHaveLength(2);
    });
    fireEvent.click(screen.getAllByRole('button', { name: /view users/i })[0]!);
    expect(mockPush).toHaveBeenCalledWith('/platform/users?tenantId=tid-1');
  });

  it('navigates to the users page when a table row is clicked', async () => {
    /*
     * Scenario: clicking the table row itself (not the button) must also
     * navigate to /platform/users?tenantId=<id>.
     * Protects: line 97 — TableRow onClick calls router.push with the tenant ID.
     */
    vi.mocked(listPlatformTenants).mockResolvedValue(mockTenants);
    render(<TenantsTable />);
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeDefined();
    });
    // Click on the tenant name cell (inside the row).
    fireEvent.click(screen.getByText('Acme Corp'));
    expect(mockPush).toHaveBeenCalledWith('/platform/users?tenantId=tid-1');
  });

  it('shows an error toast when listPlatformTenants rejects', async () => {
    /*
     * Scenario: when the tenant load fails mapAuthClientError maps the error and
     * toast.error is called with the translated message.
     * Protects: lines 53-54 — catch block in load() calls mapAuthClientError
     * and toast.error with translateAuthError.
     */
    const { toast } = await import('sonner');
    vi.mocked(listPlatformTenants).mockRejectedValue(new Error('Load error'));
    render(<TenantsTable />);
    await waitFor(() => {
      expect(vi.mocked(toast).error).toHaveBeenCalled();
    });
  });

  it('uses non-UNKNOWN error code in catch block (line 54 false branch)', async () => {
    /*
     * Scenario: when mapAuthClientError returns a non-UNKNOWN code the
     * `code === 'UNKNOWN' ? '' : code` false branch fires and translateAuthError
     * is called with the actual code.
     * Protects: line 54 — `code !== 'UNKNOWN'` branch in load() catch.
     */
    const { toast } = await import('sonner');
    const { mapAuthClientError } = await import('@/lib/auth-client');
    vi.mocked(mapAuthClientError).mockReturnValue({
      code: 'auth.forbidden',
      message: 'Forbidden',
    });
    vi.mocked(listPlatformTenants).mockRejectedValue(new Error('Forbidden'));
    render(<TenantsTable />);
    await waitFor(() => {
      expect(vi.mocked(toast).error).toHaveBeenCalled();
    });
  });
});
