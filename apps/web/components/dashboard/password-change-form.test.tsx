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

// ── Verbatim toast + isPending reset + per-field error className ─────────────

describe('PasswordChangeForm surfaces verbatim copy + isPending reset + field error className', () => {
  it('toasts the verbatim "Password updated successfully." message after a successful change', async () => {
    /*
     * Scenario: the success toast is the only confirmation the user
     * receives that the change succeeded — support docs and audit
     * dashboards pattern-match on the exact string. Pinned word-for-word.
     */
    const { toast } = await import('sonner');
    vi.mocked(changePassword).mockResolvedValue(undefined);
    render(<PasswordChangeForm />);
    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[0]!, { target: { value: 'OldPass1!' } });
    fireEvent.change(inputs[1]!, { target: { value: 'NewPass1!Long' } });
    fireEvent.change(inputs[2]!, { target: { value: 'NewPass1!Long' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Password updated successfully.');
    });
  });

  it('re-enables the submit button + restores "Update password" label after a failed change', async () => {
    /*
     * Scenario: when changePassword rejects the `finally { setIsPending(false) }`
     * cleanup must run so the user can retry. Pins the finally block AND
     * the BooleanLiteral on the `false` argument — without it the button
     * would stay stuck on "Updating…" after every failure.
     */
    vi.mocked(changePassword).mockRejectedValueOnce(new Error('Wrong password'));
    render(<PasswordChangeForm />);
    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[0]!, { target: { value: 'OldPass1!' } });
    fireEvent.change(inputs[1]!, { target: { value: 'NewPass1!Long' } });
    fireEvent.change(inputs[2]!, { target: { value: 'NewPass1!Long' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByText(/updating/i)).toBeNull();
    });
    const btn = screen.getByRole<HTMLButtonElement>('button', { name: /update password/i });
    expect(btn.disabled).toBe(false);
  });

  it('resets all three password fields to empty after a successful change', async () => {
    /*
     * Scenario: after a successful change the form must clear all three
     * fields so the user does not see their previous password sitting
     * in the DOM — a shoulder-surfing risk if the screen is left
     * unattended. Pins the `reset()` call inside the success arm of
     * `onSubmit`.
     */
    vi.mocked(changePassword).mockResolvedValue(undefined);
    render(<PasswordChangeForm />);
    const inputs = document.querySelectorAll<HTMLInputElement>('input');
    fireEvent.change(inputs[0]!, { target: { value: 'OldPass1!' } });
    fireEvent.change(inputs[1]!, { target: { value: 'NewPass1!Long' } });
    fireEvent.change(inputs[2]!, { target: { value: 'NewPass1!Long' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(inputs[0]!.value).toBe('');
      expect(inputs[1]!.value).toBe('');
      expect(inputs[2]!.value).toBe('');
    });
  });

  it('adds the red error-border class to the current-password input when validation fails', async () => {
    /*
     * Scenario: a validation failure on the current-password field must
     * surface visually via the `border-red-500/60` class — the user
     * needs to see WHICH field failed. Pins both the truthy arm of the
     * `errors.currentPassword ?` ternary AND the verbatim red-border
     * StringLiteral.
     */
    render(<PasswordChangeForm />);
    // New password long, but current empty → currentPassword validation fires.
    const inputs = document.querySelectorAll<HTMLInputElement>('input');
    fireEvent.change(inputs[1]!, { target: { value: 'NewPass1!Long' } });
    fireEvent.change(inputs[2]!, { target: { value: 'NewPass1!Long' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(inputs[0]!.className).toContain('border-red');
    });
  });

  it('does NOT add the red error-border class to the current-password input while pristine', () => {
    /*
     * Scenario: counterpart to the previous test — before any submit
     * fires, no field should carry the red error-border class. Pins
     * the falsy arms of the three `errors.<field> ?` ternaries by
     * asserting the negative space on all three inputs in one render.
     */
    render(<PasswordChangeForm />);
    const inputs = document.querySelectorAll<HTMLInputElement>('input');
    expect(inputs[0]!.className).not.toContain('border-red');
    expect(inputs[1]!.className).not.toContain('border-red');
    expect(inputs[2]!.className).not.toContain('border-red');
  });

  it('adds the red error-border class to the new-password input when its validation fails', async () => {
    /*
     * Scenario: the new-password field requires min(8). Pin the truthy
     * arm of `errors.newPassword ?` independently from the
     * currentPassword arm — a regression that conflated the two error
     * sources would silently mark the wrong field as invalid.
     */
    render(<PasswordChangeForm />);
    const inputs = document.querySelectorAll<HTMLInputElement>('input');
    fireEvent.change(inputs[0]!, { target: { value: 'OldPass1!' } });
    fireEvent.change(inputs[1]!, { target: { value: 'short' } });
    fireEvent.change(inputs[2]!, { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(inputs[1]!.className).toContain('border-red');
    });
  });

  it('renders the verbatim "Required" error for the current-password field when only it is empty', async () => {
    /*
     * Scenario: only the current-password field is empty (new + confirm
     * are valid). The currentPassword error paragraph must render with
     * the verbatim "Required" message. Pins the truthy arm of
     * `{errors.currentPassword && <p>…</p>}` AND the Zod message —
     * a `{true}` or `{false}` JSX mutant on the currentPassword arm
     * would drop the paragraph entirely.
     */
    render(<PasswordChangeForm />);
    const inputs = document.querySelectorAll<HTMLInputElement>('input');
    fireEvent.change(inputs[1]!, { target: { value: 'NewPass1!Long' } });
    fireEvent.change(inputs[2]!, { target: { value: 'NewPass1!Long' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    // The "Required" message must render (defends currentPassword paragraph).
    await waitFor(() => {
      expect(screen.getByText('Required')).toBeDefined();
    });
  });

  it('renders the verbatim "Must be at least 8 characters" error for the new-password field', async () => {
    /*
     * Scenario: only the new-password field violates the min(8) rule.
     * Pins the truthy arm of `{errors.newPassword && <p>…</p>}` AND
     * the Zod min-length message — a `{true}`/`{false}` mutant on
     * the newPassword arm would drop the paragraph.
     */
    render(<PasswordChangeForm />);
    const inputs = document.querySelectorAll<HTMLInputElement>('input');
    fireEvent.change(inputs[0]!, { target: { value: 'OldPass1!' } });
    fireEvent.change(inputs[1]!, { target: { value: 'short' } });
    fireEvent.change(inputs[2]!, { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(screen.getByText('Must be at least 8 characters')).toBeDefined();
    });
  });

  it('renders ZERO red-error paragraphs while the form is pristine', () => {
    /*
     * Scenario: before any submit fires, none of the three `errors.X &&
     * <p>…</p>` conditionals should render. Pins the falsy arm of all
     * three guards in one test by counting the rendered red-error
     * paragraphs — a mutated `true && <p>…</p>` would surface three
     * (or more) empty paragraphs on first render.
     */
    render(<PasswordChangeForm />);
    const errorParagraphs = document.querySelectorAll('p.text-xs.text-red-400');
    expect(errorParagraphs).toHaveLength(0);
  });

  it('adds the red error-border class to the confirm-password input when passwords mismatch', async () => {
    /*
     * Scenario: the mismatch refine attaches its error to the
     * `confirmPassword` path. Pin the truthy arm of
     * `errors.confirmPassword ?` independently — defends the
     * path: ['confirmPassword'] choice in the refine schema.
     */
    render(<PasswordChangeForm />);
    const inputs = document.querySelectorAll<HTMLInputElement>('input');
    fireEvent.change(inputs[0]!, { target: { value: 'OldPass1!' } });
    fireEvent.change(inputs[1]!, { target: { value: 'NewPass1!Long' } });
    fireEvent.change(inputs[2]!, { target: { value: 'DifferentPass!' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(inputs[2]!.className).toContain('border-red');
    });
  });
});
