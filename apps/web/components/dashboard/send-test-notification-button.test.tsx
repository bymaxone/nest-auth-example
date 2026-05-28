/**
 * @fileoverview Unit tests for the `SendTestNotificationButton` component.
 *
 * Verifies:
 * - The button renders in non-production environments.
 * - Clicking the button calls notifySelf.
 * - An error is surfaced via toast when notifySelf rejects.
 *
 * The component returns null in production. We cannot test that branch
 * directly because the Vitest `NODE_ENV` is always "test", so this file
 * covers the active (non-production) path.
 *
 * @module components/dashboard/send-test-notification-button.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth-client', () => ({
  notifySelf: vi.fn(),
  handleAuthClientError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { notifySelf, handleAuthClientError } from '@/lib/auth-client';
import { SendTestNotificationButton } from './send-test-notification-button.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SendTestNotificationButton rendering', () => {
  it('renders null when NODE_ENV is "production"', () => {
    /*
     * Scenario: when NODE_ENV is set to "production" the component must return
     * null so the dev-only button is never visible in production builds.
     * Protects: line 33 — `if (process.env.NODE_ENV === 'production') return null`.
     */
    const originalEnv = process.env.NODE_ENV;
    // Cast needed because NODE_ENV is normally read-only in test environments.
    (process.env as Record<string, string>)['NODE_ENV'] = 'production';
    try {
      const { container } = render(<SendTestNotificationButton />);
      expect(container.firstChild).toBeNull();
    } finally {
      (process.env as Record<string, string>)['NODE_ENV'] = originalEnv ?? 'test';
    }
  });

  it('renders the button in test/development environment', () => {
    /*
     * Scenario: when NODE_ENV !== "production" the button must be present in
     * the document.
     * Protects: production guard returns null; non-production renders the button.
     */
    render(<SendTestNotificationButton />);
    expect(screen.getByRole('button', { name: /send test notification/i })).toBeDefined();
  });

  it('renders in an enabled state initially', () => {
    /*
     * Scenario: the button must not be disabled before any click.
     * Protects: initial pending=false means the button is enabled.
     */
    render(<SendTestNotificationButton />);
    const btn = screen.getByRole('button', {
      name: /send test notification/i,
    });
    expect(btn).not.toHaveAttribute('disabled');
  });
});

describe('SendTestNotificationButton click behaviour', () => {
  it('calls notifySelf when the button is clicked', async () => {
    /*
     * Scenario: clicking the button must trigger notifySelf so the backend
     * sends a test notification through the WebSocket gateway.
     * Protects: handleClick invokes notifySelf.
     */
    vi.mocked(notifySelf).mockResolvedValue({ delivered: 1 });
    render(<SendTestNotificationButton />);
    fireEvent.click(screen.getByRole('button', { name: /send test notification/i }));
    await waitFor(() => {
      expect(notifySelf).toHaveBeenCalledOnce();
    });
  });

  it('calls handleAuthClientError when notifySelf rejects', async () => {
    /*
     * Scenario: when notifySelf throws the error must be passed to
     * handleAuthClientError so it can surface the appropriate toast.
     * Protects: catch block calls handleAuthClientError.
     */
    const err = new Error('WS error');
    vi.mocked(notifySelf).mockRejectedValue(err);
    render(<SendTestNotificationButton />);
    fireEvent.click(screen.getByRole('button', { name: /send test notification/i }));
    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
  });

  it('disables the button while notifySelf is in flight', async () => {
    /*
     * Scenario: between clicking the button and notifySelf resolving, the
     * button must be disabled so the operator cannot trigger multiple
     * notifications back-to-back.
     * Protects: BooleanLiteral mutant on `setPending(true)` — a `false`
     * mutant would leave the button enabled mid-flight.
     */
    let resolveNotify: (value: { delivered: number }) => void = () => undefined;
    vi.mocked(notifySelf).mockImplementation(
      () =>
        new Promise<{ delivered: number }>((resolve) => {
          resolveNotify = resolve;
        }),
    );

    render(<SendTestNotificationButton />);
    const button = screen.getByRole('button', { name: /send test notification/i });
    fireEvent.click(button);

    await waitFor(() => expect(notifySelf).toHaveBeenCalled());
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    resolveNotify({ delivered: 1 });
  });

  it('re-enables the button after notifySelf settles (finally → setPending(false))', async () => {
    /*
     * Scenario: after a successful notifySelf the button must be enabled
     * again so the operator can trigger another test notification.
     * Protects: BlockStatement empty-block mutant on the `finally` block
     * AND BooleanLiteral mutant on `setPending(false)` — both would leave
     * pending stuck on true, keeping the button disabled forever.
     */
    vi.mocked(notifySelf).mockResolvedValue({ delivered: 1 });

    render(<SendTestNotificationButton />);
    const button = screen.getByRole('button', { name: /send test notification/i });
    fireEvent.click(button);

    await waitFor(() => expect(notifySelf).toHaveBeenCalled());
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });
});
