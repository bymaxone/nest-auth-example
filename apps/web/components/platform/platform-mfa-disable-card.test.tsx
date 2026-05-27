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
