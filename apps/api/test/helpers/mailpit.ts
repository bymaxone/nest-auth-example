/**
 * @file mailpit.ts
 * @description Test helper for polling the Mailpit email capture server.
 *
 * Used by e2e tests that need to read emails sent during the test flow (e.g.
 * email verification OTPs, password-reset tokens, invitation links).
 *
 * Mailpit API base: `http://localhost:58025` (test-stack port from docker-compose.test.yml).
 *
 * @layer test
 * @see docs/DEVELOPMENT_PLAN.md §Phase 7 P7-8
 */

/** Base URL for the Mailpit REST API running on the test stack. */
const MAILPIT_BASE = 'http://localhost:58025';

/** Mailpit API response shape for the message list endpoint. */
interface MailpitMessage {
  ID: string;
  From: { Address: string };
  To: Array<{ Address: string }>;
  Subject: string;
  Date: string;
}

/** Mailpit API response shape for the /api/v1/messages list. */
interface MailpitMessagesResponse {
  messages: MailpitMessage[];
  total: number;
}

/** Mailpit API response shape for an individual message detail. */
interface MailpitMessageDetail {
  HTML: string;
  Text: string;
  Subject: string;
}

/**
 * Deletes all messages in the Mailpit inbox.
 *
 * Call at the start of a test suite to ensure a clean state. Failures are
 * not fatal — if Mailpit is unavailable the test will surface the real error
 * when it tries to poll for an email.
 */
export async function clearMailpit(): Promise<void> {
  const res = await fetch(`${MAILPIT_BASE}/api/v1/messages`, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`Mailpit delete failed: ${res.status.toString()}`);
  }
}

/**
 * Polls the Mailpit API until a message addressed to `recipientEmail` is found,
 * then returns the HTML body of that message.
 *
 * Uses a 100ms poll interval and a 10-second maximum wait.
 *
 * @param recipientEmail - The `To` address to filter on (case-insensitive).
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 10_000).
 * @returns The HTML body of the first matching message.
 * @throws `Error` when no matching message arrives within the timeout.
 */
export async function waitForEmail(recipientEmail: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const normalizedRecipient = recipientEmail.toLowerCase();

  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_BASE}/api/v1/messages?limit=20`);
    if (!res.ok) {
      throw new Error(`Mailpit list failed: ${res.status.toString()}`);
    }

    const data = (await res.json()) as MailpitMessagesResponse;
    const match = data.messages?.find((m) =>
      m.To.some((t) => t.Address.toLowerCase() === normalizedRecipient),
    );

    if (match) {
      const detailRes = await fetch(`${MAILPIT_BASE}/api/v1/message/${match.ID}`);
      if (!detailRes.ok) {
        throw new Error(`Mailpit detail fetch failed: ${detailRes.status.toString()}`);
      }
      const detail = (await detailRes.json()) as MailpitMessageDetail;
      return detail.HTML;
    }

    // Wait 200ms between polls to avoid hammering the API.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(
    `No email addressed to '${recipientEmail}' arrived within ${timeoutMs.toString()}ms`,
  );
}

/**
 * Extracts the first 6-digit numeric OTP from an email HTML body.
 *
 * The OTP is rendered inside the `otp` CSS class in the email templates.
 * This helper matches the class name as well as a bare 6-digit pattern as a
 * fallback so it stays resilient to minor template changes.
 *
 * @param html - HTML body of the email.
 * @returns The extracted OTP string.
 * @throws `Error` when no 6-digit code is found.
 */
export function extractOtpFromHtml(html: string): string {
  // Primary: look for the otp-box content from the verify-email.html template.
  const classMatch = html.match(/class="otp"[^>]*>\s*(\d{6})\s*</);
  if (classMatch?.[1]) {
    return classMatch[1];
  }

  // Fallback: any standalone 6-digit number (not part of a longer number).
  const rawMatch = html.match(/\b(\d{6})\b/);
  if (rawMatch?.[1]) {
    return rawMatch[1];
  }

  throw new Error('Could not extract a 6-digit OTP from the email body');
}

/**
 * Extracts a password-reset link from an email HTML body.
 *
 * The token link is embedded as an `<a href="...">` in the reset-password
 * email template.
 *
 * @param html - HTML body of the email.
 * @returns The full reset URL including the token query parameter.
 * @throws `Error` when no reset link is found.
 */
export function extractResetTokenFromHtml(html: string): string {
  // Match any href containing a `token=` query parameter (reset-password link).
  const match = html.match(/href="([^"]*token=[^"]+)"/);
  if (match?.[1]) {
    return match[1];
  }

  throw new Error('Could not extract a password-reset link from the email body');
}
