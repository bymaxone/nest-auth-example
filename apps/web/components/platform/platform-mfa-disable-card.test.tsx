/**
 * @fileoverview Unit tests for `PlatformMfaDisableCard`.
 *
 * Mirrors the dashboard `MfaDisableCard` tests but pins the platform
 * client helpers — disable + regenerate calls MUST hit
 * `/api/auth/platform/mfa/*` routes, never the dashboard equivalents.
 *
 * @module components/platform/platform-mfa-disable-card.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/auth-client', () => ({
  platformMfaDisable: vi.fn(),
  platformMfaRegenerateRecoveryCodes: vi.fn(),
  handleAuthClientError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import {
  platformMfaDisable,
  platformMfaRegenerateRecoveryCodes,
  handleAuthClientError,
} from '@/lib/auth-client';
import { PlatformMfaDisableCard } from './platform-mfa-disable-card.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PlatformMfaDisableCard idle state', () => {
  it('renders both the regenerate and disable buttons + the Enabled badge', () => {
    /*
     * Scenario: a platform admin with MFA on must see both actions
     * (regenerate + disable) plus the Enabled status badge so they
     * understand the current posture at a glance. Pinning both test
     * ids so e2e specs can locate them deterministically.
     */
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);
    expect(screen.getByTestId('platform-mfa-regenerate-button')).toBeDefined();
    expect(screen.getByTestId('platform-mfa-disable-button')).toBeDefined();
    expect(screen.getByText('Enabled')).toBeDefined();
  });
});

describe('PlatformMfaDisableCard disable flow', () => {
  it('calls platformMfaDisable with the TOTP and invokes onDisabled on success', async () => {
    /*
     * Scenario: a platform admin enters their TOTP and confirms
     * disable. The card must call POST /api/auth/platform/mfa/disable
     * (NOT the dashboard equivalent) and fire the onDisabled callback
     * so the parent flips back to the setup card. Protects platform
     * route choice + onDisabled hand-off.
     */
    vi.mocked(platformMfaDisable).mockResolvedValue(undefined);
    const onDisabled = vi.fn();
    render(<PlatformMfaDisableCard onDisabled={onDisabled} />);

    fireEvent.click(screen.getByTestId('platform-mfa-disable-button'));
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm disable/i }));

    await waitFor(() => {
      expect(platformMfaDisable).toHaveBeenCalledWith('123456');
      expect(onDisabled).toHaveBeenCalledOnce();
    });
  });

  it('shows "Disabling…" while platformMfaDisable is pending', async () => {
    /*
     * Scenario: keep the admin informed during the round-trip. The
     * submit button must surface a loading affordance distinct from
     * the regenerate flow's "Regenerating…".
     */
    vi.mocked(platformMfaDisable).mockReturnValue(new Promise(() => undefined));
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);

    fireEvent.click(screen.getByTestId('platform-mfa-disable-button'));
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm disable/i }));

    await waitFor(() => {
      expect(screen.getByText('Disabling…')).toBeDefined();
    });
  });

  it('routes platformMfaDisable rejections through handleAuthClientError', async () => {
    /*
     * Scenario: the disable endpoint rejects (wrong TOTP, account
     * locked, etc.). The card must surface the error and keep the
     * form open so the admin can retry. Protects the catch arm.
     */
    const err = new Error('Invalid TOTP');
    vi.mocked(platformMfaDisable).mockRejectedValue(err);
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);

    fireEvent.click(screen.getByTestId('platform-mfa-disable-button'));
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm disable/i }));

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
  });

  it('returns to idle when Cancel is clicked from the disable form', () => {
    /*
     * Scenario: admin opens disable form, second-guesses. Cancel must
     * restore the idle UI without firing platformMfaDisable.
     */
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-disable-button'));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByTestId('platform-mfa-disable-button')).toBeDefined();
    expect(platformMfaDisable).not.toHaveBeenCalled();
  });

  it('shows a validation error when submitting with an incomplete code', async () => {
    /*
     * Scenario: an admin submits without filling all 6 OTP digits.
     * Zod validation must fire and prevent the API call. Protects
     * the schema length(6) check via React Hook Form's resolver.
     */
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-disable-button'));
    fireEvent.click(screen.getByRole('button', { name: /confirm disable/i }));
    await waitFor(() => {
      const errorParagraphs = document.querySelectorAll('p.text-xs.text-red-400');
      expect(errorParagraphs.length).toBeGreaterThan(0);
    });
  });
});

