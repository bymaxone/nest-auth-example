/**
 * @fileoverview Shown on the sign-in page when the workspace named by the link
 * could not be looked up.
 *
 * The link carries `Tenant.id` — that is what `IEmailProvider` receives — and
 * the picker keys off slugs, so the id has to be translated before the form
 * says which workspace it will sign into. When that lookup fails the page does
 * not know, and the honest options are to ask again or to let the person say.
 * It must not fall through to the default workspace with the controls live:
 * that submits real credentials against a tenant nobody chose.
 *
 * @layer components/auth
 */

'use client';

import { Button } from '@/components/ui/button';

/**
 * Inline notice with a retry, rendered in place of a live sign-in form.
 *
 * @param onRetry - Re-runs the workspace lookup.
 */
export function TenantLookupFailedNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] p-4"
    >
      <p className="text-xs text-[rgba(255,255,255,0.6)]">
        We could not tell which workspace this link is for. Try again, or pick your workspace above.
      </p>
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
