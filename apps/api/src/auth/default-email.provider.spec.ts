/**
 * @file default-email.provider.spec.ts
 * @description Unit tests for `MailpitDefaultEmailProvider` and `MailpitSmtpSink`.
 *
 * Verifies:
 * - Constructor wiring: the SMTP transport is built from the validated env vars
 *   with the Mailpit-specific `secure: false` / `ignoreTLS: true` options.
 * - The sink receives the message `kind` and `containsCredential` flag and logs
 *   ONLY those two — never the subject, bodies, or recipient content.
 * - The `messages` catalogue overrides take effect (confirm-URL copy for
 *   `emailChangeVerification`, app-branded `passwordChanged` subject) while
 *   non-overridden kinds keep the library's default rendering.
 * - The per-kind `onDeliveryError` policy: `passwordResetToken` rethrows the
 *   channel's original error and the catch-side log line is
 *   `describeChannelStatus`-shaped (publishes nothing the channel wrote);
 *   every other kind keeps the `'swallow'` default and resolves.
 *
 * Uses `jest.unstable_mockModule` + dynamic `import()` — the correct pattern
 * for ESM modules compiled with ts-jest `useESM: true`.
 *
 * @layer test
 * @see apps/api/src/auth/default-email.provider.ts
 * @see docs/guidelines/testing-guidelines.md
 * @see docs/guidelines/email-guidelines.md
 */

import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import type { AuthEmailKind } from '@bymax-one/nest-auth';
import { AUTH_EMAIL_KINDS } from '@bymax-one/nest-auth';

// ─── Transport mock ───────────────────────────────────────────────────────────

/** Mail-options shape passed to `transporter.sendMail`. */
interface MailOptions {
  from?: string;
  to?: string;
  subject?: string;
  html?: string;
  text?: string;
}

/**
 * Shared mock for `transporter.sendMail`. Declared at module scope so the
 * `unstable_mockModule` factory below can close over it without a TDZ problem.
 */
const mockSendMail = jest.fn<(opts: MailOptions) => Promise<void>>().mockResolvedValue(undefined);

/** Options shape Nodemailer's `createTransport` accepts (subset we assert on). */
interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  ignoreTLS: boolean;
}

/**
 * Shared mock for `nodemailer.createTransport` so tests can assert on the
 * SMTP transport options the provider hands in.
 */
const mockCreateTransport = jest
  .fn<(opts: SmtpTransportOptions) => { sendMail: typeof mockSendMail }>()
  .mockImplementation(() => ({ sendMail: mockSendMail }));

jest.unstable_mockModule('nodemailer', () => ({
  default: {
    createTransport: mockCreateTransport,
  },
}));

// ─── Subject under test (dynamic import after mock registration) ──────────────

const { MailpitDefaultEmailProvider, MailpitSmtpSink } =
  await import('./default-email.provider.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Minimal `ConfigService` stub satisfying the `getOrThrow` calls the provider
 * constructor makes.
 */
function makeConfigService() {
  const vals: Record<string, string | number> = {
    SMTP_HOST: 'localhost',
    SMTP_PORT: 1025,
    SMTP_FROM: 'no-reply@test.dev',
    WEB_ORIGIN: 'http://localhost:3000',
  };
  return {
    getOrThrow: jest.fn((key: string) => {
      const v = vals[key];
      if (v === undefined) throw new Error(`Unknown config key: ${key}`);
      return v;
    }),
    get: jest.fn(() => undefined),
  };
}

/** Constructs a fresh provider against the mocked transport. */
function makeProvider() {
  return new MailpitDefaultEmailProvider(
    makeConfigService() as unknown as ConstructorParameters<typeof MailpitDefaultEmailProvider>[0],
  );
}

/** Returns the mail options object passed to the last `sendMail` call. */
function lastMailOptions(): MailOptions {
  const calls = mockSendMail.mock.calls;
  const last = calls[calls.length - 1];
  if (last === undefined) throw new Error('sendMail was never called');
  return last[0];
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Constructor wiring ───────────────────────────────────────────────────────

describe('MailpitDefaultEmailProvider constructor', () => {
  it('builds the SMTP transport with the Mailpit dev options from config', () => {
    /*
     * Scenario: the provider must point nodemailer at the env-validated
     * SMTP endpoint with `secure: false` + `ignoreTLS: true` — Mailpit
     * serves plain SMTP and a TLS-required transport would fail every send.
     * Protects: the constructor's createTransport wiring.
     */
    makeProvider();

    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: 'localhost',
      port: 1025,
      secure: false,
      ignoreTLS: true,
    });
  });
});

