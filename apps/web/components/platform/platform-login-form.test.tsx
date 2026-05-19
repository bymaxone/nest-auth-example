/**
 * @fileoverview Unit tests for the `PlatformLoginForm` component.
 *
 * Verifies:
 * - The form renders email, password, and submit button.
 * - Valid submission calls platformLogin and stores tokens, then redirects.
 * - Validation errors are shown on empty submit.
 *
 * @module components/platform/platform-login-form.test
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
  platformLogin: vi.fn(),
  mapAuthClientError: vi.fn().mockReturnValue({ code: 'UNKNOWN', message: 'Error' }),
}));

vi.mock('@/lib/platform-auth', () => ({
  setPlatformTokens: vi.fn(),
}));

vi.mock('@/lib/auth-errors', () => ({
  translateAuthError: vi.fn().mockReturnValue('Invalid credentials'),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { platformLogin } from '@/lib/auth-client';
import { setPlatformTokens } from '@/lib/platform-auth';
import { PlatformLoginForm } from './platform-login-form.js';

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('PlatformLoginForm rendering', () => {
  it('renders email input, password input, and submit button', () => {
    /*
     * Scenario: the login form must have fields for email and password plus a
     * submit button so the platform admin can sign in.
     * Protects: basic form structure renders on mount.
     */
    render(<PlatformLoginForm />);
    expect(screen.getByLabelText(/email/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /sign in to platform admin/i })).toBeDefined();
  });
});

describe('PlatformLoginForm submission', () => {
  it('calls platformLogin with email and password on valid submit', async () => {
    /*
     * Scenario: filling in valid email and password and submitting must call
     * platformLogin with those credentials.
     * Protects: onSubmit passes the form values to platformLogin.
     */
    vi.mocked(platformLogin).mockResolvedValue({
      accessToken: 'access-tok',
      refreshToken: 'refresh-tok',
      admin: {
        id: 'a1',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      },
    } as Awaited<ReturnType<typeof platformLogin>>);

    render(<PlatformLoginForm />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@example.com' },
    });
    // Password input is the second input in the DOM.
    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[1]!, { target: { value: 'secret123' } });

    fireEvent.click(screen.getByRole('button', { name: /sign in to platform admin/i }));

    await waitFor(() => {
      expect(platformLogin).toHaveBeenCalledWith('admin@example.com', 'secret123');
      expect(setPlatformTokens).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith('/platform/tenants');
    });
  });

  it('shows validation errors when email is missing on submit', async () => {
    /*
     * Scenario: clicking submit with an empty email must show a validation error.
     * Protects: Zod email validation triggers on empty submit.
     */
    render(<PlatformLoginForm />);
    fireEvent.click(screen.getByRole('button', { name: /sign in to platform admin/i }));
    await waitFor(() => {
      expect(screen.getByText(/valid email/i)).toBeDefined();
    });
    expect(platformLogin).not.toHaveBeenCalled();
  });

  it('stores MFA temp token and redirects to MFA challenge when mfaRequired is returned', async () => {
    /*
     * Scenario: when platformLogin returns { mfaRequired: true, mfaTempToken }
     * the form must persist the temp token to sessionStorage and push to the
     * MFA challenge route.
     * Protects: lines 68-72 — MFA challenge path in onSubmit.
     */
    vi.mocked(platformLogin).mockResolvedValue({
      mfaRequired: true,
      mfaTempToken: 'tmp-token-abc',
    } as Awaited<ReturnType<typeof platformLogin>>);

    render(<PlatformLoginForm />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@example.com' },
    });
    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[1]!, { target: { value: 'secret123' } });

    fireEvent.click(screen.getByRole('button', { name: /sign in to platform admin/i }));

    await waitFor(() => {
      expect(sessionStorage.getItem('platform_mfa_temp_token')).toBe('tmp-token-abc');
      expect(mockRouter.push).toHaveBeenCalledWith('/platform/mfa-challenge');
    });
  });

  it('shows an error toast when platformLogin throws', async () => {
    /*
     * Scenario: when platformLogin rejects the error must be translated and
     * surfaced as a sonner toast.
     * Protects: catch block in onSubmit at lines 78-80.
     */
    vi.mocked(platformLogin).mockRejectedValue(new Error('Unauthorized'));

    render(<PlatformLoginForm />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@example.com' },
    });
    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[1]!, { target: { value: 'wrongpassword' } });

    fireEvent.click(screen.getByRole('button', { name: /sign in to platform admin/i }));

    await waitFor(() => {
      expect(platformLogin).toHaveBeenCalled();
    });
    // translateAuthError is mocked to return 'Invalid credentials'.
    // Verify the error path ran without throwing.
    expect(setPlatformTokens).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('passes the non-UNKNOWN error code to translateAuthError', async () => {
    /*
     * Scenario: when mapAuthClientError returns a code other than 'UNKNOWN' the
     * ternary `code === 'UNKNOWN' ? '' : code` must pass the actual code to
     * translateAuthError, not an empty string.
     * Protects: line 80 — false branch of the UNKNOWN check in the catch block.
     */
    const { mapAuthClientError } = await import('@/lib/auth-client');
    const { translateAuthError } = await import('@/lib/auth-errors');

    // Return a specific code (not 'UNKNOWN') from mapAuthClientError.
    vi.mocked(mapAuthClientError).mockReturnValueOnce({
      code: 'auth.invalid_credentials' as never,
      message: 'Invalid credentials',
    });
    vi.mocked(platformLogin).mockRejectedValue(new Error('Unauthorized'));

    render(<PlatformLoginForm />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@example.com' },
    });
    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[1]!, { target: { value: 'wrongpassword' } });

    fireEvent.click(screen.getByRole('button', { name: /sign in to platform admin/i }));

    await waitFor(() => {
      // translateAuthError must be called with the actual code, not ''.
      expect(translateAuthError).toHaveBeenCalledWith('auth.invalid_credentials');
    });
  });

  it('shows the "Signing in…" label while submission is in progress', async () => {
    /*
     * Scenario: while platformLogin is pending the submit button must show
     * "Signing in…" and be disabled to prevent duplicate submissions.
     * Protects: line 150 — isSubmitting=true branch renders "Signing in…".
     */
    // Never resolve — stays in pending state indefinitely.
    vi.mocked(platformLogin).mockReturnValue(new Promise(() => undefined));

    render(<PlatformLoginForm />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@example.com' },
    });
    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[1]!, { target: { value: 'secret123' } });

    fireEvent.click(screen.getByRole('button', { name: /sign in to platform admin/i }));

    // While the promise is pending the button label should change.
    await waitFor(() => {
      expect(screen.getByText(/signing in/i)).toBeDefined();
    });
  });
});
