/**
 * @fileoverview "Sign out everywhere" button — ends every session, this one included.
 *
 * Two calls are required, in this order:
 *
 *   1. `POST /auth/sessions/revoke-all` — the library's bulk revocation, which
 *      by design preserves the session making the call
 *      (`SessionService.revokeAllExceptCurrent`).
 *   2. `POST /api/auth/logout` — terminates that surviving session, so the
 *      device in front of the user is signed out too.
 *
 * Step 2 is not optional garnish: without it the caller's refresh cookie stays
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
import { revokeAllSessions, handleAuthClientError } from '@/lib/auth-client';

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
    try {
      await revokeAllSessions();
      // Bulk revocation spares the caller's own session — end it explicitly.
      const response = await fetch(LOGOUT_ROUTE, { method: 'POST', credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Logout failed with status ${response.status}`);
      }
      toast.success('All sessions revoked.');
      router.replace('/auth/login');
    } catch (err) {
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
