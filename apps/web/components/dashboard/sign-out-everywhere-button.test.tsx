/**
 * @fileoverview Unit tests for the `SignOutEverywhereButton` component.
 *
 * Verifies:
 * - The trigger button renders with "Sign out everywhere" label.
 * - Clicking the trigger opens the confirmation dialog.
 * - Clicking confirm revokes every other session AND logs the current one out
 *   before redirecting — the pairing that makes the dialog's "including the
 *   current one" promise true.
 * - A failed logout surfaces an error and does NOT redirect.
 *
 * @module components/dashboard/sign-out-everywhere-button.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Router mock state ─────────────────────────────────────────────────────────

const mockReplace = vi.fn();
const mockRouter = { push: vi.fn(), replace: mockReplace, refresh: vi.fn() };

// ── Logout route mock ─────────────────────────────────────────────────────────

/** Stands in for the `POST /api/auth/logout` route handler. */
const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', mockFetch);

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

const mockWsClose = vi.fn();
vi.mock('@/lib/ws-client', () => ({
  getWsClient: () => ({ close: mockWsClose }),
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { revokeAllSessions, handleAuthClientError } from '@/lib/auth-client';
import { toast } from 'sonner';
import { SignOutEverywhereButton } from './sign-out-everywhere-button.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
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

  it('calls revokeAllSessions, shows the verbatim toast and redirects to /auth/login when confirm is clicked', async () => {
    /*
     * Scenario: clicking the confirm button inside the dialog must call
     * revokeAllSessions, surface the verbatim "All sessions revoked." toast
     * so support docs and audit dashboards can pattern-match on the exact
     * wording, and navigate to /auth/login.
     * Protects:
     * - handleConfirm calls revokeAllSessions and router.replace,
     * - StringLiteral mutant on the toast.success template — exact-string
     *   assertion kills any swap of the message.
     */
    vi.mocked(revokeAllSessions).mockResolvedValue(undefined);

    render(<SignOutEverywhereButton />);
    fireEvent.click(screen.getByRole('button', { name: /sign out everywhere/i }));
    const allButtons = screen.getAllByRole('button', { name: /sign out everywhere/i });
    const confirmBtn = allButtons[allButtons.length - 1]!;
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(revokeAllSessions).toHaveBeenCalledOnce();
    });
    // The bulk revoke spares the caller's session, so the component must also
    // post to the logout route — otherwise this browser stays signed in.
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('All sessions revoked.');
    });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/auth/login');
    });
  });

  it('swaps the trigger label to "Signing out…" and disables it while revokeAllSessions is in flight', async () => {
    /*
     * Scenario: between confirming the dialog and the server responding, the
     * trigger button must display the verbatim "Signing out…" label and be
     * disabled so the operator can see progress and cannot double-submit.
     * Protects:
     * - BooleanLiteral mutant on setIsPending(true) — a `false` mutant would
     *   leave isPending=false, no label swap, no disabled state,
     * - StringLiteral mutant on the truthy arm `'Signing out…'` — verbatim
     *   pin including the trailing ellipsis character.
     */
    let resolveRevoke: () => void = () => undefined;
    vi.mocked(revokeAllSessions).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRevoke = resolve;
        }),
    );

    render(<SignOutEverywhereButton />);
    // Capture the trigger BEFORE opening the dialog — survives Radix teardown.
    const trigger = screen.getByRole('button', { name: /sign out everywhere/i });
    fireEvent.click(trigger);
    const allButtons = screen.getAllByRole('button', { name: /sign out everywhere/i });
    const confirmBtn = allButtons[allButtons.length - 1]!;
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(revokeAllSessions).toHaveBeenCalledOnce());
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(true));
    // The label inside the trigger swaps to the verbatim "Signing out…".
    expect(trigger.textContent).toContain('Signing out…');
    expect(trigger.textContent).not.toContain('Sign out everywhere');
    resolveRevoke();
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
    // Radix may keep <body data-aria-hidden="true"> while tearing down the
    // dialog overlay, which blinds RTL role queries. Query the trigger via a
    // raw DOM selector that ignores the aria-hidden tree.
    await waitFor(() => {
      const triggerBtn = document.querySelector<HTMLButtonElement>('button[type="button"]');
      expect(triggerBtn).not.toBeNull();
      expect(triggerBtn?.disabled).toBe(false);
    });
  });

  it('closes the notification socket so it stops streaming after sign-out', async () => {
    /*
     * Scenario: the gateway authenticates a socket on connect and never
     * revalidates it, so revoking the HTTP credentials leaves an open socket
     * delivering notifications to a browser that was just told every session
     * ended. Closing it also stops the reconnect backoff from hammering an
     * endpoint that now refuses the upgrade.
     * Protects: the `close()` call — nothing else in this flow ends the socket.
     */
    vi.mocked(revokeAllSessions).mockResolvedValue(undefined);

    render(<SignOutEverywhereButton />);
    fireEvent.click(screen.getByRole('button', { name: /sign out everywhere/i }));
    const allButtons = screen.getAllByRole('button', { name: /sign out everywhere/i });
    fireEvent.click(allButtons[allButtons.length - 1]!);

    await waitFor(() => expect(mockWsClose).toHaveBeenCalledOnce());
  });

  it('leaves the socket open when the logout call fails', async () => {
    /*
     * Scenario: the logout failed, so the session is still live and the user
     * stays on the page. Killing their notification stream there would be a
     * silent degradation of a session that still works.
     * Protects: the ordering — the socket closes only on the success path.
     */
    vi.mocked(revokeAllSessions).mockResolvedValue(undefined);
    mockFetch.mockResolvedValue(new Response(null, { status: 500 }));

    render(<SignOutEverywhereButton />);
    fireEvent.click(screen.getByRole('button', { name: /sign out everywhere/i }));
    const allButtons = screen.getAllByRole('button', { name: /sign out everywhere/i });
    fireEvent.click(allButtons[allButtons.length - 1]!);

    await waitFor(() => expect(handleAuthClientError).toHaveBeenCalled());
    expect(mockWsClose).not.toHaveBeenCalled();
  });

  it('surfaces an error and does not redirect when the logout call fails', async () => {
    /*
     * Scenario: the bulk revoke succeeds but `POST /api/auth/logout` answers
     * non-2xx, so the caller's own session is still alive. The component must
     * report the failure and stay put — redirecting to /auth/login here would
     * look identical to success while the current device remained signed in,
     * which is the exact false-assurance the dialog copy promises against.
     * Protects:
     * - the `!response.ok` guard (an inverted or removed check would redirect),
     * - the ordering: no success toast and no router.replace on that path.
     */
    vi.mocked(revokeAllSessions).mockResolvedValue(undefined);
    mockFetch.mockResolvedValue(new Response(null, { status: 500 }));

    render(<SignOutEverywhereButton />);
    fireEvent.click(screen.getByRole('button', { name: /sign out everywhere/i }));
    const allButtons = screen.getAllByRole('button', { name: /sign out everywhere/i });
    fireEvent.click(allButtons[allButtons.length - 1]!);

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Logout failed with status 500' }),
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
