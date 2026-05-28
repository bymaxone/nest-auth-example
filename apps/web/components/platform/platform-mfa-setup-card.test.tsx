/**
 * @fileoverview Unit tests for `PlatformMfaSetupCard`.
 *
 * Mirrors the dashboard `MfaSetupCard` tests but pins the platform
 * client helpers — the platform card MUST hit `/api/auth/platform/mfa/*`
 * routes via `platformMfaSetup` and `platformMfaVerifyEnable`, never
 * the dashboard equivalents.
 *
 * @module components/platform/platform-mfa-setup-card.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/auth-client', () => ({
  platformMfaSetup: vi.fn(),
  platformMfaVerifyEnable: vi.fn(),
  handleAuthClientError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/qrcode', () => ({
  toQrDataUrl: vi.fn(() => Promise.resolve('data:image/png;base64,fake')),
}));

import {
  platformMfaSetup,
  platformMfaVerifyEnable,
  handleAuthClientError,
} from '@/lib/auth-client';
import { PlatformMfaSetupCard } from './platform-mfa-setup-card.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PlatformMfaSetupCard', () => {
  it('renders the "Set up authenticator" button in the idle state', () => {
    /*
     * Scenario: a platform admin without MFA arrives at /platform/security.
     * The card's idle render must show the setup button so they can start
     * the enrolment flow. Pinning the `data-testid` so e2e specs can
     * locate it without depending on copy.
     */
    render(<PlatformMfaSetupCard onEnabled={vi.fn()} />);
    expect(screen.getByTestId('platform-mfa-setup-button')).toBeDefined();
  });

  it('calls platformMfaSetup and renders the QR + secret after success', async () => {
    /*
     * Scenario: clicking "Set up authenticator" hits POST
     * /api/auth/platform/mfa/setup (NOT the dashboard equivalent),
     * receives the secret + qrCodeUri + recovery codes, and renders
     * the QR + secret input. Protects the platform route choice and
     * the success path of the setup mutation.
     */
    vi.mocked(platformMfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:admin?secret=JBSWY3DPEHPK3PXP&issuer=Example',
      recoveryCodes: ['AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'],
    });
    render(<PlatformMfaSetupCard onEnabled={vi.fn()} />);

    fireEvent.click(screen.getByTestId('platform-mfa-setup-button'));

    await waitFor(() => {
      expect(platformMfaSetup).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      const secretInput = screen.getByTestId<HTMLInputElement>('platform-mfa-secret');
      expect(secretInput.value).toBe('JBSWY3DPEHPK3PXP');
    });
  });

  it('calls platformMfaVerifyEnable with the TOTP code and shows the recovery codes modal', async () => {
    /*
     * Scenario: after entering the 6-digit code and clicking
     * "Verify & enable", the card must POST to /api/auth/platform/mfa/verify-enable
     * and reveal the recovery-codes modal with the codes returned by setup.
     * Protects the verify-enable hand-off + modal opening.
     */
    const codes = ['AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', '1111-2222-3333-4444-5555-6666'];
    vi.mocked(platformMfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:admin',
      recoveryCodes: codes,
    });
    vi.mocked(platformMfaVerifyEnable).mockResolvedValue(undefined);

    render(<PlatformMfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-setup-button'));
    await screen.findByTestId('platform-mfa-secret');

    const inputs = screen.getAllByRole('textbox');
    // Filter out the secret input (it has type=text but role textbox).
    const otpInputs = inputs.filter((el) => (el as HTMLInputElement).inputMode === 'numeric');
    otpInputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });

    fireEvent.click(screen.getByRole('button', { name: /verify.*enable/i }));

    await waitFor(() => {
      expect(platformMfaVerifyEnable).toHaveBeenCalledWith('123456');
    });
    // Modal opens with the recovery codes.
    await waitFor(() => {
      codes.forEach((c) => expect(screen.getByText(c)).toBeDefined());
    });
  });

  it('routes setup API rejections through handleAuthClientError', async () => {
    /*
     * Scenario: the setup endpoint fails (e.g. MFA_ALREADY_ENABLED from
     * a stale UI state, or a network error). The card must surface the
     * error via handleAuthClientError, not crash. Protects the catch
     * arm of `handleSetup`.
     */
    const err = new Error('MFA already enabled');
    vi.mocked(platformMfaSetup).mockRejectedValue(err);
    render(<PlatformMfaSetupCard onEnabled={vi.fn()} />);

    fireEvent.click(screen.getByTestId('platform-mfa-setup-button'));

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
  });

  it('routes verify-enable API rejections through handleAuthClientError', async () => {
    /*
     * Scenario: the verify-enable call rejects (wrong TOTP, anti-replay,
     * etc.). The card must surface the error and keep the form open so
     * the user can retry. Protects the catch arm of `onVerify`.
     */
    vi.mocked(platformMfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:admin',
      recoveryCodes: ['AAAA'],
    });
    const err = new Error('Invalid TOTP');
    vi.mocked(platformMfaVerifyEnable).mockRejectedValue(err);

    render(<PlatformMfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-setup-button'));
    await screen.findByTestId('platform-mfa-secret');

    const inputs = screen.getAllByRole('textbox');
    const otpInputs = inputs.filter((el) => (el as HTMLInputElement).inputMode === 'numeric');
    otpInputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /verify.*enable/i }));

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
  });

  it('returns to idle and resets the form when Cancel is clicked during the scanning step', async () => {
    /*
     * Scenario: a hesitant admin opens the setup flow, then second-guesses.
     * Cancel must restore the idle UI without firing verifyEnable. Protects
     * the cancel reset path.
     */
    vi.mocked(platformMfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:admin',
      recoveryCodes: ['AAAA'],
    });
    render(<PlatformMfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-setup-button'));
    await screen.findByTestId('platform-mfa-secret');

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.getByTestId('platform-mfa-setup-button')).toBeDefined();
    expect(platformMfaVerifyEnable).not.toHaveBeenCalled();
  });

  it('renders a validation error when the user submits with an incomplete code', async () => {
    /*
     * Scenario: an admin enters only a partial 6-digit code and submits.
     * Zod must fail validation and render the error paragraph. Protects
     * the `{errors.code && <p>...</p>}` truthy branch.
     */
    vi.mocked(platformMfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:admin',
      recoveryCodes: ['AAAA'],
    });
    render(<PlatformMfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-setup-button'));
    await screen.findByTestId('platform-mfa-secret');

    // Submit without filling any digits.
    fireEvent.click(screen.getByRole('button', { name: /verify.*enable/i }));

    await waitFor(() => {
      const errorParagraphs = document.querySelectorAll('p.text-xs.text-red-400');
      expect(errorParagraphs.length).toBeGreaterThan(0);
    });
  });

  it('shows "Verifying…" while platformMfaVerifyEnable is pending', async () => {
    /*
     * Scenario: per-mode submit label — verify-enable's pending path
     * must surface a loading affordance distinct from the idle copy.
     * Protects the `isLoading ? 'Verifying…' : 'Verify & enable'`
     * truthy branch.
     */
    vi.mocked(platformMfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:admin',
      recoveryCodes: ['AAAA'],
    });
    vi.mocked(platformMfaVerifyEnable).mockReturnValue(new Promise(() => undefined));

    render(<PlatformMfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-setup-button'));
    await screen.findByTestId('platform-mfa-secret');

    const inputs = screen.getAllByRole('textbox');
    const otpInputs = inputs.filter((el) => (el as HTMLInputElement).inputMode === 'numeric');
    otpInputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /verify.*enable/i }));

    await waitFor(() => {
      expect(screen.getByText('Verifying…')).toBeDefined();
    });
  });

  it('selects the secret input value when the user clicks on it (manual entry affordance)', async () => {
    /*
     * Scenario: a user who cannot scan the QR copies the secret
     * manually. The secret input's onClick handler must call
     * `select()` so a triple-click-then-copy gesture is unnecessary.
     * Protects the readonly-input UX.
     */
    vi.mocked(platformMfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:admin',
      recoveryCodes: ['AAAA'],
    });
    render(<PlatformMfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-setup-button'));
    const secretInput = await screen.findByTestId<HTMLInputElement>('platform-mfa-secret');
    const selectSpy = vi.spyOn(secretInput, 'select');

    fireEvent.click(secretInput);

    expect(selectSpy).toHaveBeenCalledOnce();
  });

  it('shows the verbatim "Loading…" copy while the setup call is pending and disables the button', async () => {
    /*
     * Scenario: the setup endpoint can take a moment (the lib generates
     * QR + secret + recovery codes server-side). The button must surface
     * the loading affordance verbatim AND be disabled so the operator
     * cannot double-click and create two enrolment attempts. Pinning
     * both the "Loading…" string and the `disabled` state defends:
     *   - the truthy arm of the `isLoading ? 'Loading…' : 'Set up
     *     authenticator'` ternary,
     *   - the `setIsLoading(true)` literal at the top of `handleSetup`.
     */
    vi.mocked(platformMfaSetup).mockReturnValue(new Promise(() => undefined));
    render(<PlatformMfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-setup-button'));

    await waitFor(() => {
      expect(screen.getByText('Loading…')).toBeDefined();
    });
    const btn = screen.getByTestId<HTMLButtonElement>('platform-mfa-setup-button');
    expect(btn.disabled).toBe(true);
  });

  it('renders the verbatim "Set up authenticator" copy in the idle state', () => {
    /*
     * Scenario: counterpart to the loading test — in the idle state the
     * button must display the verbatim "Set up authenticator" copy. Pins
     * the falsy arm of the `isLoading ?` ternary.
     */
    render(<PlatformMfaSetupCard onEnabled={vi.fn()} />);
    expect(screen.getByText('Set up authenticator')).toBeDefined();
  });

  it('passes the empty OTP value to the inner OtpInput when the form field is undefined', async () => {
    /*
     * Scenario: React Hook Form initialises the `code` field as
     * undefined. The Controller's render must coerce that undefined to
     * the empty string before handing it to OtpInput, so the boxes
     * start empty rather than displaying the literal "undefined" or
     * "Stryker". Pins the `field.value ?? ''` fallback.
     */
    vi.mocked(platformMfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:admin',
      recoveryCodes: ['AAAA'],
    });
    render(<PlatformMfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-setup-button'));
    await screen.findByTestId('platform-mfa-secret');

    const inputs = screen.getAllByRole<HTMLInputElement>('textbox');
    const otpInputs = inputs.filter((el) => el.inputMode === 'numeric');
    for (const input of otpInputs) {
      expect(input.value).toBe('');
    }
  });

  it('re-enables the verify button and clears the "Verifying…" label after platformMfaVerifyEnable rejects', async () => {
    /*
     * Scenario: the verify endpoint rejects (wrong TOTP, anti-replay,
     * etc.). The `finally { setIsLoading(false) }` cleanup must run so
     * the button is clickable again — without it, the admin would see
     * a permanent "Verifying…" label and have no way to retry the
     * 6-digit code.
     */
    vi.mocked(platformMfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:admin',
      recoveryCodes: ['AAAA'],
    });
    vi.mocked(platformMfaVerifyEnable).mockRejectedValue(new Error('Invalid TOTP'));

    render(<PlatformMfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-setup-button'));
    await screen.findByTestId('platform-mfa-secret');
    const otpInputs = screen
      .getAllByRole('textbox')
      .filter((el) => (el as HTMLInputElement).inputMode === 'numeric');
    otpInputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /verify.*enable/i }));

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalled();
    });
    await waitFor(() => {
      // After the failure-cleanup runs, the button must NOT still read
      // "Verifying…" — that's the in-flight label.
      expect(screen.queryByText('Verifying…')).toBeNull();
    });
    // And it must be clickable so the admin can retry.
    const retryBtn = screen.getByRole<HTMLButtonElement>('button', { name: /verify.*enable/i });
    expect(retryBtn.disabled).toBe(false);
  });

  it('hides the recovery-codes modal entirely after the user clicks "I have saved my codes"', async () => {
    /*
     * Scenario: after dismissal the modal must DISAPPEAR from the DOM,
     * not just be cleared of content. The "saved my codes" button is
     * the only modal control unique to that surface — its absence is
     * the cleanest signal that the modal closed. Pinning the
     * `setShowModal(false)` literal — a regression to
     * `setShowModal(true)` would leave the modal frame open after
     * dismissal (just with no codes inside).
     */
    const codes = ['CODE-A'];
    vi.mocked(platformMfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:admin',
      recoveryCodes: codes,
    });
    vi.mocked(platformMfaVerifyEnable).mockResolvedValue(undefined);

    render(<PlatformMfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-setup-button'));
    await screen.findByTestId('platform-mfa-secret');
    const otpInputs = screen
      .getAllByRole('textbox')
      .filter((el) => (el as HTMLInputElement).inputMode === 'numeric');
    otpInputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /verify.*enable/i }));

    const saveBtn = await screen.findByRole('button', { name: /saved my codes/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      // The button is the modal's defining control — its absence proves
      // the modal was actually removed from the DOM.
      expect(screen.queryByRole('button', { name: /saved my codes/i })).toBeNull();
    });
  });

  it('clears the recovery codes from internal state after the modal closes (prevents DOM leak)', async () => {
    /*
     * Scenario: once the operator dismisses the modal, the recovery
     * codes must be wiped from component state — re-rendering the modal
     * (even briefly) with the codes would risk leaking them into a
     * background tab's DOM where a screen recorder or extension could
     * see them. Pins the `setRecoveryCodes([])` call inside
     * `handleModalClose`. Without it, a future re-render could surface
     * the codes again.
     */
    const codes = ['SECRET-CODE-1'];
    vi.mocked(platformMfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:admin',
      recoveryCodes: codes,
    });
    vi.mocked(platformMfaVerifyEnable).mockResolvedValue(undefined);

    render(<PlatformMfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByTestId('platform-mfa-setup-button'));
    await screen.findByTestId('platform-mfa-secret');
    const otpInputs = screen
      .getAllByRole('textbox')
      .filter((el) => (el as HTMLInputElement).inputMode === 'numeric');
    otpInputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /verify.*enable/i }));

    await screen.findByText('SECRET-CODE-1');
    fireEvent.click(screen.getByRole('button', { name: /saved my codes/i }));

    // After dismissal, the code must NOT appear anywhere in the DOM.
    await waitFor(() => {
      expect(screen.queryByText('SECRET-CODE-1')).toBeNull();
    });
  });

  it('invokes onEnabled after the recovery-codes modal is dismissed', async () => {
    /*
     * Scenario: full happy path through enrolment. The parent page
     * passes a callback to re-fetch /platform/me — that callback must
     * fire after the user dismisses the codes modal so the card swaps
     * to the disable variant on the next render.
     */
    const codes = ['AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'];
    vi.mocked(platformMfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:admin',
      recoveryCodes: codes,
    });
    vi.mocked(platformMfaVerifyEnable).mockResolvedValue(undefined);
    const onEnabled = vi.fn();

    render(<PlatformMfaSetupCard onEnabled={onEnabled} />);
    fireEvent.click(screen.getByTestId('platform-mfa-setup-button'));
    await screen.findByTestId('platform-mfa-secret');

    const inputs = screen.getAllByRole('textbox');
    const otpInputs = inputs.filter((el) => (el as HTMLInputElement).inputMode === 'numeric');
    otpInputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /verify.*enable/i }));

    await waitFor(() => expect(screen.getByText(codes[0]!)).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /saved my codes/i }));

    await waitFor(() => expect(onEnabled).toHaveBeenCalledOnce());
  });
});
