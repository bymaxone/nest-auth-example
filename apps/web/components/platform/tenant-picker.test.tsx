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
     * is called with the actual code (NOT the empty string). Pinning the
     * exact arg defends both the falsy arm of the UNKNOWN ternary AND
     * defends against a `true ?` mutant that would always pass `''`.
     * Protects: line 45 — `code !== 'UNKNOWN'` branch in load() catch.
     */
    const { translateAuthError } = await import('@/lib/auth-errors');
    const { mapAuthClientError } = await import('@/lib/auth-client');
    vi.mocked(mapAuthClientError).mockReturnValue({
      code: 'auth.forbidden',
      message: 'Forbidden',
    });
    vi.mocked(listPlatformTenants).mockRejectedValue(new Error('Forbidden'));
    render(<TenantPicker />);
    await waitFor(() => {
      expect(translateAuthError).toHaveBeenCalledWith('auth.forbidden');
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

// ── Stryker-killing strengthenings ───────────────────────────────────────────

describe('TenantPicker copy + a11y + lifecycle pins', () => {
  it('shows the verbatim "Loading tenants…" placeholder text while the fetch is in flight', () => {
    /*
     * Scenario: the placeholder option text is the user's primary
     * signal that data is loading. Pinning the verbatim string defends
     * the truthy arm of `isLoading ? 'Loading tenants…' : '— Choose a
     * tenant —'`.
     */
    vi.mocked(listPlatformTenants).mockReturnValue(new Promise(() => undefined));
    render(<TenantPicker />);
    expect(screen.getByText('Loading tenants…')).toBeDefined();
  });

  it('shows the verbatim "— Choose a tenant —" placeholder after tenants resolve', async () => {
    /*
     * Scenario: counterpart to the loading test — once the fetch
     * settles, the placeholder must read "— Choose a tenant —" so the
     * user knows the dropdown is interactive. Pinning the falsy arm
     * of the placeholder ternary.
     */
    vi.mocked(listPlatformTenants).mockResolvedValue(mockTenants);
    render(<TenantPicker />);
    await waitFor(() => {
      expect(screen.getByText('— Choose a tenant —')).toBeDefined();
    });
  });

  it('forwards the EMPTY string to translateAuthError when mapAuthClientError returns UNKNOWN', async () => {
    /*
     * Scenario: the UNKNOWN sentinel must be normalised to '' before
     * being passed to translateAuthError so the user sees the generic
     * fallback copy rather than the literal "UNKNOWN" code. Pins the
     * truthy arm of `code === 'UNKNOWN' ? '' : code` AND the verbatim
     * empty-string literal — the existing test asserted toast.error
     * was called but did not pin the arg.
     */
    const { translateAuthError } = await import('@/lib/auth-errors');
    const { mapAuthClientError } = await import('@/lib/auth-client');
    vi.mocked(mapAuthClientError).mockReturnValueOnce({
      code: 'UNKNOWN' as never,
      message: 'Generic',
    });
    vi.mocked(listPlatformTenants).mockRejectedValue(new Error('boom'));

    render(<TenantPicker />);
    await waitFor(() => {
      expect(translateAuthError).toHaveBeenCalledWith('');
    });
  });

  it('re-enables the select after a failed load (finally setIsLoading(false))', async () => {
    /*
     * Scenario: when listPlatformTenants rejects the `finally {
     * setIsLoading(false) }` cleanup must run so the select is no
     * longer disabled — without it the operator would be stuck on a
     * permanently-loading dropdown with no way to retry by navigating
     * away. Pins both the finally BlockStatement AND the BooleanLiteral
     * on the `false` argument.
     */
    vi.mocked(listPlatformTenants).mockRejectedValueOnce(new Error('boom'));
    render(<TenantPicker />);

    await waitFor(() => {
      const select = screen.getByRole<HTMLSelectElement>('combobox');
      expect(select.disabled).toBe(false);
    });
  });

  it('uses the selectedTenantId prop as the select value when provided', async () => {
    /*
     * Scenario: navigating to `/platform/users?tenantId=tid-1` with
     * `selectedTenantId="tid-1"` must pre-select that tenant in the
     * dropdown via the `value` prop. Pins the truthy arm of
     * `selectedTenantId ?? ''` and the LogicalOperator on `??`. Wait
     * for tenants to load so the `<option value="tid-1">` exists.
     */
    vi.mocked(listPlatformTenants).mockResolvedValue(mockTenants);
    render(<TenantPicker selectedTenantId="tid-1" />);
    await screen.findByText('Acme Corp (acme)');
    const select = screen.getByRole<HTMLSelectElement>('combobox');
    expect(select.value).toBe('tid-1');
  });

  it('falls back to the empty string for the select value when selectedTenantId is undefined', () => {
    /*
     * Scenario: counterpart — when no `selectedTenantId` is provided,
     * the select must default to the empty placeholder option (`""`)
     * so the dropdown reads "— Choose a tenant —" rather than crashing
     * with React's controlled-component warning. Pins the falsy arm
     * of `selectedTenantId ?? ''`.
     */
    vi.mocked(listPlatformTenants).mockReturnValue(new Promise(() => undefined));
    render(<TenantPicker />);
    const select = screen.getByRole<HTMLSelectElement>('combobox');
    expect(select.value).toBe('');
  });
});
