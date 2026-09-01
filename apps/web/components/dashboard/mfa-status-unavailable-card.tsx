/**
 * @fileoverview Stand-in for the MFA setup card while the account's password
 * capability is unknown.
 *
 * `MfaSetupCard` renders one of two mutually exclusive flows off `hasPassword`,
 * so guessing is not neutral: assuming `true` asks an OAuth-only account for a
 * password it can never supply, and assuming `false` withholds enrolment from
 * an account that could complete it. Neither is recoverable from the UI once
 * the page's bounded status attempts are spent, which is why unknown gets its
 * own state and a way out of it.
 *
 * @layer components/dashboard
 */

'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Card shown in place of the MFA setup flow when the status request failed.
 *
 * @param onRetry - Re-runs the status request that decides which flow applies.
 */
export function MfaStatusUnavailableCard({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="p-6">
      <p className="text-sm text-[rgba(255,255,255,0.6)]">
        Two-factor setup is unavailable right now — your account details could not be loaded.
      </p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        Try again
      </Button>
    </Card>
  );
}
