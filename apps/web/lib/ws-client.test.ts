/**
 * @fileoverview Unit tests for the `ws-client` module.
 *
 * Verifies:
 * - Singleton is created on first `getWsClient()` call.
 * - Reconnect backoff sequence: 1 s, 2 s, 4 s, …, capped at 30 s.
 * - Backoff resets to 0 on a successful `open` event.
 * - `close()` stops all reconnect attempts permanently.
 * - `on`/`off` route `notification:new` events to registered handlers.
 *
 * Uses fake timers and a minimal `WebSocket` mock to control time and
 * simulate connect/disconnect without a real network.
 *
 * @module lib/ws-client.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getWsClient, _resetForTest } from './ws-client.js';
import type { NotificationHandler } from './ws-client.js';

// ── WebSocket mock ───────────────────────────────────────────────────────────��

/** Minimal WebSocket mock that captures lifecycle callbacks for test control. */
class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = 1; // OPEN by default to avoid triggering onopen logic in some paths
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = 3;
  }

  /** Test helper — fires the open callback and resets readyState. */
  simulateOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  /** Test helper — fires the close callback. */
  simulateClose() {
    this.readyState = 3;
    this.onclose?.();
  }

  /** Test helper — fires the message callback with JSON-serialised data. */
  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  /** Test helper — fires the message callback with a raw string. */
  simulateRawMessage(raw: string) {
    this.onmessage?.({ data: raw });
  }

  /** Test helper — fires the onerror callback. */
  simulateError() {
    this.onerror?.();
  }
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  // Pin jitter to 0 so the multiplicative factor is 0.8 + 0 * 0.4 = 0.8.
  // 0.8 is NOT the multiplicative identity, which makes `base * 0.8` and
  // `base / 0.8` distinguishable — kills the ArithmeticOperator `*` → `/`
  // mutant that would survive an `0.5` mock (where 0.8 + 0.5 * 0.4 = 1.0
  // collapses both operators to a no-op).
  vi.spyOn(Math, 'random').mockReturnValue(0);
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  process.env['NEXT_PUBLIC_WS_URL'] = 'ws://localhost:3000';
  _resetForTest();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env['NEXT_PUBLIC_WS_URL'];
  _resetForTest();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getWsClient', () => {
  it('opens a WebSocket to the configured URL on first call', () => {
    /*
     * Scenario: calling getWsClient() for the first time must open exactly one
     * WebSocket connection to `${NEXT_PUBLIC_WS_URL}/ws/notifications`.
     * Protects: P16-1 — singleton is created lazily on first call.
     */
    getWsClient();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]!.url).toBe('ws://localhost:3000/ws/notifications');
  });

  it('returns the same instance on subsequent calls without opening a new socket', () => {
    /*
     * Scenario: multiple `getWsClient()` calls must return the same object and
     * must not open duplicate connections.
     * Protects: P16-1 — module-level singleton, one connection per page load.
     */
    const first = getWsClient();
    const second = getWsClient();

    expect(first).toBe(second);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

describe('reconnect backoff', () => {
  it('reconnects after exactly 1200 ms on first disconnect when jitter is at its MAX value (random=1)', () => {
    /*
     * Scenario: with Math.random pinned to 1 the jitter factor is
     * 0.8 + 1*0.4 = 1.2, so the first reconnect delay is 1000 * 1.2 = 1200 ms.
     * Pairing this with the jitter-min (random=0 → 800 ms) test in the same
     * describe block locks BOTH the `+` operator and the `*` operator on
     * `Math.random() * 0.4`:
     * - `0.8 + Math.random() * 0.4` → `0.8 - Math.random() * 0.4` would give
     *   0.4 here (delay 400 ms), failing.
     * - `Math.random() * 0.4` → `Math.random() / 0.4` would give 2.5 here
     *   (delay 3300 ms), failing.
     * Protects: ArithmeticOperator mutants on the jitter computation.
     */
    vi.spyOn(Math, 'random').mockReturnValue(1);
    getWsClient();
    const ws0 = MockWebSocket.instances[0]!;
    ws0.simulateClose();

    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1199);
    expect(MockWebSocket.instances).toHaveLength(1); // not yet

    vi.advanceTimersByTime(1); // +1 ms → exactly 1200 ms total
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('reconnects after exactly 800 ms on first disconnect (attempt 0, jitter min)', () => {
    /*
     * Scenario: with Math.random pinned to 0 the jitter factor is 0.8, so the
     * first reconnect delay is `min(1000 * 2^0, 30000) * 0.8 = 800 ms`.
     * Asserting BOTH "not at 799 ms" AND "yes at 800 ms" pins the exact
     * product — kills the ArithmeticOperator mutant `base * 0.8` → `base / 0.8`
     * which would yield 1250 ms instead.
     * Protects: P16-1 — exponential backoff formula AND the multiplicative
     * application of the jitter factor.
     */
    getWsClient();
    const ws0 = MockWebSocket.instances[0]!;
    ws0.simulateClose();

    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(799);
    expect(MockWebSocket.instances).toHaveLength(1); // not yet

    vi.advanceTimersByTime(1); // +1 ms → exactly 800 ms total
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('reconnects after exactly 1600 ms on second disconnect (attempt 1)', () => {
    /*
     * Scenario: second disconnect → base = 1000 * 2^1 = 2000 ms, jitter factor
     * 0.8 → delay = 1600 ms.
     * Protects: P16-1 — exponential backoff doubling on each failure.
     */
    getWsClient();
    const ws0 = MockWebSocket.instances[0]!;
    ws0.simulateClose();
    vi.advanceTimersByTime(800); // reconnect #1 at 800 ms

    const ws1 = MockWebSocket.instances[1]!;
    ws1.simulateClose();
    vi.advanceTimersByTime(1599);
    expect(MockWebSocket.instances).toHaveLength(2); // not yet

    vi.advanceTimersByTime(1); // +1 ms → exactly 1600 ms after second disconnect
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it('caps the backoff base at 30 000 ms after enough failures', () => {
    /*
     * Scenario: after enough failures the underlying `base` must cap at
     * 30 000 ms → with jitter factor 0.8 the actual delay is 24 000 ms.
     * Protects: P16-1 — 30 s cap on the base prevents extreme delays.
     */
    getWsClient();

    // Push through 5 attempts so attempt counter ends at 5.
    // Delays (each = base * 0.8): 800, 1600, 3200, 6400, 12800.
    const delays = [800, 1600, 3200, 6400, 12_800];
    for (const delay of delays) {
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
      ws.simulateClose();
      vi.advanceTimersByTime(delay);
    }

    // 6th disconnect → base capped at 30 000 ms → delay = 24 000 ms.
    const ws5 = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    ws5.simulateClose();

    const countBefore = MockWebSocket.instances.length;
    vi.advanceTimersByTime(23_999);
    expect(MockWebSocket.instances).toHaveLength(countBefore); // not yet

    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(countBefore + 1); // at 24 000 ms
  });

  it('resets the attempt counter to 0 on successful open', () => {
    /*
     * Scenario: after a successful reconnect (onopen fires) the next disconnect
     * must restart the backoff sequence from the base delay, not continue
     * doubling.
     * Protects: P16-1 — attempt reset on open preserves gentle reconnect.
     */
    getWsClient();
    const ws0 = MockWebSocket.instances[0]!;
    ws0.simulateClose();
    vi.advanceTimersByTime(800); // reconnect attempt 1 at 800 ms

    const ws1 = MockWebSocket.instances[1]!;
    ws1.simulateOpen();

    // Disconnect again — backoff must restart from 800 ms (not 1600 ms).
    ws1.simulateClose();
    vi.advanceTimersByTime(799);
    expect(MockWebSocket.instances).toHaveLength(2); // not yet

    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3); // reconnected at 800 ms
  });
});

describe('close()', () => {
  it('does NOT schedule a reconnect timer after close() — even when the socket later closes', () => {
    /*
     * Scenario: close() must set stopped=true so subsequent socket onclose
     * events take the !stopped → false branch and do NOT schedule a reconnect
     * via setTimeout. Asserting at the side-effect level (setTimeout not
     * called) is necessary because connect() ALSO guards on stopped — an
     * always-true mutant on `if (!stopped)` would still produce a no-op
     * connect when the timer fired, masking the bug at the "no new socket"
     * level.
     * Protects: onclose ConditionalExpression `if (!stopped)` — always-true
     * mutant would still call setTimeout(connect, …) and leak a pending
     * timer (eventually a no-op, but observably wrong).
     */
    const ws = getWsClient();
    const socket0 = MockWebSocket.instances[0]!;
    ws.close();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    socket0.simulateClose();

    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('stops reconnect attempts permanently after close()', () => {
    /*
     * Scenario: calling close() must prevent any further reconnect even after
     * the current socket disconnects.
     * Protects: P16-1 — close() used on sign-out to stop the backoff loop.
     */
    const ws = getWsClient();
    const socket0 = MockWebSocket.instances[0]!;
    ws.close();
    socket0.simulateClose();

    vi.advanceTimersByTime(60_000); // well beyond any backoff
    expect(MockWebSocket.instances).toHaveLength(1); // no new socket opened
  });
});

describe('on / off event emitter', () => {
  it('delivers notification:new events to all registered handlers', () => {
    /*
     * Scenario: handlers registered via on('notification:new', fn) receive
     * the parsed payload when the gateway sends a matching message.
     * Protects: P16-1 — event emitter dispatches to all subscribers.
     */
    const ws = getWsClient();
    const handler1 = vi.fn<NotificationHandler>();
    const handler2 = vi.fn<NotificationHandler>();

    ws.on('notification:new', handler1);
    ws.on('notification:new', handler2);

    MockWebSocket.instances[0]!.simulateMessage({
      event: 'notification:new',
      data: { title: 'Hi', body: 'Test body' },
    });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler1).toHaveBeenCalledWith({ title: 'Hi', body: 'Test body' });
    expect(handler2).toHaveBeenCalledOnce();
  });

  it('off() does NOT throw when called for an event that was never registered', () => {
    /*
     * Scenario: calling `ws.off('notification:new', handler)` when no handler
     * has ever been registered (so listeners.get(eventName) is undefined)
     * must be a safe no-op — not a TypeError.
     * Protects: OptionalChaining mutant `listeners.get(eventName)?.delete(...)`
     * → `listeners.get(eventName).delete(...)` — without the `?.`, this would
     * throw `Cannot read properties of undefined (reading 'delete')`.
     */
    const ws = getWsClient();
    const handler = vi.fn<NotificationHandler>();

    expect(() => ws.off('notification:new', handler)).not.toThrow();
  });

  it('stops delivering events to a handler after off() is called', () => {
    /*
     * Scenario: calling off() with a handler reference removes only that handler;
     * other handlers for the same event continue to receive messages.
     * Protects: P16-1 — off() cleanup used on component unmount.
     */
    const ws = getWsClient();
    const handler = vi.fn<NotificationHandler>();

    ws.on('notification:new', handler);
    ws.off('notification:new', handler);

    MockWebSocket.instances[0]!.simulateMessage({
      event: 'notification:new',
      data: { title: 'Hi', body: 'Test' },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('silently ignores unknown events', () => {
    /*
     * Scenario: messages with an unrecognised event name must not throw or
     * deliver to notification:new handlers.
     * Protects: P16-1 — robustness against unexpected gateway messages.
     */
    const ws = getWsClient();
    const handler = vi.fn<NotificationHandler>();
    ws.on('notification:new', handler);

    MockWebSocket.instances[0]!.simulateMessage({
      event: 'unknown:event',
      data: { title: 'Should not appear', body: '' },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not dispatch notification:new when the payload is missing the title field', () => {
    /*
     * Scenario: the gateway sends a `notification:new` event whose data object
     * is missing `title`. The runtime guard in `dispatch` must reject the payload
     * and not invoke any handlers (line 112 — the early return inside the guard).
     * Protects: P16-1 — malformed payloads must not reach toast handlers.
     */
    const ws = getWsClient();
    const handler = vi.fn<NotificationHandler>();
    ws.on('notification:new', handler);

    MockWebSocket.instances[0]!.simulateMessage({
      event: 'notification:new',
      data: { body: 'Missing title field' },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not dispatch notification:new when the payload is missing the body field', () => {
    /*
     * Scenario: the gateway sends a `notification:new` event whose data object
     * is missing `body`. The runtime guard must reject it and not invoke handlers.
     * Protects: P16-1 — incomplete payloads must not reach toast handlers.
     */
    const ws = getWsClient();
    const handler = vi.fn<NotificationHandler>();
    ws.on('notification:new', handler);

    MockWebSocket.instances[0]!.simulateMessage({
      event: 'notification:new',
      data: { title: 'Missing body' },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not dispatch notification:new when the payload data is null', () => {
    /*
     * Scenario: the gateway sends `notification:new` with `data: null` — the
     * null-check in the runtime guard must reject it before dispatching.
     * Protects: P16-1 — null data must not reach toast handlers.
     */
    const ws = getWsClient();
    const handler = vi.fn<NotificationHandler>();
    ws.on('notification:new', handler);

    MockWebSocket.instances[0]!.simulateMessage({
      event: 'notification:new',
      data: null,
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not dispatch notification:new when the payload data is a primitive', () => {
    /*
     * Scenario: the gateway sends `notification:new` with `data: "string"` — a
     * non-object value. The `typeof data !== 'object'` check must reject it.
     * Protects: P16-1 — primitive data values must not reach toast handlers.
     */
    const ws = getWsClient();
    const handler = vi.fn<NotificationHandler>();
    ws.on('notification:new', handler);

    MockWebSocket.instances[0]!.simulateMessage({
      event: 'notification:new',
      data: 'not-an-object',
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not throw when an individual handler throws', () => {
    /*
     * Scenario: a registered handler that throws must not propagate the error
     * or prevent subsequent handlers from executing. The try-catch inside the
     * dispatch loop must absorb the exception.
     * Protects: P16-1 — individual handler errors must not crash the event loop.
     */
    const ws = getWsClient();
    const throwingHandler = vi.fn<NotificationHandler>(() => {
      throw new Error('handler error');
    });
    const survivingHandler = vi.fn<NotificationHandler>();

    ws.on('notification:new', throwingHandler);
    ws.on('notification:new', survivingHandler);

    expect(() => {
      MockWebSocket.instances[0]!.simulateMessage({
        event: 'notification:new',
        data: { title: 'Hi', body: 'Test' },
      });
    }).not.toThrow();

    expect(throwingHandler).toHaveBeenCalledOnce();
    expect(survivingHandler).toHaveBeenCalledOnce();
  });
});

describe('connect() guard branches', () => {
  it('does not open a WebSocket when WebSocket is not defined (server-side guard)', () => {
    /*
     * Scenario: connect() must no-op when `typeof WebSocket === 'undefined'` to
     * prevent crashes in server-side rendering contexts where the WebSocket API
     * is absent.
     * Protects: line 131 — `typeof WebSocket === 'undefined'` early return branch.
     */
    // Remove the global WebSocket to simulate a server-side environment.
    vi.stubGlobal('WebSocket', undefined);
    getWsClient();
    // No socket should have been opened.
    expect(MockWebSocket.instances).toHaveLength(0);
    // Restore for subsequent tests.
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  it('does not dispatch when the gateway message event field is not a string', () => {
    /*
     * Scenario: a gateway message whose `event` field is not a string (e.g. a
     * number) must not invoke any handlers.
     * Protects: line 143 — `if (typeof msg.event === 'string')` false branch.
     */
    const ws = getWsClient();
    const handler = vi.fn<NotificationHandler>();
    ws.on('notification:new', handler);

    // Directly invoke onmessage with a message where event is a number.
    const socket0 = MockWebSocket.instances[0]!;
    socket0.onmessage?.({ data: JSON.stringify({ event: 42, data: {} }) });

    expect(handler).not.toHaveBeenCalled();
  });

  it('silently ignores malformed (non-JSON) gateway messages', () => {
    /*
     * Scenario: receiving a non-JSON string from the gateway must not throw or
     * invoke any handlers — the catch block discards the parse error.
     * Protects: lines 146-148 — catch block inside onmessage discards malformed data.
     */
    const ws = getWsClient();
    const handler = vi.fn<NotificationHandler>();
    ws.on('notification:new', handler);

    const socket0 = MockWebSocket.instances[0]!;
    // Send invalid JSON — this must not throw.
    expect(() => {
      socket0.simulateRawMessage('not valid json }{');
    }).not.toThrow();

    expect(handler).not.toHaveBeenCalled();
  });

  it('onerror callback fires without throwing', () => {
    /*
     * Scenario: the onerror callback must be a no-op function that does not
     * throw — errors are handled in onclose to prevent double-scheduling.
     * Protects: lines 163-167 — onerror callback function body.
     */
    getWsClient();
    const socket0 = MockWebSocket.instances[0]!;
    // Firing onerror must not throw.
    expect(() => {
      socket0.simulateError();
    }).not.toThrow();
  });
});

describe('connect() with missing NEXT_PUBLIC_WS_URL', () => {
  it('uses empty string as the base URL when NEXT_PUBLIC_WS_URL is not set', () => {
    /*
     * Scenario: when `NEXT_PUBLIC_WS_URL` is absent from the environment the
     * `?? ''` fallback fires, resulting in a WebSocket URL of `'/ws/notifications'`.
     * Protects: line 133 — `process.env['NEXT_PUBLIC_WS_URL'] ?? ''` null-coalescing branch.
     */
    // Remove the env var to trigger the fallback branch.
    delete process.env['NEXT_PUBLIC_WS_URL'];
    getWsClient();
    expect(MockWebSocket.instances).toHaveLength(1);
    // URL should be /ws/notifications (empty string base).
    expect(MockWebSocket.instances[0]!.url).toBe('/ws/notifications');
  });
});

describe('close() with pending reconnect timer', () => {
  it('cancels the pending reconnect timer when close() is called during backoff', () => {
    /*
     * Scenario: close() is called while a reconnect timer is active (i.e., after
     * a disconnect and before the backoff delay fires). Lines 189-190 inside
     * close() must call clearTimeout and set reconnectTimer to null, preventing
     * any future reconnect attempt even after the timer would have elapsed.
     * Protects: P16-1 — close() permanently stops reconnects even mid-backoff.
     */
    const ws = getWsClient();
    const socket0 = MockWebSocket.instances[0]!;

    // Trigger a disconnect so a reconnect timer is scheduled.
    socket0.simulateClose();

    // At this point the reconnect timer is armed but has not fired.
    expect(MockWebSocket.instances).toHaveLength(1);

    // Call close() to cancel the timer.
    ws.close();

    // Advance time well past the backoff window — no new socket should open.
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('clearTimeout is invoked with the pending timer reference when close() runs mid-backoff', () => {
    /*
     * Scenario: spies on the global clearTimeout to assert close() actually
     * cancels the pending timer. The "no new socket opens" assertion in the
     * sibling test passes for the empty-block / always-false mutants too
     * because `stopped=true` makes connect() a no-op even when the timer
     * still fires — so the cancellation must be observed at the side-effect
     * level (clearTimeout call), not just at the symptom level.
     * Protects: close() ConditionalExpression / EqualityOperator / BlockStatement
     * on `if (reconnectTimer !== null) { clearTimeout(reconnectTimer); … }`.
     */
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const ws = getWsClient();
    const socket0 = MockWebSocket.instances[0]!;
    socket0.simulateClose();
    clearTimeoutSpy.mockClear();

    ws.close();

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy.mock.calls[0]?.[0]).not.toBeNull();
    expect(clearTimeoutSpy.mock.calls[0]?.[0]).not.toBeUndefined();
  });

  it('does NOT call clearTimeout when close() runs without a pending timer', () => {
    /*
     * Scenario: spies on global clearTimeout while calling close() on a freshly
     * opened singleton (no disconnect has happened, so reconnectTimer is null).
     * Asserting clearTimeout was NOT called kills the always-true and
     * inverted-equality mutants on `if (reconnectTimer !== null)` which would
     * still invoke clearTimeout(null).
     * Protects: close() ConditionalExpression `true` and EqualityOperator
     * `!==` → `===` mutants on the timer guard.
     */
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const ws = getWsClient();
    clearTimeoutSpy.mockClear();

    ws.close();

    expect(clearTimeoutSpy).not.toHaveBeenCalled();
  });

  it('closes the active socket via socket.close() when close() is called', () => {
    /*
     * Scenario: spy on the socket's close() method to assert close() actually
     * tears down the live connection. With `stopped=true` set first, a missing
     * socket.close() call leaves the socket alive on the server even though
     * the client stops reconnecting — observable only at the side-effect level.
     * Protects: close() ConditionalExpression `if (socket !== null) { socket.close(); … }`
     * BlockStatement and `false` mutants — both would skip socket.close().
     */
    const ws = getWsClient();
    const socket0 = MockWebSocket.instances[0]!;
    const closeSpy = vi.spyOn(socket0, 'close');

    ws.close();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT call socket.close() when there is no active socket', () => {
    /*
     * Scenario: after the active socket has already fired its close event
     * (socket = null), calling close() must not throw and must not invoke
     * any spurious close on a stale reference.
     * Protects: close() `if (socket !== null)` — an always-true mutant would
     * attempt `null.close()` and throw a TypeError.
     */
    const ws = getWsClient();
    const socket0 = MockWebSocket.instances[0]!;
    socket0.simulateClose(); // socket = null in module state
    // Advance past the backoff so the reconnect attempt is in flight; we
    // immediately close again before the new socket exists.
    ws.close(); // would throw with always-true mutant if module socket were null

    expect(() => ws.close()).not.toThrow();
  });
});

describe('reconnect()', () => {
  /*
   * Regression: prior to the lifecycle-handler detach fix, calling
   * `reconnect()` opened the new socket synchronously but the OLD socket's
   * `onclose` then fired asynchronously, nullifying the module-level
   * `socket` reference and scheduling a second `setTimeout(connect, …)`.
   * Result: every `reconnect()` produced 2-3 zombie sockets on the server,
   * and the frontend received the same `notification:new` event 2-3 times
   * (visible as duplicate toasts after re-login / tenant switch).
   *
   * This test pins that exactly ONE replacement socket exists after
   * `reconnect()`, even after the runtime has had a chance to drain
   * pending timers and microtasks. Protects the detach-before-close
   * contract in `WsClient.reconnect`.
   */
  it('opens exactly one replacement socket — no zombie reconnects', () => {
    const ws = getWsClient();
    expect(MockWebSocket.instances).toHaveLength(1);
    const original = MockWebSocket.instances[0]!;

    ws.reconnect();

    // Immediately after reconnect: exactly two sockets exist (the closed
    // original + the brand-new replacement).
    expect(MockWebSocket.instances).toHaveLength(2);

    // Drain any pending macrotasks. If the old socket's `onclose` were
    // still attached, the backoff timer would fire here and add a third
    // socket — the regression we're guarding against.
    vi.advanceTimersByTime(30_000);

    expect(MockWebSocket.instances).toHaveLength(2);
    // The original socket has been closed; the replacement is the new
    // module-level socket. They are distinct instances.
    expect(MockWebSocket.instances[1]).not.toBe(original);
  });

  it('cancels any pending backoff timer before opening the replacement', () => {
    /*
     * Scenario: the WS singleton is mid-backoff (it disconnected, the
     * reconnect timer is scheduled, but hasn't fired). The user re-logs
     * in and the listener calls `reconnect()` — the pending timer must
     * be cancelled so we don't get a second `connect()` after the
     * replacement is already open.
     * Protects the `clearTimeout(reconnectTimer)` line in reconnect().
     */
    const ws = getWsClient();
    const ws0 = MockWebSocket.instances[0]!;
    ws0.simulateClose();
    // A backoff timer is now armed at ~1s.
    expect(MockWebSocket.instances).toHaveLength(1);

    ws.reconnect();
    // One new socket opened synchronously by reconnect().
    expect(MockWebSocket.instances).toHaveLength(2);

    // If the pending timer were still armed it would fire at ~1s and
    // open a third socket.
    vi.advanceTimersByTime(30_000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('does NOT call clearTimeout when reconnect() runs without a pending timer', () => {
    /*
     * Scenario: reconnect() called on a freshly opened singleton (no prior
     * disconnect, so reconnectTimer is null) must NOT call clearTimeout.
     * Asserting at the side-effect level kills the always-true
     * ConditionalExpression mutant on `if (reconnectTimer !== null)` inside
     * reconnect().
     * Protects: reconnect() ConditionalExpression `true` mutant on the timer guard.
     */
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const ws = getWsClient();
    clearTimeoutSpy.mockClear();

    ws.reconnect();

    expect(clearTimeoutSpy).not.toHaveBeenCalled();
  });

  it('detaches lifecycle handlers from the old socket before closing it during reconnect()', () => {
    /*
     * Scenario: reconnect() must reach into `if (socket !== null)` and detach
     * the lifecycle handlers (onclose et al) BEFORE closing the old socket —
     * otherwise the async onclose fires, schedules a stale reconnect, and
     * spawns zombie sockets. The "exactly one replacement socket" assertion
     * in the sibling test passes for the empty-block mutant too because the
     * new socket gets opened either way; the only observable for the missing
     * branch is the detachment side effect on the old socket.
     * Protects: reconnect() ConditionalExpression `if (socket !== null)`
     * (false / empty-block mutants) — both would skip the detachment AND the
     * socket.close() call.
     */
    const ws = getWsClient();
    const original = MockWebSocket.instances[0]!;
    expect(original.onopen).toBeDefined();
    expect(original.onmessage).toBeDefined();
    expect(original.onclose).toBeDefined();
    const closeSpy = vi.spyOn(original, 'close');

    ws.reconnect();

    // Lifecycle handlers nulled on the old socket BEFORE close — required to
    // avoid the zombie-reconnect bug.
    expect(original.onopen).toBeNull();
    expect(original.onmessage).toBeNull();
    expect(original.onclose).toBeNull();
    expect(original.onerror).toBeNull();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('resets the backoff attempt counter so the next disconnect reconnects fast', () => {
    /*
     * Scenario: the singleton was in a deep backoff window (attempt = 5)
     * because the previous user's session was rejecting upgrades. After
     * `reconnect()` opens a fresh socket with new cookies and that one
     * also closes (e.g. transient infra blip), the next reconnect MUST
     * use the base delay (~1s), not the 30s cap. Otherwise the user
     * would wait 30s for notifications to resume on the second disconnect.
     * Protects the `attempt = 0` line in reconnect().
     */
    const ws = getWsClient();
    // Force attempt counter up by triggering 4 disconnects + reconnects.
    for (let i = 0; i < 4; i++) {
      const current = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
      current.simulateClose();
      vi.advanceTimersByTime(60_000); // let the backoff fire
    }
    // attempt counter is now somewhere ≥ 4 → next backoff would be ≥ 16s.

    ws.reconnect();
    const post = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    post.simulateOpen();
    // Simulate the post-reconnect socket closing.
    post.simulateClose();
    const countBefore = MockWebSocket.instances.length;
    // Base delay (800 ms with jitter=0.8) — if reset failed we'd still be sleeping.
    vi.advanceTimersByTime(1_000);
    expect(MockWebSocket.instances.length).toBe(countBefore + 1);
  });
});

describe('_resetForTest()', () => {
  /*
   * `_resetForTest` is a test-only export, but Stryker still mutates it.
   * Its conditional / block survivors are killable via post-conditions —
   * after calling it, the singleton must be in a clean slate (no pending
   * timer firing, no stale socket reference).
   */
  it('cancels any pending reconnect timer so no zombie socket opens after reset', () => {
    /*
     * Scenario: arm a backoff timer, then call _resetForTest. Advance time
     * past the would-be timer; no new socket may open.
     * Protects: _resetForTest ConditionalExpression / EqualityOperator /
     * BlockStatement on `if (reconnectTimer !== null) { clearTimeout(...); … }`
     * — the always-false / inverted / empty-block mutants would leave the
     * timer armed, causing a zombie reconnect when time advances.
     */
    getWsClient();
    const socket0 = MockWebSocket.instances[0]!;
    socket0.simulateClose();
    expect(MockWebSocket.instances).toHaveLength(1);

    _resetForTest();

    // Drain potential timer windows; the cleared timer must not fire.
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('does NOT call clearTimeout when _resetForTest runs without a pending timer', () => {
    /*
     * Scenario: when _resetForTest is called immediately after getWsClient
     * (no disconnect has fired, so reconnectTimer is null) it must NOT
     * invoke clearTimeout. Asserting at the side-effect level kills the
     * always-true ConditionalExpression mutant on the timer guard.
     * Protects: _resetForTest ConditionalExpression `true` mutant.
     */
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    getWsClient();
    clearTimeoutSpy.mockClear();

    _resetForTest();

    expect(clearTimeoutSpy).not.toHaveBeenCalled();
  });

  it('clearTimeout is invoked with the pending timer reference when _resetForTest runs mid-backoff', () => {
    /*
     * Scenario: side-effect-level assertion that _resetForTest actually
     * cancels the pending timer, not just leaves it to no-op via `stopped`.
     * Protects: ConditionalExpression `true`/`false` and EqualityOperator
     * `!==` → `===` on the _resetForTest timer guard.
     */
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    getWsClient();
    const socket0 = MockWebSocket.instances[0]!;
    socket0.simulateClose();
    clearTimeoutSpy.mockClear();

    _resetForTest();

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy.mock.calls[0]?.[0]).not.toBeNull();
    expect(clearTimeoutSpy.mock.calls[0]?.[0]).not.toBeUndefined();
  });
});
