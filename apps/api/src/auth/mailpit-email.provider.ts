/**
 * @file mailpit-email.provider.ts
 * @description Nodemailer-backed `IEmailProvider` that delivers mail to a local
 * Mailpit SMTP server for development and testing.
 *
 * Mailpit captures all outbound email — no real messages are sent.
 * Swap to `ResendEmailProvider` in production via `EMAIL_PROVIDER=resend`.
 *
 * Security constraints:
 * - Log output includes only the email subject and recipient — never the body,
 *   OTP codes, reset tokens, or session hashes.
 * - Transport uses `secure: false` and no auth — Mailpit does not require TLS.
 * - Template rendering uses simple `{{var}}` string replacement; no eval or
 *   dynamic code execution.
 *
 * Covers FCM rows #5 (email verification), #6/#7 (password reset), #15 (new-session
 * alert), #21 (invitations), #31 (custom email provider).
 *
 * @layer auth
 * @see docs/guidelines/email-guidelines.md
 * @see docs/guidelines/logging-guidelines.md
 */

import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { IEmailProvider, InviteData, SessionInfo } from '@bymax-one/nest-auth';

import type { Env } from '../config/env.schema.js';

/**
 * Directory that contains the HTML email templates.
 *
 * Computed once at module load using `import.meta.url` so it resolves correctly
 * in both dev (src/) and production (dist/ after asset copy in nest-cli.json).
 */
const TEMPLATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'email-templates');

/**
 * Nodemailer SMTP transporter pointing at the local Mailpit instance.
 *
 * Used in development and testing only. Never enable in production.
 *
 * @public
 */
