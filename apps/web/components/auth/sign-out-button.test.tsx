/**
 * @fileoverview Unit tests for the `SignOutButton` component.
 *
 * Verifies:
 * - The button renders with "Sign out" text.
 * - A successful click calls fetch and refreshes the router.
 * - A network failure surfaces an error toast.
 *
 * `next/navigation`, `sonner`, and global `fetch` are all mocked so no real
 * network calls or navigation occur.
 *
 * @module components/auth/sign-out-button.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Router mock state ─────────────────────────────────────────────────────────

const mockRefresh = vi.fn();
const mockRouter = { push: vi.fn(), refresh: mockRefresh, replace: vi.fn() };

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/',
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { toast } from 'sonner';
import SignOutButton from './sign-out-button.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SignOutButton rendering', () => {
  it('renders a button with "Sign out" label', () => {
    /*
     * Scenario: the sign-out button must always display the label "Sign out"
     * so users can identify the action in the topbar dropdown.
     * Protects: button content renders correctly.
     */
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    render(<SignOutButton />);
    expect(screen.getByRole('button', { name: /sign out/i })).toBeDefined();
  });

  it('renders the button in an enabled state by default', () => {
    /*
     * Scenario: before the user clicks, the button must not be disabled.
     * Protects: initial state of isPending is false.
     */
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    render(<SignOutButton />);
    const btn = screen.getByRole('button', { name: /sign out/i });
    expect(btn).not.toHaveAttribute('disabled');
  });
});

describe('SignOutButton click behaviour', () => {
  it('calls POST /api/auth/logout and router.refresh on success', async () => {
    /*
     * Scenario: clicking the button must call fetch with POST method and then
     * call router.refresh() to clear RSC cache before the redirect lands.
     * Protects: logout flow calls the correct endpoint with correct method.
     */
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    render(<SignOutButton />);
    const btn = screen.getByRole('button', { name: /sign out/i });
    fireEvent.click(btn);

    // Wait for the async handler to complete.
    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('shows an error toast when fetch throws', async () => {
    /*
     * Scenario: if the logout request fails with a network error, a toast.error
     * must be shown so the user knows sign-out failed.
     * Protects: catch block surfaces the network error as a toast.
     */
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    render(<SignOutButton />);
    const btn = screen.getByRole('button', { name: /sign out/i });
    fireEvent.click(btn);

    await vi.waitFor(() => {
      expect(vi.mocked(toast).error).toHaveBeenCalledWith(
        expect.stringContaining('Sign out failed'),
      );
    });
  });

  it('disables the button while the logout request is in flight', async () => {
    /*
     * Scenario: between clicking and the logout request resolving, the button
     * must be disabled so the user cannot double-submit.
     * Protects: BooleanLiteral mutant on `setIsPending(true)` — a `false`
     * mutant would leave the button enabled mid-flight.
     */
    let resolveFetch: (value: { ok: boolean }) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise<{ ok: boolean }>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    render(<SignOutButton />);
    const btn = screen.getByRole('button', { name: /sign out/i });
    fireEvent.click(btn);

    await vi.waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
    resolveFetch({ ok: true });
  });

  it('re-enables the button after the logout request settles (finally → setIsPending(false))', async () => {
    /*
     * Scenario: after the logout fetch fails (catch path) the button must be
     * enabled again so the user can retry. The catch path is used because the
     * success path triggers a redirect that takes the page out of test scope.
     * Protects: BlockStatement empty-block mutant on `finally` AND
     * BooleanLiteral mutant on `setIsPending(false)` — both would leave the
     * button stuck on disabled after the error.
     */
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    render(<SignOutButton />);
    const btn = screen.getByRole('button', { name: /sign out/i });
    fireEvent.click(btn);

    await vi.waitFor(() => expect(vi.mocked(toast).error).toHaveBeenCalled());
    await vi.waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
  });
});
