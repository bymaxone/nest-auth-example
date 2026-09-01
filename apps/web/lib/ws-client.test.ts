/**
 * @fileoverview Unit tests for the `ws-client` module.
 *
 * Verifies:
 * - Singleton is created on first `getWsClient()` call.
 * - A single-use upgrade ticket is minted via `POST /api/auth/ws-ticket` and
 *   appended (URL-encoded) as `?ticket=` on the WS URL; mint failures fall
 *   back to the cookie-authenticated upgrade path (no query string).
 * - The `connectSeq` guard collapses rapid overlapping `connect()` triggers
 *   into a single socket, and `close()` aborts an in-flight mint.
 * - Reconnect backoff sequence: 1 s, 2 s, 4 s, …, capped at 30 s.
 * - Backoff resets to 0 on a successful `open` event.
 * - `close()` stops all reconnect attempts permanently.
 * - `on`/`off` route `notification:new` events to registered handlers.
 *
 * Uses fake timers, a stubbed global `fetch` (the ticket mint), and a minimal
 * `WebSocket` mock to control time and simulate connect/disconnect without a
 * real network. Because `connect()` now performs an async ticket mint before
 * opening the socket, tests drain the microtask queue (`flushMintMicrotasks`)
 * after every trigger — a bare `vi.advanceTimersByTime` is no longer enough.
 *
 * @module lib/ws-client.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getWsClient, _resetForTest } from './ws-client.js';
import type { NotificationHandler, WsClient } from './ws-client.js';

// ── WebSocket mock ────────────────────────────────────────────────────────────

/** Minimal WebSocket mock that captures lifecycle callbacks for test control. */
class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = 1; // OPEN by default to avoid triggering onopen logic in some paths
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
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

  /**
   * Test helper — fires the close callback.
   *
   * A real `WebSocket` always hands `onclose` a `CloseEvent`, and the client
   * branches on its code, so the double supplies one. 1006 (abnormal closure)
   * is the transport-level default that should reconnect; pass 4401/4403 to
   * model the gateway refusing the credential.
   *
   * @param code - Close code to report.
   */
  simulateClose(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
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

// ── Fetch (ticket mint) stub ──────────────────────────────────────────────────

/** Spy standing in for the global `fetch` used by the ticket mint. */
const mockFetch = vi.fn<typeof fetch>();

/**
 * Configures the mint stub to succeed with the given ticket.
 *
 * @param ticket - Ticket string the fake `/api/auth/ws-ticket` route returns.
 */
function mintSucceedsWith(ticket: string): void {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ ticket, expiresIn: 30 }),
  } as unknown as Response);
}

/**
 * Drains the microtask queue so the async ticket mint inside `connect()`
 * settles and `openSocket` runs. Ten ticks deterministically cover the
 * `fetch → response.json() → .then` chain regardless of fake timers.
 */
async function flushMintMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

/**
 * Calls `getWsClient()` and waits for the in-flight ticket mint so the
 * WebSocket exists before the test proceeds — the async replacement for the
 * previous synchronous "getWsClient() opens the socket" contract.
 *
 * @returns The singleton client, with `MockWebSocket.instances[0]` populated.
 */
