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

// ── Stryker-killing strengthenings ───────────────────────────────────────────

describe('InviteForm defaults, verbatim copy, reset + lifecycle pins', () => {
  it('pre-selects the "MEMBER" role on first render via defaultValues', () => {
    /*
     * Scenario: the role dropdown must default to "MEMBER" — the
     * sensible least-privileged option that admins reach for most
     * often. Pinning the initial select value defends the RHF
     * `defaultValues: { role: 'MEMBER' }` ObjectLiteral; a mutated
     * empty object would leave the select uncontrolled and the browser
     * would default to the FIRST option ("VIEWER"), changing the
     * invitation's default privilege level silently.
     */
    render(<InviteForm onSuccess={vi.fn()} />);
    const select = screen.getByRole<HTMLSelectElement>('combobox');
    expect(select.value).toBe('MEMBER');
  });

  it('renders all three role options (VIEWER, MEMBER, ADMIN) from ROLE_OPTIONS', () => {
    /*
     * Scenario: the role dropdown must include every entry in the
     * ROLE_OPTIONS tuple. Pinning all three options defends the
     * `ROLE_OPTIONS.map((r) => …)` ArrowFunction — a mutated `() =>
     * undefined` callback would render zero options, leaving the
     * dropdown with no choices.
     */
    render(<InviteForm onSuccess={vi.fn()} />);
    const options = screen.getAllByRole<HTMLOptionElement>('option');
    const values = options.map((o) => o.value);
    expect(values).toEqual(['VIEWER', 'MEMBER', 'ADMIN']);
  });

  it('toasts the verbatim "Invitation sent to <email>." message on success', async () => {
    /*
     * Scenario: the success toast is the only confirmation the admin
     * receives that the invite landed. Pinning the verbatim template
     * (including the trailing period and the email interpolation)
     * defends both the StringLiteral template and the data.email
     * interpolation.
     */
    vi.mocked(createInvitation).mockResolvedValue(undefined);
    const { toast } = await import('sonner');
    render(<InviteForm onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/colleague@example.com/i), {
      target: { value: 'newhire@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Invitation sent to newhire@example.com.');
    });
  });

  it('restores the role to "MEMBER" after a successful invite even when the admin had changed it to ADMIN', async () => {
    /*
     * Scenario: the admin picks "ADMIN" for one specific invite, then
     * sends. After the success path runs `reset({ role: 'MEMBER' })`,
     * the role select must snap back to "MEMBER" so the next invite
     * defaults to the least-privileged level. Pins both the
     * `reset({ role: 'MEMBER' })` ObjectLiteral AND the literal
     * `'MEMBER'` — a mutated `reset({})` would leave the form's
     * defaultValue undefined and the next render would surface
     * "VIEWER" (the first option) silently downgrading every
     * subsequent invite to the wrong default.
     */
    vi.mocked(createInvitation).mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    render(<InviteForm onSuccess={onSuccess} />);
    fireEvent.change(screen.getByPlaceholderText(/colleague@example.com/i), {
      target: { value: 'first@example.com' },
    });
    fireEvent.change(screen.getByRole<HTMLSelectElement>('combobox'), {
      target: { value: 'ADMIN' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));

    // Wait for the full submit cycle to settle (createInvitation → reset → onSuccess).
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
    // Confirm the role snapped back to MEMBER (the reset target).
    const refreshedSelect = screen.getByRole<HTMLSelectElement>('combobox');
    expect(refreshedSelect.value).toBe('MEMBER');
  });

  it('re-enables the submit button + restores "Send invite" label after a failed submit', async () => {
    /*
     * Scenario: when createInvitation rejects the `finally {
     * setIsPending(false) }` cleanup must run so the admin can retry.
     * Pins the finally BlockStatement AND the BooleanLiteral on the
     * `false` argument — a removal would leave the button stuck on
     * "Sending…" + disabled.
     */
    vi.mocked(createInvitation).mockRejectedValueOnce(new Error('Conflict'));
    render(<InviteForm onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/colleague@example.com/i), {
      target: { value: 'retry@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByText(/sending/i)).toBeNull();
    });
    const btn = screen.getByRole<HTMLButtonElement>('button', { name: /send invite/i });
    expect(btn.disabled).toBe(false);
  });

  it('adds the red error-border class to the email input when validation fails', async () => {
    /*
     * Scenario: when validation fails the email input must surface the
     * brand error-border palette. Pins the truthy arm of the cn()
     * conditional AND the verbatim `border-red-500/60` literal.
     */
    render(<InviteForm onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));
    await waitFor(() => {
      expect(screen.getByText(/valid email/i)).toBeDefined();
    });
    const email = screen.getByPlaceholderText<HTMLInputElement>(/colleague@example.com/i);
    expect(email.className).toContain('border-red');
  });

  it('does NOT add the red error-border class to the email input while pristine', () => {
    /*
     * Scenario: counterpart — before any submit fires the email input
     * must not carry the red error palette. Pins the falsy arm of the
     * cn() conditional.
     */
    render(<InviteForm onSuccess={vi.fn()} />);
    const email = screen.getByPlaceholderText<HTMLInputElement>(/colleague@example.com/i);
    expect(email.className).not.toContain('border-red');
  });
});
