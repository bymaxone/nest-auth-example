/**
 * @fileoverview Password change form for the Account page.
 *
 * Validates `currentPassword` + `newPassword` + `confirmPassword` with Zod,
 * posts to `POST /api/account/change-password`, and shows a success or error
 * toast. On success the form resets to blank.
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
import { changePassword, handleAuthClientError } from '@/lib/auth-client';

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: z.string().min(8, 'Must be at least 8 characters'),
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
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const onSubmit = async (data: ChangePasswordValues) => {
    setIsPending(true);
    try {
      await changePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
      toast.success('Password updated successfully.');
      reset();
    } catch (err) {
      handleAuthClientError(err, { toast });
    } finally {
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
          className={errors.currentPassword ? 'border-red-500/60' : ''}
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
          className={errors.newPassword ? 'border-red-500/60' : ''}
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
          className={errors.confirmPassword ? 'border-red-500/60' : ''}
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
