/**
 * @fileoverview WebSocket client singleton for real-time notification delivery.
 *
 * Opens a single `WebSocket` to `${NEXT_PUBLIC_WS_URL}/ws/notifications` and
 * reconnects automatically using exponential backoff (capped at 30 s) whenever
 * the connection drops. The singleton survives React re-renders because it is
 * bound to module-level state, not to a hook or component.
 *
 * Authentication: the WS URL is same-origin via the Next.js `/ws/*` proxy, so
 * the HttpOnly `access_token` cookie is forwarded automatically on the HTTP
 * upgrade request. The `NotificationsGateway` reads the cookie as a fallback
 * when no `Authorization: Bearer` header is present.
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
}

// ── Module-level singleton state ──────────────────────────────────────────────

let socket: WebSocket | null = null;
let attempt = 0;
let stopped = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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
  if (handlers === undefined) return;
  // Runtime guard: only dispatch notification events with valid string fields
  // to prevent undefined values appearing in toasts from malformed payloads.
  if (
    eventName === 'notification:new' &&
    (typeof data !== 'object' ||
      data === null ||
      typeof (data as Record<string, unknown>)['title'] !== 'string' ||
      typeof (data as Record<string, unknown>)['body'] !== 'string')
  ) {
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

/**
 * Opens a new WebSocket connection and wires the lifecycle handlers.
 *
 * Called on first `getWsClient()` call and after each reconnect delay.
 * No-ops when running server-side (`typeof WebSocket === 'undefined'`) or
 * after `close()` has been called (`stopped === true`).
 */
function connect(): void {
  if (stopped || typeof WebSocket === 'undefined') return;

  const wsUrl = `${process.env['NEXT_PUBLIC_WS_URL'] ?? ''}/ws/notifications`;
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    attempt = 0;
  };

  socket.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(String(event.data)) as GatewayMessage;
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
