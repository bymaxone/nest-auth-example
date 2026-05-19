/**
 * @fileoverview Unit tests for the `MfaDisableCard` component.
 *
 * Verifies:
 * - The initial state renders the "Disable two-factor authentication" button.
 * - Clicking the disable button shows the TOTP form.
 * - Clicking Cancel from the form hides it.
 * - Submitting a valid 6-digit code calls mfaDisable and onDisabled.
 *
 * @module components/dashboard/mfa-disable-card.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth-client', () => ({
  mfaDisable: vi.fn(),
  handleAuthClientError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { mfaDisable, handleAuthClientError } from '@/lib/auth-client';
import { MfaDisableCard } from './mfa-disable-card.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MfaDisableCard initial state', () => {
  it('renders the disable button and "Enabled" badge in the initial state', () => {
    /*
     * Scenario: when the component first renders it must show the "Enabled"
     * status badge and the disable button so the user can see MFA is active.
     * Protects: showForm=false initial state renders the idle UI.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    expect(screen.getByRole('button', { name: /disable two-factor/i })).toBeDefined();
    expect(screen.getByText('Enabled')).toBeDefined();
  });

  it('shows the TOTP form after clicking the disable button', () => {
    /*
     * Scenario: clicking "Disable two-factor authentication" must reveal
     * the confirmation form with the OTP input.
     * Protects: setShowForm(true) on button click transitions to the form.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));
    expect(screen.getByText(/authenticator code/i)).toBeDefined();
  });

  it('hides the form and returns to idle when Cancel is clicked', () => {
    /*
     * Scenario: clicking Cancel in the form must hide the TOTP input and return
     * to the idle state.
     * Protects: Cancel button sets showForm=false and resets the form.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByRole('button', { name: /disable two-factor/i })).toBeDefined();
    expect(screen.queryByText(/authenticator code/i)).toBeNull();
  });
});

describe('MfaDisableCard form submission', () => {
  it('calls mfaDisable with the code and invokes onDisabled on success', async () => {
    /*
     * Scenario: entering a valid 6-digit code and clicking "Confirm disable"
     * must call mfaDisable with the code and then invoke onDisabled.
     * Protects: onSubmit calls mfaDisable and the parent onDisabled callback.
     */
    vi.mocked(mfaDisable).mockResolvedValue(undefined);
    const onDisabled = vi.fn();
    render(<MfaDisableCard onDisabled={onDisabled} />);

    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));

    // Type a digit into each OTP input box.
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });

    fireEvent.click(screen.getByRole('button', { name: /confirm disable/i }));

    await waitFor(() => {
      expect(mfaDisable).toHaveBeenCalledOnce();
      expect(onDisabled).toHaveBeenCalledOnce();
    });
  });

  it('shows "Disabling…" text while mfaDisable is pending', async () => {
    /*
     * Scenario: while mfaDisable is in-flight the submit button must display
     * "Disabling…" so the user knows the request is processing.
     * Protects: line 115 — `isPending ? 'Disabling…' : 'Confirm disable'` truthy branch.
     */
    vi.mocked(mfaDisable).mockReturnValue(new Promise(() => undefined));
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));

    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });

    fireEvent.click(screen.getByRole('button', { name: /confirm disable/i }));

    await waitFor(() => {
      expect(screen.getByText('Disabling…')).toBeDefined();
    });
  });

  it('shows a validation error when submitting with an incomplete code', async () => {
    /*
     * Scenario: submitting the form without a valid 6-digit code must trigger
     * the Zod validation error for the code field.
     * Protects: line 110 — `errors.code &&` conditional renders the error message.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));
    // Submit without filling any OTP digits so the code field fails validation.
    fireEvent.click(screen.getByRole('button', { name: /confirm disable/i }));
    await waitFor(() => {
      // The error paragraph must appear (any non-empty validation error text).
      const errorParagraphs = document.querySelectorAll('p.text-xs.text-red-400');
      expect(errorParagraphs.length).toBeGreaterThan(0);
    });
  });

  it('calls handleAuthClientError when mfaDisable rejects', async () => {
    /*
     * Scenario: when mfaDisable throws the error must be forwarded to
     * handleAuthClientError so an error toast is displayed.
     * Protects: line 63 — catch block in onSubmit calls handleAuthClientError.
     */
    const err = new Error('Invalid TOTP');
    vi.mocked(mfaDisable).mockRejectedValue(err);
    render(<MfaDisableCard onDisabled={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));

    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });

    fireEvent.click(screen.getByRole('button', { name: /confirm disable/i }));

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
  });
});