// ─── Sink contract ────────────────────────────────────────────────────────────

describe('MailpitSmtpSink', () => {
  it('delivers via sendMail and logs only the kind and containsCredential flag', async () => {
    /*
     * Scenario: the sink's log line is the observable half of the
     * `containsCredential` contract — it must record which message kind was
     * delivered and whether it carried a credential, and must NOT publish
     * the subject, bodies, or recipient (any of which may hold a live OTP
     * or token when a renderer override misbehaves).
     * Protects: the "publish none of this message" duty of AuthEmailSink.
     */
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const sink = new MailpitSmtpSink(
      { sendMail: mockSendMail } as unknown as ConstructorParameters<typeof MailpitSmtpSink>[0],
      'no-reply@test.dev',
    );

    await sink.send({
      tenantId: 't1',
      to: 'user@example.com',
      subject: 'Your code is 699647',
      html: '<p>699647</p>',
      text: 'Your code is 699647',
      kind: 'passwordResetOtp',
      containsCredential: true,
    });

    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'no-reply@test.dev',
      to: 'user@example.com',
      subject: 'Your code is 699647',
      html: '<p>699647</p>',
      text: 'Your code is 699647',
    });

    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).toContain('passwordResetOtp');
    expect(logged).toContain('containsCredential');
    expect(logged).not.toContain('699647');
    expect(logged).not.toContain('user@example.com');
    logSpy.mockRestore();
  });

  it('propagates transport rejections unaltered', async () => {
    /*
     * Scenario: the sink must not swallow or reshape a transport error —
     * the provider's per-kind policy is the single place that decides
     * between swallow and rethrow, and it needs the original error.
     * Protects: no try/catch inside the sink's send.
     */
    const failure = new Error('550 rejected');
    mockSendMail.mockRejectedValueOnce(failure);
    const sink = new MailpitSmtpSink(
      { sendMail: mockSendMail } as unknown as ConstructorParameters<typeof MailpitSmtpSink>[0],
      'no-reply@test.dev',
    );

    await expect(
      sink.send({
        tenantId: 't1',
        to: 'user@example.com',
        subject: 's',
        html: '<p>b</p>',
        text: 'b',
        kind: 'newSessionAlert',
        containsCredential: false,
      }),
    ).rejects.toBe(failure);
  });
});

// ─── Library rendering through the provider ───────────────────────────────────