describe('PlatformMfaDisableCard regenerate flow', () => {
  it('submits the TOTP and opens the modal with the fresh codes', async () => {
    /*
     * Scenario: a platform admin rotates their recovery codes. The
     * card must call POST /api/auth/platform/mfa/recovery-codes,
     * receive the new codes, and reveal the codes modal so the admin
     * can save them. Protects the platform-route + modal hand-off.
     */
    const newCodes = ['1111-2222-3333-4444-5555-6666', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'];
    vi.mocked(platformMfaRegenerateRecoveryCodes).mockResolvedValue({
      recoveryCodes: newCodes,
    });
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);

    fireEvent.click(screen.getByTestId('platform-mfa-regenerate-button'));
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /^regenerate codes$/i }));

    await waitFor(() => {
      expect(platformMfaRegenerateRecoveryCodes).toHaveBeenCalledWith('123456');
    });
    await waitFor(() => {
      newCodes.forEach((c) => expect(screen.getByText(c)).toBeDefined());
    });
  });

  it('shows "Regenerating…" while platformMfaRegenerateRecoveryCodes is pending', async () => {
    /*
     * Scenario: per-mode submit label — the regenerate path uses a
     * distinct copy from the disable path. Protects the per-mode
     * label branch.
     */
    vi.mocked(platformMfaRegenerateRecoveryCodes).mockReturnValue(new Promise(() => undefined));
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);

    fireEvent.click(screen.getByTestId('platform-mfa-regenerate-button'));
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /^regenerate codes$/i }));

    await waitFor(() => {
      expect(screen.getByText('Regenerating…')).toBeDefined();
    });
  });

  it('routes regenerate rejections through handleAuthClientError', async () => {
    /*
     * Scenario: regenerate fails (wrong TOTP, anti-replay, etc.). The
     * card must surface the error and keep the form open.
     */
    const err = new Error('Invalid TOTP');
    vi.mocked(platformMfaRegenerateRecoveryCodes).mockRejectedValue(err);
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);

    fireEvent.click(screen.getByTestId('platform-mfa-regenerate-button'));
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /^regenerate codes$/i }));

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
  });

  it('closes the recovery-codes modal on "I have saved my codes" and clears the codes from state', async () => {
    /*
     * Scenario: after the modal renders the new codes the user clicks
     * "I have saved my codes". The card must remove the codes from
     * component state so they cannot leak back into the DOM on a
     * subsequent re-render. Protects the `setFreshCodes(null)` line
     * inside handleCodesModalClose.
     */
    const newCodes = ['AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'];
    vi.mocked(platformMfaRegenerateRecoveryCodes).mockResolvedValue({
      recoveryCodes: newCodes,
    });
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);

    fireEvent.click(screen.getByTestId('platform-mfa-regenerate-button'));
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /^regenerate codes$/i }));

    await waitFor(() => expect(screen.getByText(newCodes[0]!)).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /saved my codes/i }));
    await waitFor(() => {
      expect(screen.queryByText(newCodes[0]!)).toBeNull();
    });
  });

  it('returns to idle when Cancel is clicked from the regenerate form', () => {
    /*
     * Scenario: admin opens regenerate, decides not to. Cancel must
     * restore the idle UI without firing the API.
     */
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-regenerate-button'));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByTestId('platform-mfa-regenerate-button')).toBeDefined();
    expect(platformMfaRegenerateRecoveryCodes).not.toHaveBeenCalled();
  });
});

// ── Verbatim copy + per-mode variant ─────────────────────────────────────────

import { toast } from 'sonner';

