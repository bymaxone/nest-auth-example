/**
 * @fileoverview Invite form — sends a new tenant invitation by email and role.
 *
 * Calls `POST /api/invitations` and invokes `onSuccess()` to refresh the parent
 * invitations table. Restricted to admin users — non-admins should not see this form.
 *
 * @layer components/dashboard
 */

'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createInvitation, handleAuthClientError } from '@/lib/auth-client';

const ROLE_OPTIONS = ['VIEWER', 'MEMBER', 'ADMIN'] as const;

const inviteSchema = z.object({
  email: z.email('Enter a valid email address'),
  role: z.enum(ROLE_OPTIONS),
});

type InviteValues = z.infer<typeof inviteSchema>;

interface InviteFormProps {
  /** Called after a successful invitation so the parent can refresh the list. */
  onSuccess: () => void;
}

/**
 * Form that creates a new invitation for the specified email and role.
 *
 * @param onSuccess - Callback invoked after a successful invitation.
 */
export function InviteForm({ onSuccess }: InviteFormProps) {
  const [isPending, setIsPending] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: 'MEMBER' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const onSubmit = async (data: InviteValues) => {
    setIsPending(true);
    try {
      await createInvitation(data.email, data.role);
      toast.success(`Invitation sent to ${data.email}.`);
      reset({ role: 'MEMBER' });
      onSuccess();
    } catch (err) {
      handleAuthClientError(err, { toast });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      noValidate
      className="flex flex-wrap items-end gap-3"
    >
      <div className="min-w-[200px] flex-1 space-y-1">
        <Label htmlFor="inviteEmail" className="text-xs text-[rgba(255,255,255,0.6)]">
          Email address
        </Label>
        <Input
          id="inviteEmail"
          type="email"
          autoComplete="off"
          placeholder="colleague@example.com"
          {...register('email')}
          className={errors.email ? 'border-red-500/60' : ''}
        />
        {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="inviteRole" className="text-xs text-[rgba(255,255,255,0.6)]">
          Role
        </Label>
        <select
          id="inviteRole"
          {...register('role')}
          className="h-9 rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] px-3 text-sm text-[rgba(255,255,255,0.8)] focus:outline-none focus:ring-2 focus:ring-[#ff6224]/50"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r} className="bg-[#0c0c0c]">
              {r}
            </option>
          ))}
        </select>
      </div>

      <Button
        type="submit"
        size="sm"
        disabled={isPending}
        className="bg-[#ff6224] text-white hover:bg-[#e5551f]"
      >
        <UserPlus className="mr-1.5 h-3.5 w-3.5" />
        {isPending ? 'Sending…' : 'Send invite'}
      </Button>
    </form>
  );
}
