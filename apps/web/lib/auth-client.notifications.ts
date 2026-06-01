/**
 * @fileoverview Notifications slice of the typed API client.
 *
 * Wraps the dev-only `POST /api/debug/notify/self` endpoint that pushes
 * a `notification:new` WebSocket event to all open sockets for the
 * authenticated user. Used by the dashboard's "Send test notification"
 * button to demonstrate the WebSocket-auth flow without
 * requiring a real backend event.
 *
 * Split out of `auth-client.ts` to keep the parent module under the
 * 800-line file cap; consumers keep importing from `@/lib/auth-client`
 * thanks to the barrel re-export there.
 *
 * @module lib/auth-client.notifications
 */

import { apiFetch } from './auth-client';

/** Optional payload for the self-notification demo endpoint. */
export interface NotifySelfPayload {
  /** Notification headline (defaults to `'Hello'` server-side). */
  title?: string;
  /** Notification body text (defaults to `'This is a test notification.'` server-side). */
  body?: string;
}

/** Response from `POST /api/debug/notify/self`. */
export interface NotifySelfResponse {
  /** Number of WebSocket sockets that received the notification. */
  delivered: number;
}

/**
 * Sends a test notification to the authenticated user's own WebSocket sockets.
 *
 * Calls the dev-only `POST /api/debug/notify/self` endpoint. The server pushes
 * a `notification:new` WS event to all open sockets for the current user, which
 * the `<NotificationListener />` component surfaces as a `sonner` toast.
 *
 * Only available when `NODE_ENV !== 'production'`; the endpoint returns 403 in
 * production builds.
 *
 * @param payload - Optional title and body; both have sensible server-side defaults.
 * @returns `{ delivered: number }` — count of sockets that received the message.
 */
export const notifySelf = (payload?: NotifySelfPayload): Promise<NotifySelfResponse> =>
  apiFetch<NotifySelfResponse>('/debug/notify/self', {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  });
