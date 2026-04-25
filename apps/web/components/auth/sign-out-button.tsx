/**
 * @fileoverview Sign-out button — posts to the logout route handler and refreshes.
 *
 * Client component that posts to `POST /api/auth/logout` (the `createLogoutHandler`
 * endpoint from Phase 12). The handler owns cookie clearing and the redirect to
 * `/auth/login`; this component only triggers the request and reflects loading state.
 *
 * Used in the dashboard header dropdown (Phase 14). Shipping it here makes Phase 12's
 * auth wiring end-to-end testable without the full dashboard being built.
 *
 * @layer components/auth
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/**
 * Ghost button that signs the user out via the library's logout route handler.
 *
 * On success the logout handler's redirect takes effect; `router.refresh()` is
 * called first to clear any cached RSC payloads. On network failure a toast
 * surfaces the error without navigating away.
 */
export default function SignOutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const handleClick = async () => {
    setIsPending(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      // The logout handler issues a redirect — refresh the router so the server
      // tree re-renders without stale cached RSC payloads before following it.
      router.refresh();
    } catch {
      toast.error('Sign out failed — please try again');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Button variant="ghost" size="sm" disabled={isPending} onClick={() => void handleClick()}>
      <LogOut className="mr-1 h-4 w-4" />
      Sign out
    </Button>
  );
}
