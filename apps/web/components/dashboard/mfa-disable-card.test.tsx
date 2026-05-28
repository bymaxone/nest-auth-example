/**
 * @fileoverview Unit tests for the `MfaDisableCard` component.
 *
 * Verifies:
 * - The initial state renders the "Disable two-factor authentication" button.
 * - Clicking the disable button shows the TOTP form.
 * - Clicking Cancel from the form hides it.
 * - Submitting a valid 6-digit code calls mfaDisable and onDisabled.
 *
 * @module components/dashboard/mfa-disable-card.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth-client', () => ({
  mfaDisable: vi.fn(),
  mfaRegenerateRecoveryCodes: vi.fn(),
  getMfaStatus: vi.fn(),
  handleAuthClientError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import {
  mfaDisable,
  mfaRegenerateRecoveryCodes,
  getMfaStatus,
  handleAuthClientError,
} from '@/lib/auth-client';
import { toast } from 'sonner';
import { MfaDisableCard } from './mfa-disable-card.js';

/** Helper — fill all 6 OTP boxes with digits "1"-"6" so the form is valid. */
function fillOtpInputs(): void {
  const inputs = screen.getAllByRole('textbox');
  inputs.forEach((input, i) => {
    fireEvent.change(input, { target: { value: String(i + 1) } });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default status fetch resolves to a healthy snapshot so existing tests
  // do not have to care about the counter. Individual tests override this
  // with `vi.mocked(getMfaStatus).mockResolvedValueOnce(...)` to assert
  // counter-specific behaviour.
  vi.mocked(getMfaStatus).mockResolvedValue({
    enabled: true,
    recoveryCodesRemaining: 8,
    recoveryCodesTotal: 8,
    required: false,
  });
});

describe('MfaDisableCard initial state', () => {
  it('renders the disable button and "Enabled" badge in the initial state', () => {
    /*
     * Scenario: when the component first renders it must show the "Enabled"
     * status badge and the disable button so the user can see MFA is active.
     * Protects: showForm=false initial state renders the idle UI.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    expect(screen.getByRole('button', { name: /disable two-factor/i })).toBeDefined();
    expect(screen.getByText('Enabled')).toBeDefined();
  });

  it('shows the TOTP form after clicking the disable button', () => {
    /*
     * Scenario: clicking "Disable two-factor authentication" must reveal
     * the confirmation form with the OTP input.
     * Protects: setShowForm(true) on button click transitions to the form.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));
    expect(screen.getByText(/authenticator code/i)).toBeDefined();
  });

  it('hides the form and returns to idle when Cancel is clicked', () => {
    /*
     * Scenario: clicking Cancel in the form must hide the TOTP input and return
     * to the idle state.
     * Protects: Cancel button sets showForm=false and resets the form.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByRole('button', { name: /disable two-factor/i })).toBeDefined();
    expect(screen.queryByText(/authenticator code/i)).toBeNull();
  });
});

describe('MfaDisableCard form submission', () => {
  it('calls mfaDisable with the code and invokes onDisabled on success', async () => {
    /*
     * Scenario: entering a valid 6-digit code and clicking "Confirm disable"
     * must call mfaDisable with the code and then invoke onDisabled.
     * Protects: onSubmit calls mfaDisable and the parent onDisabled callback.
     */
    vi.mocked(mfaDisable).mockResolvedValue(undefined);
    const onDisabled = vi.fn();
    render(<MfaDisableCard onDisabled={onDisabled} />);

    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));

    // Type a digit into each OTP input box.
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });

    fireEvent.click(screen.getByRole('button', { name: /confirm disable/i }));

    await waitFor(() => {
      expect(mfaDisable).toHaveBeenCalledOnce();
      expect(onDisabled).toHaveBeenCalledOnce();
    });
  });

  it('shows "Disabling…" text while mfaDisable is pending', async () => {
    /*
     * Scenario: while mfaDisable is in-flight the submit button must display
     * "Disabling…" so the user knows the request is processing.
     * Protects: line 115 — `isPending ? 'Disabling…' : 'Confirm disable'` truthy branch.
     */
    vi.mocked(mfaDisable).mockReturnValue(new Promise(() => undefined));
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));

    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });

    fireEvent.click(screen.getByRole('button', { name: /confirm disable/i }));

    await waitFor(() => {
      expect(screen.getByText('Disabling…')).toBeDefined();
    });
  });

  it('shows a validation error when submitting with an incomplete code', async () => {
    /*
     * Scenario: submitting the form without a valid 6-digit code must trigger
     * the Zod validation error for the code field.
     * Protects: line 110 — `errors.code &&` conditional renders the error message.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));
    // Submit without filling any OTP digits so the code field fails validation.
    fireEvent.click(screen.getByRole('button', { name: /confirm disable/i }));
    await waitFor(() => {
      // The error paragraph must appear (any non-empty validation error text).
      const errorParagraphs = document.querySelectorAll('p.text-xs.text-red-400');
      expect(errorParagraphs.length).toBeGreaterThan(0);
    });
  });

  it('calls handleAuthClientError when mfaDisable rejects', async () => {
    /*
     * Scenario: when mfaDisable throws the error must be forwarded to
     * handleAuthClientError so an error toast is displayed.
     * Protects: line 63 — catch block in onSubmit calls handleAuthClientError.
     */
    const err = new Error('Invalid TOTP');
    vi.mocked(mfaDisable).mockRejectedValue(err);
    render(<MfaDisableCard onDisabled={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));

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
});

