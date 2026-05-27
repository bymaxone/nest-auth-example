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
