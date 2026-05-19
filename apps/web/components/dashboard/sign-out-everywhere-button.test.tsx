/**
 * @fileoverview Unit tests for the `SignOutEverywhereButton` component.
 *
 * Verifies:
 * - The trigger button renders with "Sign out everywhere" label.
 * - Clicking the trigger opens the confirmation dialog.
 * - Clicking confirm in the dialog calls revokeAllSessions and redirects.
 *
 * @module components/dashboard/sign-out-everywhere-button.test
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
  revokeAllSessions: vi.fn(),
  handleAuthClientError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { revokeAllSessions, handleAuthClientError } from '@/lib/auth-client';
import { SignOutEverywhereButton } from './sign-out-everywhere-button.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SignOutEverywhereButton rendering', () => {
  it('renders the trigger button with correct label', () => {
    /*
     * Scenario: the trigger button must show "Sign out everywhere" so the user
     * can identify the destructive action.
     * Protects: basic rendering of the AlertDialogTrigger button.
     */
    render(<SignOutEverywhereButton />);
    expect(screen.getByRole('button', { name: /sign out everywhere/i })).toBeDefined();
  });
});

describe('SignOutEverywhereButton dialog flow', () => {
  it('shows the confirmation dialog when the trigger is clicked', () => {
    /*
     * Scenario: clicking the trigger must open the AlertDialog so the user sees
     * the confirmation prompt before the action executes.
     * Protects: AlertDialog opens on trigger click.
     */
    render(<SignOutEverywhereButton />);
    fireEvent.click(screen.getByRole('button', { name: /sign out everywhere/i }));
    expect(screen.getByText(/sign out of all sessions/i)).toBeDefined();
  });

  it('calls revokeAllSessions and redirects when confirm is clicked', async () => {
    /*
     * Scenario: clicking the confirm button inside the dialog must call
     * revokeAllSessions and then navigate to /auth/login.
     * Protects: handleConfirm calls revokeAllSessions and router.replace.
     */
    vi.mocked(revokeAllSessions).mockResolvedValue(undefined);

    render(<SignOutEverywhereButton />);
    // Open the dialog.
    fireEvent.click(screen.getByRole('button', { name: /sign out everywhere/i }));
    // Click the destructive confirm button inside the dialog.
    // There are two buttons named "Sign out everywhere" — trigger and confirm.
    const allButtons = screen.getAllByRole('button', { name: /sign out everywhere/i });
    // The confirm button is the last one rendered.
    const confirmBtn = allButtons[allButtons.length - 1]!;
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(revokeAllSessions).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/auth/login');
    });
  });

  it('calls handleAuthClientError and re-enables the button when revokeAllSessions rejects', async () => {
    /*
     * Scenario: when revokeAllSessions throws the error must be forwarded to
     * handleAuthClientError and isPending must be reset to false so the button
     * is re-enabled.
     * Protects: lines 48-49 — catch block calls handleAuthClientError and
     * setIsPending(false) on API failure.
     */
    const err = new Error('Revoke failed');
    vi.mocked(revokeAllSessions).mockRejectedValue(err);

    render(<SignOutEverywhereButton />);
    fireEvent.click(screen.getByRole('button', { name: /sign out everywhere/i }));

    const allButtons = screen.getAllByRole('button', { name: /sign out everywhere/i });
    const confirmBtn = allButtons[allButtons.length - 1]!;
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
    // The trigger button must be re-enabled after failure (isPending=false).
    await waitFor(() => {
      const triggerBtn = screen.getByRole('button', { name: /sign out everywhere/i });
      expect((triggerBtn as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