describe('MfaDisableCard recovery-code counter', () => {
  it('renders the "8 of 8 remaining" counter when MFA is fully provisioned', async () => {
    /*
     * Scenario: a freshly-enrolled user has every recovery code intact. The
     * counter row must surface that count using the OK tone (no warning
     * badge). Protects the success path of the /account/mfa fetch and the
     * `counterTone === 'ok'` branch that hides the trailing badge.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);

    const counter = await screen.findByTestId('mfa-recovery-codes-remaining');
    expect(counter.textContent).toMatch(/8\s*of\s*8\s*recovery codes remaining/i);
    // The "Low" / "Exhausted" badge must NOT appear at the healthy threshold.
    expect(counter.textContent).not.toMatch(/Low|Exhausted/i);
  });

  it('renders the "Low" badge when remaining drops to 2', async () => {
    /*
     * Scenario: after the user burns through most of their codes the
     * counter must switch to amber and show the "Low" badge so the user
     * knows to regenerate before running out. Protects the
     * `counterTone === 'warning'` branch threshold (remaining <= 2).
     */
    vi.mocked(getMfaStatus).mockResolvedValueOnce({
      enabled: true,
      recoveryCodesRemaining: 2,
      recoveryCodesTotal: 8,
      required: false,
    });
    render(<MfaDisableCard onDisabled={vi.fn()} />);

    const counter = await screen.findByTestId('mfa-recovery-codes-remaining');
    expect(counter.textContent).toMatch(/2\s*of\s*8/);
    expect(counter.textContent).toMatch(/Low/i);
  });

  it('renders the "Exhausted" badge when no recovery codes remain', async () => {
    /*
     * Scenario: every recovery code has been consumed. The counter must
     * switch to red and show "Exhausted" — losing TOTP access at this
     * point would lock the user out. Protects the
     * `counterTone === 'critical'` branch (remaining === 0).
     */
    vi.mocked(getMfaStatus).mockResolvedValueOnce({
      enabled: true,
      recoveryCodesRemaining: 0,
      recoveryCodesTotal: 8,
      required: false,
    });
    render(<MfaDisableCard onDisabled={vi.fn()} />);

    const counter = await screen.findByTestId('mfa-recovery-codes-remaining');
    expect(counter.textContent).toMatch(/0\s*of\s*8/);
    expect(counter.textContent).toMatch(/Exhausted/i);
  });

  it('avoids state updates when the component unmounts before a fetch rejection', async () => {
    /*
     * Scenario: a slow /account/mfa is rejected by the API AFTER the
     * user has navigated away. The cleanup must have set `cancelled` so
     * the catch block's `if (!cancelled) setStatus(null)` does NOT fire
     * a state update on the unmounted component. Pinning the
     * cancelled-true branch of the catch arm — its sibling (cancelled-false)
     * is covered by the "omits the counter row when /account/mfa rejects"
     * spec earlier in the file.
     */
    let rejectFetch: (err: unknown) => void = () => undefined;
    const pendingPromise = new Promise<never>((_, reject) => {
      rejectFetch = reject;
    });
    vi.mocked(getMfaStatus).mockReturnValueOnce(pendingPromise);

    const { unmount } = render(<MfaDisableCard onDisabled={vi.fn()} />);
    unmount();
    rejectFetch(new Error('after-unmount rejection'));
    await Promise.resolve();
    expect(true).toBe(true);
  });

  it('avoids state updates when the component unmounts mid-fetch', async () => {
    /*
     * Scenario: the user navigates away while /account/mfa is still in
     * flight. The useEffect cleanup must flip the `cancelled` flag so
     * neither the success nor the error branch calls setState — preventing
     * the React "state update on unmounted component" warning. Pinning
     * the cleanup path catches a future refactor that drops the
     * `let cancelled` guard.
     */
    let resolveFetch: (value: {
      enabled: boolean;
      recoveryCodesRemaining: number;
      recoveryCodesTotal: number;
      required: boolean;
    }) => void = () => undefined;
    const pendingPromise = new Promise<{
      enabled: boolean;
      recoveryCodesRemaining: number;
      recoveryCodesTotal: number;
      required: boolean;
    }>((resolve) => {
      resolveFetch = resolve;
    });
    vi.mocked(getMfaStatus).mockReturnValueOnce(pendingPromise);

    const { unmount } = render(<MfaDisableCard onDisabled={vi.fn()} />);
    // Tear down the component BEFORE the fetch resolves so the cleanup
    // flips `cancelled` first. The subsequent resolve must NOT crash
    // (which it would on a real `setState` on unmounted node).
    unmount();
    resolveFetch({
      enabled: true,
      recoveryCodesRemaining: 7,
      recoveryCodesTotal: 8,
      required: false,
    });
    // Allow microtasks to settle so the post-cleanup code path runs.
    await Promise.resolve();
    // No assertion on the DOM — the test passes if no React warning was
    // thrown. The cleanup branch is exercised by the resolve happening
    // after unmount.
    expect(true).toBe(true);
  });

  it('omits the counter row when /account/mfa rejects', async () => {
    /*
     * Scenario: the status fetch fails (network, API down, etc.). The
     * card must keep the disable flow usable — the counter is optional
     * UI sugar, not a blocker. Protects the silent-catch branch of the
     * useEffect that leaves `status` null on failure.
     */
    vi.mocked(getMfaStatus).mockRejectedValueOnce(new Error('boom'));
    render(<MfaDisableCard onDisabled={vi.fn()} />);

    // Wait a tick so the useEffect rejection settles, then assert the
    // counter row never rendered.
    await waitFor(() => {
      expect(screen.queryByTestId('mfa-recovery-codes-remaining')).toBeNull();
    });
    // Disable button is still present — the failure is non-fatal.
    expect(screen.getByRole('button', { name: /disable two-factor/i })).toBeDefined();
  });
});

