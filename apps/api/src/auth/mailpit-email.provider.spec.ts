/**
 * @file mailpit-email.provider.spec.ts
 * @description Unit tests for `MailpitEmailProvider`.
 *
 * Verifies that every public email method:
 * - Calls the Nodemailer transport with the correct `to`, `from`, and `subject`.
 * - Produces an HTML body that contains the expected dynamic values.
 * - Strips CRLF characters from the invitation subject to prevent header injection.
 * - HTML-escapes attacker-controlled `textVars` (e.g. `inviterName`).
 * - Re-throws transport errors so the caller can decide on retry strategy.
 * - Throws on unknown or unpreloaded template names (allowlist and invariant guards).
 *
 * The real HTML template files on disk are used — only the SMTP transport is mocked.
 * This ensures that template-placeholder names remain in sync with the provider.
 *
 * Uses `jest.unstable_mockModule` + dynamic `import()` which is the correct pattern
 * for ESM modules compiled with ts-jest `useESM: true`.
 *
 * @layer test
 * @see apps/api/src/auth/mailpit-email.provider.ts
 * @see docs/guidelines/testing-guidelines.md
 * @see docs/guidelines/email-guidelines.md
 */

import { jest } from '@jest/globals';

// ─── Transport mock ───────────────────────────────────────────────────────────

/** Mail-options shape passed to `transporter.sendMail`. */
interface MailOptions {
  from?: string;
  to?: string;
  subject?: string;
  html?: string;
}

/**
 * Shared mock for `transporter.sendMail`. Declared here and referenced in the
 * `unstable_mockModule` factory — both live in the same module scope so there
 * is no TDZ problem.
 *
 * Typed as `(opts: MailOptions) => Promise<void>` so that `.mock.calls` carries
 * the correct argument tuple and avoids `noUncheckedIndexedAccess` false-positives
 * when extracting call arguments.
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
 * Shared mock for `nodemailer.createTransport`. Exposed at module scope so
 * tests can assert on the SMTP transport options the provider hands in.
 * Typed so `.mock.calls[i]?.[0]` carries the right tuple shape.
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

const { MailpitEmailProvider } = await import('./mailpit-email.provider.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal `PrismaService` stub returning a fixed tenantId for reset-token tests. */
function makePrismaService() {
  return {
    user: {
      findFirst: jest.fn<() => Promise<{ tenantId: string } | null>>().mockResolvedValue({
        tenantId: 'tenant-cuid-1',
      }),
    },
  };
}

/**
 * Minimal `ConfigService` stub that satisfies the `getOrThrow` calls made
 * during `MailpitEmailProvider` construction.
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

/** Returns the mail options object passed to the last `sendMail` call. */
function lastMailOptions(): MailOptions {
  const calls = mockSendMail.mock.calls;
  if (calls.length === 0) throw new Error('sendMail was never called');
  // `noUncheckedIndexedAccess` makes array[index] return `T | undefined`.
  // The guard above ensures at least one call exists; the `??` provides a
  // safe fallback that satisfies the compiler without casting through `unknown`.
  const lastCall = calls[calls.length - 1] ?? ([{}] as [MailOptions]);
  return lastCall[0];
}

