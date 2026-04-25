/**
 * @fileoverview MFA disable card — shown when MFA is already enabled.
 *
 * Requires the user to confirm with a live TOTP code before disabling
 * two-factor authentication, preventing accidental or unauthorized removal.
 *
 * @layer components/dashboard
 */

'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import { toast } from 'sonner';
import { ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { OtpInput } from '@/components/auth/otp-input';
import { mfaDisable, handleAuthClientError } from '@/lib/auth-client';

const disableSchema = z.object({
  code: z.string().length(6, 'Enter the 6-digit code from your authenticator app'),
});

type DisableValues = z.infer<typeof disableSchema>;

interface MfaDisableCardProps {
  /** Called after MFA is successfully disabled so the parent can refresh state. */
  onDisabled: () => void;
}

/**
 * Card that lets a user disable MFA by supplying a valid TOTP code.
 *
 * @param onDisabled - Callback invoked once MFA is successfully disabled.
 */
export function MfaDisableCard({ onDisabled }: MfaDisableCardProps) {
  const [showForm, setShowForm] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DisableValues>({
    resolver: zodResolver(disableSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const onSubmit = async (data: DisableValues) => {
    setIsPending(true);
    try {
      await mfaDisable(data.code);
      toast.success('Two-factor authentication has been disabled.');
      reset();
      setShowForm(false);
      onDisabled();
    } catch (err) {
      handleAuthClientError(err, { toast });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-6">
      <div className="mb-4 flex items-center gap-2">
        <ShieldOff className="h-4 w-4 text-[rgba(255,255,255,0.4)]" />
        <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-[rgba(255,255,255,0.4)]">
          Two-Factor Authentication
        </h2>
        <span className="ml-auto rounded-full border border-[rgba(34,197,94,0.3)] bg-[rgba(34,197,94,0.1)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#22c55e]">
          Enabled
        </span>
      </div>

      {!showForm ? (
        <div className="space-y-3">
          <p className="text-sm text-[rgba(255,255,255,0.55)]">
            Your account is protected with a TOTP authenticator app.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowForm(true)}
            className="border-red-500/30 text-red-400 hover:border-red-500/60 hover:bg-red-500/10 hover:text-red-300"
          >
            Disable two-factor authentication
          </Button>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
          <p className="text-sm text-[rgba(255,255,255,0.55)]">
            Enter a code from your authenticator app to confirm.
          </p>

          <div className="space-y-1.5">
            <Label className="text-xs text-[rgba(255,255,255,0.6)]">Authenticator code</Label>
            <Controller
              control={control}
              name="code"
              render={({ field }) => (
                <OtpInput length={6} value={field.value ?? ''} onChange={field.onChange} />
              )}
            />
            {errors.code && <p className="text-xs text-red-400">{errors.code.message}</p>}
          </div>

          <div className="flex gap-2">
            <Button type="submit" variant="destructive" size="sm" disabled={isPending}>
              {isPending ? 'Disabling…' : 'Confirm disable'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowForm(false);
                reset();
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