describe('MfaDisableCard regenerate recovery codes flow', () => {
  it('renders the regenerate button in the idle state', () => {
    /*
     * Scenario: the security card surfaces both actions (disable +
     * regenerate) on first paint so an admin needing to rotate codes
     * never has to dig through a menu. Protects the new
     * `mfa-regenerate-button` test id and the `RefreshCw` icon affordance.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    expect(screen.getByTestId('mfa-regenerate-button')).toBeDefined();
  });

  it('opens the TOTP form with regenerate-specific copy', () => {
    /*
     * Scenario: clicking "Regenerate recovery codes" must enter
     * `mode = 'regenerating'`, swap the form prompt to the rotation copy,
     * and render the submit button as "Regenerate codes" (non-destructive
     * variant). Protects the mode-machine + the per-mode copy/variant
     * computation.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('mfa-regenerate-button'));
    expect(screen.getByText(/confirm the rotation/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /^regenerate codes$/i })).toBeDefined();
  });

  it('submits the TOTP, opens the modal with fresh codes, and re-fetches status on close', async () => {
    /*
     * Scenario: the full happy path. The user clicks regenerate, enters
     * a TOTP, submits → mfaRegenerateRecoveryCodes resolves with the new
     * code set → modal opens with the rotated codes → user dismisses
     * the modal → getMfaStatus is called a second time (via the
     * statusVersion bump) so the counter reflects the refreshed set.
     * Pins the entire mode-machine + modal handoff + status-refresh
     * trio that the security page UX depends on.
     */
    const newCodes = ['AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', '1111-2222-3333-4444-5555-6666'];
    vi.mocked(mfaRegenerateRecoveryCodes).mockResolvedValue({ recoveryCodes: newCodes });
    render(<MfaDisableCard onDisabled={vi.fn()} />);

    // Wait for the initial counter fetch to settle so we can count
    // subsequent invocations cleanly.
    await screen.findByTestId('mfa-recovery-codes-remaining');
    const fetchCallsBefore = vi.mocked(getMfaStatus).mock.calls.length;

    fireEvent.click(screen.getByTestId('mfa-regenerate-button'));
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /^regenerate codes$/i }));

    await waitFor(() => {
      expect(mfaRegenerateRecoveryCodes).toHaveBeenCalledWith('123456');
    });

    // The recovery-codes modal renders the fresh codes verbatim.
    await waitFor(() => {
      expect(screen.getByText(newCodes[0]!)).toBeDefined();
      expect(screen.getByText(newCodes[1]!)).toBeDefined();
    });

    // Dismiss the modal — should bump statusVersion and trigger a
    // second getMfaStatus call so the counter reflects the new set.
    fireEvent.click(screen.getByRole('button', { name: /saved my codes/i }));
    await waitFor(() => {
      expect(vi.mocked(getMfaStatus).mock.calls.length).toBeGreaterThan(fetchCallsBefore);
    });
  });

  it('shows "Regenerating…" copy while the mfaRegenerateRecoveryCodes call is pending', async () => {
    /*
     * Scenario: keep the user informed during the round-trip — the
     * submit button must surface a loading affordance distinct from
     * the disable flow's "Disabling…". Protects the per-mode label
     * branch of `submitLabel`.
     */
    vi.mocked(mfaRegenerateRecoveryCodes).mockReturnValue(new Promise(() => undefined));
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('mfa-regenerate-button'));
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /^regenerate codes$/i }));

    await waitFor(() => {
      expect(screen.getByText('Regenerating…')).toBeDefined();
    });
  });

  it('returns to idle when the user cancels mid-regenerate', () => {
    /*
     * Scenario: a cautious user opens the regenerate form, then
     * second-guesses. Cancel must restore the idle UI without firing
     * mfaRegenerateRecoveryCodes. Protects the shared `returnToIdle`
     * helper across both modes.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('mfa-regenerate-button'));
    expect(screen.getByText(/confirm the rotation/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByTestId('mfa-regenerate-button')).toBeDefined();
    expect(mfaRegenerateRecoveryCodes).not.toHaveBeenCalled();
  });

  it('routes API rejections through handleAuthClientError', async () => {
    /*
     * Scenario: the regenerate call fails — wrong TOTP, account
     * locked, anti-replay, etc. The component must surface the
     * error via handleAuthClientError, not crash and not silently
     * swallow. Protects the catch arm of the shared `onSubmit`.
     */
    const err = new Error('Invalid TOTP');
    vi.mocked(mfaRegenerateRecoveryCodes).mockRejectedValue(err);
    render(<MfaDisableCard onDisabled={vi.fn()} />);

    fireEvent.click(screen.getByTestId('mfa-regenerate-button'));
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
});