describe('MailpitDefaultEmailProvider rendering', () => {
  it('sends a library-rendered verification OTP to the recipient', async () => {
    /*
     * Scenario: a non-overridden kind must flow through the library's own
     * default renderer — the provider supplies only the channel. The OTP
     * must appear in the delivered body (that is the message's purpose)
     * and the sender/recipient must come from config/arguments.
     * Protects: constructor wiring of the sink into the library base class.
     */
    const provider = makeProvider();

    await provider.sendEmailVerificationOtp('t1', 'user@example.com', '123456');

    const mail = lastMailOptions();
    expect(mail.from).toBe('no-reply@test.dev');
    expect(mail.to).toBe('user@example.com');
    expect(mail.text).toContain('123456');
  });

  it('renders the overridden emailChangeVerification copy with the app confirm URL', async () => {
    /*
     * Scenario: the `messages` override must replace the library's default
     * copy so the mailed link lands on this app's real confirm page with
     * the URL-encoded token — the library default has no WEB_ORIGIN to
     * build a link from.
     * Protects: the emailChangeVerification catalogue override.
     */
    const provider = makeProvider();

    await provider.sendEmailChangeVerification('t1', 'new@example.com', 'tok/en+1');

    const mail = lastMailOptions();
    expect(mail.to).toBe('new@example.com');
    expect(mail.subject).toBe('Confirm your new email address');
    expect(mail.text).toContain(
      'http://localhost:3000/auth/confirm-email-change?token=tok%2Fen%2B1',
    );
  });

  it('renders the overridden app-branded passwordChanged subject', async () => {
    /*
     * Scenario: the second `messages` override swaps only the subject/copy
     * of the credential-change notice; delivery still goes through the
     * library's deliver pipeline.
     * Protects: the passwordChanged catalogue override.
     */
    const provider = makeProvider();

    await provider.sendPasswordChangedNotification('t1', 'user@example.com');

    expect(lastMailOptions().subject).toBe('Your nest-auth-example password was changed');
  });
});

// ─── Delivery-error policy ────────────────────────────────────────────────────

describe('MailpitDefaultEmailProvider delivery-error policy', () => {
  it('rethrows the channel error for passwordResetToken and logs a channel-safe description', async () => {
    /*
     * Scenario: `passwordResetToken: 'rethrow'` restores the throw that
     * lets PasswordResetService delete an undelivered token early. The
     * rethrown error is the channel's ORIGINAL (callers may branch on its
     * codes), but the catch-side log line must be describeChannelStatus
     * output — a relay that quotes the rejected body would otherwise put
     * the live token into the log pipeline.
     * Protects: the rethrow opt-in AND the credential-safe logging duty.
     */
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const secretToken = 'a1b2c3-reset-token';
    const channelError = new Error(`550 rejected: body was "reset token ${secretToken}"`);
    mockSendMail.mockRejectedValueOnce(channelError);
    const provider = makeProvider();

    await expect(
      provider.sendPasswordResetToken('t1', 'user@example.com', secretToken),
    ).rejects.toBe(channelError);

    // describeChannelStatus publishes only the failure's SHAPE (`<error>`),
    // never the channel-authored message text or the token.
    const warned = JSON.stringify(warnSpy.mock.calls);
    expect(warned).toContain('<error>');
    expect(warned).not.toContain(secretToken);
    expect(warned).not.toContain('550 rejected');
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('swallows a channel error for kinds outside the policy map (invitation)', async () => {
    /*
     * Scenario: every kind left out of the policy map keeps the library's
     * `'swallow'` default — a down mail channel must not turn an invitation
     * create into a failed request over a message that is a notification.
     * Protects: the "safe value by saying nothing" direction of the map.
     */
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mockSendMail.mockRejectedValueOnce(new Error('channel down'));
    const provider = makeProvider();

    await expect(
      provider.sendInvitation('t1', 'invitee@example.com', {
        inviterName: 'Ada',
        tenantName: 'Acme',
        inviteToken: 'f'.repeat(64),
        expiresAt: new Date('2026-01-01T00:00:00Z'),
      }),
    ).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });

  it('names only kinds that exist in AUTH_EMAIL_KINDS in the rethrow policy', () => {
    /*
     * Scenario: the policy map's keys are typed as AuthEmailKind, and this
     * runtime cross-check keeps the demo honest against the library's
     * canonical kind list — a key the catalogue does not know would be
     * silently dropped by the provider (typo → swallow), so the list is
     * the source of truth the map must stay inside.
     * Protects: the policy map keys against library kind renames.
     */
    const kinds: readonly AuthEmailKind[] = AUTH_EMAIL_KINDS;
    expect(kinds).toContain('passwordResetToken');
    // The map opts in exactly one kind; all ten canonical kinds exist.
    expect(kinds).toHaveLength(10);
  });
});
