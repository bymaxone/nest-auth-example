/**
 * @fileoverview Unit tests for the `MfaSetupCard` component.
 *
 * Verifies:
 * - The idle state renders "Set up authenticator" button.
 * - Clicking setup calls mfaSetup and transitions to QR code state.
 * - Cancel button from the scanning step returns to idle.
 *
 * `@/lib/auth-client` and `@/lib/qrcode` are mocked to avoid real API/QR calls.
 *
 * @module components/dashboard/mfa-setup-card.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth-client', () => ({
  mfaSetup: vi.fn(),
  mfaVerifyEnable: vi.fn(),
  handleAuthClientError: vi.fn(),
}));

vi.mock('@/lib/qrcode', () => ({
  toQrDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,fake-qr'),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { mfaSetup, mfaVerifyEnable, handleAuthClientError } from '@/lib/auth-client';
import { MfaSetupCard } from './mfa-setup-card.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MfaSetupCard idle state', () => {
  it('renders the "Set up authenticator" button in the idle state', () => {
    /*
     * Scenario: when no setup has been initiated the card must show the
     * "Set up authenticator" call-to-action button.
     * Protects: idle step renders the setup button.
     */
    render(<MfaSetupCard onEnabled={vi.fn()} />);
    expect(screen.getByRole('button', { name: /set up authenticator/i })).toBeDefined();
  });
});

