/**
 * @file default-email.provider.ts
 * @description `DefaultAuthEmailProvider` wired over a nodemailer→Mailpit SMTP
 * sink — the third `EMAIL_PROVIDER` choice (`mailpit-default`).
 *
 * Where `MailpitEmailProvider` implements `IEmailProvider` by hand (its own
 * HTML templates, its own delivery), this provider demonstrates the library's
 * own default: the app supplies only an `AuthEmailSink` delivery channel and
 * the library renders every message, escapes it, and applies the
 * delivery-error policy. Three seams are exercised:
 *
 * - **Sink** — `MailpitSmtpSink` adapts nodemailer's `sendMail` to the
 *   library's `send` contract. It logs the message `kind` and the
 *   `containsCredential` flag only — never the subject, bodies, or recipient
 *   — honouring the sink contract's "publish none of this message" duty.
 * - **`messages` catalogue overrides** — `emailChangeVerification` is
 *   replaced so the mailed copy carries the app's real confirm URL
 *   (`${WEB_ORIGIN}/auth/confirm-email-change?token=…`), and `passwordChanged`
 *   gets an app-branded subject. Every other kind keeps the secure default.
 * - **Per-kind `onDeliveryError` policy** — only `passwordResetToken`
 *   rethrows (so `PasswordResetService` deletes an undelivered token early);
 *   everything else keeps the safe `'swallow'` default. The rethrow path is
 *   caught once here and described with `describeChannelStatus`, which
 *   publishes nothing the channel wrote — the channel's original error may
 *   quote the message body, credential included, so it must never be logged raw.
 *
 * **Known limitation — links in this provider carry no tenant.** The catalogue
 * renderers receive only their own payload (`emailChangeVerification` gets
 * `{ token, locale }`, `passwordResetToken` gets `{ token, locale }`); the
 * tenant and the recipient address stay on the class methods and never reach
 * the renderer. So the URLs built here cannot include `tenantId`, and the
 * reset URL cannot include the `mode`/`email` the reset page reads either.
 *
 * A recipient opening one of these links in a browser with no `tenant_id`
 * cookie is refused by the API's tenant resolver. The hand-written providers
 * do not have this problem — they build URLs in the class method, where the
 * tenant is in scope — so the gap is specific to demonstrating the library's
 * own renderer. Working around it would mean stashing per-call state on the
 * instance between the method and an async render, which races, or
 * re-implementing rendering and escaping, which defeats the purpose of the
 * demonstration. The fix belongs upstream: give the renderers the tenant.
 *
 * This is why the provider is confined to dev. `EMAIL_PROVIDER=mailpit-default`
 * is rejected in production by the env schema, so no deployment can hit it.
 *
 * @layer auth
 * @see docs/guidelines/email-guidelines.md
 * @see docs/guidelines/logging-guidelines.md
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { DefaultAuthEmailProvider, describeChannelStatus } from '@bymax-one/nest-auth';
import type {
  AuthEmailCatalogue,
  AuthEmailKind,
  AuthEmailMessage,
  AuthEmailSink,
  DefaultAuthEmailProviderOptions,
  DeliveryErrorPolicy,
  DeliveryErrorPolicyMap,
} from '@bymax-one/nest-auth';

import type { Env } from '../config/env.schema.js';

/**
 * The policy that opts a message kind into rejecting its calling flow.
 *
 * Named so the map below reads as intent rather than a bare string literal.
 */
const RETHROW: DeliveryErrorPolicy = 'rethrow';

/**
 * Per-kind delivery-error policy.
 *
 * Only the reset-token flow rethrows: `PasswordResetService` reacts to the
 * throw by deleting the stored token early instead of leaving an undelivered
 * credential alive until its TTL. Every kind left out of the map keeps
 * `'swallow'` — the safe value is what you get by saying nothing, so widening
 * the opt-in is always an explicit edit here. A bare `'rethrow'` would also
 * reach four more credential-bearing kinds nobody asked to throw.
 */
const DELIVERY_ERROR_POLICY: DeliveryErrorPolicyMap = {
  passwordResetToken: RETHROW,
};

/**
 * Nodemailer delivery channel over the local Mailpit SMTP endpoint.
 *
 * Satisfies the library's `AuthEmailSink` contract deliberately rather than
 * structurally: `containsCredential` is the field a generic mailer would
 * silently ignore, so this sink's one duty beyond delivery is to honour it —
 * nothing of the message's content is logged, thrown, or recorded here.
 * Transport errors propagate unaltered so the provider's per-kind policy
 * decides whether they swallow or rethrow.
 *
 * Exported for direct unit testing of the sink contract; application code
 * consumes it only through `MailpitDefaultEmailProvider`.
 *
 * @public
 */
export class MailpitSmtpSink implements AuthEmailSink {
  private readonly logger = new Logger(MailpitSmtpSink.name);

  /**
   * @param transporter - Nodemailer SMTP transport pointed at Mailpit.
   * @param from - Sender address for every outbound message.
   */
  constructor(
    private readonly transporter: Transporter,
    private readonly from: string,
  ) {}