/** Returns the HTML body string passed to the last `sendMail` call. */
function lastSentHtml(): string {
  return lastMailOptions().html ?? '';
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('MailpitEmailProvider', () => {
  let provider: InstanceType<typeof MailpitEmailProvider>;

  beforeEach(() => {
    // Reset call records but keep the mock implementation in place.
    mockSendMail.mockClear();
    mockCreateTransport.mockClear();
    mockSendMail.mockResolvedValue(undefined);
    provider = new MailpitEmailProvider(makeConfigService() as never, makePrismaService() as never);
  });

  // ─── sendPasswordResetToken ───────────────────────────────────────────────

  it('sendPasswordResetToken — calls sendMail with correct to, from and subject; HTML contains the encoded token in a URL', async () => {
    // FCM #6 — the reset-token email must embed the signed token in a URL so the
    // browser can submit it to /auth/reset-password?mode=token.
    await provider.sendPasswordResetToken('alice@example.test', 'my-reset-token');

    const opts = lastMailOptions();
    expect(opts.to).toBe('alice@example.test');
    expect(opts.from).toBe('no-reply@test.dev');
    expect(opts.subject).toBe('Reset your password');

    const html = lastSentHtml();
    // The token, email, and tenantId must all be URI-encoded and appear in the reset URL.
    expect(html).toContain('/auth/reset-password?mode=token');
    expect(html).toContain(encodeURIComponent('my-reset-token'));
    expect(html).toContain(encodeURIComponent('alice@example.test'));
    expect(html).toContain(encodeURIComponent('tenant-cuid-1'));
  });

  it('sendPasswordResetToken — falls back to tenantId="default" when the user row is not found', async () => {
    // Anti-enumeration: forgotPassword on a non-existent email still calls into
    // the provider so timing/side-effects look identical to the happy path.
    // The provider must not crash on a null user — it composes the URL with a
    // "default" tenant placeholder that the reset page rejects safely.
    const prisma = makePrismaService();
    (
      prisma.user.findFirst as jest.Mock<() => Promise<{ tenantId: string } | null>>
    ).mockResolvedValueOnce(null);
    provider = new MailpitEmailProvider(makeConfigService() as never, prisma as never);

    await provider.sendPasswordResetToken('ghost@example.test', 'tk');

    expect(lastSentHtml()).toContain(`tenantId=${encodeURIComponent('default')}`);
  });

  // ─── sendPasswordResetOtp ────────────────────────────────────────────────

  it('sendPasswordResetOtp — calls sendMail with the correct subject and embeds the OTP in the HTML body', async () => {
    // FCM #7 — the OTP must appear verbatim in the rendered template so the user
    // can copy-paste it into the reset-password screen.
    await provider.sendPasswordResetOtp('bob@example.test', '123456');

    const opts = lastMailOptions();
    expect(opts.to).toBe('bob@example.test');
    expect(opts.subject).toBe('Your password reset code');
    expect(lastSentHtml()).toContain('123456');
  });

  // ─── sendEmailVerificationOtp ────────────────────────────────────────────

  it('sendEmailVerificationOtp — calls sendMail with the verify-email subject and embeds the OTP', async () => {
    // FCM #5 — the verification OTP must appear in the HTML so the user can enter
    // it on the verification screen; the correct subject signals the purpose.
    await provider.sendEmailVerificationOtp('carol@example.test', '654321');

    const opts = lastMailOptions();
    expect(opts.to).toBe('carol@example.test');
    expect(opts.subject).toBe('Verify your email address');
    expect(lastSentHtml()).toContain('654321');
  });

  // ─── sendMfaEnabledNotification ──────────────────────────────────────────

  it('sendMfaEnabledNotification — calls sendMail once with the MFA-enabled subject', async () => {
    // Security notification: confirms the correct subject reaches the recipient
    // so they know MFA was activated on their account.
    await provider.sendMfaEnabledNotification('dave@example.test');

    const opts = lastMailOptions();
    expect(opts.to).toBe('dave@example.test');
    expect(opts.subject).toBe('Two-factor authentication enabled');
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  // ─── sendMfaDisabledNotification ─────────────────────────────────────────

  it('sendMfaDisabledNotification — calls sendMail once with the MFA-disabled subject', async () => {
    // Security alert: the correct subject warns the recipient that MFA has been
    // removed — they must act if the change was not authorised.
    await provider.sendMfaDisabledNotification('eve@example.test');

    const opts = lastMailOptions();
    expect(opts.to).toBe('eve@example.test');
    expect(opts.subject).toBe('Two-factor authentication disabled');
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  // ─── sendNewSessionAlert ─────────────────────────────────────────────────

  it('sendNewSessionAlert — calls sendMail and includes device, ip and sessionHash in the HTML body', async () => {
    // FCM #15 — the session-alert email body must show device, IP, and session ID
    // so the user can recognise or dispute the sign-in.
    await provider.sendNewSessionAlert('frank@example.test', {
      device: 'Chrome on macOS',
      ip: '203.0.113.5',
      sessionHash: 'abc123',
    });

    const opts = lastMailOptions();
    expect(opts.to).toBe('frank@example.test');
    expect(opts.subject).toBe('New sign-in detected on your account');

    const html = lastSentHtml();
    expect(html).toContain('Chrome on macOS');
    expect(html).toContain('203.0.113.5');
    expect(html).toContain('abc123');
  });

  // ─── sendInvitation ──────────────────────────────────────────────────────

  it('sendInvitation — calls sendMail; subject contains tenantName; HTML contains inviterName', async () => {
    // FCM #21 — the invitation email must name the inviting organisation in the
    // subject line and the inviter's name in the body so the recipient has context.
    await provider.sendInvitation('grace@example.test', {
      inviterName: 'Alice Admin',
      tenantName: 'Acme Corp',
      inviteToken: 'tok-xyz',
      expiresAt: new Date('2026-12-31T23:59:59Z'),
    });

    const opts = lastMailOptions();
    expect(opts.to).toBe('grace@example.test');
    expect(opts.subject).toContain('Acme Corp');

    const html = lastSentHtml();
    expect(html).toContain('Alice Admin');
  });

  // ─── CRLF injection protection ───────────────────────────────────────────

  it('sendInvitation — strips CRLF from tenantName to prevent SMTP header injection', async () => {
    /*
     * Security: a malicious tenant name containing CR+LF characters could
     * inject extra SMTP headers (e.g. Bcc:) if included verbatim in the
     * subject line. The CRLF characters MUST be REMOVED (replaced with an
     * empty string), not replaced with any other content — a replacement
     * that inserted any non-empty value into the subject would corrupt
     * the canonical "You've been invited to join <name>" template that
     * the invitation email recipients expect.
     */
    await provider.sendInvitation('target@example.test', {
      inviterName: 'Attacker',
      tenantName: 'Evil\r\nBcc: victim@example.test',
      inviteToken: 'tok-evil',
      expiresAt: new Date('2026-12-31T23:59:59Z'),
    });

    const subject = lastMailOptions().subject ?? '';
    expect(subject).not.toContain('\r');
    expect(subject).not.toContain('\n');
    // The replacement must remove the CRLF, not substitute another value —
    // pin the exact resulting subject so any replacement string other than
    // '' would surface as a test failure.
    expect(subject).toBe("You've been invited to join EvilBcc: victim@example.test");
  });

  // ─── HTML injection protection ───────────────────────────────────────────

  it('sendInvitation — HTML-escapes inviterName to prevent script injection in the email body', async () => {
    // Security: user-controlled display names must be HTML-escaped before embedding
    // in the template to prevent the recipient's email client from executing scripts.
    await provider.sendInvitation('victim@example.test', {
      inviterName: '<script>alert(1)</script>',
      tenantName: 'Safe Corp',
      inviteToken: 'tok-safe',
      expiresAt: new Date('2026-12-31T23:59:59Z'),
    });

    const html = lastSentHtml();
    // The raw tag must NOT appear — the escaped form must be used instead.
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  // ─── Transport failure ───────────────────────────────────────────────────

  it('re-throws the transport error when sendMail rejects, so the caller handles retry', async () => {
    // The provider must not swallow SMTP failures. Callers (the library) decide on
    // retry strategy; suppressing the error would leave the user without an email.
    const transportError = new Error('SMTP connection refused');
    mockSendMail.mockRejectedValueOnce(transportError);

    await expect(provider.sendPasswordResetOtp('err@example.test', '000000')).rejects.toThrow(
      'SMTP connection refused',
    );
  });

  it('re-throws non-Error transport failures using String(err) in the log (non-Error throw path)', async () => {
    // Covers the `String(err)` branch of `err instanceof Error ? err.message : String(err)`.
    // Some SMTP libraries throw plain strings rather than Error instances.
    mockSendMail.mockRejectedValueOnce('SMTP timeout string');

    await expect(provider.sendPasswordResetOtp('err@example.test', '000000')).rejects.toBe(
      'SMTP timeout string',
    );
  });

  // ─── render() — unknown template guard ──────────────────────────────────

  it('throws Error("Unknown email template") when render is called with a template name not in the allowlist', () => {
    // The allowlist guard in render() prevents path-traversal and future
    // misconfigurations where a caller passes an arbitrary template name.
    // Because render() is private, we access it through a typed cast via unknown
    // (no `any` cast) to avoid bypassing exactOptionalPropertyTypes constraints.
    const renderFn = (
      provider as unknown as { render: (name: string, textVars: Record<string, string>) => string }
    ).render.bind(provider);

    expect(() => renderFn('../../etc/passwd', {})).toThrow('Unknown email template');
  });

  // ─── render() — preload invariant guard ──────────────────────────────────

  it('throws Error("not preloaded at startup") when a template is in the allowlist but missing from the cache', () => {
    // This branch protects against an invariant violation: a template was added to
    // ALLOWED_TEMPLATES but the constructor somehow failed to preload it. Clearing
    // the cache simulates this state without touching the allowlist.
    const providerInternal = provider as unknown as {
      render: (name: string, textVars: Record<string, string>) => string;
      templateCache: Map<string, string>;
    };
    providerInternal.templateCache.clear();

    expect(() => providerInternal.render('password-reset-otp', { otp: '123456' })).toThrow(
      'was not preloaded at startup',
    );
  });

  // ─── Transport, logging, and HTML-escape contract ────────────────────────

  describe('transport configuration and observability', () => {
    it('builds the SMTP transport with secure=false, ignoreTLS=true, and the env-configured host and port', () => {
      /*
       * Scenario: Mailpit is a local development server that does NOT
       * support TLS. The provider MUST disable secure mode and ignore
       * the STARTTLS upgrade; turning either on would make every dev
       * email fail before reaching the inbox. Pinning the four fields
       * also catches a swap to a remote SMTP host that DOES require
       * TLS — the test would surface the misconfiguration immediately.
       */
      expect(mockCreateTransport).toHaveBeenCalledTimes(1);
      const opts = mockCreateTransport.mock.calls[0]?.[0];
      expect(opts).toEqual({
        host: 'localhost',
        port: 1025,
        secure: false,
        ignoreTLS: true,
      });
    });

    it('logs the subject and recipient on a successful send (no body or secrets)', async () => {
      /*
       * Scenario: every successful email must surface in operator logs
       * with the subject and the `to` address — and ONLY those — so
       * support can verify which user received which template without
       * the log entry leaking OTPs, reset tokens, or session hashes.
       */
      const logSpy = jest
        .spyOn((provider as unknown as { logger: { log: (m: unknown) => void } }).logger, 'log')
        .mockImplementation(() => undefined);

      await provider.sendPasswordResetOtp('alice@example.test', '123456');

      expect(logSpy).toHaveBeenCalledTimes(1);
      const arg = logSpy.mock.calls[0]?.[0] as { msg?: string; subject?: string; to?: string };
      expect(arg.msg).toBe('Email sent');
      expect(arg.subject).toBe('Your password reset code');
      expect(arg.to).toBe('alice@example.test');
    });

    it('logs SMTP failures with the subject, recipient, and error message before rethrowing', async () => {
      /*
       * Scenario: the SMTP transport rejects the send (connection
       * refused, host unreachable). The provider re-throws so the
       * caller can retry, AND it logs the failure with the subject,
       * recipient, and root cause so support can correlate user
       * reports with the transport outage. An empty payload would
       * leave operators guessing which template / user was affected.
       */
      const errorSpy = jest
        .spyOn((provider as unknown as { logger: { error: (m: unknown) => void } }).logger, 'error')
        .mockImplementation(() => undefined);
      mockSendMail.mockRejectedValueOnce(new Error('SMTP down'));

      await expect(provider.sendPasswordResetOtp('bob@example.test', '999999')).rejects.toThrow(
        'SMTP down',
      );

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const arg = errorSpy.mock.calls[0]?.[0] as {
        msg?: string;
        subject?: string;
        to?: string;
        error?: string;
      };
      expect(arg.msg).toBe('SMTP delivery failed');
      expect(arg.subject).toBe('Your password reset code');
      expect(arg.to).toBe('bob@example.test');
      expect(arg.error).toBe('SMTP down');
    });

    it('escapes the five HTML-significant characters in attacker-controlled template variables', () => {
      /*
       * Scenario: an invitee accepts an invitation from a tenant whose
       * inviter name contains every HTML metacharacter. The template
       * must render each one as its named/numeric entity so no
       * variant of the input can break out of the surrounding text
       * context — & must become &amp;, < must become &lt;, > must
       * become &gt;, double quotes must become &quot;, and single
       * quotes must become &#039;. Missing any of the five would
       * leave one injection path open.
       */
      const escape = (MailpitEmailProvider as unknown as { escapeHtml: (s: string) => string })
        .escapeHtml;

      const out = escape(`& < > " ' `);

      // Each metacharacter must map to its specific entity — pinning all five.
      expect(out).toContain('&amp;');
      expect(out).toContain('&lt;');
      expect(out).toContain('&gt;');
      expect(out).toContain('&quot;');
      expect(out).toContain('&#039;');
      // The raw characters must NOT survive the escape step.
      expect(out).not.toMatch(/(?:^| )(&)(?: |$)/);
      expect(out).not.toContain('<');
      expect(out).not.toContain('>');
      expect(out).not.toContain('"');
      expect(out).not.toContain("'");
    });

    it('looks up the reset-token tenant by lowercased email with a narrow {tenantId} projection', async () => {
      /*
       * Scenario: an admin types a user's email with inconsistent
       * casing into the password-reset trigger. The lookup MUST
       * normalise to lower case so the email's canonical row is
       * found — Postgres collation is case-sensitive by default.
       * The select MUST stay narrow to {tenantId} so the lookup
       * never reads the password hash or MFA secret as a side
       * effect of resolving the workspace.
       */
      const prisma = makePrismaService();
      provider = new MailpitEmailProvider(makeConfigService() as never, prisma as never);

      await provider.sendPasswordResetToken('Mixed@Example.TEST', 'tok');

      expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
      const call = (prisma.user.findFirst as unknown as jest.Mock).mock.calls[0]?.[0] as {
        where: { email: string };
        select: { tenantId: boolean };
      };
      expect(call.where.email).toBe('mixed@example.test');
      expect(call.select).toEqual({ tenantId: true });
    });

    it('embeds the URI-encoded inviteToken in the accept URL on the invitation email', async () => {
      /*
       * Scenario: the invitation accept URL carries the raw token
       * URI-encoded so reserved characters (`+`, `=`, `&`) survive
       * the trip through the mail client. A drift that dropped the
       * encoding or the token entirely would break every invitation
       * link in production.
       */
      await provider.sendInvitation('invite@example.test', {
        inviterName: 'Alice',
        tenantName: 'Acme',
        inviteToken: 'token with +special &chars',
        expiresAt: new Date('2026-12-31T23:59:59Z'),
      });

      const html = lastSentHtml();
      expect(html).toContain('/auth/accept-invitation?token=');
      expect(html).toContain(encodeURIComponent('token with +special &chars'));
    });
  });
});