describe('MfaSetupCard setup flow', () => {
  it('shows QR code and verify form after clicking setup', async () => {
    /*
     * Scenario: clicking "Set up authenticator" must call mfaSetup and
     * transition to the scanning step showing the QR image.
     * Protects: handleSetup calls mfaSetup and transitions to step="scanning".
     */
    vi.mocked(mfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP',
      recoveryCodes: ['R1', 'R2'],
    });

    render(<MfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /set up authenticator/i }));

    await waitFor(() => {
      expect(screen.getByAltText('MFA QR code')).toBeDefined();
    });
    expect(mfaSetup).toHaveBeenCalledOnce();
  });

  it('shows the manual secret input after clicking setup', async () => {
    /*
     * Scenario: after setup the manual secret input must be rendered so
     * users who cannot scan a QR code can enter the secret manually.
     * Protects: scanning step renders the secret Input element.
     */
    vi.mocked(mfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP',
      recoveryCodes: ['R1', 'R2'],
    });

    render(<MfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /set up authenticator/i }));

    await waitFor(() => {
      // The secret input has value="JBSWY3DPEHPK3PXP".
      const inputs = document.querySelectorAll('input[readonly]');
      expect(inputs.length).toBeGreaterThan(0);
    });
  });

  it('returns to idle when Cancel is clicked from the scanning step', async () => {
    /*
     * Scenario: clicking Cancel during the scanning step must revert the
     * component to the idle state, hiding the QR code.
     * Protects: Cancel onClick resets step to "idle".
     */
    vi.mocked(mfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP',
      recoveryCodes: ['R1', 'R2'],
    });

    render(<MfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /set up authenticator/i }));

    await waitFor(() => {
      expect(screen.getByAltText('MFA QR code')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByAltText('MFA QR code')).toBeNull();
    expect(screen.getByRole('button', { name: /set up authenticator/i })).toBeDefined();
  });

  it('calls mfaVerifyEnable and shows recovery modal on successful verify', async () => {
    /*
     * Scenario: entering a valid 6-digit OTP code and submitting the verify form
     * must call mfaVerifyEnable and then open the RecoveryCodesModal.
     * Protects: onVerify path calls mfaVerifyEnable and sets showModal=true.
     */
    vi.mocked(mfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP',
      recoveryCodes: ['CODE-1', 'CODE-2'],
    });
    vi.mocked(mfaVerifyEnable).mockResolvedValue(undefined);

    render(<MfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /set up authenticator/i }));

    await waitFor(() => {
      expect(screen.getByAltText('MFA QR code')).toBeDefined();
    });

    // Fill the OTP inputs (6 single-character inputs from OtpInput).
    const otpInputs = document.querySelectorAll<HTMLInputElement>('input[maxlength="1"]');
    expect(otpInputs.length).toBe(6);
    const code = ['1', '2', '3', '4', '5', '6'];
    code.forEach((digit, i) => {
      fireEvent.change(otpInputs[i]!, { target: { value: digit } });
    });

    fireEvent.click(screen.getByRole('button', { name: /verify & enable/i }));

    await waitFor(() => {
      expect(mfaVerifyEnable).toHaveBeenCalledWith('123456');
    });
    // RecoveryCodesModal should be open — verify one recovery code is shown.
    await waitFor(() => {
      expect(screen.getByText('CODE-1')).toBeDefined();
    });
  });

  it('shows "Verifying…" text while mfaVerifyEnable is pending', async () => {
    /*
     * Scenario: while mfaVerifyEnable is in-flight the submit button must show
     * "Verifying…" so the user knows the request is processing.
     * Protects: line 185 — `isLoading ? 'Verifying…' : 'Verify & enable'` truthy branch.
     */
    vi.mocked(mfaSetup).mockResolvedValue({
      secret: 'TESTSECRET',
      qrCodeUri: 'otpauth://totp/test',
      recoveryCodes: ['R1'],
    });
    // Never-resolving promise keeps isLoading=true.
    vi.mocked(mfaVerifyEnable).mockReturnValue(new Promise(() => undefined));

    render(<MfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /set up authenticator/i }));

    await waitFor(() => expect(screen.getByAltText('MFA QR code')).toBeDefined());

    const otpInputs = document.querySelectorAll<HTMLInputElement>('input[maxlength="1"]');
    ['1', '2', '3', '4', '5', '6'].forEach((digit, i) => {
      fireEvent.change(otpInputs[i]!, { target: { value: digit } });
    });

    fireEvent.click(screen.getByRole('button', { name: /verify & enable/i }));

    await waitFor(() => {
      expect(screen.getByText('Verifying…')).toBeDefined();
    });
  });

  it('shows a validation error when submitting the verify form with an incomplete code', async () => {
    /*
     * Scenario: clicking "Verify & enable" without a complete 6-digit code must
     * trigger the Zod validation error for the code field.
     * Protects: line 175 — `errors.code &&` conditional renders the error message.
     */
    vi.mocked(mfaSetup).mockResolvedValue({
      secret: 'TESTSECRET',
      qrCodeUri: 'otpauth://totp/test',
      recoveryCodes: ['R1'],
    });

    render(<MfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /set up authenticator/i }));

    await waitFor(() => expect(screen.getByAltText('MFA QR code')).toBeDefined());

    // Submit without filling OTP inputs so the code field fails validation.
    fireEvent.click(screen.getByRole('button', { name: /verify & enable/i }));

    await waitFor(() => {
      // The validation error paragraph must appear below the OTP input.
      const errorParagraphs = document.querySelectorAll('p.text-xs.text-red-400');
      expect(errorParagraphs.length).toBeGreaterThan(0);
    });
  });

  it('calls handleAuthClientError when mfaSetup rejects', async () => {
    /*
     * Scenario: when mfaSetup throws the error must be forwarded to
     * handleAuthClientError so an error toast is shown.
     * Protects: line 82 — catch block in handleSetup calls handleAuthClientError.
     */
    const err = new Error('Setup failed');
    vi.mocked(mfaSetup).mockRejectedValue(err);
    render(<MfaSetupCard onEnabled={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /set up authenticator/i }));

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
  });

  it('calls handleAuthClientError when mfaVerifyEnable rejects', async () => {
    /*
     * Scenario: when mfaVerifyEnable throws after submitting the OTP the error
     * must be forwarded to handleAuthClientError.
     * Protects: line 98 — catch block in onVerify calls handleAuthClientError.
     */
    vi.mocked(mfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP',
      recoveryCodes: ['R1'],
    });
    const err = new Error('Verify failed');
    vi.mocked(mfaVerifyEnable).mockRejectedValue(err);

    render(<MfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /set up authenticator/i }));

    await waitFor(() => expect(screen.getByAltText('MFA QR code')).toBeDefined());

    const otpInputs = document.querySelectorAll<HTMLInputElement>('input[maxlength="1"]');
    ['1', '2', '3', '4', '5', '6'].forEach((digit, i) => {
      fireEvent.change(otpInputs[i]!, { target: { value: digit } });
    });

    fireEvent.click(screen.getByRole('button', { name: /verify & enable/i }));

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
  });

  it('selects all text when the secret input is clicked', async () => {
    /*
     * Scenario: clicking the read-only secret input must call select() on the
     * input element so the user can quickly copy the secret.
     * Protects: line 159 — onClick handler calls (e.target as HTMLInputElement).select().
     */
    vi.mocked(mfaSetup).mockResolvedValue({
      secret: 'TESTSECRET1234',
      qrCodeUri: 'otpauth://totp/test',
      recoveryCodes: ['R1'],
    });

    render(<MfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /set up authenticator/i }));

    await waitFor(() => expect(screen.getByAltText('MFA QR code')).toBeDefined());

    // Find the read-only secret input.
    const secretInput = document.querySelector('input[readonly]') as HTMLInputElement;
    expect(secretInput).toBeDefined();

    // Mock the select method and fire a click event.
    const selectSpy = vi.fn();
    secretInput.select = selectSpy;
    fireEvent.click(secretInput);

    expect(selectSpy).toHaveBeenCalledOnce();
  });

  it('calls onEnabled after closing the recovery codes modal', async () => {
    /*
     * Scenario: dismissing the RecoveryCodesModal (handleModalClose) must call
     * the onEnabled prop so the parent re-fetches the MFA state.
     * Protects: handleModalClose calls onEnabled after clearing modal state.
     */
    vi.mocked(mfaSetup).mockResolvedValue({
      secret: 'SECRET',
      qrCodeUri: 'otpauth://totp/test',
      recoveryCodes: ['REC-1'],
    });
    vi.mocked(mfaVerifyEnable).mockResolvedValue(undefined);

    const onEnabled = vi.fn();
    render(<MfaSetupCard onEnabled={onEnabled} />);

    fireEvent.click(screen.getByRole('button', { name: /set up authenticator/i }));
    await waitFor(() => expect(screen.getByAltText('MFA QR code')).toBeDefined());

    const otpInputs = document.querySelectorAll<HTMLInputElement>('input[maxlength="1"]');
    ['1', '2', '3', '4', '5', '6'].forEach((digit, i) => {
      fireEvent.change(otpInputs[i]!, { target: { value: digit } });
    });

    fireEvent.click(screen.getByRole('button', { name: /verify & enable/i }));

    await waitFor(() => expect(screen.getByText('REC-1')).toBeDefined());

    // The RecoveryCodesModal renders "I've saved my codes" as the confirm button.
    // Use exact text to avoid matching the X close icon button.
    const closeButton = screen.getByRole('button', { name: "I've saved my codes" });
    fireEvent.click(closeButton);

    expect(onEnabled).toHaveBeenCalledOnce();
  });
});

