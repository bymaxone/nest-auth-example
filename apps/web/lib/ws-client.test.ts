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
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  // Remove jitter so backoff values are deterministic: 0.8 + 0.5 * 0.4 = 1.0.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
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
  it('reconnects after ~1 s on first disconnect (attempt 0)', () => {
    /*
     * Scenario: when the WS closes for the first time the reconnect delay must
     * be min(1000 * 2^0, 30000) = 1 000 ms (jitter = 1.0 with mocked random).
     * Protects: P16-1 — exponential backoff formula, first interval.
     */
    getWsClient();
    const ws0 = MockWebSocket.instances[0]!;
    ws0.simulateClose();

    // Not yet reconnected — timer hasn't fired.
    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('reconnects after ~2 s on second disconnect (attempt 1)', () => {
    /*
     * Scenario: second disconnect → delay = min(1000 * 2^1, 30000) = 2 000 ms.
     * Protects: P16-1 — exponential backoff, doubling on each failure.
     */
    getWsClient();
    const ws0 = MockWebSocket.instances[0]!;
    ws0.simulateClose();
    vi.advanceTimersByTime(1000); // reconnect #1

    const ws1 = MockWebSocket.instances[1]!;
    ws1.simulateClose();
    vi.advanceTimersByTime(1000); // not yet
    expect(MockWebSocket.instances).toHaveLength(2);

    vi.advanceTimersByTime(1000); // +2 000 ms total → reconnect #2
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it('caps the backoff at 30 s after enough failures', () => {
    /*
     * Scenario: after 5+ failures the backoff must not exceed 30 000 ms
     * (min(1000 * 2^5, 30000) = 30 000 ms).
     * Protects: P16-1 — 30 s cap prevents extreme delays.
     */
    getWsClient();

    // Simulate 5 consecutive disconnects.
    // Delays: 1 000, 2 000, 4 000, 8 000, 16 000 ms.
    const delays = [1000, 2000, 4000, 8000, 16_000];
    for (const delay of delays) {
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
      ws.simulateClose();
      vi.advanceTimersByTime(delay);
    }

    // 6th disconnect → delay should be capped at 30 000 ms.
    const ws5 = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    ws5.simulateClose();

    const countBefore = MockWebSocket.instances.length;
    vi.advanceTimersByTime(29_999);
    expect(MockWebSocket.instances).toHaveLength(countBefore); // not yet

    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(countBefore + 1); // reconnected at 30 000 ms
  });

  it('resets the attempt counter to 0 on successful open', () => {
    /*
     * Scenario: after a successful reconnect (onopen fires) the next disconnect
     * should start the backoff sequence over from 1 000 ms, not continue doubling.
     * Protects: P16-1 — attempt reset on open preserves gentle reconnect behaviour.
     */
    getWsClient();
    const ws0 = MockWebSocket.instances[0]!;
    ws0.simulateClose();
    vi.advanceTimersByTime(1000); // reconnect attempt 1

    // Simulate a successful open — this resets the attempt counter.
    const ws1 = MockWebSocket.instances[1]!;
    ws1.simulateOpen();

    // Disconnect again — backoff should restart from 1 000 ms (not 2 000 ms).
    ws1.simulateClose();
    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(2); // not yet

    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3); // reconnected at 1 000 ms
  });
});

describe('close()', () => {
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
});