@Injectable()
export class MailpitEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(MailpitEmailProvider.name);
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly webOrigin: string;
  private readonly templateCache = new Map<string, string>();

  /** Allowlist of valid template names — prevents path traversal via `render()`. */
  private static readonly ALLOWED_TEMPLATES = new Set([
    'password-reset-token',
    'password-reset-otp',
    'verify-email',
    'mfa-enabled',
    'mfa-disabled',
    'new-session-alert',
    'invitation',
  ]);

  /**
   * Escapes user-supplied strings for safe interpolation into HTML.
   *
   * Applied to all template variables so attacker-controlled values (e.g. the
   * `inviterName` or `device` user-agent) cannot inject HTML into outbound emails.
   *
   * @param unsafe - Raw string from user input or an external source.
   * @returns HTML-escaped string safe for use in both text nodes and attributes.
   */
  private static escapeHtml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Builds the Nodemailer SMTP transport from validated environment variables.
   * All templates are preloaded synchronously during module initialisation so
   * blocking I/O never occurs during live request handling.
   *
   * @param config - Zod-validated `ConfigService`. `SMTP_HOST`, `SMTP_PORT`, and
   *   `SMTP_FROM` are required and guaranteed present by the Zod schema defaults.
   */
  constructor(config: ConfigService<Env, true>) {
    const host = config.getOrThrow<string>('SMTP_HOST');
    const port = config.getOrThrow<number>('SMTP_PORT');
    this.from = config.getOrThrow<string>('SMTP_FROM');
    this.webOrigin = config.getOrThrow<string>('WEB_ORIGIN');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: false,
      ignoreTLS: true,
    });

    // Preload all templates at construction time (NestJS module-init phase is
    // synchronous, so blocking I/O here is safe and avoids event-loop stalls
    // on the first email sent of each type).
    for (const name of MailpitEmailProvider.ALLOWED_TEMPLATES) {
      const path = resolve(TEMPLATE_DIR, `${name}.html`);
      this.templateCache.set(name, readFileSync(path, 'utf-8'));
    }
  }

  /**
   * Retrieves a preloaded template and interpolates `{{key}}` placeholders.
   *
   * Two categories of substitution are supported:
   * - `textVars` are HTML-escaped to prevent injection from attacker-controlled
   *   inputs (e.g. `inviterName`, `device` user-agent, OTP codes).
   * - `urlVars` are substituted without escaping — they are already safe because
   *   they are built from a validated `WEB_ORIGIN` env var plus `encodeURIComponent`-
   *   encoded tokens. Escaping `&` in a URL to `&amp;` would break `href` attributes
   *   in email clients that do not decode HTML entities before following links.
   *
   * @param templateName - File name without the `.html` extension (must be in allowlist).
   * @param textVars - User-facing strings to HTML-escape before substitution.
   * @param urlVars - Pre-encoded URL strings to substitute without HTML-escaping.
   * @returns Rendered HTML string.
   * @throws {Error} When `templateName` is not in the allowlist.
   */
  private render(
    templateName: string,
    textVars: Record<string, string>,
    urlVars: Record<string, string> = {},
  ): string {
    if (!MailpitEmailProvider.ALLOWED_TEMPLATES.has(templateName)) {
      throw new Error(`Unknown email template: ${templateName}`);
    }
    const html = this.templateCache.get(templateName);
    if (html === undefined) {
      // Invariant: all ALLOWED_TEMPLATES are preloaded in the constructor.
      throw new Error(`Template '${templateName}' was not preloaded at startup`);
    }
    // URL vars first — no HTML-escaping (values are already safe).
    const withUrls = Object.entries(urlVars).reduce(
      (acc, [key, val]) => acc.replaceAll(`{{${key}}}`, val),
      html,
    );
    // Text vars second — HTML-escape to neutralise any injected markup.
    return Object.entries(textVars).reduce(
      (acc, [key, val]) => acc.replaceAll(`{{${key}}}`, MailpitEmailProvider.escapeHtml(val)),
      withUrls,
    );
  }

  /**
   * Sends a transactional email via the Mailpit SMTP transport.
   *
   * Logs the subject and recipient only — never the body or any secret value.
   * Transport errors are logged before rethrowing to preserve operator visibility.
   *
   * @param to - Recipient email address.
   * @param subject - Email subject line.
   * @param html - Rendered HTML body.
   * @throws Re-throws transport errors so the caller decides on retry strategy.
   */
  private async send(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
      this.logger.log({ msg: 'Email sent', subject, to });
    } catch (err: unknown) {
      this.logger.error({
        msg: 'SMTP delivery failed',
        subject,
        to,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Sends a password-reset link email.
   *
   * The raw `token` is embedded in the reset URL by the caller; only the URL is
   * put in the template — the token is never separately logged.
   *
   * @param email - Recipient's email address.
   * @param token - Signed reset token. The template embeds it in the reset URL.
   * @param _locale - BCP 47 locale tag (unused; single locale supported).
   */
  async sendPasswordResetToken(email: string, token: string, _locale?: string): Promise<void> {
    const resetUrl = `${this.webOrigin}/auth/reset-password?mode=token&token=${encodeURIComponent(token)}`;
    const html = this.render('password-reset-token', {}, { resetUrl });
    await this.send(email, 'Reset your password', html);
  }

  /**
   * Sends a password-reset OTP code email.
   *
   * @param email - Recipient's email address.
   * @param otp - Short-lived numeric OTP code. Never logged.
   * @param _locale - BCP 47 locale tag (unused).
   */
  async sendPasswordResetOtp(email: string, otp: string, _locale?: string): Promise<void> {
    const html = this.render('password-reset-otp', { otp });
    await this.send(email, 'Your password reset code', html);
  }

  /**
   * Sends an email-verification OTP code.
   *
   * @param email - Recipient's email address to be verified.
   * @param otp - Short-lived OTP code for verification. Never logged.
   * @param _locale - BCP 47 locale tag (unused).
   */
  async sendEmailVerificationOtp(email: string, otp: string, _locale?: string): Promise<void> {
    const html = this.render('verify-email', { otp });
    await this.send(email, 'Verify your email address', html);
  }

  /**
   * Sends a security notification that MFA was enabled on the account.
   *
   * @param email - Recipient's email address.
   * @param _locale - BCP 47 locale tag (unused).
   */
  async sendMfaEnabledNotification(email: string, _locale?: string): Promise<void> {
    const html = this.render('mfa-enabled', {});
    await this.send(email, 'Two-factor authentication enabled', html);
  }

  /**
   * Sends a security alert that MFA was disabled on the account.
   *
   * @param email - Recipient's email address.
   * @param _locale - BCP 47 locale tag (unused).
   */
  async sendMfaDisabledNotification(email: string, _locale?: string): Promise<void> {
    const html = this.render('mfa-disabled', {});
    await this.send(email, 'Two-factor authentication disabled', html);
  }

  /**
   * Sends a new-session security alert.
   *
   * Logs subject and recipient only — `sessionInfo.ip` and `sessionInfo.sessionHash`
   * are included in the email body but never logged here.
   *
   * @param email - Recipient's email address.
   * @param sessionInfo - Device, IP, and session hash for the new session.
   * @param _locale - BCP 47 locale tag (unused).
   */
  async sendNewSessionAlert(
    email: string,
    sessionInfo: SessionInfo,
    _locale?: string,
  ): Promise<void> {
    const html = this.render('new-session-alert', {
      device: sessionInfo.device,
      ip: sessionInfo.ip,
      sessionHash: sessionInfo.sessionHash,
    });
    await this.send(email, 'New sign-in detected on your account', html);
  }

  /**
   * Sends a tenant invitation email to a prospective member.
   *
   * Builds the accept URL from the raw `inviteToken` and passes it to the template.
   * The raw token is embedded in the URL only — never logged.
   *
   * @param email - Recipient's email address (the invitee).
   * @param inviteData - Invitation metadata.
   * @param _locale - BCP 47 locale tag (unused).
   */
  async sendInvitation(email: string, inviteData: InviteData, _locale?: string): Promise<void> {
    const acceptUrl = `${this.webOrigin}/auth/accept-invitation?token=${encodeURIComponent(inviteData.inviteToken)}`;
    const html = this.render(
      'invitation',
      {
        inviterName: inviteData.inviterName,
        tenantName: inviteData.tenantName,
        expiresAt: inviteData.expiresAt.toUTCString(),
      },
      { acceptUrl },
    );
    // Strip CRLF from tenantName to prevent SMTP header injection in the subject line.
    const safeSubject = inviteData.tenantName.replace(/[\r\n]/g, '');
    await this.send(email, `You've been invited to join ${safeSubject}`, html);
  }
}