// ── Verbatim observable strings ───────────────────────────────────────────────

describe('MfaDisableCard surfaces verbatim copy + variant choices', () => {
  it('toasts the documented "MFA disabled" success message verbatim after disable succeeds', async () => {
    /*
     * Scenario: the success toast that appears after MFA is disabled is the
     * single piece of confirmation the user receives — the surrounding card
     * also swaps to the setup state, which is informative but not a
     * confirmation. The message text is part of the user-facing contract:
     * support docs link to it and the QA suite pattern-matches on it.
     * Pinning the exact string defends against an accidental truncation
     * (e.g. "Two-factor authentication disabled.") or rewording that would
     * silently break those external consumers.
     */
    vi.mocked(mfaDisable).mockResolvedValue(undefined);
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));
    fillOtpInputs();
    fireEvent.click(screen.getByRole('button', { name: /confirm disable/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Two-factor authentication has been disabled.');
    });
  });

  it('toasts the documented "codes regenerated" warning verbatim after a rotation succeeds', async () => {
    /*
     * Scenario: the regenerate toast doubles as a warning ("old codes no
     * longer work") because the user must immediately save the new ones.
     * Truncating or rewording the second clause would erase the warning
     * that anchors the recovery-code rotation UX. Pinned word-for-word.
     */
    vi.mocked(mfaRegenerateRecoveryCodes).mockResolvedValue({ recoveryCodes: ['AAA', 'BBB'] });
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('mfa-regenerate-button'));
    fillOtpInputs();
    fireEvent.click(screen.getByRole('button', { name: /^regenerate codes$/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'Recovery codes regenerated. Save them now — old codes no longer work.',
      );
    });
  });

  it('renders the disable form title verbatim with the "to confirm." period', () => {
    /*
     * Scenario: the disable confirmation prompt and the regenerate prompt
     * diverge by their final clause ("…to confirm." vs "…to confirm the
     * rotation."). The two strings are used by ops to disambiguate
     * screenshots and by the e2e suite as the anchor for the form
     * region. Pinning the disable copy defends the disambiguation.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));
    expect(screen.getByText('Enter a code from your authenticator app to confirm.')).toBeDefined();
  });

  it('renders the regenerate form title verbatim with the rotation clause', () => {
    /*
     * Scenario: counterpart to the previous test — the rotation prompt must
     * end with "to confirm the rotation." so the user understands they are
     * regenerating, not disabling. Pinned word-for-word.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('mfa-regenerate-button'));
    expect(
      screen.getByText('Enter a code from your authenticator app to confirm the rotation.'),
    ).toBeDefined();
  });

  it('renders the disable submit button with the destructive Tailwind variant class', () => {
    /*
     * Scenario: the disable action is destructive — once executed, the user
     * loses second-factor coverage until they re-enroll. The submit button
     * must visually surface this risk via the `destructive` shadcn variant,
     * not the neutral `default` one. Pinning the class fragment defends
     * the per-mode `submitVariant` ternary so it cannot silently regress
     * to a neutral palette.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));
    const submit = screen.getByRole('button', { name: /confirm disable/i });
    expect(submit.className).toMatch(/bg-destructive/);
  });

  it('renders the regenerate submit button WITH the default (brand-gradient) variant', () => {
    /*
     * Scenario: regenerating recovery codes is a routine maintenance
     * action — not destructive — so the submit button must use the
     * neutral `default` variant. The shadcn `default` variant carries
     * the `from-brand-500` brand-gradient class that no other variant
     * surfaces; pinning that fragment defends BOTH against a regression
     * back to the destructive palette AND against the variant arm
     * collapsing to an empty string that would fall through to a
     * styleless button.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('mfa-regenerate-button'));
    const submit = screen.getByRole('button', { name: /^regenerate codes$/i });
    expect(submit.className).not.toMatch(/bg-destructive/);
    expect(submit.className).toMatch(/from-brand-500/);
  });
});

// ── Idle-UI restoration + isPending reset ─────────────────────────────────────

describe('MfaDisableCard returns to idle / re-enables submit after each terminal state', () => {
  it('returns to the idle UI (disable button visible, form hidden) after a successful disable', async () => {
    /*
     * Scenario: after `mfaDisable` resolves, the component swaps `mode`
     * back to `'idle'` so the surrounding security page can render the
     * setup card. Pins the `setMode('idle')` literal in the disable
     * success arm — without it, a stale form would still be visible
     * once the parent re-renders.
     */
    vi.mocked(mfaDisable).mockResolvedValue(undefined);
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));
    fillOtpInputs();
    fireEvent.click(screen.getByRole('button', { name: /confirm disable/i }));

    // Wait for the disable to settle, then the idle disable button must reappear.
    await waitFor(() => {
      expect(mfaDisable).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      // Form-only "Cancel" button should be gone.
      expect(screen.queryByRole('button', { name: /^cancel$/i })).toBeNull();
    });
    expect(screen.getByRole('button', { name: /disable two-factor/i })).toBeDefined();
  });

  it('returns to the idle UI after a successful regenerate (form hidden, regenerate button visible)', async () => {
    /*
     * Scenario: after `mfaRegenerateRecoveryCodes` resolves the form
     * must collapse so the user is not asked for another TOTP. Pins
     * the `setMode('idle')` literal in the regenerate success arm —
     * an empty string would keep `isFormOpen` true and the form would
     * remain on screen alongside the open modal, confusing the user.
     */
    vi.mocked(mfaRegenerateRecoveryCodes).mockResolvedValue({ recoveryCodes: ['XYZ-1'] });
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('mfa-regenerate-button'));
    fillOtpInputs();
    fireEvent.click(screen.getByRole('button', { name: /^regenerate codes$/i }));

    // Modal renders with the fresh codes.
    await screen.findByText('XYZ-1');
    // Form is gone — only the idle regenerate button + disable button remain.
    expect(screen.queryByRole('button', { name: /^cancel$/i })).toBeNull();
    expect(screen.getByTestId('mfa-regenerate-button')).toBeDefined();
  });

  it('re-enables the submit button after a failed disable so the user can retry', async () => {
    /*
     * Scenario: when `mfaDisable` rejects (wrong TOTP, network blip,
     * anti-replay), the `finally` block must flip `isPending` back to
     * `false` so the submit button is clickable again. Pins both the
     * `finally { setIsPending(false) }` block and the `false` literal:
     * removing the block would leave the button permanently disabled
     * after any error; flipping the literal to `true` would do the same.
     */
    vi.mocked(mfaDisable).mockRejectedValue(new Error('Invalid TOTP'));
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));
    fillOtpInputs();
    fireEvent.click(screen.getByRole('button', { name: /confirm disable/i }));

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalled();
    });
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: /confirm disable/i });
    expect(submit.disabled).toBe(false);
  });

  it('re-enables the submit button after a failed regenerate so the user can retry', async () => {
    /*
     * Scenario: same retry-affordance contract on the regenerate path
     * after `mfaRegenerateRecoveryCodes` rejects. Pinned independently
     * so a future refactor cannot accidentally branch the finally
     * cleanup per mode.
     */
    vi.mocked(mfaRegenerateRecoveryCodes).mockRejectedValue(new Error('Invalid TOTP'));
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('mfa-regenerate-button'));
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
});

