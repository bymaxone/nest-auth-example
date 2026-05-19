/**
 * @fileoverview Unit tests for the `PasswordChangeForm` component.
 *
 * Verifies:
 * - Form renders all three password fields and submit button.
 * - Submitting valid data calls changePassword.
 * - Submitting mismatched passwords shows a validation error.
 * - Submitting empty fields shows validation errors.
 *
 * @module components/dashboard/password-change-form.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth-client', () => ({
  changePassword: vi.fn(),
  handleAuthClientError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { changePassword, handleAuthClientError } from '@/lib/auth-client';
import { PasswordChangeForm } from './password-change-form.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PasswordChangeForm rendering', () => {
  it('renders all three password field labels and the submit button', () => {
    /*
     * Scenario: the form must have labels for current, new, and confirm
     * password fields plus the submit button.
     * Protects: form structure is correct on initial render.
     */
    render(<PasswordChangeForm />);
    // Use exact label queries to avoid "multiple matches" for "new password".
    expect(screen.getByText('Current password')).toBeDefined();
    expect(screen.getByText('New password')).toBeDefined();
    expect(screen.getByText('Confirm new password')).toBeDefined();
    expect(screen.getByRole('button', { name: /update password/i })).toBeDefined();
  });
});

describe('PasswordChangeForm submission', () => {
  it('calls changePassword with correct fields on valid submit', async () => {
    /*
     * Scenario: filling all three fields with a valid, matching password and
     * clicking submit must call changePassword with currentPassword and newPassword.
     * Protects: successful submit passes correct payload to changePassword.
     */
    vi.mocked(changePassword).mockResolvedValue(undefined);
    render(<PasswordChangeForm />);

    // Fill current password (index 0), new password (index 1), confirm (index 2).
    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[0]!, { target: { value: 'OldPass1!' } });
    fireEvent.change(inputs[1]!, { target: { value: 'NewPass1!Long' } });
    fireEvent.change(inputs[2]!, { target: { value: 'NewPass1!Long' } });

    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: 'OldPass1!',
        newPassword: 'NewPass1!Long',
      });
    });
  });

  it('shows validation error when passwords do not match', async () => {
    /*
     * Scenario: submitting with mismatched new and confirm passwords must
     * show a "Passwords do not match" error.
     * Protects: Zod .refine() validation triggers on mismatched passwords.
     */
    render(<PasswordChangeForm />);

    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[0]!, { target: { value: 'OldPass1!' } });
    fireEvent.change(inputs[1]!, { target: { value: 'NewPass1!Long' } });
    fireEvent.change(inputs[2]!, { target: { value: 'DifferentPass!' } });

    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeDefined();
    });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('shows validation errors when all fields are empty on submit', async () => {
    /*
     * Scenario: clicking submit with no input must show at least one validation
     * error paragraph (for currentPassword min(1) or newPassword min(8)).
     * Protects: Zod validation fires on empty submit.
     */
    render(<PasswordChangeForm />);
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));
    // Multiple validation messages may appear — just check at least one error paragraph.
    await waitFor(() => {
      const errorParagraphs = document.querySelectorAll('p.text-xs.text-red-400');
      expect(errorParagraphs.length).toBeGreaterThan(0);
    });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('shows "Updating…" text on the submit button while the request is pending', async () => {
    /*
     * Scenario: while changePassword is in-flight the submit button must display
     * "Updating…" so the user knows the request is processing.
     * Protects: line 129 — `isPending ? 'Updating…' : 'Update password'` truthy branch.
     */
    vi.mocked(changePassword).mockReturnValue(new Promise(() => undefined));
    render(<PasswordChangeForm />);

    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[0]!, { target: { value: 'OldPass1!' } });
    fireEvent.change(inputs[1]!, { target: { value: 'NewPass1!Long' } });
    fireEvent.change(inputs[2]!, { target: { value: 'NewPass1!Long' } });

    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(screen.getByText('Updating…')).toBeDefined();
    });
  });

  it('calls handleAuthClientError when changePassword rejects', async () => {
    /*
     * Scenario: when changePassword throws the error must be forwarded to
     * handleAuthClientError so an error toast is shown.
     * Protects: line 68 — catch block in onSubmit calls handleAuthClientError.
     */
    const err = new Error('Wrong password');
    vi.mocked(changePassword).mockRejectedValue(err);
    render(<PasswordChangeForm />);

    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[0]!, { target: { value: 'OldPass1!' } });
    fireEvent.change(inputs[1]!, { target: { value: 'NewPass1!Long' } });
    fireEvent.change(inputs[2]!, { target: { value: 'NewPass1!Long' } });

    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
  });
});