async function getConnectedClient(): Promise<WsClient> {
  const ws = getWsClient();
  await flushMintMicrotasks();
  return ws;
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
  mockFetch.mockReset();
  mintSucceedsWith('tkt-1');
  vi.stubGlobal('fetch', mockFetch);
  process.env['NEXT_PUBLIC_WS_URL'] = 'ws://localhost:3000';
  _resetForTest();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env['NEXT_PUBLIC_WS_URL'];
  _resetForTest();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getWsClient', () => {
  it('opens a WebSocket to the configured URL with the minted ticket on first call', async () => {
    /*
     * Scenario: calling getWsClient() for the first time must mint a ticket
     * via POST /api/auth/ws-ticket and open exactly one WebSocket to
     * `${NEXT_PUBLIC_WS_URL}/ws/notifications?ticket=<ticket>`.
     * Protects: lazy singleton creation + the ticket-first upgrade path.
     */
    getWsClient();
    await flushMintMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]!.url).toBe(
      'ws://localhost:3000/ws/notifications?ticket=tkt-1',
    );
  });

  it('mints the ticket with a same-origin credentialed POST to the library route', async () => {
    /*
     * Scenario: the mint call must be a plain same-origin fetch to
     * POST /api/auth/ws-ticket with credentials included — the HttpOnly auth
     * cookies are the mint call's authentication.
     * Protects: fetchWsTicket's request contract.
     */
    getWsClient();
    await flushMintMicrotasks();

    expect(mockFetch).toHaveBeenCalledWith('/api/auth/ws-ticket', {
      method: 'POST',
      credentials: 'include',
    });
  });

  it('returns the same instance on subsequent calls', async () => {
    /*
     * Scenario: multiple `getWsClient()` calls must return the same object and
     * must not open duplicate connections once a socket exists.
     * Protects: module-level singleton, one connection per page load.
     */
    const first = await getConnectedClient();
    const second = getWsClient();
    await flushMintMicrotasks();

    expect(first).toBe(second);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

describe('ticket mint outcomes', () => {
  it('URL-encodes the ticket before appending it as the ?ticket= query param', async () => {
    /*
     * Scenario: tickets are opaque strings — a value containing reserved URL
     * characters must arrive percent-encoded, otherwise the gateway would
     * parse a truncated ticket and reject the upgrade.
     * Protects: the `encodeURIComponent(ticket)` call in connect().
     */
    mintSucceedsWith('tkt/1+2 3');
    getWsClient();
    await flushMintMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]!.url).toBe(
      `ws://localhost:3000/ws/notifications?ticket=${encodeURIComponent('tkt/1+2 3')}`,
    );
  });

  it('falls back to the cookie path (no query string) when the mint fetch rejects', async () => {
    /*
     * Scenario: the mint request fails at the network level (offline,
     * session mid-refresh). The client must still open the socket WITHOUT a
     * ticket so the gateway can fall back to the `access_token` cookie
     * forwarded through the same-origin proxy.
     * Protects: fetchWsTicket's catch → null → empty-query branch.
     */
    mockFetch.mockRejectedValue(new Error('network down'));
    getWsClient();
    await flushMintMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]!.url).toBe('ws://localhost:3000/ws/notifications');
  });

  it('falls back to the cookie path when the mint responds non-2xx', async () => {
    /*
     * Scenario: the mint route answers but refuses (e.g. 401 while the
     * refresh rotation is settling). `ok: false` must yield a ticket-less
     * upgrade, not a thrown error or an aborted connection.
     * Protects: the `if (!response.ok) return null` branch of fetchWsTicket.
     */
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    } as unknown as Response);
    getWsClient();
    await flushMintMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]!.url).toBe('ws://localhost:3000/ws/notifications');
  });

  it('falls back to the cookie path when the mint responds with an empty ticket', async () => {
    /*
     * Scenario: a malformed mint body (empty ticket string) must be treated
     * as a failed mint — an empty `?ticket=` query would make the gateway
     * reject the upgrade instead of falling back to cookies.
     * Protects: the non-empty-string ticket validation in fetchWsTicket.
     */
    mintSucceedsWith('');
    getWsClient();
    await flushMintMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]!.url).toBe('ws://localhost:3000/ws/notifications');
  });
});

