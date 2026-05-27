/**
 * @fileoverview Platform admin MFA setup card — initiates TOTP enrolment for a
 * platform administrator.
 *
 * Parallel to the dashboard `MfaSetupCard` but pointed at the platform-specific
 * routes the lib mounts under `/api/auth/platform/mfa/*` (shipped in
 * `@bymax-one/nest-auth` ≥ 1.0.6). The flow itself is identical — secret + QR +
 * recovery codes are returned by `setup`, the first TOTP is confirmed via
 * `verify-enable`, and the recovery codes show in a modal once.
 *
 * Visual style matches the platform area's red-tinted theme (so an admin
 * always knows they are inside the platform context, not the tenant dashboard).
 *
 * @layer components/platform
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
import { RecoveryCodesModal } from '@/components/dashboard/recovery-codes-modal';
import {
  platformMfaSetup,
  platformMfaVerifyEnable,
  handleAuthClientError,
} from '@/lib/auth-client';
import { toQrDataUrl } from '@/lib/qrcode';

const verifySchema = z.object({
  code: z.string().length(6, 'Enter the 6-digit code from your authenticator app'),
});

type VerifyValues = z.infer<typeof verifySchema>;

interface PlatformMfaSetupCardProps {
  /** Called after MFA is successfully enabled so the parent can refresh state. */
  onEnabled: () => void;
}

/**
 * Card that guides the platform admin through TOTP enrolment.
 *
 * Renders a "Set up authenticator" button initially. On click, calls the
 * platform setup endpoint and renders a QR code plus a verification form.
 * On verify success, shows the recovery codes modal before calling
 * `onEnabled` so the parent can flip into the disable card.
 *
 * @param onEnabled - Callback invoked once MFA is successfully enabled.
 */
export function PlatformMfaSetupCard({ onEnabled }: PlatformMfaSetupCardProps) {
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
      const result = await platformMfaSetup();
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
      await platformMfaVerifyEnable(data.code);
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
      <div className="rounded-xl border border-[rgba(239,68,68,0.15)] bg-[rgba(20,0,0,0.4)] p-6">
        <div className="mb-4 flex items-center gap-2">
          <Shield className="h-4 w-4 text-red-400" />
          <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-[rgba(255,200,200,0.45)]">
            Platform Two-Factor Authentication
          </h2>
        </div>

        {step === 'idle' && (
          <div className="space-y-3">
            <p className="text-sm text-[rgba(255,200,200,0.6)]">
              Protect your platform admin account with a TOTP authenticator app (Google
              Authenticator, Authy, etc.). Strongly recommended for SUPER_ADMIN accounts — a
              compromised platform session can suspend tenants and access every workspace.
            </p>
            <Button
              size="sm"
              onClick={() => void handleSetup()}
              disabled={isLoading}
              data-testid="platform-mfa-setup-button"
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {isLoading ? 'Loading…' : 'Set up authenticator'}
            </Button>
          </div>
        )}

        {step === 'scanning' && qrDataUrl !== null && secret !== null && (
          <div className="space-y-4">
            <p className="text-sm text-[rgba(255,200,200,0.6)]">
              Scan this QR code with your authenticator app, then enter the 6-digit code below.
            </p>

            {/* QR code */}
            <div className="flex justify-center">
              <div className="rounded-lg bg-white p-2">
                <img src={qrDataUrl} alt="Platform MFA QR code" width={200} height={200} />
              </div>
            </div>

            {/* Manual entry fallback */}
            <div className="space-y-1">
              <Label className="text-xs text-[rgba(255,200,200,0.5)]">
                Or enter the secret manually
              </Label>
              <Input
                readOnly
                value={secret}
                data-testid="platform-mfa-secret"
                className="cursor-text font-mono text-xs"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
            </div>

            <form onSubmit={(e) => void handleSubmit(onVerify)(e)} className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-[rgba(255,200,200,0.7)]">
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
                  className="bg-red-500 text-white hover:bg-red-600"
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
