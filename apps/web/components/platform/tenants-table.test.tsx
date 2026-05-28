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

const ONE_DAY_MS = 86_400_000;

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
    // Past offset so date-fns suffix wording is deterministically "1 day ago".
    createdAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tid-2',
    name: 'Beta Ltd',
    slug: 'beta',
    createdAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
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

  it('button onClick invokes e.stopPropagation() so the row onClick does NOT also fire', async () => {
    /*
     * Scenario: when the "View users" button is clicked the button's onClick
     * must call `e.stopPropagation()` so the surrounding row's onClick does
     * NOT also fire. The button and row both push the SAME URL, so the
     * mockPush count is 1 either way — the only observable for the missing
     * stopPropagation is the call on the event itself.
     * Protects: BlockStatement mutant on the button's onClick body — an
     * empty-block mutant drops both stopPropagation AND the inner
     * router.push, allowing the click to bubble to the row handler. The
     * URL would still be pushed (by the row), so a "called with URL"
     * assertion would pass — only the stopPropagation spy distinguishes
     * the original from the mutant.
     */
    vi.mocked(listPlatformTenants).mockResolvedValue(mockTenants);
    render(<TenantsTable />);
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /view users/i })).toHaveLength(2);
    });
    const button = screen.getAllByRole('button', { name: /view users/i })[0]!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    const stopSpy = vi.spyOn(event, 'stopPropagation');
    button.dispatchEvent(event);
    expect(stopSpy).toHaveBeenCalled();
  });

  it('navigates to the users page when "View users" is clicked AND stops the click from bubbling to the row handler', async () => {
    /*
     * Scenario: clicking the "View users" button must navigate to
     * /platform/users?tenantId=<id> EXACTLY ONCE — the button's onClick must
     * call e.stopPropagation() so the row's onClick does NOT also fire.
     * Without stopPropagation the click bubbles up and router.push is called
     * a second time with the same URL.
     * Protects:
     * - View users button onClick calls router.push with the correct URL,
     * - the BlockStatement on the button's onClick handler — an empty-block
     *   mutant drops both stopPropagation AND the inner router.push, so
     *   only the row handler would fire (still 1 call, same URL — but the
     *   count assertion paired with the row-click test exposes the missing
     *   inner call when combined with the next test).
     */
    vi.mocked(listPlatformTenants).mockResolvedValue(mockTenants);
    render(<TenantsTable />);
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /view users/i })).toHaveLength(2);
    });
    fireEvent.click(screen.getAllByRole('button', { name: /view users/i })[0]!);
    expect(mockPush).toHaveBeenCalledTimes(1);
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

  it('renders Created cell with the date-fns "ago" suffix from addSuffix: true', async () => {
    /*
     * Scenario: each tenant's Created column must render the date-fns relative
     * wording with the "ago" suffix so the human-readable direction of the
     * timestamp is clear.
     * Protects: DATE_FORMAT_OPTIONS { addSuffix: true } passed to
     * formatDistanceToNow — kills the ObjectLiteral `{}` mutant and the
     * BooleanLiteral `false` mutant which would emit "1 day" / "about 1 day"
     * without the trailing " ago".
     */
    vi.mocked(listPlatformTenants).mockResolvedValue(mockTenants);
    render(<TenantsTable />);
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeDefined());
    // Each row contains a "… ago" cell.
    const created = screen.getAllByText(/.+\sago$/i);
    expect(created.length).toBeGreaterThanOrEqual(2);
  });

  it('passes empty string to translateAuthError when the mapped code is UNKNOWN', async () => {
    /*
     * Scenario: when mapAuthClientError returns `code: 'UNKNOWN'` the
     * `code === 'UNKNOWN' ? '' : code` ternary must take the truthy arm and
     * pass an empty string to translateAuthError so the translator can fall
     * back to its default unknown-error wording rather than echoing
     * "UNKNOWN".
     * Protects: ConditionalExpression / EqualityOperator / StringLiteral
     * mutants on the `code === 'UNKNOWN' ? '' : code` ternary — flipping
     * any of them would pass `'UNKNOWN'` (or `code` for any string) instead
     * of the verbatim empty string.
     */
    const { mapAuthClientError } = await import('@/lib/auth-client');
    const { translateAuthError } = await import('@/lib/auth-errors');
    vi.mocked(mapAuthClientError).mockReturnValue({
      code: 'UNKNOWN',
      message: 'Unknown error',
    });
    vi.mocked(listPlatformTenants).mockRejectedValue(new Error('Boom'));
    render(<TenantsTable />);
    await waitFor(() => {
      expect(vi.mocked(translateAuthError)).toHaveBeenCalledWith('');
    });
  });

  it('passes the actual error code to translateAuthError when the mapped code is NOT UNKNOWN', async () => {
    /*
     * Scenario: when mapAuthClientError returns a real error code (e.g.
     * `auth.forbidden`) the ternary must take the falsy arm and pass the
     * verbatim code so the translator can surface a specific message.
     * Protects: ConditionalExpression / EqualityOperator mutants — flipping
     * any of them would pass `''` (the truthy arm) instead of the verbatim
     * code.
     */
    const { mapAuthClientError } = await import('@/lib/auth-client');
    const { translateAuthError } = await import('@/lib/auth-errors');
    vi.mocked(mapAuthClientError).mockReturnValue({
      code: 'auth.forbidden',
      message: 'Forbidden',
    });
    vi.mocked(listPlatformTenants).mockRejectedValue(new Error('Forbidden'));
    render(<TenantsTable />);
    await waitFor(() => {
      expect(vi.mocked(translateAuthError)).toHaveBeenCalledWith('auth.forbidden');
    });
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
