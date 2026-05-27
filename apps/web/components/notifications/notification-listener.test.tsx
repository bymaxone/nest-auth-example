/**
 * @fileoverview Unit tests for `NotificationListener`.
 *
 * Verifies:
 * - A `notification:new` event from the WS client fires a `sonner` toast.
 * - The component unsubscribes when the user signs out.
 * - No toast is fired when the user is unauthenticated (user === null).
 *
 * `@bymax-one/nest-auth/react`, `sonner`, and `@/lib/ws-client` are all mocked
 * so the test never opens a real WebSocket or requires an `AuthProvider` tree.
 *
 * @module components/notifications/notification-listener.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@bymax-one/nest-auth/react', () => ({
  useSession: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: vi.fn(),
}));

vi.mock('@/lib/ws-client', () => {
  const on = vi.fn();
  const off = vi.fn();
  const close = vi.fn();
  const reconnect = vi.fn();
  return {
    getWsClient: vi.fn(() => ({ on, off, close, reconnect })),
  };
});

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { useSession } from '@bymax-one/nest-auth/react';
import { toast } from 'sonner';
import { getWsClient } from '@/lib/ws-client';
import type { NotificationHandler } from '@/lib/ws-client';
import { NotificationListener } from './notification-listener.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Builds the minimal session shape returned by the mocked `useSession`. */
function makeSession(userId: string | null) {
  return { user: userId !== null ? { id: userId, role: 'MEMBER', mfaEnabled: false } : null };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NotificationListener', () => {
  it('renders null and subscribes to notification:new when authenticated', () => {
    /*
     * Scenario: when the user is authenticated the component must call
     * ws.on('notification:new', handler) on mount.
     * Protects: P16-2 — NotificationListener subscribes on authenticated mount.
     */
    vi.mocked(useSession).mockReturnValue(makeSession('user-1') as ReturnType<typeof useSession>);

    const { container } = render(<NotificationListener />);

    expect(container.firstChild).toBeNull();

    const ws = getWsClient();
    expect(ws.on).toHaveBeenCalledWith('notification:new', expect.any(Function));
  });

  it('forces an immediate ws.reconnect() when the user transitions to authenticated', () => {
    /*
     * Scenario: the WS singleton may be sleeping on an exponential-backoff
     * timer (after the previous user signed out) or holding a stale socket
     * authenticated as a different identity. When `user.id` becomes set,
     * the listener must call `ws.reconnect()` to cancel the timer, reset
     * `attempt`, and open a fresh upgrade with the browser's current
     * cookies — otherwise notifications never reach the new session.
     * Protects: re-login / tenant-switch reconnect behaviour.
     */
    vi.mocked(useSession).mockReturnValue(makeSession('user-1') as ReturnType<typeof useSession>);

    render(<NotificationListener />);

    const ws = getWsClient();
    expect(ws.reconnect).toHaveBeenCalledTimes(1);
  });

  it('fires a toast when a notification:new event arrives', () => {
    /*
     * Scenario: the handler registered via ws.on must call sonner toast with
     * the payload's title and body when invoked.
     * Protects: P16-2 — toast is surfaced to the user on incoming notification.
     */
    vi.mocked(useSession).mockReturnValue(makeSession('user-1') as ReturnType<typeof useSession>);

    render(<NotificationListener />);

    // Retrieve the handler that was registered with the mock WS.
    const ws = getWsClient();
    const registeredHandler = vi.mocked(ws.on).mock.calls[0]?.[1] as NotificationHandler;
    expect(registeredHandler).toBeDefined();

    registeredHandler({ title: 'Hello', body: 'This is a test.' });

    expect(toast).toHaveBeenCalledWith('Hello', { description: 'This is a test.' });
  });

  it('does not subscribe when the user is unauthenticated', () => {
    /*
     * Scenario: when user === null the component must not open the WS or
     * subscribe — prevents pointless backoff loops before sign-in.
     * Protects: P16-2 — guard against unauthenticated WS connections.
     */
    vi.mocked(useSession).mockReturnValue(makeSession(null) as ReturnType<typeof useSession>);

    render(<NotificationListener />);

    const ws = getWsClient();
    expect(ws.on).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    /*
     * Scenario: when the component unmounts (e.g. navigation away from the
     * dashboard) the cleanup function must call ws.off to prevent memory leaks.
     * Protects: P16-2 — effect cleanup removes the handler.
     */
    vi.mocked(useSession).mockReturnValue(makeSession('user-1') as ReturnType<typeof useSession>);

    const { unmount } = render(<NotificationListener />);

    const ws = getWsClient();
    const registeredHandler = vi.mocked(ws.on).mock.calls[0]?.[1];
    expect(registeredHandler).toBeDefined();

    unmount();

    expect(ws.off).toHaveBeenCalledWith('notification:new', registeredHandler);
  });

  it('calls ws.off when user transitions from authenticated to null (sign-out)', () => {
    /*
     * Scenario: when the user transitions from authenticated to null (sign-out
     * without a full page reload) the component must call ws.off with the
     * stored handlerRef so the stale listener is removed.
     * Protects: P16-2 — lines 55-57 (handlerRef.current !== null branch).
     */
    // Start authenticated.
    vi.mocked(useSession).mockReturnValue(makeSession('user-1') as ReturnType<typeof useSession>);

    const { rerender } = render(<NotificationListener />);

    const ws = getWsClient();
    const registeredHandler = vi.mocked(ws.on).mock.calls[0]?.[1];
    expect(registeredHandler).toBeDefined();

    // Transition to signed-out — triggers the user === null branch in useEffect.
    vi.mocked(useSession).mockReturnValue(makeSession(null) as ReturnType<typeof useSession>);
    rerender(<NotificationListener />);

    // ws.off must have been called with the previously registered handler.
    expect(ws.off).toHaveBeenCalledWith('notification:new', registeredHandler);
  });
});
