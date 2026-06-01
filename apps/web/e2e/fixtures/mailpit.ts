/**
 * @fileoverview Mailpit polling helper for Playwright e2e tests.
 *
 * Provides `waitForEmail` and extraction helpers that poll the Mailpit HTTP API
 * until a matching email arrives (or the timeout elapses).
 *
 * @layer test/e2e/fixtures
 */

/** Base URL for the Mailpit API (matches docker-compose.yml dev stack port). */
const MAILPIT_URL = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';

interface MailpitMessage {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
}

interface MailpitMessagesResponse {
  messages: MailpitMessage[];
  total: number;
}

interface MailpitMessageDetail {
  HTML: string;
  Text: string;
}

/**
 * Subjects that are SIDE EFFECTS of the auth flow, not the primary email a
 * test is waiting for. Skipped by default so a spec waiting for a verify OTP,
 * password-reset link, or invitation does not pick up the new-session security
 * alert that the `onNewSession` hook dispatches during register / login.
 */
const SKIP_SUBJECTS = /new sign-in detected/i;

/**
 * Polls Mailpit until an email addressed to `recipientEmail` arrives.
 *
 * @param recipientEmail - Recipient address to filter on (case-insensitive).
 * @param timeoutMs - Maximum wait time in milliseconds (default: 10_000).
 * @returns The HTML body of the first matching email.
 * @throws When no matching email arrives within the timeout.
 */
export async function waitForEmail(recipientEmail: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const normalised = recipientEmail.toLowerCase();

  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=20`);
    if (!res.ok) {
      throw new Error(`Mailpit list failed: ${res.status.toString()}`);
    }
    const data = (await res.json()) as MailpitMessagesResponse;
    const match = data.messages?.find(
      (m) =>
        !SKIP_SUBJECTS.test(m.Subject) && m.To.some((t) => t.Address.toLowerCase() === normalised),
    );
    if (match) {
      const detail = await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
      if (!detail.ok) {
        throw new Error(`Mailpit detail fetch failed: ${detail.status.toString()}`);
      }
      const body = (await detail.json()) as MailpitMessageDetail;
      return body.HTML;
    }
    await new Promise<void>((r) => setTimeout(r, 200));
  }

  throw new Error(`No email to '${recipientEmail}' arrived within ${timeoutMs.toString()}ms`);
}

/**
 * Clears all messages from the Mailpit inbox.
 *
 * @throws When the delete request fails.
 */
export async function clearMailpit(): Promise<void> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`Mailpit clear failed: ${res.status.toString()}`);
  }
}

/**
 * Extracts the first 6-digit OTP from an email HTML body.
 *
 * @param html - HTML body of the email.
 * @returns The 6-digit OTP string.
 * @throws When no 6-digit code is found.
 */
export function extractOtp(html: string): string {
  const match = html.match(/class="otp"[^>]*>\s*(\d{6})\s*</) ?? html.match(/\b(\d{6})\b/);
  if (match?.[1]) return match[1];
  throw new Error('Could not extract OTP from email body');
}

/**
 * Extracts the password-reset URL from an email HTML body.
 *
 * @param html - HTML body of the reset email.
 * @returns The full reset URL.
 * @throws When no reset link is found.
 */
export function extractResetUrl(html: string): string {
  const match = html.match(/href="([^"]*token=[^"]+)"/);
  if (match?.[1]) return match[1];
  throw new Error('Could not extract reset URL from email body');
}

/**
 * Extracts the invitation accept token from an email HTML body.
 *
 * @param html - HTML body of the invitation email.
 * @returns The decoded invitation token.
 * @throws When no token is found.
 */
export function extractInviteToken(html: string): string {
  const match = html.match(/[?&]token=([^"&\s<]+)/);
  if (match?.[1]) return decodeURIComponent(match[1]);
  throw new Error('Could not extract invite token from email body');
}