  /**
   * Delivers one rendered message via SMTP.
   *
   * Logs the message `kind` and the `containsCredential` flag only. The
   * subject and both bodies are rendered by the library and may carry a live
   * credential (`containsCredential: true` states exactly that), so none of
   * them may reach a log line, in any encoding.
   *
   * @param input - Tenant, recipient, rendered subject/bodies, kind, and flag.
   * @returns Nothing the provider reads — the contract ignores the result.
   */
  async send(input: {
    tenantId: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    kind: AuthEmailKind;
    containsCredential: boolean;
  }): Promise<unknown> {
    await this.transporter.sendMail({
      from: this.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    this.logger.log({
      msg: 'Auth email delivered',
      kind: input.kind,
      containsCredential: input.containsCredential,
    });
    return undefined;
  }
}

/**
 * Copy overrides for the library's message catalogue.
 *
 * Only the entries returned here replace the library's renderers; every
 * other kind keeps its secure default copy and escaping.
 *
 * @param webOrigin - Validated `WEB_ORIGIN`, the base of the confirm URL.
 * @returns The two overridden renderers.
 */
function buildMessageOverrides(webOrigin: string): Partial<AuthEmailCatalogue> {
  return {
    /**
     * The library's default copy states the token on its own; this app has a
     * real confirm page, so the override renders the clickable URL instead.
     * `containsCredential: true` is stated explicitly even though the kind's
     * baseline already implies it — an override replaces the renderer
     * outright, so it re-declares what its own body carries.
     */
    emailChangeVerification: ({ token }): AuthEmailMessage => ({
      subject: 'Confirm your new email address',
      text:
        `You asked to move your account to this address. ` +
        `Open the link below to confirm the change:\n\n` +
        `${webOrigin}/auth/confirm-email-change?token=${encodeURIComponent(token)}\n\n` +
        `If you did not request this, you can ignore this message.`,
      // Stryker disable next-line BooleanLiteral: an equivalent mutant, by the library's documented semantics. `AuthEmailMessage.containsCredential` is OR-ed with the kind's own baseline — "a renderer cannot make that baseline weaker" — and `emailChangeVerification` already carries a credential by baseline, so `false` here reaches the sink as `true` regardless. The flag is stated anyway because an override replaces the renderer outright and should declare what its own body carries; that the sink is told `true` is pinned by "declares the email-change body as carrying a credential".
      containsCredential: true,
    }),
    /** App-branded subject for the credential-change notice (NIST SP 800-63B §4.6). */
    passwordChanged: (): AuthEmailMessage => ({
      subject: 'Your nest-auth-example password was changed',
      text:
        'The password on your account was just changed. ' +
        'If this was not you, reset your password immediately and review your active sessions.',
    }),
  };
}

/**
 * The library's `DefaultAuthEmailProvider` bound to the Mailpit SMTP sink.
 *
 * Selected with `EMAIL_PROVIDER=mailpit-default`. Everything the provider
 * does — rendering, HTML escaping, the credential flag, the delivery-error
 * policy — is the library's own code; this class only supplies the channel
 * and the two seams documented in the file header.
 *
 * @public
 */
@Injectable()
export class MailpitDefaultEmailProvider extends DefaultAuthEmailProvider {
  /**
   * Named distinctly from the parent's private `logger` — TypeScript treats
   * same-named private fields across the hierarchy as a conflict.
   */
  private readonly deliveryLogger = new Logger(MailpitDefaultEmailProvider.name);

  /**
   * Builds the SMTP transport from validated env vars and hands the library
   * its sink plus the copy overrides and per-kind error policy.
   *
   * @param config - Zod-validated `ConfigService`. `SMTP_HOST`, `SMTP_PORT`,
   *   `SMTP_FROM`, and `WEB_ORIGIN` are guaranteed present by schema defaults.
   */
  constructor(config: ConfigService<Env, true>) {
    const host = config.getOrThrow<string>('SMTP_HOST');
    const port = config.getOrThrow<number>('SMTP_PORT');
    const from = config.getOrThrow<string>('SMTP_FROM');
    const webOrigin = config.getOrThrow<string>('WEB_ORIGIN');

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: false,
      ignoreTLS: true,
    });

    const options: DefaultAuthEmailProviderOptions = {
      messages: buildMessageOverrides(webOrigin),
      onDeliveryError: DELIVERY_ERROR_POLICY,
    };

    super(new MailpitSmtpSink(transporter, from), options);
  }

  /**
   * The catch side of the `passwordResetToken: 'rethrow'` opt-in.
   *
   * What the provider rethrows is the channel's ORIGINAL error, unaltered —
   * a relay that rejects a message by quoting its body puts the live reset
   * token into that error. `describeChannelStatus` is therefore mandatory
   * here: it publishes only the failure's shape (that a throw happened and
   * how deep its `cause` chain is), never anything the channel authored —
   * `redactSecrets` could not help because a relay may re-encode what it
   * quotes. The error is rethrown untouched so `PasswordResetService` still
   * deletes the undelivered token early.
   *
   * @param tenantId - Tenant the reset was requested in.
   * @param email - Recipient address.
   * @param token - Signed reset token — rendered by the library, never logged.
   * @param locale - BCP 47 locale tag, forwarded to the library renderer.
   * @throws The channel's original error, after the described log line.
   */
  override async sendPasswordResetToken(
    tenantId: string,
    email: string,
    token: string,
    locale?: string,
  ): Promise<void> {
    try {
      await super.sendPasswordResetToken(tenantId, email, token, locale);
    } catch (error: unknown) {
      this.deliveryLogger.warn(
        `Reset-token delivery rejected by the channel: ${describeChannelStatus(error)}`,
      );
      throw error;
    }
  }
}
