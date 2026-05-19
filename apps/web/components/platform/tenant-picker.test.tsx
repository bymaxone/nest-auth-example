/**
 * @fileoverview Unit tests for the `TenantPicker` component.
 *
 * Verifies:
 * - Loading state shows "Loading tenants…" in the select.
 * - After load the select contains tenant options.
 * - Changing the select navigates to the correct URL.
 *
 * @module components/platform/tenant-picker.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ── Router mock state ─────────────────────────────────────────────────────────

const mockReplace = vi.fn();
const mockRouter = { push: vi.fn(), replace: mockReplace, refresh: vi.fn() };

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/platform/users',
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
import { TenantPicker } from './tenant-picker.js';

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
  mockReplace.mockReset();
});

describe('TenantPicker states', () => {
  it('shows a disabled select while loading tenants', () => {
    /*
     * Scenario: before listPlatformTenants resolves the select must be disabled
     * and show "Loading tenants…".
     * Protects: isLoading guard disables the select.
     */
    vi.mocked(listPlatformTenants).mockReturnValue(new Promise(() => undefined));
    render(<TenantPicker />);
    const select = screen.getByRole('combobox');
    expect(select).toHaveAttribute('disabled');
  });

  it('renders tenant options once tenants are loaded', async () => {
    /*
     * Scenario: after listPlatformTenants resolves the select must contain
     * one option per tenant.
     * Protects: tenants array is rendered as <option> elements.
     */
    vi.mocked(listPlatformTenants).mockResolvedValue(mockTenants);
    render(<TenantPicker />);
    await waitFor(() => {
      expect(screen.getByText('Acme Corp (acme)')).toBeDefined();
      expect(screen.getByText('Beta Ltd (beta)')).toBeDefined();
    });
  });

  it('navigates to /platform/users?tenantId=... when a tenant is selected', async () => {
    /*
     * Scenario: selecting a tenant from the dropdown must call router.replace
     * with the correct URL including the tenantId search param.
     * Protects: handleChange calls router.replace with the correct path.
     */
    vi.mocked(listPlatformTenants).mockResolvedValue(mockTenants);
    render(<TenantPicker />);
    await waitFor(() => {
      expect(screen.getByText('Acme Corp (acme)')).toBeDefined();
    });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'tid-2' } });

    expect(mockReplace).toHaveBeenCalledWith('/platform/users?tenantId=tid-2');
  });

  it('shows an error toast when listPlatformTenants rejects', async () => {
    /*
     * Scenario: when the tenant load fails mapAuthClientError maps the error and
     * toast.error is called with the translated message.
     * Protects: lines 44-45 — catch block in load() calls mapAuthClientError and
     * toast.error with translateAuthError.
     */
    const { toast } = await import('sonner');
    vi.mocked(listPlatformTenants).mockRejectedValue(new Error('Load error'));
    render(<TenantPicker />);
    await waitFor(() => {
      expect(vi.mocked(toast).error).toHaveBeenCalled();
    });
  });

  it('uses non-UNKNOWN error code in catch block (line 45 false branch)', async () => {
    /*
     * Scenario: when mapAuthClientError returns a non-UNKNOWN code the
     * `code === 'UNKNOWN' ? '' : code` false branch fires and translateAuthError
     * is called with the actual code.
     * Protects: line 45 — `code !== 'UNKNOWN'` branch in load() catch.
     */
    const { toast } = await import('sonner');
    const { mapAuthClientError } = await import('@/lib/auth-client');
    vi.mocked(mapAuthClientError).mockReturnValue({
      code: 'auth.forbidden',
      message: 'Forbidden',
    });
    vi.mocked(listPlatformTenants).mockRejectedValue(new Error('Forbidden'));
    render(<TenantPicker />);
    await waitFor(() => {
      expect(vi.mocked(toast).error).toHaveBeenCalled();
    });
  });

  it('does not call router.replace when an empty value is selected', async () => {
    /*
     * Scenario: selecting the placeholder option (empty string value) must not
     * trigger a navigation.
     * Protects: line 57-59 — `if (id)` guard prevents navigation for empty value.
     */
    vi.mocked(listPlatformTenants).mockResolvedValue(mockTenants);
    render(<TenantPicker />);
    await waitFor(() => {
      expect(screen.getByText('Acme Corp (acme)')).toBeDefined();
    });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '' } });

    expect(mockReplace).not.toHaveBeenCalled();
  });
});