describe('connectSeq guard', () => {
  it('does NOT open a socket when close() lands while the mint is in flight', async () => {
    /*
     * Scenario: the user signs out immediately after the page triggered a
     * connection — `close()` runs while the ticket mint is still pending.
     * The `.then` guard must observe `stopped === true` and abort, otherwise
     * a zombie socket would open against an endpoint that will reject it.
     * Protects: the `stopped` clause of the in-flight mint guard.
     */
    const ws = getWsClient(); // mint in flight
    ws.close(); // lands before the mint resolves
    await flushMintMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('opens only ONE socket when two connect() triggers race (getWsClient + reconnect)', async () => {
    /*
     * Scenario: `getWsClient()` starts a mint and, before it settles, a
     * sign-in listener calls `reconnect()` (a second `connect()`). The
     * sequence counter must invalidate the first in-flight mint so exactly
     * one socket opens — without the guard the user would receive every
     * notification twice.
     * Protects: the `seq !== connectSeq` clause of the in-flight mint guard.
     */
    const ws = getWsClient(); // first mint in flight
    ws.reconnect(); // second connect() bumps connectSeq
    await flushMintMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('opens only ONE socket when getWsClient() is called twice before the mint settles', async () => {
    /*
     * Scenario: two components call `getWsClient()` in the same render pass.
     * Both observe `socket === null` and trigger `connect()`; the seq guard
     * must collapse the pair into a single opened socket.
     * Protects: rapid double-trigger de-duplication via connectSeq.
     */
    getWsClient();
    getWsClient();
    await flushMintMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('does not trigger a second connect() once a socket is already open', async () => {
    /*
     * Scenario: after the first connect() settled and the socket exists,
     * another `getWsClient()` call must not mint again or open a second
     * socket — the singleton invariant holds across the async hop.
     * Protects: the `socket === null` gate in getWsClient combined with the
     * defensive `socket !== null` clause of the in-flight mint guard.
     */
    getWsClient();
    await flushMintMicrotasks(); // socket open
    getWsClient(); // socket !== null → connect() not even triggered
    await flushMintMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

describe('revoked credentials are terminal', () => {
  it('stops reconnecting when the gateway refuses the credential', async () => {
    /*
     * Scenario: another device is signed out through sign-out-everywhere, or
     * an admin resets its MFA. The gateway closes the socket with 4401. The
     * upgrade itself succeeded first, so `onopen` already reset the attempt
     * counter — a reconnect loop here would sit at the backoff floor, issuing
     * a ticket request and a rejected upgrade about once a second for as long
     * as the tab stays open.
     * Protects: the 4401 branch in onclose. Without it the client schedules a
     * reconnect and the socket count grows.
     */
    const client = await getConnectedClient();
    expect(MockWebSocket.instances).toHaveLength(1);

    MockWebSocket.instances[0]?.simulateClose(4401);
    await vi.advanceTimersByTimeAsync(60_000);
    await flushMintMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(client).toBeDefined();
  });

  it('stops reconnecting when the account is suspended', async () => {
    /*
     * Scenario: the 4403 half of the same rule — a suspended account cannot
     * reconnect its way back in either.
     * Protects: 4403 being in the terminal set, not just 4401.
     */
    await getConnectedClient();

    MockWebSocket.instances[0]?.simulateClose(4403);
    await vi.advanceTimersByTimeAsync(60_000);
    await flushMintMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('still reconnects after an ordinary transport close', async () => {
    /*
     * Scenario: the mirror case. A dropped connection is not an authorisation
     * failure, and treating every close as terminal would leave users without
     * notifications after any network blip.
     * Protects: the terminal branch is scoped to the auth codes.
     */
    await getConnectedClient();

    MockWebSocket.instances[0]?.simulateClose(1006);
    await vi.advanceTimersByTimeAsync(60_000);
    await flushMintMicrotasks();

    expect(MockWebSocket.instances.length).toBeGreaterThan(1);
  });

  it('does not open a socket at all when the ticket mint is refused', async () => {
    /*
     * Scenario: the mint returns 401 because the credential is already gone.
     * Falling back to a cookie-authenticated upgrade would present that same
     * revoked token, so the gateway refuses it and the loop starts one layer
     * earlier. Nothing should be opened.
     * Protects: the `unauthenticated` branch in connect().
     */
    mockFetch.mockResolvedValue({ ok: false, status: 401 } as unknown as Response);

    getWsClient();
    await flushMintMicrotasks();
    await vi.advanceTimersByTimeAsync(60_000);
    await flushMintMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('falls back to a cookie upgrade when the mint fails for a non-auth reason', async () => {
    /*
     * Scenario: a 500 or a network blip says nothing about the credential, so
     * the cookie-authenticated upgrade is still worth attempting — collapsing
     * every failure into "terminal" would drop notifications on a server
     * hiccup.
     * Protects: `unavailable` staying non-terminal.
     */
    mockFetch.mockResolvedValue({ ok: false, status: 500 } as unknown as Response);

    getWsClient();
    await flushMintMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.url).not.toContain('ticket=');
  });
});

describe('reconnect backoff', () => {
  it('reconnects after exactly 1200 ms on first disconnect when jitter is at its MAX value (random=1)', async () => {
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
    await getConnectedClient();
    const ws0 = MockWebSocket.instances[0]!;
    ws0.simulateClose();

    expect(MockWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1199);
    expect(MockWebSocket.instances).toHaveLength(1); // not yet

    await vi.advanceTimersByTimeAsync(1); // +1 ms → exactly 1200 ms total
    await flushMintMicrotasks();
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('reconnects after exactly 800 ms on first disconnect (attempt 0, jitter min)', async () => {
    /*
     * Scenario: with Math.random pinned to 0 the jitter factor is 0.8, so the
     * first reconnect delay is `min(1000 * 2^0, 30000) * 0.8 = 800 ms`.
     * Asserting BOTH "not at 799 ms" AND "yes at 800 ms" pins the exact
     * product — kills the ArithmeticOperator mutant `base * 0.8` → `base / 0.8`
     * which would yield 1250 ms instead.
     * Protects: exponential backoff formula AND the multiplicative
     * application of the jitter factor.
     */
    await getConnectedClient();
    const ws0 = MockWebSocket.instances[0]!;
    ws0.simulateClose();

    expect(MockWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(799);
    expect(MockWebSocket.instances).toHaveLength(1); // not yet

    await vi.advanceTimersByTimeAsync(1); // +1 ms → exactly 800 ms total
    await flushMintMicrotasks();
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('reconnects after exactly 1600 ms on second disconnect (attempt 1)', async () => {
    /*
     * Scenario: second disconnect → base = 1000 * 2^1 = 2000 ms, jitter factor
     * 0.8 → delay = 1600 ms.
     * Protects: exponential backoff doubling on each failure.
     */
    await getConnectedClient();
    const ws0 = MockWebSocket.instances[0]!;
    ws0.simulateClose();
    await vi.advanceTimersByTimeAsync(800); // reconnect #1 at 800 ms
    await flushMintMicrotasks();

    const ws1 = MockWebSocket.instances[1]!;
    ws1.simulateClose();
    await vi.advanceTimersByTimeAsync(1599);
    expect(MockWebSocket.instances).toHaveLength(2); // not yet

    await vi.advanceTimersByTimeAsync(1); // +1 ms → exactly 1600 ms after second disconnect
    await flushMintMicrotasks();
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it('caps the backoff base at 30 000 ms after enough failures', async () => {
    /*
     * Scenario: after enough failures the underlying `base` must cap at
     * 30 000 ms → with jitter factor 0.8 the actual delay is 24 000 ms.
     * Protects: 30 s cap on the base prevents extreme delays.
     */
    await getConnectedClient();

    // Push through 5 attempts so attempt counter ends at 5.
    // Delays (each = base * 0.8): 800, 1600, 3200, 6400, 12800.
    const delays = [800, 1600, 3200, 6400, 12_800];
    for (const delay of delays) {
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
      ws.simulateClose();
      await vi.advanceTimersByTimeAsync(delay);
      await flushMintMicrotasks();
    }

    // 6th disconnect → base capped at 30 000 ms → delay = 24 000 ms.
    const ws5 = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    ws5.simulateClose();

    const countBefore = MockWebSocket.instances.length;
    await vi.advanceTimersByTimeAsync(23_999);
    expect(MockWebSocket.instances).toHaveLength(countBefore); // not yet

    await vi.advanceTimersByTimeAsync(1);
    await flushMintMicrotasks();
    expect(MockWebSocket.instances).toHaveLength(countBefore + 1); // at 24 000 ms
  });

  it('resets the attempt counter to 0 on successful open', async () => {
    /*
     * Scenario: after a successful reconnect (onopen fires) the next disconnect
     * must restart the backoff sequence from the base delay, not continue
     * doubling.
     * Protects: attempt reset on open preserves gentle reconnect.
     */
    await getConnectedClient();
    const ws0 = MockWebSocket.instances[0]!;
    ws0.simulateClose();
    await vi.advanceTimersByTimeAsync(800); // reconnect attempt 1 at 800 ms
    await flushMintMicrotasks();

    const ws1 = MockWebSocket.instances[1]!;
    ws1.simulateOpen();

    // Disconnect again — backoff must restart from 800 ms (not 1600 ms).
    ws1.simulateClose();
    await vi.advanceTimersByTimeAsync(799);
    expect(MockWebSocket.instances).toHaveLength(2); // not yet

    await vi.advanceTimersByTimeAsync(1);
    await flushMintMicrotasks();
    expect(MockWebSocket.instances).toHaveLength(3); // reconnected at 800 ms
  });
});

describe('close()', () => {
  it('does NOT schedule a reconnect timer after close() — even when the socket later closes', async () => {
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
    const ws = await getConnectedClient();
    const socket0 = MockWebSocket.instances[0]!;
    ws.close();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    socket0.simulateClose();

    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('stops reconnect attempts permanently after close()', async () => {
    /*
     * Scenario: calling close() must prevent any further reconnect even after
     * the current socket disconnects.
     * Protects: close() used on sign-out to stop the backoff loop.
     */
    const ws = await getConnectedClient();
    const socket0 = MockWebSocket.instances[0]!;
    ws.close();
    socket0.simulateClose();

    await vi.advanceTimersByTimeAsync(60_000); // well beyond any backoff
    await flushMintMicrotasks();
    expect(MockWebSocket.instances).toHaveLength(1); // no new socket opened
  });
});

describe('on / off event emitter', () => {
  it('delivers notification:new events to all registered handlers', async () => {
    /*
     * Scenario: handlers registered via on('notification:new', fn) receive
     * the parsed payload when the gateway sends a matching message.
     * Protects: event emitter dispatches to all subscribers.
     */
    const ws = await getConnectedClient();
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

  it('off() does NOT throw when called for an event that was never registered', async () => {
    /*
     * Scenario: calling `ws.off('notification:new', handler)` when no handler
     * has ever been registered (so listeners.get(eventName) is undefined)
     * must be a safe no-op — not a TypeError.
     * Protects: OptionalChaining mutant `listeners.get(eventName)?.delete(...)`
     * → `listeners.get(eventName).delete(...)` — without the `?.`, this would
     * throw `Cannot read properties of undefined (reading 'delete')`.
     */
    const ws = await getConnectedClient();
    const handler = vi.fn<NotificationHandler>();

    expect(() => ws.off('notification:new', handler)).not.toThrow();
  });

  it('stops delivering events to a handler after off() is called', async () => {
    /*
     * Scenario: calling off() with a handler reference removes only that handler;
     * other handlers for the same event continue to receive messages.
     * Protects: off() cleanup used on component unmount.
     */
    const ws = await getConnectedClient();
    const handler = vi.fn<NotificationHandler>();

    ws.on('notification:new', handler);
    ws.off('notification:new', handler);

    MockWebSocket.instances[0]!.simulateMessage({
      event: 'notification:new',
      data: { title: 'Hi', body: 'Test' },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('silently ignores unknown events', async () => {
    /*
     * Scenario: messages with an unrecognised event name must not throw or
     * deliver to notification:new handlers.
     * Protects: robustness against unexpected gateway messages.
     */
    const ws = await getConnectedClient();
    const handler = vi.fn<NotificationHandler>();
    ws.on('notification:new', handler);

    MockWebSocket.instances[0]!.simulateMessage({
      event: 'unknown:event',
      data: { title: 'Should not appear', body: '' },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not dispatch notification:new when the payload is missing the title field', async () => {
    /*
     * Scenario: the gateway sends a `notification:new` event whose data object
     * is missing `title`. The runtime guard in `dispatch` must reject the payload
     * and not invoke any handlers (the early return inside the guard).
     * Protects: malformed payloads must not reach toast handlers.
     */
    const ws = await getConnectedClient();
    const handler = vi.fn<NotificationHandler>();
    ws.on('notification:new', handler);

    MockWebSocket.instances[0]!.simulateMessage({
      event: 'notification:new',
      data: { body: 'Missing title field' },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not dispatch notification:new when the payload is missing the body field', async () => {
    /*
     * Scenario: the gateway sends a `notification:new` event whose data object
     * is missing `body`. The runtime guard must reject it and not invoke handlers.
     * Protects: incomplete payloads must not reach toast handlers.
     */
    const ws = await getConnectedClient();
    const handler = vi.fn<NotificationHandler>();
    ws.on('notification:new', handler);

    MockWebSocket.instances[0]!.simulateMessage({
      event: 'notification:new',
      data: { title: 'Missing body' },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not dispatch notification:new when the payload data is null', async () => {
    /*
     * Scenario: the gateway sends `notification:new` with `data: null` — the
     * null-check in the runtime guard must reject it before dispatching.
     * Protects: null data must not reach toast handlers.
     */
    const ws = await getConnectedClient();
    const handler = vi.fn<NotificationHandler>();
    ws.on('notification:new', handler);

    MockWebSocket.instances[0]!.simulateMessage({
      event: 'notification:new',
      data: null,
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not dispatch notification:new when the payload data is a primitive', async () => {
    /*
     * Scenario: the gateway sends `notification:new` with `data: "string"` — a
     * non-object value. The `typeof data !== 'object'` check must reject it.
     * Protects: primitive data values must not reach toast handlers.
     */
    const ws = await getConnectedClient();
    const handler = vi.fn<NotificationHandler>();
    ws.on('notification:new', handler);

    MockWebSocket.instances[0]!.simulateMessage({
      event: 'notification:new',
      data: 'not-an-object',
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not throw when an individual handler throws', async () => {
    /*
     * Scenario: a registered handler that throws must not propagate the error
     * or prevent subsequent handlers from executing. The try-catch inside the
     * dispatch loop must absorb the exception.
     * Protects: individual handler errors must not crash the event loop.
     */
    const ws = await getConnectedClient();
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
  it('does not open a WebSocket when WebSocket is not defined (server-side guard)', async () => {
    /*
     * Scenario: connect() must no-op when `typeof WebSocket === 'undefined'` to
     * prevent crashes in server-side rendering contexts where the WebSocket API
     * is absent — including skipping the ticket mint entirely.
     * Protects: the `typeof WebSocket === 'undefined'` early return branch.
     */
    // Remove the global WebSocket to simulate a server-side environment.
    vi.stubGlobal('WebSocket', undefined);
    getWsClient();
    await flushMintMicrotasks();
    // No socket should have been opened, and no mint attempted.
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
    // Restore for subsequent tests.
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  it('does not dispatch when the gateway message event field is not a string', async () => {
    /*
     * Scenario: a gateway message whose `event` field is not a string (e.g. a
     * number) must not invoke any handlers.
     * Protects: `if (typeof msg.event === 'string')` false branch.
     */
    const ws = await getConnectedClient();
    const handler = vi.fn<NotificationHandler>();
    ws.on('notification:new', handler);

    // Directly invoke onmessage with a message where event is a number.
    const socket0 = MockWebSocket.instances[0]!;
    socket0.onmessage?.({ data: JSON.stringify({ event: 42, data: {} }) });

    expect(handler).not.toHaveBeenCalled();
  });

  it('silently ignores malformed (non-JSON) gateway messages', async () => {
    /*
     * Scenario: receiving a non-JSON string from the gateway must not throw or
     * invoke any handlers — the catch block discards the parse error.
     * Protects: catch block inside onmessage discards malformed data.
     */
    const ws = await getConnectedClient();
    const handler = vi.fn<NotificationHandler>();
    ws.on('notification:new', handler);

    const socket0 = MockWebSocket.instances[0]!;
    // Send invalid JSON — this must not throw.
    expect(() => {
      socket0.simulateRawMessage('not valid json }{');
    }).not.toThrow();

    expect(handler).not.toHaveBeenCalled();
  });

  it('onerror callback fires without throwing', async () => {
    /*
     * Scenario: the onerror callback must be a no-op function that does not
     * throw — errors are handled in onclose to prevent double-scheduling.
     * Protects: onerror callback function body.
     */
    await getConnectedClient();
    const socket0 = MockWebSocket.instances[0]!;
    // Firing onerror must not throw.
    expect(() => {
      socket0.simulateError();
    }).not.toThrow();
  });
});

describe('connect() with missing NEXT_PUBLIC_WS_URL', () => {
  it('uses empty string as the base URL when NEXT_PUBLIC_WS_URL is not set', async () => {
    /*
     * Scenario: when `NEXT_PUBLIC_WS_URL` is absent from the environment the
     * `?? ''` fallback fires, resulting in a same-origin WebSocket URL of
     * `'/ws/notifications?ticket=…'`.
     * Protects: `process.env['NEXT_PUBLIC_WS_URL'] ?? ''` null-coalescing branch.
     */
    // Remove the env var to trigger the fallback branch.
    delete process.env['NEXT_PUBLIC_WS_URL'];
    getWsClient();
    await flushMintMicrotasks();
    expect(MockWebSocket.instances).toHaveLength(1);
    // URL should be /ws/notifications?ticket=… (empty string base).
    expect(MockWebSocket.instances[0]!.url).toBe('/ws/notifications?ticket=tkt-1');
  });
});

describe('close() with pending reconnect timer', () => {
  it('cancels the pending reconnect timer when close() is called during backoff', async () => {
    /*
     * Scenario: close() is called while a reconnect timer is active (i.e., after
     * a disconnect and before the backoff delay fires). close() must call
     * clearTimeout and set reconnectTimer to null, preventing any future
     * reconnect attempt even after the timer would have elapsed.
     * Protects: close() permanently stops reconnects even mid-backoff.
     */
    const ws = await getConnectedClient();
    const socket0 = MockWebSocket.instances[0]!;

    // Trigger a disconnect so a reconnect timer is scheduled.
    socket0.simulateClose();

    // At this point the reconnect timer is armed but has not fired.
    expect(MockWebSocket.instances).toHaveLength(1);

    // Call close() to cancel the timer.
    ws.close();

    // Advance time well past the backoff window — no new socket should open.
    await vi.advanceTimersByTimeAsync(60_000);
    await flushMintMicrotasks();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('clearTimeout is invoked with the pending timer reference when close() runs mid-backoff', async () => {
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
    const ws = await getConnectedClient();
    const socket0 = MockWebSocket.instances[0]!;
    socket0.simulateClose();
    clearTimeoutSpy.mockClear();

    ws.close();

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy.mock.calls[0]?.[0]).not.toBeNull();
    expect(clearTimeoutSpy.mock.calls[0]?.[0]).not.toBeUndefined();
  });

  it('does NOT call clearTimeout when close() runs without a pending timer', async () => {
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
    const ws = await getConnectedClient();
    clearTimeoutSpy.mockClear();

    ws.close();

    expect(clearTimeoutSpy).not.toHaveBeenCalled();
  });

  it('closes the active socket via socket.close() when close() is called', async () => {
    /*
     * Scenario: spy on the socket's close() method to assert close() actually
     * tears down the live connection. With `stopped=true` set first, a missing
     * socket.close() call leaves the socket alive on the server even though
     * the client stops reconnecting — observable only at the side-effect level.
     * Protects: close() ConditionalExpression `if (socket !== null) { socket.close(); … }`
     * BlockStatement and `false` mutants — both would skip socket.close().
     */
    const ws = await getConnectedClient();
    const socket0 = MockWebSocket.instances[0]!;
    const closeSpy = vi.spyOn(socket0, 'close');

    ws.close();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT call socket.close() when there is no active socket', async () => {
    /*
     * Scenario: after the active socket has already fired its close event
     * (socket = null), calling close() must not throw and must not invoke
     * any spurious close on a stale reference.
     * Protects: close() `if (socket !== null)` — an always-true mutant would
     * attempt `null.close()` and throw a TypeError.
     */
    const ws = await getConnectedClient();
    const socket0 = MockWebSocket.instances[0]!;
    socket0.simulateClose(); // socket = null in module state
    // The reconnect timer is armed but has not fired; we close before the
    // replacement socket exists.
    ws.close(); // would throw with always-true mutant if module socket were null

    expect(() => ws.close()).not.toThrow();
  });
});

describe('reconnect()', () => {
  /*
   * Regression: prior to the lifecycle-handler detach fix, calling
   * `reconnect()` opened the new socket but the OLD socket's `onclose` then
   * fired asynchronously, nullifying the module-level `socket` reference and
   * scheduling a second `setTimeout(connect, …)`. Result: every `reconnect()`
   * produced 2-3 zombie sockets on the server, and the frontend received the
   * same `notification:new` event 2-3 times (visible as duplicate toasts
   * after re-login / tenant switch).
   *
   * This test pins that exactly ONE replacement socket exists after
   * `reconnect()`, even after the runtime has had a chance to drain
   * pending timers and microtasks. Protects the detach-before-close
   * contract in `WsClient.reconnect`.
   */
  it('opens exactly one replacement socket — no zombie reconnects', async () => {
    const ws = await getConnectedClient();
    expect(MockWebSocket.instances).toHaveLength(1);
    const original = MockWebSocket.instances[0]!;

    ws.reconnect();
    await flushMintMicrotasks();

    // After the replacement mint settles: exactly two sockets exist (the
    // closed original + the brand-new replacement).
    expect(MockWebSocket.instances).toHaveLength(2);

    // Drain any pending macrotasks. If the old socket's `onclose` were
    // still attached, the backoff timer would fire here and add a third
    // socket — the regression we're guarding against.
    await vi.advanceTimersByTimeAsync(30_000);
    await flushMintMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(2);
    // The original socket has been closed; the replacement is the new
    // module-level socket. They are distinct instances.
    expect(MockWebSocket.instances[1]).not.toBe(original);
  });

  it('cancels any pending backoff timer before opening the replacement', async () => {
    /*
     * Scenario: the WS singleton is mid-backoff (it disconnected, the
     * reconnect timer is scheduled, but hasn't fired). The user re-logs
     * in and the listener calls `reconnect()` — the pending timer must
     * be cancelled so we don't get a second `connect()` after the
     * replacement is already open.
     * Protects the `clearTimeout(reconnectTimer)` line in reconnect().
     */
    const ws = await getConnectedClient();
    const ws0 = MockWebSocket.instances[0]!;
    ws0.simulateClose();
    // A backoff timer is now armed at ~1s.
    expect(MockWebSocket.instances).toHaveLength(1);

    ws.reconnect();
    await flushMintMicrotasks();
    // One new socket opened by reconnect() once its mint settled.
    expect(MockWebSocket.instances).toHaveLength(2);

    // If the pending timer were still armed it would fire at ~1s and
    // open a third socket.
    await vi.advanceTimersByTimeAsync(30_000);
    await flushMintMicrotasks();
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('does NOT call clearTimeout when reconnect() runs without a pending timer', async () => {
    /*
     * Scenario: reconnect() called on a freshly opened singleton (no prior
     * disconnect, so reconnectTimer is null) must NOT call clearTimeout.
     * Asserting at the side-effect level kills the always-true
     * ConditionalExpression mutant on `if (reconnectTimer !== null)` inside
     * reconnect().
     * Protects: reconnect() ConditionalExpression `true` mutant on the timer guard.
     */
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const ws = await getConnectedClient();
    clearTimeoutSpy.mockClear();

    ws.reconnect();
    await flushMintMicrotasks();

    expect(clearTimeoutSpy).not.toHaveBeenCalled();
  });

  it('detaches lifecycle handlers from the old socket before closing it during reconnect()', async () => {
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
    const ws = await getConnectedClient();
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

  it('resets the backoff attempt counter so the next disconnect reconnects fast', async () => {
    /*
     * Scenario: the singleton was in a deep backoff window (attempt = 5)
     * because the previous user's session was rejecting upgrades. After
     * `reconnect()` opens a fresh socket with new cookies and that one
     * also closes (e.g. transient infra blip), the next reconnect MUST
     * use the base delay (~1s), not the 30s cap. Otherwise the user
     * would wait 30s for notifications to resume on the second disconnect.
     * Protects the `attempt = 0` line in reconnect().
     */
    const ws = await getConnectedClient();
    // Force attempt counter up by triggering 4 disconnects + reconnects.
    for (let i = 0; i < 4; i++) {
      const current = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
      current.simulateClose();
      await vi.advanceTimersByTimeAsync(60_000); // let the backoff fire
      await flushMintMicrotasks();
    }
    // attempt counter is now somewhere ≥ 4 → next backoff would be ≥ 16s.

    ws.reconnect();
    await flushMintMicrotasks();
    const post = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    post.simulateOpen();
    // Simulate the post-reconnect socket closing.
    post.simulateClose();
    const countBefore = MockWebSocket.instances.length;
    // Base delay (800 ms with jitter=0.8) — if reset failed we'd still be sleeping.
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMintMicrotasks();
    expect(MockWebSocket.instances.length).toBe(countBefore + 1);
  });
});

describe('_resetForTest()', () => {
  /*
   * `_resetForTest` is a test-only export, but Stryker still mutates it.
   * Its conditional / block survivors are killable via post-conditions —
   * after calling it, the singleton must be in a clean slate (no pending
   * timer firing, no stale socket reference, no in-flight mint able to
   * open a socket).
   */
  it('cancels any pending reconnect timer so no zombie socket opens after reset', async () => {
    /*
     * Scenario: arm a backoff timer, then call _resetForTest. Advance time
     * past the would-be timer; no new socket may open.
     * Protects: _resetForTest ConditionalExpression / EqualityOperator /
     * BlockStatement on `if (reconnectTimer !== null) { clearTimeout(...); … }`
     * — the always-false / inverted / empty-block mutants would leave the
     * timer armed, causing a zombie reconnect when time advances.
     */
    await getConnectedClient();
    const socket0 = MockWebSocket.instances[0]!;
    socket0.simulateClose();
    expect(MockWebSocket.instances).toHaveLength(1);

    _resetForTest();

    // Drain potential timer windows; the cleared timer must not fire.
    await vi.advanceTimersByTimeAsync(60_000);
    await flushMintMicrotasks();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('invalidates an in-flight ticket mint so it cannot open a socket after reset', async () => {
    /*
     * Scenario: a mint is in flight when _resetForTest runs (mirrors a test
     * teardown racing an async connect). The connectSeq bump inside
     * _resetForTest must invalidate the pending `.then` so no socket leaks
     * into the post-reset state.
     * Protects: the `connectSeq++` line in _resetForTest.
     */
    getWsClient(); // mint in flight
    _resetForTest();
    await flushMintMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('does NOT call clearTimeout when _resetForTest runs without a pending timer', async () => {
    /*
     * Scenario: when _resetForTest is called immediately after the socket
     * opens (no disconnect has fired, so reconnectTimer is null) it must NOT
     * invoke clearTimeout. Asserting at the side-effect level kills the
     * always-true ConditionalExpression mutant on the timer guard.
     * Protects: _resetForTest ConditionalExpression `true` mutant.
     */
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    await getConnectedClient();
    clearTimeoutSpy.mockClear();

    _resetForTest();

    expect(clearTimeoutSpy).not.toHaveBeenCalled();
  });

  it('clearTimeout is invoked with the pending timer reference when _resetForTest runs mid-backoff', async () => {
    /*
     * Scenario: side-effect-level assertion that _resetForTest actually
     * cancels the pending timer, not just leaves it to no-op via `stopped`.
     * Protects: ConditionalExpression `true`/`false` and EqualityOperator
     * `!==` → `===` on the _resetForTest timer guard.
     */
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    await getConnectedClient();
    const socket0 = MockWebSocket.instances[0]!;
    socket0.simulateClose();
    clearTimeoutSpy.mockClear();

    _resetForTest();

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy.mock.calls[0]?.[0]).not.toBeNull();
    expect(clearTimeoutSpy.mock.calls[0]?.[0]).not.toBeUndefined();
  });
});
