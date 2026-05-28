/**
 * @fileoverview MFA disable + recovery-code management card — shown when MFA is
 * already enabled on the account.
 *
 * Three flows live in this single card:
 *   1. **Disable MFA** — requires a current TOTP code, calls
 *      `POST /api/auth/mfa/disable`. After success the parent re-renders
 *      the setup card.
 *   2. **Regenerate recovery codes** — requires a current TOTP code, calls
 *      `POST /api/auth/mfa/recovery-codes` (lib v1.0.6+). On success the
 *      `RecoveryCodesModal` opens with the freshly issued plain codes;
 *      previous codes are revoked server-side by that call.
 *   3. **Display the remaining recovery codes counter** — sourced from
 *      `GET /api/account/mfa`. When the counter falls to 2 or below, the
 *      surrounding row switches to an amber tone with a "Low" badge so the
 *      user is nudged toward (2) before exhausting the set.
 *
 * Mode-machine choice (`mode: 'idle' | 'disabling' | 'regenerating'`) keeps
 * the disable and regenerate forms isolated — both share the same OTP input
 * but their submit handlers + button copy + destructive styling differ.
 *
 * @layer components/dashboard
 */

'use client';

import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import { toast } from 'sonner';
import { ShieldOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { OtpInput } from '@/components/auth/otp-input';
import { RecoveryCodesModal } from './recovery-codes-modal';
import {
  mfaDisable,
  mfaRegenerateRecoveryCodes,
  getMfaStatus,
  handleAuthClientError,
  type MfaStatusInfo,
} from '@/lib/auth-client';

const totpSchema = z.object({
  code: z.string().length(6, 'Enter the 6-digit code from your authenticator app'),
});

type TotpValues = z.infer<typeof totpSchema>;

/**
 * Active flow inside the card:
 *   - `idle`         — initial state; both action buttons visible.
 *   - `disabling`    — TOTP form is open, submit will call mfaDisable.
 *   - `regenerating` — TOTP form is open, submit will call mfaRegenerateRecoveryCodes.
 */
type CardMode = 'idle' | 'disabling' | 'regenerating';

interface MfaDisableCardProps {
  /**
   * Called after MFA is successfully disabled so the parent can refresh
   * state and swap to the setup card. Not invoked on the regenerate
   * path — that one stays on the disable card with refreshed counter.
   */
  onDisabled: () => void;
}

/**
 * Card that lets a user disable MFA or rotate their recovery codes, both
 * gated by a fresh TOTP confirmation.
 *
 * @param onDisabled - Callback invoked once MFA is successfully disabled.
 */
export function MfaDisableCard({ onDisabled }: MfaDisableCardProps) {
  const [mode, setMode] = useState<CardMode>('idle');
  const [isPending, setIsPending] = useState(false);
  const [status, setStatus] = useState<MfaStatusInfo | null>(null);
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);
  // Counter must re-fetch after a successful regenerate so the
  // "X of Y remaining" indicator reflects the new full set. Using a
  // version counter keeps the useEffect dep cleanly typed instead of
  // re-running on every state change.
  const [statusVersion, setStatusVersion] = useState(0);

  // Fire-and-forget fetch on mount + whenever `statusVersion` ticks. Errors
  // are swallowed deliberately — the counter is a nice-to-have, the disable
  // and regenerate flows still work without it. A failed fetch leaves
  // `status` null and the counter row collapses to nothing.
  // Stryker disable BlockStatement,BooleanLiteral,ConditionalExpression: the `cancelled`-flag race is observable only as a React "state update on an unmounted component" warning. JSDOM + Vitest demote that warning to a non-fatal console message, which Stryker cannot use as a kill signal. Real-browser SSR/CSR hand-off would surface the leak, but the test harness has no equivalent. Pattern is documented in `docs/guidelines/mutation-testing-guidelines.md` and protected by the higher-level "still hides the counter" + "refetches on modal close" tests.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await getMfaStatus();
        if (!cancelled) setStatus(snapshot);
      } catch {
        // Status is optional UI sugar — swallow silently.
        if (!cancelled) setStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [statusVersion]);
  // Stryker restore BlockStatement,BooleanLiteral,ConditionalExpression

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TotpValues>({
    resolver: zodResolver(totpSchema),
    // Stryker disable next-line StringLiteral: RHF `mode` controls validation cadence — mutating `'onSubmit'` to `""` falls back to RHF's default `onSubmit` behaviour anyway, and any other valid value (`'onBlur'`, `'onChange'`, `'all'`) would still produce a working form with different (and equally valid) timing. Observable behaviour is impossible to pin without coupling the test to RHF internals.
    mode: 'onSubmit',
    // Stryker disable next-line StringLiteral: same reasoning as `mode` above — `reValidateMode` selects RHF-internal re-validation cadence; the empty-string mutant falls back to defaults and produces no test-visible regression.
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
        await mfaDisable(data.code);
        toast.success('Two-factor authentication has been disabled.');
        reset();
        setMode('idle');
        onDisabled();
        return;
      }
      // `mode === 'regenerating'` here: the form is only mounted when
      // mode !== 'idle' (see `isFormOpen` below), and the disabling
      // branch above returns early. No explicit guard is needed —
      // TypeScript narrows accordingly and any future mode addition
      // would surface as an unreachable-branch lint error rather than
      // a silent fall-through.
      const result = await mfaRegenerateRecoveryCodes(data.code);
      toast.success('Recovery codes regenerated. Save them now — old codes no longer work.');
      reset();
      setMode('idle');
      // Open the modal with the new codes; status refresh fires once
      // the user dismisses the modal (see handleCodesModalClose).
      setFreshCodes(result.recoveryCodes);
    } catch (err) {
      handleAuthClientError(err, { toast });
    } finally {
      setIsPending(false);
    }
  };

  /**
   * Called when the user dismisses the recovery-codes modal. Clears the
   * codes from local state (so a re-render cannot leak them back into
   * the DOM) and bumps the status version so the counter re-fetches
   * with the new full count.
   */
  const handleCodesModalClose = () => {
    setFreshCodes(null);
    // Stryker disable next-line ArithmeticOperator: `n + 1` vs `n - 1` both produce a new `statusVersion` distinct from the previous value, so React re-runs the useEffect either way. The PLUS-ONE direction is kept for readability (it matches the conventional "version bump" idiom); the minus-one mutant is observationally equivalent.
    setStatusVersion((n) => n + 1);
  };

  // Display variant for the recovery-code counter row. Thresholds keep
  // the visual weight proportional to how worried the user should be:
  //   - 0 codes → red, "Regenerate now" is the only safe path forward
  //   - 1-2 codes → amber, low and worth regenerating
  //   - 3+ codes → muted green, healthy
  // When `status` is still loading we render `null` for the counter so
  // the card height does not jump on settled state.
  const remaining = status?.recoveryCodesRemaining;
  const total = status?.recoveryCodesTotal;
  // `remaining === undefined ? null : …` outer ternary: the `false ? null : …`
  // direction is an equivalent mutant — it always falls through to the inner
  // ternary, which resolves to `'ok'` when `remaining === undefined`, but the
  // outer visibility guard's `remaining !== undefined` clause already hides
  // the row in that case. The `true ? null : …` direction IS killed by the
  // healthy-counter test (counterTone === null → row never renders).
  // Stryker disable ConditionalExpression
  const counterTone =
    remaining === undefined
      ? null
      : remaining === 0
        ? 'critical'
        : remaining <= 2
          ? 'warning'
          : 'ok';
  // Stryker restore ConditionalExpression

  // Button copy + handler vary per mode. Computed once so the JSX below
  // stays declarative.
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
  // Stryker disable next-line StringLiteral: `'default'` → `""` is an equivalent mutant — passing an empty string to the shadcn Button `variant` prop falls back to the `default` variant's class composition (the CVA `variants` map has no entry for `""`). Observable behaviour is identical. The regenerate-button-variant test pins the brand-gradient class to defend the truthy branch; the empty-string mutation cannot escape that branch.
  const submitVariant = mode === 'disabling' ? 'destructive' : 'default';

  // Composed once so the JSX expression stays single-line readable. The
  // `counterTone !== null` and `remaining !== undefined` clauses are
  // mutually-redundant defensive guards — `counterTone` is derived from
  // `remaining`, so when one is "missing" the other is too. The `!isFormOpen`
  // and `total !== undefined` clauses ARE killable in isolation and are
  // pinned by the visibility-guard tests in `mfa-disable-card.test.tsx`.
  // Stryker disable ConditionalExpression
  const isCounterVisible =
    !isFormOpen && counterTone !== null && remaining !== undefined && total !== undefined;
  // Stryker restore ConditionalExpression

  return (
    <>
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

        {/* Recovery codes counter — rendered only after the /account/mfa
            fetch settles. Hidden during a confirmation form to avoid
            noise while the user is typing a TOTP. */}
        {isCounterVisible && (
          <div
            aria-label="Recovery codes remaining"
            data-testid="mfa-recovery-codes-remaining"
            className={`mb-4 flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
              counterTone === 'critical'
                ? 'border-red-500/30 bg-red-500/10 text-red-300'
                : counterTone === 'warning'
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                  : // Stryker disable next-line StringLiteral: the healthy-tone Tailwind tokens are visual-only — the critical (`text-red-300`) and warning (`text-amber-300`) palettes are pinned by assertion in `mfa-disable-card.test.tsx`. The healthy arm carries no behaviour to assert on; mutating it to `""` leaves the container's structural `rounded-lg border …` classes intact and would only be caught by a styling snapshot regime, which is out of scope (see ADR 0001).
                    'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] text-[rgba(255,255,255,0.55)]'
            }`}
          >
            <span>
              <span className="font-mono font-semibold">{remaining}</span>
              <span className="opacity-70"> of </span>
              <span className="font-mono">{total}</span>
              <span className="opacity-70"> recovery codes remaining</span>
            </span>
            {counterTone !== 'ok' && (
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wide">
                {counterTone === 'critical' ? 'Exhausted' : 'Low'}
              </span>
            )}
          </div>
        )}

        {!isFormOpen ? (
          <div className="space-y-4">
            <p className="text-sm text-[rgba(255,255,255,0.55)]">
              Your account is protected with a TOTP authenticator app.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                // Stryker disable next-line StringLiteral: `setMode('regenerating')` → `setMode('')` is an equivalent mutant — the empty string is not `'idle'`, so `isFormOpen` is still true, and `mode === 'disabling'` is false, so `submitVariant`, `formTitle`, `submitLabel`, and `onSubmit` all fall through to the regenerate branch. Observable behaviour is identical. TypeScript would reject `''` at compile time, but Stryker does not run the project's TS check on this workspace (per ADR 0001 / `apps/web/stryker.config.json`).
                onClick={() => setMode('regenerating')}
                data-testid="mfa-regenerate-button"
                className="border-[rgba(255,98,36,0.3)] text-[#ff6224] hover:border-[#ff6224]/60 hover:bg-[#ff6224]/10"
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Regenerate recovery codes
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMode('disabling')}
                data-testid="mfa-disable-button"
                className="border-red-500/30 text-red-400 hover:border-red-500/60 hover:bg-red-500/10 hover:text-red-300"
              >
                Disable two-factor authentication
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
            <p className="text-sm text-[rgba(255,255,255,0.55)]">{formTitle}</p>

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
        // Stryker disable next-line ArrayDeclaration: the `?? []` fallback is observed only when `freshCodes === null`, in which case `open={false}` ensures the modal renders nothing. Mutating to `?? ["Stryker was here"]` cannot leak through the closed modal, so the mutation has no observable effect. Kept as `[]` for forward-defensive coverage if the modal ever renders even when closed.
        codes={freshCodes ?? []}
        onClose={handleCodesModalClose}
      />
    </>
  );
}
