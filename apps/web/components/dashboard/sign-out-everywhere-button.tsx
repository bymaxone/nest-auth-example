/**
 * @fileoverview "Sign out everywhere" button — ends every session, this one included.
 *
 * Four steps are required, and the order is the point:
 *
 *   1. `POST /auth/sessions/revoke-all` — the library's bulk revocation, which
 *      by design preserves the session making the call
 *      (`SessionService.revokeAllExceptCurrent`).
 *   2. `POST /api/account/realtime/disconnect` — closes the sockets on every
 *      OTHER device, which the gateway would otherwise keep serving: it
 *      authenticates on connect and never revalidates an established socket.
 *      It is an authenticated endpoint, so it has to run while the caller's
 *      session is still alive — which is why it comes before the logout and
 *      not after it.
 *   3. `POST /api/auth/logout` — terminates that surviving session, so the
 *      device in front of the user is signed out too.
 *   4. `getWsClient().close()` — closes this tab's own socket, which the
 *      server-side disconnect cannot reach once the session is gone.
 *
 * When a step after the disconnect fails the session survives, so the catch
 * calls `reconnect()`: step 2 closes this tab's socket too (the gateway cannot
 * exempt one device) with a code `WsClient` treats as final.
 *
 * Step 3 is not optional garnish: without it the caller's refresh cookie stays
 * valid and a silent refresh re-authenticates the very browser the user just
 * told to sign out — which is exactly what the confirmation dialog promises
 * will not happen. `revokeAllSessions`' own JSDoc in `lib/auth-client.ts`
 * prescribes this pairing.
 *
 * @layer components/dashboard
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { revokeAllSessions, disconnectRealtime, handleAuthClientError } from '@/lib/auth-client';
import { getWsClient } from '@/lib/ws-client';

/**
 * Route handler that clears the auth cookies for the calling session.
 *
 * A Next.js route handler, not a backend path, so it is reached with a plain
 * `fetch` rather than through `apiFetch`'s `/api`-relative pipeline.
 */
const LOGOUT_ROUTE = '/api/auth/logout';

/**
 * The confirmation dialog body.
 *
 * The copy states that the current session ends too, which `handleConfirm`
 * makes true by pairing the bulk revoke with a logout.
 *
 * @param onConfirm - Fired when the user commits to signing out everywhere.
 */
function ConfirmDialogContent({ onConfirm }: { onConfirm: () => void }) {
  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Sign out of all sessions?</AlertDialogTitle>
        <AlertDialogDescription>
          This will immediately revoke every active session, including the current one. You will
          need to sign in again on all devices.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm}>Sign out everywhere</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

/**
 * Destructive button that ends every session — the current one included — and
 * then redirects to login.
 *
 * An `AlertDialog` confirmation step prevents accidental clicks. A failure in
 * either call leaves the user on the page with an error toast rather than
 * redirecting, because a redirect to the login screen would otherwise look
 * exactly like success while sessions were still live.
 */
export function SignOutEverywhereButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const handleConfirm = async () => {
    setIsPending(true);
    // Set once the server-side disconnect has been asked for. Past that point a
    // failure leaves this browser signed in but with the socket the gateway
    // closed underneath it, so the catch has to bring the stream back.
    let realtimeDisconnectRequested = false;
    try {
      await revokeAllSessions();
      realtimeDisconnectRequested = true;
      // The revoke ends the other sessions' HTTP credentials, but the gateway
      // authenticates a socket only at connect, so every OTHER device keeps
      // streaming on a socket that is already open. Closing the local client
      // alone would leave exactly the devices this action targets connected.
      // Runs before the logout, while this session is still authenticated.
      await disconnectRealtime();
      // Bulk revocation spares the caller's own session — end it explicitly.
      const response = await fetch(LOGOUT_ROUTE, { method: 'POST', credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Logout failed with status ${response.status}`);
      }
      // The gateway authenticates a socket once, at connect time, and never
      // revalidates an established one, so revoking the HTTP credentials
      // leaves an open socket streaming notifications to a browser that has
      // just been told every session ended. Close it here — `close()` also
      // stops the reconnect backoff, which would otherwise hammer an endpoint
      // that now rejects the upgrade.
      getWsClient().close();
      toast.success('All sessions revoked.');
      router.replace('/auth/login');
    } catch (err) {
      // The gateway closes this tab's socket with 4403 alongside the other
      // devices' — it cannot single one out — and `WsClient` treats that code as
      // final, so the stream never comes back on its own. On this path the
      // session is still live and the user stays on the dashboard, which would
      // leave them silently unnotified until a reload.
      if (realtimeDisconnectRequested) {
        getWsClient().reconnect();
      }
      handleAuthClientError(err, { toast });
      setIsPending(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          className="border-red-500/30 text-red-400 hover:border-red-500/60 hover:bg-red-500/10 hover:text-red-300"
        >
          <LogOut className="mr-1.5 h-3.5 w-3.5" />
          {isPending ? 'Signing out…' : 'Sign out everywhere'}
        </Button>
      </AlertDialogTrigger>
      <ConfirmDialogContent onConfirm={() => void handleConfirm()} />
    </AlertDialog>
  );
}
