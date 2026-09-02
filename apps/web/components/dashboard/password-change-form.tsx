/**
 * @fileoverview Password change form for the Account page.
 *
 * Validates `currentPassword` + `newPassword` + `confirmPassword` with Zod
 * (new password minimum 15 characters, matching the API's
 * `password.minLength`), posts to the library's built-in
 * `POST /api/auth/password/change` route (lib v1.1.0+ — revokes every other
 * session while keeping the caller's cookie-mode session alive), and shows a
 * success or error toast. On success the form resets to blank.
 *
 * Everything after the change itself is post-commit cleanup: the success is
 * reported before it runs, so a failure there is never mistaken for the
 * password change having failed.
 *
 * @layer components/dashboard
 */

'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import { toast } from 'sonner';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/auth/password-input';
import { changePassword, disconnectRealtime, handleAuthClientError } from '@/lib/auth-client';
import { getWsClient } from '@/lib/ws-client';
import { cn } from '@/lib/utils';

/** Tailwind error-border class applied to a password input on validation failure. */
const ERROR_BORDER_CLASS = 'border-red-500/60';

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: z.string().min(15, 'Must be at least 15 characters'),
    confirmPassword: z.string().min(1, 'Required'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

/**
 * Form that lets the signed-in user change their local password.
 *
 * Not rendered for OAuth-only accounts — the backend returns a 400 in that
 * case, but callers should hide the form entirely using `mfaEnabled` / no
 * `passwordHash` signal when that signal is exposed.
 */
export function PasswordChangeForm() {
  const [isPending, setIsPending] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    // Stryker disable next-line StringLiteral: RHF validation cadence — documented equivalent in mutation-testing-guidelines.md § "Equivalent mutants — known patterns in this repo".
    mode: 'onSubmit',
    // Stryker disable next-line StringLiteral: same reasoning as `mode` above.
    reValidateMode: 'onChange',
  });

  const onSubmit = async (data: ChangePasswordValues) => {
    setIsPending(true);
    try {
      await changePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
    } catch (err) {
      handleAuthClientError(err, { toast });
      setIsPending(false);
      return;
    }

    // Past this point the password is changed and the other sessions are
    // revoked — committed server-side, whatever happens next. Reporting it
    // first keeps a failure in the cleanup below from being read as "your
    // password was not changed", which would send the user to try again with a
    // password that is no longer current.
    toast.success('Password updated successfully.');
    reset();

    // The library revokes every OTHER session and bumps the token epoch, but
    // the gateway authenticates a socket at connect and never revalidates, so
    // those devices keep streaming on connections opened before the change.
    try {
      await disconnectRealtime();
    } catch (err) {
      // Best-effort: the revoked devices keep their sockets until they close
      // them, which is worth saying out loud, but the password change stands.
      handleAuthClientError(err, { toast });
    } finally {
      // Closing them server-side also drops this tab's socket — the gateway
      // cannot single one out — and 4403 is a code `WsClient` never retries.
      // This runs even when the call above reported a failure, because a lost
      // response is indistinguishable from one that never reached the server,
      // and in that case the sockets are already closed. This session is still
      // valid; the revoked ones are refused and stop on their own.
      getWsClient().reconnect();
      setIsPending(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="currentPassword" className="text-xs text-[rgba(255,255,255,0.6)]">
          Current password
        </Label>
        <PasswordInput
          id="currentPassword"
          autoComplete="current-password"
          placeholder="••••••••"
          {...register('currentPassword')}
          className={cn(errors.currentPassword && ERROR_BORDER_CLASS)}
        />
        {errors.currentPassword && (
          <p className="text-xs text-red-400">{errors.currentPassword.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="newPassword" className="text-xs text-[rgba(255,255,255,0.6)]">
          New password
        </Label>
        <PasswordInput
          id="newPassword"
          autoComplete="new-password"
          placeholder="••••••••"
          {...register('newPassword')}
          className={cn(errors.newPassword && ERROR_BORDER_CLASS)}
        />
        {errors.newPassword && <p className="text-xs text-red-400">{errors.newPassword.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword" className="text-xs text-[rgba(255,255,255,0.6)]">
          Confirm new password
        </Label>
        <PasswordInput
          id="confirmPassword"
          autoComplete="new-password"
          placeholder="••••••••"
          {...register('confirmPassword')}
          className={cn(errors.confirmPassword && ERROR_BORDER_CLASS)}
        />
        {errors.confirmPassword && (
          <p className="text-xs text-red-400">{errors.confirmPassword.message}</p>
        )}
      </div>

      <Button
        type="submit"
        disabled={isPending}
        size="sm"
        className="w-full bg-[#ff6224] text-white hover:bg-[#e5551f]"
      >
        <KeyRound className="mr-1.5 h-3.5 w-3.5" />
        {isPending ? 'Updating…' : 'Update password'}
      </Button>
    </form>
  );
}