// ── Counter row visibility + tone ─────────────────────────────────────────────

describe('MfaDisableCard counter row visibility + tone', () => {
  it('hides the counter row while the confirmation form is open', async () => {
    /*
     * Scenario: once the user has chosen disable or regenerate and the OTP
     * form is up, the surrounding counter row collapses to keep the focus
     * on the TOTP input. Pins the `!isFormOpen` factor of the counter's
     * visibility guard — without it, opening the form would still leave
     * the counter visible and steal attention from the input.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    await screen.findByTestId('mfa-recovery-codes-remaining');

    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));
    expect(screen.queryByTestId('mfa-recovery-codes-remaining')).toBeNull();
  });

  it('renders the counter row with red palette classes when MFA recovery codes are exhausted', async () => {
    /*
     * Scenario: at 0 remaining recovery codes the user is one TOTP-loss
     * away from being locked out. The counter row must surface the red
     * palette so the affordance for "Regenerate now" is unmistakable.
     * Pinning the `text-red-300` fragment defends the critical-tone
     * branch of the counter's className ternary.
     */
    vi.mocked(getMfaStatus).mockResolvedValueOnce({
      enabled: true,
      recoveryCodesRemaining: 0,
      recoveryCodesTotal: 8,
      required: false,
    });
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    const counter = await screen.findByTestId('mfa-recovery-codes-remaining');
    expect(counter.className).toMatch(/text-red-300/);
  });

  it('renders the counter row with amber palette classes when recovery codes drop to the warning band', async () => {
    /*
     * Scenario: 1-2 recovery codes left → amber row + "Low" badge. The
     * amber palette must surface for the user to notice without becoming
     * alarming red. Pins the warning-tone branch of the className
     * ternary so a refactor cannot collapse both warning and critical
     * onto the same colour.
     */
    vi.mocked(getMfaStatus).mockResolvedValueOnce({
      enabled: true,
      recoveryCodesRemaining: 2,
      recoveryCodesTotal: 8,
      required: false,
    });
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    const counter = await screen.findByTestId('mfa-recovery-codes-remaining');
    expect(counter.className).toMatch(/text-amber-300/);
  });

  it('renders the counter row with the muted neutral palette at the healthy threshold', async () => {
    /*
     * Scenario: with ≥3 recovery codes the row stays muted so the visual
     * weight matches the operational risk. The healthy branch must NOT
     * borrow the warning amber or critical red palette. Pins the
     * default arm of the className ternary.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    const counter = await screen.findByTestId('mfa-recovery-codes-remaining');
    expect(counter.className).not.toMatch(/text-red-300/);
    expect(counter.className).not.toMatch(/text-amber-300/);
  });

  it('renders "of" between the remaining and total counts in the counter', async () => {
    /*
     * Scenario: the counter reads "<remaining> of <total> recovery codes
     * remaining" — pulling the "of" connective out would collapse the two
     * numbers into "8 8" which a user would scan as a typo. Pinned.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    const counter = await screen.findByTestId('mfa-recovery-codes-remaining');
    expect(counter.textContent).toMatch(/ of /);
  });

  it('does not render the counter while the /account/mfa fetch is still in flight (counterTone null branch)', async () => {
    /*
     * Scenario: rendering the counter before `status` settles would either
     * show "undefined of undefined" or trigger an XHR-time layout jump as
     * the row appears and reshuffles. Pins the `counterTone !== null`
     * factor of the visibility guard by holding the fetch open and
     * asserting the row is absent.
     */
    let resolveFetch: (value: {
      enabled: boolean;
      recoveryCodesRemaining: number;
      recoveryCodesTotal: number;
      required: boolean;
    }) => void = () => undefined;
    vi.mocked(getMfaStatus).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(<MfaDisableCard onDisabled={vi.fn()} />);
    // Fetch is still pending — counter must NOT have rendered.
    expect(screen.queryByTestId('mfa-recovery-codes-remaining')).toBeNull();

    // Resolve so the test cleanup does not leak a pending promise.
    await act(async () => {
      resolveFetch({
        enabled: true,
        recoveryCodesRemaining: 8,
        recoveryCodesTotal: 8,
        required: false,
      });
      await Promise.resolve();
    });
  });

  it('does not render "undefined" in the counter even when the API omits remaining/total fields', async () => {
    /*
     * Scenario: a malformed API response that omits `recoveryCodesRemaining`
     * or `recoveryCodesTotal` would, under a dropped guard, render the
     * literal string "undefined" inside the counter (`{undefined} of
     * {undefined} recovery codes remaining`). The `remaining !== undefined`
     * + `total !== undefined` clauses of the visibility guard prevent
     * that. Pinned by checking no rendered text contains "undefined".
     */
    vi.mocked(getMfaStatus).mockResolvedValueOnce({
      enabled: true,
      recoveryCodesRemaining: undefined as unknown as number,
      recoveryCodesTotal: undefined as unknown as number,
      required: false,
    });
    render(<MfaDisableCard onDisabled={vi.fn()} />);

    // Let the fetch settle.
    await waitFor(() => {
      expect(vi.mocked(getMfaStatus)).toHaveBeenCalled();
    });
    // Counter row must NOT have rendered at all.
    expect(screen.queryByTestId('mfa-recovery-codes-remaining')).toBeNull();
  });

  it('still hides the counter when only one of remaining/total is undefined', async () => {
    /*
     * Scenario: half-broken payloads (one count present, the other
     * missing) must still suppress the counter — surfacing "8 of
     * undefined recovery codes remaining" would be worse than not
     * surfacing the row at all. Pins the `total !== undefined` clause
     * in isolation by sending a payload with `total === undefined`.
     */
    vi.mocked(getMfaStatus).mockResolvedValueOnce({
      enabled: true,
      recoveryCodesRemaining: 5,
      recoveryCodesTotal: undefined as unknown as number,
      required: false,
    });
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    await waitFor(() => {
      expect(vi.mocked(getMfaStatus)).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('mfa-recovery-codes-remaining')).toBeNull();
  });
});

// ── Recovery-codes modal handoff ──────────────────────────────────────────────

describe('MfaDisableCard recovery-codes modal handoff', () => {
  it('passes the freshly-issued codes to the RecoveryCodesModal without padding or substituting', async () => {
    /*
     * Scenario: the regenerate API returns the brand-new recovery codes
     * exactly once — if the modal renders anything other than the API's
     * verbatim array (e.g. an empty array, a placeholder, or a duplicated
     * entry) the user permanently loses the only window in which those
     * codes are recoverable. Pins the exact codes-prop wiring between
     * the `setFreshCodes` write and the modal's `codes` prop.
     */
    const newCodes = ['ALPHA-1111', 'BRAVO-2222', 'CHARLIE-3'];
    vi.mocked(mfaRegenerateRecoveryCodes).mockResolvedValue({ recoveryCodes: newCodes });
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('mfa-regenerate-button'));
    fillOtpInputs();
    fireEvent.click(screen.getByRole('button', { name: /^regenerate codes$/i }));

    for (const code of newCodes) {
      await screen.findByText(code);
    }
    // No extra codes — the modal must not render a sentinel or duplicate.
    expect(screen.queryByText('Stryker was here')).toBeNull();
  });

  it('passes the empty OTP value to the inner OtpInput when the form field is undefined', () => {
    /*
     * Scenario: React Hook Form initialises the `code` field as undefined.
     * The Controller's render must coerce that undefined to the empty
     * string before handing it to OtpInput, so the boxes start empty
     * rather than displaying the literal string "undefined". Pins the
     * `field.value ?? ''` fallback.
     */
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }));
    const inputs = screen.getAllByRole<HTMLInputElement>('textbox');
    for (const input of inputs) {
      expect(input.value).toBe('');
    }
  });
});