// ── Mutation-killing additions (mirrors platform-mfa-setup-card strategy) ────

describe('MfaSetupCard verbatim copy + disabled state', () => {
  it('shows the verbatim "Loading…" copy while mfaSetup is pending and disables the button', async () => {
    /*
     * Scenario: mfaSetup can take a moment (lib generates QR + secret +
     * recovery codes server-side). The button must surface the loading
     * affordance verbatim AND be disabled so the user cannot double-
     * click and create two enrolment attempts. Pins both the "Loading…"
     * string and the disabled state.
     */
    vi.mocked(mfaSetup).mockReturnValue(new Promise(() => undefined));
    render(<MfaSetupCard onEnabled={vi.fn()} />);
    const setupBtn = screen.getByRole('button', { name: /set up authenticator/i });
    fireEvent.click(setupBtn);

    await waitFor(() => {
      expect(screen.getByText('Loading…')).toBeDefined();
    });
    const btn = screen.getByRole<HTMLButtonElement>('button', { name: /loading/i });
    expect(btn.disabled).toBe(true);
  });

  it('renders the verbatim "Set up authenticator" copy in the idle state', () => {
    /*
     * Scenario: counterpart to the loading test — the idle state must
     * display the verbatim "Set up authenticator" copy. Pins the falsy
     * arm of the `isLoading ?` ternary.
     */
    render(<MfaSetupCard onEnabled={vi.fn()} />);
    expect(screen.getByText('Set up authenticator')).toBeDefined();
  });

  it('passes the empty OTP value to the inner OtpInput when the form field is undefined', async () => {
    /*
     * Scenario: React Hook Form initialises the `code` field as
     * undefined. The Controller's render must coerce that undefined to
     * the empty string before handing it to OtpInput so the boxes
     * start empty rather than displaying "undefined" or "Stryker".
     */
    vi.mocked(mfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:user',
      recoveryCodes: ['AAAA'],
    });
    render(<MfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /set up authenticator/i }));
    await screen.findByTestId('mfa-secret');

    const inputs = screen.getAllByRole<HTMLInputElement>('textbox');
    const otpInputs = inputs.filter((el) => el.inputMode === 'numeric');
    for (const input of otpInputs) {
      expect(input.value).toBe('');
    }
  });

  it('hides the recovery-codes modal entirely after the user clicks "I have saved my codes"', async () => {
    /*
     * Scenario: after dismissal the modal must DISAPPEAR from the DOM,
     * not just be cleared of content. The "saved my codes" button is
     * the only modal control unique to that surface — its absence is
     * the cleanest signal the modal closed. Pins `setShowModal(false)`.
     */
    vi.mocked(mfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:user',
      recoveryCodes: ['CODE-A'],
    });
    vi.mocked(mfaVerifyEnable).mockResolvedValue(undefined);

    render(<MfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /set up authenticator/i }));
    await screen.findByTestId('mfa-secret');
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
      expect(screen.queryByRole('button', { name: /saved my codes/i })).toBeNull();
    });
  });

  it('clears the recovery codes from internal state after the modal closes (prevents DOM leak)', async () => {
    /*
     * Scenario: once the user dismisses the modal, the recovery codes
     * must be wiped from component state — re-rendering the modal
     * (even briefly) with the codes would risk leaking them into a
     * background tab's DOM where a screen recorder or extension could
     * see them. Pins the `setRecoveryCodes([])` call inside
     * `handleModalClose`.
     */
    vi.mocked(mfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:user',
      recoveryCodes: ['SECRET-CODE-1'],
    });
    vi.mocked(mfaVerifyEnable).mockResolvedValue(undefined);

    render(<MfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /set up authenticator/i }));
    await screen.findByTestId('mfa-secret');
    const otpInputs = screen
      .getAllByRole('textbox')
      .filter((el) => (el as HTMLInputElement).inputMode === 'numeric');
    otpInputs.forEach((input, i) => {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    });
    fireEvent.click(screen.getByRole('button', { name: /verify.*enable/i }));

    await screen.findByText('SECRET-CODE-1');
    fireEvent.click(screen.getByRole('button', { name: /saved my codes/i }));

    await waitFor(() => {
      expect(screen.queryByText('SECRET-CODE-1')).toBeNull();
    });
  });

  it('re-enables the verify button and clears "Verifying…" after mfaVerifyEnable rejects', async () => {
    /*
     * Scenario: the verify endpoint rejects (wrong TOTP, anti-replay,
     * etc.). The `finally { setIsLoading(false) }` cleanup must run so
     * the button is clickable again — without it, the user would see a
     * permanent "Verifying…" label and have no way to retry.
     */
    vi.mocked(mfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeUri: 'otpauth://totp/Example:user',
      recoveryCodes: ['AAAA'],
    });
    vi.mocked(mfaVerifyEnable).mockRejectedValue(new Error('Invalid TOTP'));

    render(<MfaSetupCard onEnabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /set up authenticator/i }));
    await screen.findByTestId('mfa-secret');
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
      expect(screen.queryByText('Verifying…')).toBeNull();
    });
    const retryBtn = screen.getByRole<HTMLButtonElement>('button', { name: /verify.*enable/i });
    expect(retryBtn.disabled).toBe(false);
  });
});
