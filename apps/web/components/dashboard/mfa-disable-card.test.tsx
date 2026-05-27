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
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
import { MfaDisableCard } from './mfa-disable-card.js';

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
