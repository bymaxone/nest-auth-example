/**
 * @fileoverview Email address card for the Security page — starts the
 * library's two-step address-change flow.
 *
 * Validates `newEmail` + `currentPassword` with Zod, posts to the library's
 * built-in `POST /api/auth/email/change` route (`controllers.emailChange`,
 * lib v1.1.0+) via the `requestEmailChange` client slice, and shows a success
 * or error toast. The password is re-proved because the email address is the
 * account's recovery credential — a stolen access token alone must not be
 * enough to redirect it.
 *
 * Nothing changes on the account until the user opens the confirmation link
 * mailed to the NEW address (`/auth/confirm-email-change?token=…`), so the
 * success copy tells them to check that inbox rather than claiming the
 * address moved.
 *
 * @layer components/dashboard
 */

'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import { toast } from 'sonner';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/auth/password-input';
import { requestEmailChange, handleAuthClientError } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

/** Tailwind error-border class applied to an input on validation failure. */
const ERROR_BORDER_CLASS = 'border-red-500/60';

const changeEmailSchema = z.object({
  newEmail: z.email('Enter a valid email address.'),
  currentPassword: z.string().min(1, 'Required'),
});

type ChangeEmailValues = z.infer<typeof changeEmailSchema>;

/**
 * Card heading — the section label and the one-line explanation that nothing
 * changes until the emailed link is opened.
 */
function EmailChangeCardHeading() {
  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Mail className="h-4 w-4 text-[rgba(255,255,255,0.4)]" />
        <h2 className="font-mono text-sm font-semibold tracking-widest text-[rgba(255,255,255,0.4)] uppercase">
          Email Address
        </h2>
      </div>

      <p className="mb-4 text-sm text-[rgba(255,255,255,0.5)]">
        Move your account to a new email address. We will send a confirmation link to the new
        address — nothing changes until you open it.
      </p>
    </>
  );
}

/**
 * The two inputs the change requires: the destination address and the current
 * password that re-proves ownership.
 *
 * @param register - React Hook Form register for the parent's form.
 * @param errors - Field errors from the parent's form state.
 */
function EmailChangeFields({
  register,
  errors,
}: {
  register: UseFormRegister<ChangeEmailValues>;
  errors: FieldErrors<ChangeEmailValues>;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="newEmail" className="text-xs text-[rgba(255,255,255,0.6)]">
          New email address
        </Label>
        <Input
          id="newEmail"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          {...register('newEmail')}
          className={cn(errors.newEmail && ERROR_BORDER_CLASS)}
        />
        {errors.newEmail && <p className="text-xs text-red-400">{errors.newEmail.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="emailChangeCurrentPassword"
          className="text-xs text-[rgba(255,255,255,0.6)]"
        >
          Current password
        </Label>
        <PasswordInput
          id="emailChangeCurrentPassword"
          autoComplete="current-password"
          placeholder="••••••••"
          {...register('currentPassword')}
          className={cn(errors.currentPassword && ERROR_BORDER_CLASS)}
        />
        {errors.currentPassword && (
          <p className="text-xs text-red-400">{errors.currentPassword.message}</p>
        )}
      </div>
    </>
  );
}

/**
 * Card that lets the signed-in user move their account to a new email
 * address, gated by their current password.
 *
 * On success the form resets and a toast points the user at the new
 * address's inbox — the account keeps its current email until the mailed
 * confirmation link is used, so a typo can never lock the owner out.
 */
export function EmailChangeCard() {
  const [isPending, setIsPending] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ChangeEmailValues>({
    resolver: zodResolver(changeEmailSchema),
    // Stryker disable next-line StringLiteral: RHF validation cadence — documented equivalent in mutation-testing-guidelines.md § "Equivalent mutants — known patterns in this repo".
    mode: 'onSubmit',
    // Stryker disable next-line StringLiteral: same reasoning as `mode` above.
    reValidateMode: 'onChange',
  });

  const onSubmit = async (data: ChangeEmailValues) => {
    setIsPending(true);
    try {
      await requestEmailChange(data);
      toast.success('Check the new address for a confirmation link.');
      reset();
    } catch (err) {
      handleAuthClientError(err, { toast });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Card className="p-6">
      <EmailChangeCardHeading />

      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="space-y-4">
        <EmailChangeFields register={register} errors={errors} />

        <Button
          type="submit"
          disabled={isPending}
          size="sm"
          className="w-full bg-brand-500 text-white hover:bg-brand-600"
        >
          <Mail className="mr-1.5 h-3.5 w-3.5" />
          {isPending ? 'Sending…' : 'Send confirmation link'}
        </Button>
      </form>
    </Card>
  );
}
