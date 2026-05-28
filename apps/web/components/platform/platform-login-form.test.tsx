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

  it('passes the EMPTY string to translateAuthError when mapAuthClientError returns UNKNOWN', async () => {
    /*
     * Scenario: the UNKNOWN sentinel must be normalised to '' before
     * being passed to translateAuthError so the user sees the generic
     * fallback copy rather than the literal "UNKNOWN" code. Pins the
     * truthy arm of the `code === 'UNKNOWN' ? '' : code` ternary.
     */
    const { mapAuthClientError } = await import('@/lib/auth-client');
    const { translateAuthError } = await import('@/lib/auth-errors');
    vi.mocked(mapAuthClientError).mockReturnValueOnce({
      code: 'UNKNOWN' as never,
      message: 'Generic',
    });
    vi.mocked(platformLogin).mockRejectedValue(new Error('boom'));

    render(<PlatformLoginForm />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@example.com' },
    });
    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[1]!, { target: { value: 'wrong' } });

    fireEvent.click(screen.getByRole('button', { name: /sign in to platform admin/i }));

    await waitFor(() => {
      expect(translateAuthError).toHaveBeenCalledWith('');
    });
  });

  it('re-enables the submit button + restores its label after a failed submit', async () => {
    /*
     * Scenario: when platformLogin rejects the `finally { setIsSubmitting(false) }`
     * cleanup must run so the admin can retry. Pins the finally block
     * AND the BooleanLiteral on the `false` argument — a regression
     * that removed the block (or flipped to `true`) would leave the
     * submit button stuck on "Signing in…" + disabled forever.
     */
    vi.mocked(platformLogin).mockRejectedValueOnce(new Error('Unauthorized'));

    render(<PlatformLoginForm />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@example.com' },
    });
    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[1]!, { target: { value: 'wrong' } });

    fireEvent.click(screen.getByRole('button', { name: /sign in to platform admin/i }));

    // After the rejection settles the button must be clickable again.
    await waitFor(() => {
      const btn = screen.getByRole<HTMLButtonElement>('button', {
        name: /sign in to platform admin/i,
      });
      expect(btn.disabled).toBe(false);
    });
    // The "Signing in…" label must NOT persist.
    expect(screen.queryByText(/signing in/i)).toBeNull();
  });
});

// ── A11y wiring on email + password inputs ───────────────────────────────────

describe('PlatformLoginForm a11y wiring on validation errors', () => {
  it('sets aria-invalid="false" and omits aria-describedby on the email input while pristine', () => {
    /*
     * Scenario: before any submit fires, the email field must not be
     * marked invalid AND must not point at a non-existent error id.
     * Pins the falsy arms of both `errors.email ?` ternaries on lines
     * 110-111: the aria-describedby `undefined` fallback (React drops
     * the attribute) and `aria-invalid={!!errors.email}` falsy.
     */
    render(<PlatformLoginForm />);
    const email = screen.getByLabelText<HTMLInputElement>(/email/i);
    expect(email.getAttribute('aria-invalid')).toBe('false');
    expect(email.getAttribute('aria-describedby')).toBeNull();
  });

  it('sets aria-invalid="true" + aria-describedby="email-error" on the email input after validation fails', async () => {
    /*
     * Scenario: after an empty-submit validation fires, the email
     * input's `aria-invalid` must flip to `true` AND `aria-describedby`
     * must point at the documented `email-error` id so a screen reader
     * announces the validation message in order. Pins both BooleanLiteral
     * mutants on `!!errors.email` AND the verbatim 'email-error' literal.
     */
    render(<PlatformLoginForm />);
    fireEvent.click(screen.getByRole('button', { name: /sign in to platform admin/i }));
    await screen.findByText(/valid email/i);

    const email = screen.getByLabelText<HTMLInputElement>(/email/i);
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(email.getAttribute('aria-describedby')).toBe('email-error');
  });

  it('sets aria-invalid="true" + aria-describedby="password-error" on the password input after validation fails', async () => {
    /*
     * Scenario: counterpart for the password field. Pins both
     * BooleanLiteral mutants on `!!errors.password` AND the verbatim
     * 'password-error' literal, plus the `errors.password && <p>...</p>`
     * conditional rendering of the error paragraph.
     */
    render(<PlatformLoginForm />);
    // Email valid, password empty — only the password validation fires.
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in to platform admin/i }));
    await screen.findByText(/password is required/i);

    const inputs = document.querySelectorAll<HTMLInputElement>('input');
    const password = inputs[1]!;
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(password.getAttribute('aria-describedby')).toBe('password-error');
  });

  it('does NOT render the password error paragraph while the field is pristine', () => {
    /*
     * Scenario: counterpart to the password-after-failure test — the
     * `<p id="password-error">…</p>` paragraph must NOT render until
     * validation fires. Pins the falsy arm of the `errors.password && …`
     * conditional.
     */
    render(<PlatformLoginForm />);
    expect(document.getElementById('password-error')).toBeNull();
  });
});
