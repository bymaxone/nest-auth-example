/**
 * @file email-text-bodies.ts
 * @description Plain-text counterparts for every transactional email body.
 *
 * A `text/html`-only message has no representation in a text-only client, and
 * corporate filters that strip HTML leave the recipient with an empty body —
 * which for the reset, confirm and invitation kinds means an action they can
 * no longer complete, and for the security notices a warning they never read.
 * Every message therefore ships `multipart/alternative`.
 *
 * The bodies live here rather than inline in each provider because both
 * providers send the same nine kinds: keeping one copy is what stops the SMTP
 * and Resend paths from drifting into telling users different things.
 *
 * These are the plain-text alternative, not a fallback to be escaped: they are
 * never rendered as markup, so values are interpolated as-is.
 *
 * @layer auth
 * @see docs/guidelines/email-guidelines.md
 */

/** Closing line shared by every message that carries a credential or a link. */
const IGNORE_NOTICE = 'If you did not request this, you can safely ignore this email.';

/** Closing line shared by the security notices, which are never user-initiated. */
const SECURITY_NOTICE = 'If this was not you, reset your password and review your active sessions.';

/**
 * Plain-text bodies, one per message kind.
 *
 * @public
 */
export const emailTextBodies = {
  /**
   * @param resetUrl - Fully-qualified reset link, already carrying the token.
   * @returns Plain-text body for the token-based password reset.
   */
  passwordResetToken: (resetUrl: string): string =>
    `Reset your password by opening the link below:\n\n${resetUrl}\n\n${IGNORE_NOTICE}`,

  /**
   * @param otp - Short-lived numeric code.
   * @returns Plain-text body for the OTP-based password reset.
   */
  passwordResetOtp: (otp: string): string =>
    `Your password reset code is ${otp}.\n\nIt expires shortly.\n\n${IGNORE_NOTICE}`,

  /**
   * @param otp - Short-lived numeric code.
   * @returns Plain-text body for email verification.
   */
  emailVerificationOtp: (otp: string): string =>
    `Your email verification code is ${otp}.\n\nIt expires shortly.\n\n${IGNORE_NOTICE}`,

  /** @returns Plain-text body for the MFA-enabled notice. */
  mfaEnabled: (): string =>
    `Two-factor authentication was enabled on your account.\n\n${SECURITY_NOTICE}`,

  /** @returns Plain-text body for the MFA-disabled notice. */
  mfaDisabled: (): string =>
    `Two-factor authentication was disabled on your account.\n\n${SECURITY_NOTICE}`,

  /**
   * @param device - User-agent description of the new session.
   * @param ip - Client address the session was opened from.
   * @returns Plain-text body for the new-sign-in alert.
   */
  newSessionAlert: (device: string, ip: string): string =>
    `A new sign-in to your account was detected.\n\nDevice: ${device}\nIP address: ${ip}\n\n${SECURITY_NOTICE}`,

  /**
   * @param confirmUrl - Fully-qualified confirm link, carrying token and tenant.
   * @returns Plain-text body for the email-change verification.
   */
  emailChangeVerification: (confirmUrl: string): string =>
    `You asked to move your account to this address. Open the link below to confirm the change:\n\n${confirmUrl}\n\n${IGNORE_NOTICE}`,

  /**
   * @param newEmail - The address the account now uses.
   * @returns Plain-text body for the notice sent to the previous address.
   */
  emailChanged: (newEmail: string): string =>
    `The email address on your account was changed to ${newEmail}.\n\n${SECURITY_NOTICE}`,

  /**
   * @param inviterName - Who sent the invitation.
   * @param tenantName - Organisation being joined.
   * @param acceptUrl - Fully-qualified accept link, carrying the token.
   * @param expiresAt - Human-readable expiry.
   * @returns Plain-text body for a tenant invitation.
   */
  invitation: (
    inviterName: string,
    tenantName: string,
    acceptUrl: string,
    expiresAt: string,
  ): string =>
    `${inviterName} invited you to join ${tenantName}.\n\nAccept the invitation using the link below:\n\n${acceptUrl}\n\nThis invitation expires on ${expiresAt}.\n\n${IGNORE_NOTICE}`,
} as const;
