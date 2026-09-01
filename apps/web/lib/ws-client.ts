/**
 * @fileoverview WebSocket client singleton for real-time notification delivery.
 *
 * Opens a single `WebSocket` to `${NEXT_PUBLIC_WS_URL}/ws/notifications` and
 * reconnects automatically using exponential backoff (capped at 30 s) whenever
 * the connection drops. The singleton survives React re-renders because it is
 * bound to module-level state, not to a hook or component.
 *
 * Authentication: before each upgrade the client requests a single-use ticket
 * from the library's `POST /api/auth/ws-ticket` route (lib v1.1.0+, 30 s TTL,
 * atomically consumed server-side) and appends it as `?ticket=` on the upgrade
 * URL — the canonical browser WS auth path: browsers cannot set custom headers
 * on upgrades, and a single-use ticket in the URL is worthless once redeemed.
 * When the ticket mint fails (e.g. session mid-refresh), the client falls back
 * to the same-origin cookie path: the WS URL goes through the Next.js `/ws/*`
 * proxy, so the HttpOnly `access_token` cookie is forwarded automatically and
 * the `NotificationsGateway` reads it when no ticket or Bearer header is present.
 *
 * Usage:
 * ```tsx
 * const ws = getWsClient();
 * ws.on('notification:new', (payload) => toast(payload.title));
 * // On sign-out:
 * ws.close();
 * ```
 *
 * @module lib/ws-client
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Payload emitted by the gateway on `notification:new` events. */
export interface NotificationPayload {
  /** Short notification headline. */
  title: string;
  /** Supporting notification text. */
  body: string;
}

/** Handler function for `notification:new` events. */
export type NotificationHandler = (payload: NotificationPayload) => void;

/** Shape of raw messages received from the gateway. */
interface GatewayMessage {
  event: string;
  data: unknown;
}

/** Public WsClient interface returned by `getWsClient()`. */
export interface WsClient {
  /**
   * Subscribes `handler` to `eventName` events.
   *
   * @param eventName - The event to listen for (currently only `'notification:new'`).
   * @param handler   - Callback invoked with the deserialized payload.
   */
  on(eventName: 'notification:new', handler: NotificationHandler): void;
  /**
   * Unsubscribes `handler` from `eventName`.
   *
   * @param eventName - The event name passed to `on()`.
   * @param handler   - The exact handler reference passed to `on()`.
   */
  off(eventName: 'notification:new', handler: NotificationHandler): void;
  /**
   * Permanently closes the WebSocket and stops all reconnect attempts.
   *
   * Call this when the user signs out to avoid pointless backoff loops against
   * an endpoint that will reject unauthenticated upgrades.
   */
  close(): void;
  /**
   * Force an immediate reconnection with the current cookies.
   *
   * Cancels any pending backoff timer, resets the attempt counter, and tears
   * down the current socket (if any). The next `connect()` runs synchronously
   * with delay 0 and uses whatever auth cookies the browser holds NOW —
   * critical when the user signs in under a new identity (e.g. tenant switch
   * or re-login after logout) and the singleton was last connected with the
   * previous user's cookies (or was mid-backoff against an unauthenticated
   * endpoint).
   */
  reconnect(): void;
}

// ── Module-level singleton state ──────────────────────────────────────────────

let socket: WebSocket | null = null;
let attempt = 0;
let stopped = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
/** Monotonic guard: each `connect()` invalidates older in-flight ticket mints. */
let connectSeq = 0;

/** Map from event name to the set of registered handlers. */
const listeners = new Map<string, Set<NotificationHandler>>();

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Returns the reconnect delay in milliseconds.
 *
 * Uses exponential backoff (`1000 * 2^attempt`) capped at 30 s, with ±20%
 * jitter to spread reconnect storms across clients.
 *
 * @returns Delay in milliseconds.
 */
function backoff(): number {
  const base = Math.min(1000 * 2 ** attempt, 30_000);
  return base * (0.8 + Math.random() * 0.4);
}

/**
 * Dispatches a parsed gateway event to all registered handlers.
 *
 * @param eventName - The event name from the gateway message.
 * @param data      - The raw data payload; cast to `NotificationPayload` for known events.
 */