describe('PlatformMfaDisableCard surfaces verbatim copy + variant choices', () => {
  /** Helper — fill all 6 OTP boxes with digits "1"-"6" so the form is valid. */
  function fillOtpInputs(): void {
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });
  }

  it('toasts the verbatim "Platform MFA has been disabled." message after disable success', async () => {
    /*
     * Scenario: the success toast is the only confirmation the operator
     * receives that the platform-level MFA was disabled (the surrounding
     * card also swaps via onDisabled, but the toast is what audit
     * dashboards and support docs pattern-match on). Pinned word-for-word.
     */
    vi.mocked(platformMfaDisable).mockResolvedValue(undefined);
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-disable-button'));
    fillOtpInputs();
    fireEvent.click(screen.getByRole('button', { name: /confirm disable/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Platform MFA has been disabled.');
    });
  });

  it('toasts the verbatim "codes regenerated" warning after a rotation succeeds', async () => {
    /*
     * Scenario: the rotate toast doubles as a warning ("old codes no
     * longer work") — truncating the second clause would erase the
     * warning that anchors the recovery-code rotation UX.
     */
    vi.mocked(platformMfaRegenerateRecoveryCodes).mockResolvedValue({
      recoveryCodes: ['CODE-1'],
    });
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-regenerate-button'));
    fillOtpInputs();
    fireEvent.click(screen.getByRole('button', { name: /^regenerate codes$/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'Recovery codes regenerated. Save them now — old codes no longer work.',
      );
    });
  });

  it('renders the disable form title verbatim (no "rotation" clause)', () => {
    /*
     * Scenario: the disable form title MUST end with "to confirm." not
     * "to confirm the rotation." Pinned to defend against a copy swap
     * with the regenerate variant.
     */
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-disable-button'));
    expect(screen.getByText('Enter a code from your authenticator app to confirm.')).toBeDefined();
  });

  it('renders the regenerate form title verbatim with the rotation clause', () => {
    /*
     * Scenario: counterpart to the disable title — the rotation form
     * must include "the rotation." so the user understands they are
     * regenerating, not disabling.
     */
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-regenerate-button'));
    expect(
      screen.getByText('Enter a code from your authenticator app to confirm the rotation.'),
    ).toBeDefined();
  });

  it('renders the disable submit button with the destructive Tailwind variant class', () => {
    /*
     * Scenario: the disable action is destructive — once executed, the
     * platform admin loses second-factor coverage. The submit button
     * must visually surface this risk via the `destructive` shadcn
     * variant (red palette), not the neutral `default` brand gradient.
     */
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-disable-button'));
    const submit = screen.getByRole('button', { name: /confirm disable/i });
    expect(submit.className).toMatch(/bg-destructive/);
  });

  it('renders the regenerate submit button with the default (brand-gradient) variant', () => {
    /*
     * Scenario: routine maintenance — the regenerate submit button must
     * use the neutral `default` variant, not the destructive palette.
     * Pinning `from-brand-500` because that fragment is unique to the
     * default Button variant.
     */
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-regenerate-button'));
    const submit = screen.getByRole('button', { name: /^regenerate codes$/i });
    expect(submit.className).not.toMatch(/bg-destructive/);
    expect(submit.className).toMatch(/from-brand-500/);
  });
});

// ── Idle restoration + isPending reset ───────────────────────────────────────

