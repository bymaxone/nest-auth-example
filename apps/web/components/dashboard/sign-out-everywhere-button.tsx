/**
 * @fileoverview "Sign out everywhere" button — revokes all sessions except the current one.
 *
 * Calls `DELETE /auth/sessions/all` and then navigates to the login page,
 * because the current session cookie is also invalidated server-side by the
 * library's `revokeAllSessions` endpoint (all sessions including the current
 * one are revoked).
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
 * Destructive button that revokes every session, then redirects to login.
 *
 * An `AlertDialog` confirmation step prevents accidental clicks.
 */
export function SignOutEverywhereButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const handleConfirm = async () => {
    setIsPending(true);
    try {
      await revokeAllSessions();
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
          <AlertDialogAction onClick={() => void handleConfirm()}>
            Sign out everywhere
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
