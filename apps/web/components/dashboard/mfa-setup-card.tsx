/**
 * @fileoverview MFA setup card — initiates TOTP enrollment.
 *
 * Flow:
 *   1. User clicks "Set up authenticator" → `POST /auth/mfa/setup`
 *   2. Card shows QR code + manual secret entry field
 *   3. User enters TOTP code → `POST /auth/mfa/verify-enable`
 *   4. On success, recovery codes from step 1 are shown in `RecoveryCodesModal`
 *   5. On modal dismiss, `onEnabled()` is called to re-fetch the MFA state
 *
 * Recovery codes are returned by `setup`, not by `verify-enable`. They are
 * stored in component state and cleared once the modal is dismissed.
 *
 * @layer components/dashboard
 */

'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import { toast } from 'sonner';
import { Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { OtpInput } from '@/components/auth/otp-input';
import { RecoveryCodesModal } from './recovery-codes-modal';
import { mfaSetup, mfaVerifyEnable, handleAuthClientError } from '@/lib/auth-client';
import { toQrDataUrl } from '@/lib/qrcode';

const verifySchema = z.object({
  code: z.string().length(6, 'Enter the 6-digit code from your authenticator app'),
});

type VerifyValues = z.infer<typeof verifySchema>;

interface MfaSetupCardProps {
  /** Called after MFA is successfully enabled so the parent can refresh state. */
  onEnabled: () => void;
}

/**
 * Card that guides the user through TOTP enrollment.
 *
 * Renders a "Set up" button initially. On click, calls the setup endpoint
 * and renders a QR code plus a verification form. On verify success, shows
 * the recovery codes modal before calling `onEnabled`.
 *
 * @param onEnabled - Callback invoked once MFA is successfully enabled.
 */
export function MfaSetupCard({ onEnabled }: MfaSetupCardProps) {
  const [step, setStep] = useState<'idle' | 'scanning' | 'verifying'>('idle');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const {
    control: formControl,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<VerifyValues>({
    resolver: zodResolver(verifySchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const handleSetup = async () => {
    setIsLoading(true);
    try {
      const result = await mfaSetup();
      const dataUrl = await toQrDataUrl(result.qrCodeUri);
      setQrDataUrl(dataUrl);
      setSecret(result.secret);
      setRecoveryCodes(result.recoveryCodes);
      setStep('scanning');
    } catch (err) {
      handleAuthClientError(err, { toast });
    } finally {
      setIsLoading(false);
    }
  };

  const onVerify = async (data: VerifyValues) => {
    setIsLoading(true);
    try {
      await mfaVerifyEnable(data.code);
      reset();
      setStep('idle');
      setQrDataUrl(null);
      setSecret(null);
      setShowModal(true);
    } catch (err) {
      handleAuthClientError(err, { toast });
    } finally {
      setIsLoading(false);
    }
  };

  const handleModalClose = () => {
    setShowModal(false);
    setRecoveryCodes([]);
    onEnabled();
  };

  return (
    <>
      <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-6">
        <div className="mb-4 flex items-center gap-2">
          <Shield className="h-4 w-4 text-[#ff6224]" />
          <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-[rgba(255,255,255,0.4)]">
            Two-Factor Authentication
          </h2>
        </div>

        {step === 'idle' && (
          <div className="space-y-3">
            <p className="text-sm text-[rgba(255,255,255,0.55)]">
              Protect your account with a TOTP authenticator app (Google Authenticator, Authy,
              etc.).
            </p>
            <Button
              size="sm"
              onClick={() => void handleSetup()}
              disabled={isLoading}
              className="bg-[#ff6224] text-white hover:bg-[#e5551f]"
            >
              {isLoading ? 'Loading…' : 'Set up authenticator'}
            </Button>
          </div>
        )}

        {step === 'scanning' && qrDataUrl !== null && secret !== null && (
          <div className="space-y-4">
            <p className="text-sm text-[rgba(255,255,255,0.55)]">
              Scan this QR code with your authenticator app, then enter the 6-digit code below.
            </p>

            {/* QR code */}
            <div className="flex justify-center">
              <div className="rounded-lg bg-white p-2">
                <img src={qrDataUrl} alt="MFA QR code" width={200} height={200} />
              </div>
            </div>

            {/* Manual entry fallback */}
            <div className="space-y-1">
              <Label className="text-xs text-[rgba(255,255,255,0.4)]">
                Or enter the secret manually
              </Label>
              <Input
                readOnly
                value={secret}
                className="cursor-text font-mono text-xs"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
            </div>

            <form onSubmit={(e) => void handleSubmit(onVerify)(e)} className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-[rgba(255,255,255,0.6)]">
                  Enter 6-digit code from authenticator
                </Label>
                <Controller
                  control={formControl}
                  name="code"
                  render={({ field }) => (
                    <OtpInput length={6} value={field.value ?? ''} onChange={field.onChange} />
                  )}
                />
                {errors.code && <p className="text-xs text-red-400">{errors.code.message}</p>}
              </div>

              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={isLoading}
                  className="bg-[#ff6224] text-white hover:bg-[#e5551f]"
                >
                  {isLoading ? 'Verifying…' : 'Verify & enable'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStep('idle');
                    setQrDataUrl(null);
                    setSecret(null);
                    reset();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>

      <RecoveryCodesModal open={showModal} onClose={handleModalClose} codes={recoveryCodes} />
    </>
  );
}