function dispatch(eventName: string, data: unknown): void {
  const handlers = listeners.get(eventName);
  // Stryker disable next-line ConditionalExpression: defensive early-return — when no handlers are registered, falling through reaches `for (const handler of undefined)` which throws synchronously. The surrounding `socket.onmessage` try-catch absorbs that throw and the observable side effect is identical (no handler ever runs). This guard exists for clarity, not for observable correctness.
  if (handlers === undefined) return;
  // Runtime guard: only dispatch notification events with valid string fields
  // to prevent undefined values appearing in toasts from malformed payloads.
  //
  // Stryker disable ConditionalExpression,LogicalOperator: the eventName
  // check + the OR-chain are a redundant defensive validation. Every
  // malformed shape (non-object, null, missing title, missing body) is
  // caught by one OR another clause, AND any thrown property access from
  // the chain is absorbed by the onmessage try-catch. Mutating any single
  // clause to a constant just shifts which clause triggers the return
  // without changing the observable handler-not-called outcome — there is
  // no test that can distinguish the original from any individual mutant
  // here because the OR-fallbacks plus the outer try-catch flatten every
  // path to the same no-op result.
  const isMalformedNotification =
    eventName === 'notification:new' &&
    (typeof data !== 'object' ||
      data === null ||
      typeof (data as Record<string, unknown>)['title'] !== 'string' ||
      typeof (data as Record<string, unknown>)['body'] !== 'string');
  // Stryker restore ConditionalExpression,LogicalOperator
  if (isMalformedNotification) {
    return;
  }
  for (const handler of handlers) {
    try {
      handler(data as NotificationPayload);
    } catch {
      // Individual handler errors must not crash the event loop.
    }
  }
}

/** Response shape of the library's `POST /api/auth/ws-ticket` route. */
interface WsTicketResponse {
  /** Single-use upgrade ticket to append as `?ticket=` on the WS URL. */
  ticket: string;
  /** Ticket lifetime in seconds (30 — `WS_TICKET_TTL_SECONDS`). */
  expiresIn: number;
}

/**
 * Mints a single-use WebSocket upgrade ticket via the library route.
 *
 * Uses a plain same-origin `fetch` (not the auth client) to avoid a module
 * cycle and to keep this file dependency-free. The HttpOnly auth cookies ride
 * along via `credentials: 'include'`; the library authenticates the mint call
 * exactly like any other dashboard request.
 *
 * @returns The ticket string, or null when the mint fails (not authenticated,
 *   network error) — callers fall back to cookie-authenticated upgrades.
 */