describe('PlatformMfaDisableCard recovers idle UI after each terminal state', () => {
  /** Same helper as above. */
  function fillOtpInputs(): void {
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });
  }

  it('returns to the idle UI after a successful regenerate (form hidden, regenerate button visible)', async () => {
    /*
     * Scenario: after `platformMfaRegenerateRecoveryCodes` resolves, the
     * form must collapse (no Cancel button) and the idle regenerate
     * button must reappear so the admin can rotate again later without
     * a reload. Pins the `setMode('idle')` literal in the regenerate
     * success arm — a regression to `setMode('')` would keep
     * `isFormOpen` true and the form would remain on screen alongside
     * the open modal.
     */
    vi.mocked(platformMfaRegenerateRecoveryCodes).mockResolvedValue({
      recoveryCodes: ['NEW-CODE-1'],
    });
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-regenerate-button'));
    fillOtpInputs();
    fireEvent.click(screen.getByRole('button', { name: /^regenerate codes$/i }));

    await screen.findByText('NEW-CODE-1');
    expect(screen.queryByRole('button', { name: /^cancel$/i })).toBeNull();
    expect(screen.getByTestId('platform-mfa-regenerate-button')).toBeDefined();
  });

  it('re-enables the submit button after a failed disable so the admin can retry', async () => {
    /*
     * Scenario: when platformMfaDisable rejects, the `finally` block
     * must flip `isPending` back to `false` so the submit button is
     * clickable again. Pinning the `finally { setIsPending(false) }`
     * block — removing it leaves the button permanently disabled, and
     * flipping the literal to `true` does the same.
     */
    vi.mocked(platformMfaDisable).mockRejectedValue(new Error('Invalid TOTP'));
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-disable-button'));
    fillOtpInputs();
    fireEvent.click(screen.getByRole('button', { name: /confirm disable/i }));

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalled();
    });
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: /confirm disable/i });
    expect(submit.disabled).toBe(false);
  });

  it('re-enables the submit button after a failed regenerate so the admin can retry', async () => {
    /*
     * Scenario: same retry-affordance contract on the regenerate path.
     * Pinned independently so a future refactor cannot branch the
     * finally cleanup per mode.
     */
    vi.mocked(platformMfaRegenerateRecoveryCodes).mockRejectedValue(new Error('Invalid TOTP'));
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-regenerate-button'));
    fillOtpInputs();
    fireEvent.click(screen.getByRole('button', { name: /^regenerate codes$/i }));

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalled();
    });
    const submit = screen.getByRole<HTMLButtonElement>('button', {
      name: /^regenerate codes$/i,
    });
    expect(submit.disabled).toBe(false);
  });

  it('returns to the idle UI after a successful disable (Cancel gone, disable button visible)', async () => {
    /*
     * Scenario: after `platformMfaDisable` resolves the card must swap
     * `mode` back to `'idle'` so the parent can re-render the setup
     * card. Pinning the `setMode('idle')` literal in the disable
     * success arm — a regression to `setMode('')` would leave the form
     * visible underneath the parent swap.
     */
    vi.mocked(platformMfaDisable).mockResolvedValue(undefined);
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-disable-button'));
    fillOtpInputs();
    fireEvent.click(screen.getByRole('button', { name: /confirm disable/i }));

    await waitFor(() => {
      expect(platformMfaDisable).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^cancel$/i })).toBeNull();
    });
    expect(screen.getByTestId('platform-mfa-disable-button')).toBeDefined();
  });

  it('passes the empty OTP value to the inner OtpInput when the form field is undefined', () => {
    /*
     * Scenario: React Hook Form initialises the `code` field as undefined.
     * The Controller's render must coerce that undefined to the empty
     * string before handing it to OtpInput, so the boxes start empty
     * rather than displaying the literal string "undefined" (or
     * "Stryker"). Pins the `field.value ?? ''` fallback.
     */
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-disable-button'));
    const inputs = screen.getAllByRole<HTMLInputElement>('textbox');
    for (const input of inputs) {
      expect(input.value).toBe('');
    }
  });

  it('passes the freshly-issued codes to the RecoveryCodesModal without padding or substituting', async () => {
    /*
     * Scenario: the regenerate API returns the brand-new recovery codes
     * exactly once — if the modal renders anything other than the API's
     * verbatim array (an empty array, a placeholder, a duplicated
     * entry) the operator permanently loses the only window in which
     * those codes are recoverable.
     */
    const newCodes = ['ALPHA-1', 'BRAVO-2', 'CHARLIE-3'];
    vi.mocked(platformMfaRegenerateRecoveryCodes).mockResolvedValue({ recoveryCodes: newCodes });
    render(<PlatformMfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-regenerate-button'));
    fillOtpInputs();
    fireEvent.click(screen.getByRole('button', { name: /^regenerate codes$/i }));

    for (const code of newCodes) {
      await screen.findByText(code);
    }
    expect(screen.queryByText('Stryker was here')).toBeNull();
  });
});
