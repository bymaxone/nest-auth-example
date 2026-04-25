/**
 * @fileoverview Send Test Notification button — dev-only Account page demo.
 *
 * Renders a button that calls `POST /api/debug/notify/self` to push a test
 * notification through the WebSocket gateway to the current user's open sockets.
 * The notification surfaces as a `sonner` toast via `<NotificationListener />`.
 *
 * Hidden entirely when `NODE_ENV === 'production'` so no dev-only UI leaks
 * into production builds. The underlying endpoint also enforces this server-side.
 *
 * @layer components/dashboard
 * @see docs/DEVELOPMENT_PLAN.md §Phase 16 P16-3
 */

'use client';

import { useState } from 'react';
import { Bell, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { notifySelf, handleAuthClientError } from '@/lib/auth-client';

/**
 * Button that triggers a self-notification via the debug endpoint.
 *
 * Disabled while a request is in flight; shows a spinner icon to indicate
 * the pending state. Returns `null` in production builds.
 *
 * @returns The button element, or `null` in production.
 */
export function SendTestNotificationButton() {
  const [pending, setPending] = useState(false);

  if (process.env.NODE_ENV === 'production') return null;

  async function handleClick() {
    setPending(true);
    try {
      await notifySelf();
    } catch (err) {
      handleAuthClientError(err, { toast });
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        void handleClick();
      }}
      className="inline-flex items-center gap-2 rounded-lg border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] px-4 py-2 text-sm font-medium text-[rgba(255,255,255,0.8)] transition-colors hover:bg-[rgba(255,255,255,0.1)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Bell className="h-4 w-4" aria-hidden="true" />
      )}
      Send test notification
    </button>
  );
}
