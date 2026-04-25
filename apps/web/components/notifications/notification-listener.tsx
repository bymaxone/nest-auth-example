/**
 * @fileoverview Notification listener — bridges the WS singleton and sonner toasts.
 *
 * A `'use client'` component that mounts once inside the dashboard layout.
 * It subscribes to the `ws-client` singleton's `notification:new` events when
 * the user is authenticated and fires a `sonner` toast for each incoming payload.
 *
 * When the user signs out (session transitions to unauthenticated), the component
 * unsubscribes from the event. The WS singleton is not closed here — closing it
 * sets `stopped = true` permanently, which would break re-authentication in SPA
 * flows that do not trigger a full page reload. The gateway rejects the next
 * upgrade attempt with an auth error and the singleton enters backoff mode, which
 * is acceptable until the user signs back in or navigates away.
 *
 * Renders nothing — this component is purely a side-effect host.
 *
 * @layer components/notifications
 * @see docs/DEVELOPMENT_PLAN.md §Phase 16 P16-2
 */

'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useSession } from '@bymax-one/nest-auth/react';
import { getWsClient } from '@/lib/ws-client';
import type { NotificationHandler } from '@/lib/ws-client';

/**
 * Mounts a WebSocket listener for `notification:new` events and surfaces
 * each payload as a `sonner` toast.
 *
 * Lifecycle:
 * - Authenticated → subscribe to WS events.
 * - Unauthenticated / unmount → unsubscribe only (WS singleton not closed).
 *
 * Place this component once inside `app/dashboard/layout.tsx` so every
 * dashboard page benefits from real-time notifications.
 *
 * @returns `null` — renders no DOM.
 */
export function NotificationListener() {
  const { user } = useSession();

  // Stable ref for the handler so the same function reference is used for
  // both `on` and `off`, preventing stale-closure leaks across renders.
  const handlerRef = useRef<NotificationHandler | null>(null);

  useEffect(() => {
    if (user === null) {
      // User signed out — unsubscribe only. Closing the singleton here would set
      // stopped=true permanently, preventing reconnection if the user signs back
      // in without a full page reload.
      if (handlerRef.current !== null) {
        const ws = getWsClient();
        ws.off('notification:new', handlerRef.current);
        handlerRef.current = null;
      }
      return;
    }

    const ws = getWsClient();

    const handler: NotificationHandler = (payload) => {
      toast(payload.title, { description: payload.body });
    };

    handlerRef.current = handler;
    ws.on('notification:new', handler);

    return () => {
      ws.off('notification:new', handler);
    };
  }, [user?.id]);

  return null;
}
