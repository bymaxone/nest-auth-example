/**
 * @fileoverview Platform admin MFA disable + recovery-code management card.
 *
 * Parallel to the dashboard `MfaDisableCard` but pointed at the
 * platform-specific routes (`/api/auth/platform/mfa/*`). Same three flows:
 *   1. Disable MFA → TOTP confirmation → `POST /api/auth/platform/mfa/disable`.
 *   2. Regenerate recovery codes → TOTP confirmation →
 *      `POST /api/auth/platform/mfa/recovery-codes`. New codes shown once.
 *   3. (No counter UI here — the platform `GET /platform/me` payload does NOT
 *      expose the remaining-codes count, and adding a custom `/account/mfa`
 *      style endpoint for platform admins is out of scope. The Security
 *      page renders only the action buttons + status badge.)
 *
 * Visual style uses the red-tinted platform theme so the operator always
 * knows they are touching the platform context, not their tenant account.
 *
 * @layer components/platform
 */

'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import { toast } from 'sonner';
import { ShieldOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { OtpInput } from '@/components/auth/otp-input';
import { RecoveryCodesModal } from '@/components/dashboard/recovery-codes-modal';
import {
  platformMfaDisable,
  platformMfaRegenerateRecoveryCodes,
  handleAuthClientError,
} from '@/lib/auth-client';

const totpSchema = z.object({
  code: z.string().length(6, 'Enter the 6-digit code from your authenticator app'),
});

type TotpValues = z.infer<typeof totpSchema>;

/** Active flow inside the card; mirrors `MfaDisableCard`'s `CardMode`. */
type CardMode = 'idle' | 'disabling' | 'regenerating';

interface PlatformMfaDisableCardProps {
  /**
   * Called after MFA is successfully disabled so the parent can refresh
   * state and swap to the setup card. Not invoked on the regenerate
   * path — that one stays on the disable card.
   */
  onDisabled: () => void;
}

/**
 * Card that lets a platform admin disable MFA or rotate their recovery
 * codes, both gated by a fresh TOTP confirmation.
 *
 * @param onDisabled - Callback invoked once MFA is successfully disabled.
 */
export function PlatformMfaDisableCard({ onDisabled }: PlatformMfaDisableCardProps) {
  const [mode, setMode] = useState<CardMode>('idle');
  const [isPending, setIsPending] = useState(false);
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TotpValues>({
    resolver: zodResolver(totpSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const returnToIdle = () => {
    setMode('idle');
    reset();
  };

  const onSubmit = async (data: TotpValues) => {
    setIsPending(true);
    try {
      if (mode === 'disabling') {
        await platformMfaDisable(data.code);
        toast.success('Platform MFA has been disabled.');
        reset();
        setMode('idle');
        onDisabled();
        return;
      }
      // `mode === 'regenerating'` here — see the dashboard MfaDisableCard
      // for the rationale on dropping the redundant check.
      const result = await platformMfaRegenerateRecoveryCodes(data.code);
      toast.success('Recovery codes regenerated. Save them now — old codes no longer work.');
      reset();
      setMode('idle');
      setFreshCodes(result.recoveryCodes);
    } catch (err) {
      handleAuthClientError(err, { toast });
    } finally {
      setIsPending(false);
    }
  };

  const handleCodesModalClose = () => {
    setFreshCodes(null);
  };

  const isFormOpen = mode !== 'idle';
  const formTitle =
    mode === 'disabling'
      ? 'Enter a code from your authenticator app to confirm.'
      : 'Enter a code from your authenticator app to confirm the rotation.';
  const submitLabel =
    mode === 'disabling'
      ? isPending
        ? 'Disabling…'
        : 'Confirm disable'
      : isPending
        ? 'Regenerating…'
        : 'Regenerate codes';
  const submitVariant = mode === 'disabling' ? 'destructive' : 'default';

  return (
    <>
      <div className="rounded-xl border border-[rgba(239,68,68,0.15)] bg-[rgba(20,0,0,0.4)] p-6">
        <div className="mb-4 flex items-center gap-2">
          <ShieldOff className="h-4 w-4 text-[rgba(255,200,200,0.45)]" />
          <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-[rgba(255,200,200,0.45)]">
            Platform Two-Factor Authentication
          </h2>
          <span className="ml-auto rounded-full border border-[rgba(34,197,94,0.3)] bg-[rgba(34,197,94,0.1)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#22c55e]">
            Enabled
          </span>
        </div>

        {!isFormOpen ? (
          <div className="space-y-4">
            <p className="text-sm text-[rgba(255,200,200,0.6)]">
              Your platform admin account is protected with a TOTP authenticator app.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMode('regenerating')}
                data-testid="platform-mfa-regenerate-button"
                className="border-red-500/30 text-red-300 hover:border-red-500/60 hover:bg-red-500/10"
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Regenerate recovery codes
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMode('disabling')}
                data-testid="platform-mfa-disable-button"
                className="border-red-500/30 text-red-400 hover:border-red-500/60 hover:bg-red-500/10 hover:text-red-300"
              >
                Disable platform MFA
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
            <p className="text-sm text-[rgba(255,200,200,0.6)]">{formTitle}</p>

            <div className="space-y-1.5">
              <Label className="text-xs text-[rgba(255,200,200,0.7)]">Authenticator code</Label>
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
              <Button type="submit" variant={submitVariant} size="sm" disabled={isPending}>
                {submitLabel}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={returnToIdle}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>

      <RecoveryCodesModal
        open={freshCodes !== null}
        codes={freshCodes ?? []}
        onClose={handleCodesModalClose}
      />
    </>
  );
}
