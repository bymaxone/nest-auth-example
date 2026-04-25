/**
 * @fileoverview QR code data-URL generator for MFA setup.
 *
 * Wraps the `qrcode` npm package to produce a base64-encoded PNG data URL
 * from an `otpauth://` URI. Runs in the browser (Client Component context).
 *
 * @layer lib/client
 */

import QRCode from 'qrcode';

/**
 * Renders `uri` as a base64 PNG data URL suitable for use in `<img src="…">`.
 *
 * @param uri  - The `otpauth://` URI returned by the MFA setup endpoint.
 * @returns    A `data:image/png;base64,…` string.
 * @throws     On encoding failure (malformed URI or canvas unavailable).
 */
export async function toQrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, {
    width: 200,
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
  });
}
