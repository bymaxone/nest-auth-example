/**
 * @fileoverview Unit tests for the `toQrDataUrl` QR code generator.
 *
 * Verifies that `toQrDataUrl` resolves to a base64 PNG data URL and delegates
 * to the underlying `qrcode` npm package. The `qrcode` module is mocked so the
 * test runs in jsdom without a canvas implementation.
 *
 * @module lib/qrcode.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(),
  },
}));

/** Typed handle for the QRCode.toDataURL mock (promise-returning overload). */
type ToDataURLFn = (text: string, options?: unknown) => Promise<string>;

// ── Typed imports after mocks ─────────────────────────────────────────────────

import QRCode from 'qrcode';
import { toQrDataUrl } from './qrcode.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('toQrDataUrl', () => {
  it('resolves to the data URL returned by QRCode.toDataURL', async () => {
    /*
     * Scenario: calling toQrDataUrl with an otpauth URI must return the data URL
     * resolved by the underlying QRCode.toDataURL call.
     * Protects: toQrDataUrl delegates to QRCode.toDataURL and returns its result.
     */
    const fakeDataUrl = 'data:image/png;base64,FAKEQR==';
    vi.mocked(QRCode.toDataURL as ToDataURLFn).mockResolvedValue(fakeDataUrl);

    const result = await toQrDataUrl('otpauth://totp/Example?secret=ABC');

    expect(result).toBe(fakeDataUrl);
  });

  it('calls QRCode.toDataURL with the provided URI and correct options', async () => {
    /*
     * Scenario: the options passed to QRCode.toDataURL must include width=200,
     * margin=1, and the correct dark/light colors.
     * Protects: toQrDataUrl passes the expected options to the underlying library.
     */
    vi.mocked(QRCode.toDataURL as ToDataURLFn).mockResolvedValue('data:image/png;base64,X');

    const uri = 'otpauth://totp/MyApp:user@example.com?secret=SECRET';
    await toQrDataUrl(uri);

    expect(QRCode.toDataURL).toHaveBeenCalledWith(uri, {
      width: 200,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    });
  });

  it('propagates errors thrown by QRCode.toDataURL', async () => {
    /*
     * Scenario: when QRCode.toDataURL throws (e.g. canvas unavailable) the
     * error must propagate to the caller unchanged.
     * Protects: toQrDataUrl does not swallow errors from the underlying library.
     */
    vi.mocked(QRCode.toDataURL as ToDataURLFn).mockRejectedValue(new Error('Canvas not available'));

    await expect(toQrDataUrl('otpauth://totp/Test')).rejects.toThrow('Canvas not available');
  });
});
