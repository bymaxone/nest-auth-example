/**
 * @file ws.ts
 * @description WebSocket test helper that wraps the `ws` npm package with
 * promise-based APIs for open, message, and close events.
 *
 * Used by `websocket-auth.e2e-spec.ts` to connect to the notifications gateway
 * at `/ws/notifications` with optional `Authorization: Bearer` headers.
 *
 * # Manual reproduction with websocat
 * ```
 * websocat --header "Authorization: Bearer <access_token>" ws://localhost:4001/ws/notifications
 * ```
 * Replace `<access_token>` with the value extracted from the `access_token` cookie
 * obtained by POSTing to `POST /api/auth/login`.
 *
 * @layer test
 * @see docs/DEVELOPMENT_PLAN.md §Phase 10 P10-3
 * @see apps/api/test/websocket-auth.e2e-spec.ts
 */

import WebSocket from 'ws';
import type { RawData } from 'ws';

/**
 * Converts a `ws.RawData` value (Buffer | ArrayBuffer | Buffer[]) to a UTF-8
 * string. Handles all three variants so the caller doesn't need to narrow.
 */
function rawDataToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return new TextDecoder().decode(data);
}

/** Options for creating a test WebSocket connection. */
export interface WsClientOptions {
  /** Full WebSocket URL, e.g. `ws://localhost:4001/ws/notifications`. */
  url: string;
  /**
   * Additional HTTP headers sent during the WebSocket upgrade request.
   * Use `{ Authorization: 'Bearer <token>' }` for authenticated connections.
   */
  headers?: Record<string, string>;
}

/** Lightweight wrapper around a `ws.WebSocket` exposing promise-based events. */
export interface WsTestClient {
  /** Underlying `ws.WebSocket` instance — use for low-level assertions. */
  socket: WebSocket;
  /**
   * Resolves when the socket emits the `open` event, or rejects if `close`
   * fires before `open`.
   */
  opened: Promise<void>;
  /**
   * Resolves with the first `message` event data as a parsed JSON object.
   * Rejects after `timeoutMs` milliseconds if no message arrives.
   *
   * @param timeoutMs - Maximum wait time in milliseconds (default: 2000).
   */
  nextMessage: (timeoutMs?: number) => Promise<unknown>;
  /**
   * Resolves with the WebSocket close code when the `close` event fires.
   * Rejects after `timeoutMs` milliseconds if no close event occurs.
   *
   * @param timeoutMs - Maximum wait time in milliseconds (default: 2000).
   */
  nextClose: (timeoutMs?: number) => Promise<number>;
  /**
   * Closes the socket gracefully. Safe to call multiple times.
   */
  close: () => void;
}

/**
 * Opens a WebSocket connection and returns a test client with promise-based
 * event helpers.
 *
 * @param options - Connection URL and optional headers.
 * @returns A `WsTestClient` whose `opened` promise resolves once connected.
 */
export function createWsClient(options: WsClientOptions): WsTestClient {
  const { url, headers = {} } = options;

  const socket = new WebSocket(url, { headers });

  const opened = new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    // Reject if the socket closes before the open event fires.
    socket.once('close', (code) => reject(new Error(`socket closed before open, code=${code}`)));
    socket.once('error', (err) => reject(err));
  });

  const nextMessage = (timeoutMs = 2000): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('nextMessage timed out')), timeoutMs);

      socket.once('message', (data) => {
        clearTimeout(timer);
        const str = rawDataToString(data);
        try {
          resolve(JSON.parse(str) as unknown);
        } catch {
          reject(new Error(`Failed to parse message: ${str}`));
        }
      });

      socket.once('close', () => {
        clearTimeout(timer);
        reject(new Error('socket closed while waiting for message'));
      });
    });

  const nextClose = (timeoutMs = 2000): Promise<number> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('nextClose timed out')), timeoutMs);

      socket.once('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

  const close = (): void => {
    if (socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
      socket.close();
    }
  };

  return { socket, opened, nextMessage, nextClose, close };
}