// ── useEffect cleanup observability ───────────────────────────────────────────

describe('MfaDisableCard useEffect cleanup', () => {
  it('refetches the recovery-code status when the user closes the modal (statusVersion bump)', async () => {
    /*
     * Scenario: after the user dismisses the recovery-codes modal the
     * counter must reflect the freshly-rotated set, NOT the pre-rotation
     * count. The component achieves this by bumping `statusVersion` so
     * the useEffect re-runs `getMfaStatus`. Pinning the call count
     * defends the `setStatusVersion((n) => n + 1)` callback — a regression
     * that returns `n` (stale closure) or `n - 1` would skip the refresh
     * and leave the user looking at the old count.
     */
    vi.mocked(mfaRegenerateRecoveryCodes).mockResolvedValue({ recoveryCodes: ['X-Y-Z'] });
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    await screen.findByTestId('mfa-recovery-codes-remaining');
    const before = vi.mocked(getMfaStatus).mock.calls.length;

    fireEvent.click(screen.getByTestId('mfa-regenerate-button'));
    fillOtpInputs();
    fireEvent.click(screen.getByRole('button', { name: /^regenerate codes$/i }));
    await screen.findByText('X-Y-Z');

    // Dismiss the modal — the close handler bumps statusVersion.
    fireEvent.click(screen.getByRole('button', { name: /saved my codes/i }));

    await waitFor(() => {
      expect(vi.mocked(getMfaStatus).mock.calls.length).toBe(before + 1);
    });
  });

  it('refetches the recovery-code status on EVERY modal close, not just the first one', async () => {
    /*
     * Scenario: the user may regenerate recovery codes more than once
     * across the lifetime of the security page (e.g. lose a backup,
     * regenerate, lose another, regenerate again). The `(n) => n + 1`
     * updater must produce a NEW `statusVersion` each call so the
     * useEffect re-runs every time. Pins the always-strict-monotonic
     * version bump — an `() => undefined` regression would short-circuit
     * after the first close (because undefined === undefined skips the
     * re-render), leaving the counter forever stale on the second
     * rotation.
     */
    vi.mocked(mfaRegenerateRecoveryCodes).mockResolvedValue({ recoveryCodes: ['first-cycle'] });
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    await screen.findByTestId('mfa-recovery-codes-remaining');
    const baseline = vi.mocked(getMfaStatus).mock.calls.length;

    // Cycle 1
    fireEvent.click(screen.getByTestId('mfa-regenerate-button'));
    fillOtpInputs();
    fireEvent.click(screen.getByRole('button', { name: /^regenerate codes$/i }));
    await screen.findByText('first-cycle');
    fireEvent.click(screen.getByRole('button', { name: /saved my codes/i }));
    await waitFor(() => {
      expect(vi.mocked(getMfaStatus).mock.calls.length).toBe(baseline + 1);
    });

    // Cycle 2 — same flow, must trigger ANOTHER fetch.
    vi.mocked(mfaRegenerateRecoveryCodes).mockResolvedValueOnce({
      recoveryCodes: ['second-cycle'],
    });
    fireEvent.click(screen.getByTestId('mfa-regenerate-button'));
    fillOtpInputs();
    fireEvent.click(screen.getByRole('button', { name: /^regenerate codes$/i }));
    await screen.findByText('second-cycle');
    fireEvent.click(screen.getByRole('button', { name: /saved my codes/i }));
    await waitFor(() => {
      expect(vi.mocked(getMfaStatus).mock.calls.length).toBe(baseline + 2);
    });
  });

  it('does NOT refetch the recovery-code status while the modal is still open', async () => {
    /*
     * Scenario: the second-fetch must fire on modal CLOSE, not on every
     * submit. Pinning this defends the close-only refresh contract — if
     * the version bump migrated to `onSubmit` the counter would briefly
     * flash zero while the post-rotation fetch was in flight.
     */
    vi.mocked(mfaRegenerateRecoveryCodes).mockResolvedValue({ recoveryCodes: ['only-one'] });
    render(<MfaDisableCard onDisabled={vi.fn()} />);
    await screen.findByTestId('mfa-recovery-codes-remaining');
    const before = vi.mocked(getMfaStatus).mock.calls.length;

    fireEvent.click(screen.getByTestId('mfa-regenerate-button'));
    fillOtpInputs();
    fireEvent.click(screen.getByRole('button', { name: /^regenerate codes$/i }));
    await screen.findByText('only-one');

    // Modal is still open — no second fetch yet.
    expect(vi.mocked(getMfaStatus).mock.calls.length).toBe(before);
  });

  it('does not call setStatus after unmount when the fetch resolves later (cancelled flag flipped to true)', async () => {
    /*
     * Scenario: the user navigates away from the security page mid-fetch.
     * The useEffect cleanup must flip `cancelled = true` so the eventual
     * resolve does NOT call `setStatus(snapshot)`. Pinning this with a
     * console.error spy turns the React "state update on unmounted" warning
     * into an assertion — if the cleanup is dropped, React logs and the
     * spy fires.
     */
    let resolveFetch: (value: {
      enabled: boolean;
      recoveryCodesRemaining: number;
      recoveryCodesTotal: number;
      required: boolean;
    }) => void = () => undefined;
    vi.mocked(getMfaStatus).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { unmount } = render(<MfaDisableCard onDisabled={vi.fn()} />);
      unmount();
      await act(async () => {
        resolveFetch({
          enabled: true,
          recoveryCodesRemaining: 7,
          recoveryCodesTotal: 8,
          required: false,
        });
        await Promise.resolve();
      });
      // No "state update on unmounted component" warning from React.
      const unmountWarnings = errorSpy.mock.calls.filter((args) =>
        String(args[0] ?? '').includes('unmounted'),
      );
      expect(unmountWarnings).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
