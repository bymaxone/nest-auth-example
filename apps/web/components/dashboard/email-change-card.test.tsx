/**
 * @fileoverview Unit tests for the `EmailChangeCard` component.
 *
 * Verifies:
 * - Card renders the heading, both fields, and the submit button.
 * - Submitting valid data calls requestEmailChange with the DTO field names.
 * - Invalid email / empty password show validation errors and block the call.
 * - The pending label, success toast, form reset, and error forwarding.
 *
 * @module components/dashboard/email-change-card.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth-client', () => ({
  requestEmailChange: vi.fn(),
  handleAuthClientError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { requestEmailChange, handleAuthClientError } from '@/lib/auth-client';
import { EmailChangeCard } from './email-change-card.js';

beforeEach(() => {
  vi.clearAllMocks();
});

/** Fills both fields and clicks submit. Index 0 = email, index 1 = password. */
function submitWith(newEmail: string, currentPassword: string): void {
  const inputs = document.querySelectorAll('input');
  fireEvent.change(inputs[0]!, { target: { value: newEmail } });
  fireEvent.change(inputs[1]!, { target: { value: currentPassword } });
  fireEvent.click(screen.getByRole('button', { name: /send confirmation link/i }));
}

describe('EmailChangeCard rendering', () => {
  it('renders the heading, both field labels, and the submit button', () => {
    /*
     * Scenario: the card must expose the email-address heading, the
     * new-email and current-password fields, and the submit button.
     * Protects: card structure is correct on initial render.
     */
    render(<EmailChangeCard />);
    expect(screen.getByText('Email Address')).toBeDefined();
    expect(screen.getByText('New email address')).toBeDefined();
    expect(screen.getByText('Current password')).toBeDefined();
    expect(screen.getByRole('button', { name: /send confirmation link/i })).toBeDefined();
  });

  it('renders ZERO red-error paragraphs while the form is pristine', () => {
    /*
     * Scenario: before any submit fires, neither `errors.X && <p>…</p>`
     * conditional should render. Pins the falsy arm of both guards by
     * counting rendered red-error paragraphs on first render.
     */
    render(<EmailChangeCard />);
    const errorParagraphs = document.querySelectorAll('p.text-xs.text-red-400');
    expect(errorParagraphs).toHaveLength(0);
  });
});

describe('EmailChangeCard submission', () => {
  it('calls requestEmailChange with newEmail and currentPassword on valid submit', async () => {
    /*
     * Scenario: filling both fields and clicking submit must call
     * requestEmailChange with the library's ChangeEmailDto field names.
     * Protects: successful submit passes the correct payload.
     */
    vi.mocked(requestEmailChange).mockResolvedValue(undefined);
    render(<EmailChangeCard />);

    submitWith('new@example.com', 'CurrentPass1!');

    await waitFor(() => {
      expect(requestEmailChange).toHaveBeenCalledWith({
        newEmail: 'new@example.com',
        currentPassword: 'CurrentPass1!',
      });
    });
  });

  it('shows a validation error and blocks the call for an invalid email', async () => {
    /*
     * Scenario: submitting a malformed address must surface the Zod email
     * message and never reach the API.
     * Protects: `z.email()` validation on the newEmail field.
     */
    render(<EmailChangeCard />);

    submitWith('not-an-email', 'CurrentPass1!');

    await waitFor(() => {
      expect(screen.getByText('Enter a valid email address.')).toBeDefined();
    });
    expect(requestEmailChange).not.toHaveBeenCalled();
  });

  it('shows the verbatim "Required" error when the password is empty', async () => {
    /*
     * Scenario: a valid email but empty password must fail the
     * `min(1, 'Required')` rule — the password re-proof is the security
     * gate of this flow, so it can never be optional client-side.
     * Protects: currentPassword validation and its error paragraph.
     */
    render(<EmailChangeCard />);

    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[0]!, { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send confirmation link/i }));

    await waitFor(() => {
      expect(screen.getByText('Required')).toBeDefined();
    });
    expect(requestEmailChange).not.toHaveBeenCalled();
  });

  it('shows "Sending…" on the submit button while the request is pending', async () => {
    /*
     * Scenario: while requestEmailChange is in flight the button must show
     * the pending label so the user knows the request is processing.
     * Protects: the `isPending ? 'Sending…' : …` truthy branch.
     */
    vi.mocked(requestEmailChange).mockReturnValue(new Promise(() => undefined));
    render(<EmailChangeCard />);

    submitWith('new@example.com', 'CurrentPass1!');

    await waitFor(() => {
      expect(screen.getByText('Sending…')).toBeDefined();
    });
  });

  it('toasts the verbatim confirmation-link message after a successful request', async () => {
    /*
     * Scenario: the success toast is the only cue telling the user the next
     * step happens in the NEW address's inbox — nothing changed on the
     * account yet, so the copy must not claim the address moved. Pinned
     * word-for-word.
     */
    const { toast } = await import('sonner');
    vi.mocked(requestEmailChange).mockResolvedValue(undefined);
    render(<EmailChangeCard />);

    submitWith('new@example.com', 'CurrentPass1!');

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Check the new address for a confirmation link.');
    });
  });

  it('resets both fields to empty after a successful request', async () => {
    /*
     * Scenario: after a successful request the form must clear so the
     * password does not linger in the DOM — same shoulder-surfing rationale
     * as the password-change form. Pins the `reset()` call in the success arm.
     */
    vi.mocked(requestEmailChange).mockResolvedValue(undefined);
    render(<EmailChangeCard />);

    const inputs = document.querySelectorAll<HTMLInputElement>('input');
    submitWith('new@example.com', 'CurrentPass1!');

    await waitFor(() => {
      expect(requestEmailChange).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(inputs[0]!.value).toBe('');
      expect(inputs[1]!.value).toBe('');
    });
  });

  it('forwards rejections to handleAuthClientError and re-enables the button', async () => {
    /*
     * Scenario: when requestEmailChange rejects (wrong password, taken
     * address) the error must reach handleAuthClientError for the toast,
     * and the `finally { setIsPending(false) }` cleanup must restore the
     * idle label so the user can retry.
     */
    const err = new Error('Wrong password');
    vi.mocked(requestEmailChange).mockRejectedValue(err);
    render(<EmailChangeCard />);

    submitWith('new@example.com', 'WrongPass1!');

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByText('Sending…')).toBeNull();
    });
    const btn = screen.getByRole<HTMLButtonElement>('button', {
      name: /send confirmation link/i,
    });
    expect(btn.disabled).toBe(false);
  });

  it('adds the red error-border class to the email input when its validation fails', async () => {
    /*
     * Scenario: a failed email validation must mark the email input with
     * the red border class so the user sees WHICH field failed. Pins the
     * truthy arm of the `errors.newEmail &&` className composition.
     */
    render(<EmailChangeCard />);
    const inputs = document.querySelectorAll<HTMLInputElement>('input');

    submitWith('not-an-email', 'CurrentPass1!');

    await waitFor(() => {
      expect(inputs[0]!.className).toContain('border-red');
    });
    expect(inputs[1]!.className).not.toContain('border-red');
  });
});
