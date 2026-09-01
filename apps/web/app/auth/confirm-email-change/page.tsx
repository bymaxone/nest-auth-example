/**
 * @fileoverview Confirm email change page — completes the library's two-step
 * address-change flow.
 *
 * Visual shell is provided by `app/auth/layout.tsx`. This page:
 *   - Reads `?token=` and `?tenantId=` from the URL (mailed to the NEW address
 *     by the API's email provider after `POST /api/auth/email/change`). The
 *     tenant is resolved and stashed in the `tenant_id` cookie before the
 *     confirm call, because this link is routinely opened in a browser that
 *     has never seen this app and therefore carries no tenant cookie.
 *   - On the explicit "Confirm" click: POSTs the token to
 *     `POST /api/auth/email/change/confirm` via the `confirmEmailChange`
 *     client slice — a button rather than an on-mount submit so a link
 *     prefetcher can never consume the single-use token
 *   - On success: shows a success state + link to `/auth/login?email_changed=1`
 *   - On failure: toasts `translateAuthError` (`auth.email_change_token_invalid`
 *     for an unknown, expired, or already-used token)
 *   - Missing `?token=`: shows an inline "re-open the link" error instead of crashing
 *
 * @layer pages/auth
 */

'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { confirmEmailChange, resolveTenantForLogin, AuthClientError } from '@/lib/auth-client';
import { translateAuthError } from '@/lib/auth-errors';

/**
 * Shown when the URL carries no `?token=`, e.g. a mail client truncated the
 * link. Offers a way back rather than rendering a confirm button that could
 * only ever fail.
 */
function MissingTokenState() {
  return (
    <div className="flex flex-col gap-6 text-center">
      <p className="text-sm text-[rgba(255,255,255,0.5)]">Confirm your new email address</p>
      <div
        role="alert"
        className="rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)] px-4 py-3 text-sm text-red-400"
      >
        This link looks incomplete. Please re-open the link from your confirmation email.
      </div>
      <Link
        href="/auth/login"
        className="text-sm text-brand-500/80 transition-colors hover:text-brand-500"
      >
        Back to sign in
      </Link>
    </div>
  );
}

/**
 * Shown once the token has been accepted and the address has moved.
 *
 * The copy names the notice sent to the previous address, because that notice
 * is the user's signal if the change was not theirs.
 *
 * @param tenantParam - Tenant from the confirmation URL, carried into the login
 *   link so the workspace survives the hand-off.
 */
function SuccessState({ tenantParam }: { tenantParam: string }) {
  // The login page seeds its workspace selector from `?tenantId=` and otherwise
  // falls back to the default tenant, overwriting the `tenant_id` cookie before
  // it submits. Dropping the tenant here would therefore send someone who just
  // confirmed a non-default workspace address to the default one, where their
  // new credentials are rejected. The value mailed by the library is the
  // tenant's CUID rather than its slug — the login page translates it before
  // seeding the selector.
  const loginHref =
    tenantParam === ''
      ? '/auth/login?email_changed=1'
      : `/auth/login?email_changed=1&tenantId=${encodeURIComponent(tenantParam)}`;

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <MailCheck className="h-8 w-8 text-success" />
      <div>
        <p className="text-sm font-semibold text-white">Email address updated</p>
        <p className="mt-1 text-sm text-[rgba(255,255,255,0.5)]">
          Use your new address the next time you sign in. A notice was sent to your previous
          address.
        </p>
      </div>
      <Link
        href={loginHref}
        className="text-sm text-brand-500/80 transition-colors hover:text-brand-500"
      >
        Continue to sign in
      </Link>
    </div>
  );
}

/**
 * The pre-confirmation prompt.
 *
 * Deliberately a button rather than an on-mount submit: a link prefetcher or a
 * mail-scanner following the emailed URL would otherwise consume the
 * single-use token before the user ever saw the page.
 *
 * @param isSubmitting - Disables the button and swaps its label while in flight.
 * @param onConfirm - Fired when the user commits to the change.
 */
function ConfirmPrompt({
  isSubmitting,
  onConfirm,
}: {
  isSubmitting: boolean;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col gap-6 text-center">
      <p className="text-sm text-[rgba(255,255,255,0.5)]">
        Confirm that you want to move your account to this email address. Your old address will be
        notified.
      </p>

      <Button
        type="button"
        disabled={isSubmitting}
        size="lg"
        className="w-full"
        onClick={onConfirm}
      >
        {isSubmitting ? 'Confirming…' : 'Confirm email change'}
      </Button>

      <Link
        href="/auth/login"
        className="text-sm text-[rgba(255,255,255,0.4)] transition-colors hover:text-[rgba(255,255,255,0.6)]"
      >
        Back to sign in
      </Link>
    </div>
  );
}

/**
 * Reads `?token=` and drives the confirm request.
 *
 * The three render states are mutually exclusive: no token, confirmed, or the
 * confirm prompt.
 */
function ConfirmEmailChangeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const tenantParam = searchParams.get('tenantId') ?? '';

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      // The link is opened from the NEW mailbox, so this browser usually has no
      // `tenant_id` cookie and `tenantAwareFetch` would send no `X-Tenant-Id`.
      // Stash the tenant from the URL first, exactly as the reset page does.
      if (tenantParam !== '') {
        const resolvedTenantId = await resolveTenantForLogin(tenantParam);
        document.cookie = `tenant_id=${resolvedTenantId}; Path=/; SameSite=Lax; Max-Age=31536000`;
      }
      await confirmEmailChange(token);
      setIsConfirmed(true);
      toast.success('Your email address has been updated.');
    } catch (err) {
      if (err instanceof AuthClientError && err.body?.code !== undefined) {
        toast.error(translateAuthError(err.body.code));
      } else {
        toast.error('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (token === '') {
    return <MissingTokenState />;
  }

  if (isConfirmed) {
    return <SuccessState tenantParam={tenantParam} />;
  }

  return <ConfirmPrompt isSubmitting={isSubmitting} onConfirm={() => void handleConfirm()} />;
}

/**
 * Confirm email change page — submits the single-use token mailed to the
 * user's new address.
 *
 * Shows a success state with a login link on success. When `?token=` is
 * absent from the URL the user is shown an inline error to re-open the link.
 *
 * The `<Suspense>` boundary is required because `useSearchParams()` triggers a
 * CSR bailout during static generation in Next 16.
 */
export default function ConfirmEmailChangePage() {
  return (
    <Suspense fallback={null}>
      <ConfirmEmailChangeContent />
    </Suspense>
  );
}
