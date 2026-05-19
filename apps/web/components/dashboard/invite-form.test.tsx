/**
 * @fileoverview Unit tests for the `InviteForm` component.
 *
 * Verifies:
 * - The form renders with email input, role select, and submit button.
 * - Submitting valid data calls createInvitation and invokes onSuccess.
 * - Validation error is shown when email is empty on submit.
 *
 * @module components/dashboard/invite-form.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth-client', () => ({
  createInvitation: vi.fn(),
  handleAuthClientError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { createInvitation, handleAuthClientError } from '@/lib/auth-client';
import { InviteForm } from './invite-form.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InviteForm rendering', () => {
  it('renders email input, role select, and send button', () => {
    /*
     * Scenario: the form must show an email field, role dropdown, and a submit
     * button so the admin can fill in the invitation details.
     * Protects: basic form structure is rendered on mount.
     */
    render(<InviteForm onSuccess={vi.fn()} />);
    expect(screen.getByPlaceholderText(/colleague@example.com/i)).toBeDefined();
    expect(screen.getByRole('combobox')).toBeDefined();
    expect(screen.getByRole('button', { name: /send invite/i })).toBeDefined();
  });
});

describe('InviteForm submission', () => {
  it('calls createInvitation and onSuccess on valid submit', async () => {
    /*
     * Scenario: filling in a valid email and clicking "Send invite" must call
     * createInvitation with the email and role, then invoke onSuccess.
     * Protects: successful invitation flow triggers API call and callback.
     */
    vi.mocked(createInvitation).mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    render(<InviteForm onSuccess={onSuccess} />);

    fireEvent.change(screen.getByPlaceholderText(/colleague@example.com/i), {
      target: { value: 'charlie@example.com' },
    });

    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => {
      expect(createInvitation).toHaveBeenCalledWith('charlie@example.com', expect.any(String));
      expect(onSuccess).toHaveBeenCalledOnce();
    });
  });

  it('shows a validation error when email is empty on submit', async () => {
    /*
     * Scenario: clicking submit without entering an email must show a Zod
     * validation error message below the email field.
     * Protects: Zod email validation triggers the error message on submit.
     */
    render(<InviteForm onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));
    await waitFor(() => {
      expect(screen.getByText(/valid email/i)).toBeDefined();
    });
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it('shows "Sending…" text on the submit button while the request is pending', async () => {
    /*
     * Scenario: while createInvitation is in-flight the submit button must display
     * "Sending…" so the user knows the invite is being sent.
     * Protects: line 116 — `isPending ? 'Sending…' : 'Send invite'` truthy branch.
     */
    vi.mocked(createInvitation).mockReturnValue(new Promise(() => undefined));
    render(<InviteForm onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/colleague@example.com/i), {
      target: { value: 'pending@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => {
      expect(screen.getByText('Sending…')).toBeDefined();
    });
  });

  it('calls handleAuthClientError when createInvitation rejects', async () => {
    /*
     * Scenario: when createInvitation throws the error must be forwarded to
     * handleAuthClientError so the user sees an error toast.
     * Protects: line 65 — catch block in onSubmit calls handleAuthClientError.
     */
    const err = new Error('Invitation error');
    vi.mocked(createInvitation).mockRejectedValue(err);
    render(<InviteForm onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/colleague@example.com/i), {
      target: { value: 'error@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
  });
});