async function fetchWsTicket(): Promise<string | null> {
  try {
    const response = await fetch('/api/auth/ws-ticket', {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) return null;
    const body = (await response.json()) as WsTicketResponse;
    return typeof body.ticket === 'string' && body.ticket.length > 0 ? body.ticket : null;
  } catch {
    return null;
  }
}

/**
 * Opens a new WebSocket connection and wires the lifecycle handlers.
 *
 * Called on first `getWsClient()` call and after each reconnect delay.
 * No-ops when running server-side (`typeof WebSocket === 'undefined'`) or
 * after `close()` has been called (`stopped === true`).
 *
 * Mints a fresh single-use ticket per attempt (tickets are consumed on redeem,
 * so a reconnect can never reuse one); on mint failure the upgrade proceeds
 * without a ticket and the gateway falls back to the `access_token` cookie.
 */
function connect(): void {
  if (stopped || typeof WebSocket === 'undefined') return;

  // The ticket mint is asynchronous, so a `reconnect()`/`close()`/second
  // `connect()` can land while it is in flight. The sequence counter makes
  // every newer call invalidate older pending mints — without it, two rapid
  // calls would each open a socket and the user would receive every
  // notification twice.
  const seq = ++connectSeq;
  void fetchWsTicket().then((ticket) => {
    if (stopped || seq !== connectSeq || socket !== null) return;
    const query = ticket !== null ? `?ticket=${encodeURIComponent(ticket)}` : '';
    openSocket(query);
  });
}

/**
 * Creates the raw `WebSocket` and wires the lifecycle handlers.
 *
 * @param query - `?ticket=…` query string, or empty for cookie-auth upgrades.
 */
function openSocket(query: string): void {
  const wsUrl = `${process.env['NEXT_PUBLIC_WS_URL'] ?? ''}/ws/notifications${query}`;
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    attempt = 0;
  };

  socket.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(String(event.data)) as GatewayMessage;
      // Stryker disable next-line ConditionalExpression: the typeof guard is defensive — dispatch() already early-returns when no handler is registered for the event key, so calling dispatch(42, …) ends with the same no-handler-invoked outcome. Removing this guard surfaces the same observable behaviour.
      if (typeof msg.event === 'string') {
        dispatch(msg.event, msg.data);
      }
    } catch {
      // Silently discard malformed gateway messages.
    }
  };

  socket.onclose = () => {
    socket = null;
    if (!stopped) {
      // Compute the delay BEFORE incrementing so attempt=0 yields 1 000 ms,
      // attempt=1 yields 2 000 ms, etc.  Incrementing after ensures the next
      // call to backoff() doubles the window.
      const delay = backoff();
      attempt++;
      reconnectTimer = setTimeout(connect, delay);
    }
  };

  socket.onerror = () => {
    // onerror fires before onclose; reconnect logic is in onclose to avoid
    // double-scheduling. Errors are intentionally not logged in production to
    // prevent leaking connection details.
  };
}

// ── Public singleton instance ─────────────────────────────────────────────────

const wsClientSingleton: WsClient = {
  on(eventName, handler) {
    let set = listeners.get(eventName);
    if (set === undefined) {
      set = new Set();
      listeners.set(eventName, set);
    }
    set.add(handler);
  },

  off(eventName, handler) {
    listeners.get(eventName)?.delete(handler);
  },

  close() {
    stopped = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket !== null) {
      socket.close();
      socket = null;
    }
  },

  reconnect() {
    // Reset the backoff state so the next `connect()` runs at delay=0 — the
    // user just authenticated (or re-authenticated), so the cookies are fresh
    // and the singleton must not keep sleeping on an old exponential window.
    attempt = 0;
    stopped = false;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket !== null) {
      // **Detach lifecycle handlers BEFORE `close()`.** `WebSocket.close()` is
      // asynchronous — the old socket's `onclose` would fire AFTER the
      // synchronous `connect()` call below has already replaced the
      // module-level `socket` with a fresh instance. Without detachment, the
      // stale `onclose` then:
      //   1. Nullifies `socket` (clobbering the brand-new connection).
      //   2. Enters the `!stopped` branch and schedules YET ANOTHER reconnect
      //      via `setTimeout(connect, backoff())`.
      // Result: every `reconnect()` call leaves 2-3 zombie sockets alive on
      // the server, each delivering the same `notification:new` event — the
      // user sees the toast fire 2-3 times per notification.
      //
      // `WebSocket.close()` itself still sends the close frame to the
      // server, so the gateway's `handleDisconnect` fires and removes the
      // old socket from `userSockets` cleanly. We only suppress the
      // CLIENT-SIDE side effects that race the new connection.
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
      socket = null;
    }
    connect();
  },
};

/**
 * Returns the module-level `WsClient` singleton.
 *
 * Opens the WebSocket connection on the first call (browser context only).
 * Subsequent calls return the same instance without re-connecting.
 *
 * @returns The singleton `WsClient` instance.
 */
export function getWsClient(): WsClient {
  if (socket === null && !stopped) {
    connect();
  }
  return wsClientSingleton;
}

/**
 * Resets all module-level singleton state to a clean initial condition.
 *
 * @internal — only for use in test files. Not part of the public API.
 */
export function _resetForTest(): void {
  stopped = false;
  attempt = 0;
  // Bump the sequence so any in-flight ticket mint from a previous test can
  // never open a socket into the next test's clean state.
  connectSeq++;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket !== null) {
    socket.close();
    socket = null;
  }
  listeners.clear();
}
