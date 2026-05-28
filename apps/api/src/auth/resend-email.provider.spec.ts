/**
 * @file resend-email.provider.spec.ts
 * @description Unit tests for `ResendEmailProvider`.
 *
 * Verifies that every public email method:
 * - Calls `resend.emails.send` with the correct `to`, `from`, and `subject`.
 * - Produces an HTML body that contains the expected dynamic values.
 * - Strips CRLF characters from the invitation subject to prevent header injection.
 * - HTML-escapes attacker-controlled `textVars` (e.g. `inviterName`).
 * - Throws `Error('Email delivery failed')` when the Resend SDK returns an error.
 * - Resolves successfully when the SDK returns `{ data: { id }, error: null }`.
 * - Throws on unknown or unpreloaded template names (allowlist and invariant guards).
 *
 * The real HTML template files on disk are used — only the Resend SDK client is mocked.
 * This ensures that template-placeholder names remain in sync with the provider.
 *
 * Uses `jest.unstable_mockModule` + dynamic `import()` which is the correct pattern
 * for ESM modules compiled with ts-jest `useESM: true`.
 *
 * @layer test
 * @see apps/api/src/auth/resend-email.provider.ts
 * @see docs/guidelines/testing-guidelines.md
 * @see docs/guidelines/email-guidelines.md
 */

import { jest } from '@jest/globals';

// ─── Resend SDK mock ──────────────────────────────────────────────────────────

/** Mail-options shape passed to `client.emails.send`. */
interface SendOptions {
  from?: string;
  to?: string;
  subject?: string;
  html?: string;
}

/** Return value shape of `client.emails.send`. */
interface SendResult {
  data: { id: string } | null;
  error: { name: string } | null;
}

/**
 * Shared mock for `client.emails.send`. Declared here and referenced in the
 * `unstable_mockModule` factory — both live in the same module scope so there
 * is no TDZ problem.
 *
 * Typed as `(opts: SendOptions) => Promise<SendResult>` so that `.mock.calls`
 * carries the correct argument tuple and avoids `noUncheckedIndexedAccess`
 * false-positives when extracting call arguments.
 */
const mockEmailsSend = jest
  .fn<(opts: SendOptions) => Promise<SendResult>>()
  .mockResolvedValue({ data: { id: 'test-email-id' }, error: null });

jest.unstable_mockModule('resend', () => ({
  Resend: jest.fn(() => ({
    emails: { send: mockEmailsSend },
  })),
}));

// ─── Subject under test (dynamic import after mock registration) ──────────────

const { ResendEmailProvider } = await import('./resend-email.provider.js');

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
 * during `ResendEmailProvider` construction.
 */
function makeConfigService() {
  const vals: Record<string, string> = {
    RESEND_API_KEY: 'test-api-key',
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

/** Returns the options object passed to the last `emails.send` call. */
function lastMailOptions(): SendOptions {
  const calls = mockEmailsSend.mock.calls;
  if (calls.length === 0) throw new Error('emails.send was never called');
  // `noUncheckedIndexedAccess` makes array[index] return `T | undefined`.
  // The guard above ensures at least one call exists; the `??` provides a
  // safe fallback that satisfies the compiler without casting through `unknown`.
  const lastCall = calls[calls.length - 1] ?? ([{}] as [SendOptions]);
  return lastCall[0];
}

/** Returns the HTML body string passed to the last `emails.send` call. */
function lastSentHtml(): string {
  return lastMailOptions().html ?? '';
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('ResendEmailProvider', () => {
  let provider: InstanceType<typeof ResendEmailProvider>;

  beforeEach(() => {
    // Reset call records and restore the happy-path default for each test.
    mockEmailsSend.mockClear();
    mockEmailsSend.mockResolvedValue({ data: { id: 'test-email-id' }, error: null });
    provider = new ResendEmailProvider(makeConfigService() as never, makePrismaService() as never);
  });

  // ─── sendPasswordResetToken ───────────────────────────────────────────────

  it('sendPasswordResetToken — calls emails.send with correct to, from and subject; HTML contains the encoded token in a URL', async () => {
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
    // the provider. The provider must compose a URL with a "default" tenant
    // placeholder rather than crashing on a null lookup result.
    const prisma = makePrismaService();
    (
      prisma.user.findFirst as jest.Mock<() => Promise<{ tenantId: string } | null>>
    ).mockResolvedValueOnce(null);
    provider = new ResendEmailProvider(makeConfigService() as never, prisma as never);

    await provider.sendPasswordResetToken('ghost@example.test', 'tk');

    expect(lastSentHtml()).toContain(`tenantId=${encodeURIComponent('default')}`);
  });

  // ─── sendPasswordResetOtp ────────────────────────────────────────────────

  it('sendPasswordResetOtp — calls emails.send with the correct subject and embeds the OTP in the HTML body', async () => {
    // FCM #7 — the OTP must appear verbatim in the rendered template so the user
    // can copy-paste it into the reset-password screen.
    await provider.sendPasswordResetOtp('bob@example.test', '123456');

    const opts = lastMailOptions();
    expect(opts.to).toBe('bob@example.test');
    expect(opts.subject).toBe('Your password reset code');
    expect(lastSentHtml()).toContain('123456');
  });

  // ─── sendEmailVerificationOtp ────────────────────────────────────────────

  it('sendEmailVerificationOtp — calls emails.send with the verify-email subject and embeds the OTP', async () => {
    // FCM #5 — the verification OTP must appear in the HTML so the user can enter
    // it on the verification screen; the correct subject signals the purpose.
    await provider.sendEmailVerificationOtp('carol@example.test', '654321');

    const opts = lastMailOptions();
    expect(opts.to).toBe('carol@example.test');
    expect(opts.subject).toBe('Verify your email address');
    expect(lastSentHtml()).toContain('654321');
  });

  // ─── sendMfaEnabledNotification ──────────────────────────────────────────

  it('sendMfaEnabledNotification — calls emails.send once with the MFA-enabled subject', async () => {
    // Security notification: confirms the correct subject reaches the recipient
    // so they know MFA was activated on their account.
    await provider.sendMfaEnabledNotification('dave@example.test');

    const opts = lastMailOptions();
    expect(opts.to).toBe('dave@example.test');
    expect(opts.subject).toBe('Two-factor authentication enabled');
    expect(mockEmailsSend).toHaveBeenCalledTimes(1);
  });

  // ─── sendMfaDisabledNotification ─────────────────────────────────────────

  it('sendMfaDisabledNotification — calls emails.send once with the MFA-disabled subject', async () => {
    // Security alert: the correct subject warns the recipient that MFA has been
    // removed — they must act if the change was not authorised.
    await provider.sendMfaDisabledNotification('eve@example.test');

    const opts = lastMailOptions();
    expect(opts.to).toBe('eve@example.test');
    expect(opts.subject).toBe('Two-factor authentication disabled');
    expect(mockEmailsSend).toHaveBeenCalledTimes(1);
  });

  // ─── sendNewSessionAlert ─────────────────────────────────────────────────

  it('sendNewSessionAlert — calls emails.send and includes device, ip and sessionHash in the HTML body', async () => {
    // FCM #15 — the session-alert email body must show device, IP, and session ID
    // so the user can recognise or dispute the sign-in.
    await provider.sendNewSessionAlert('frank@example.test', {
      device: 'Firefox on Windows',
      ip: '198.51.100.7',
      sessionHash: 'deadbeef',
    });

    const opts = lastMailOptions();
    expect(opts.to).toBe('frank@example.test');
    expect(opts.subject).toBe('New sign-in detected on your account');

    const html = lastSentHtml();
    expect(html).toContain('Firefox on Windows');
    expect(html).toContain('198.51.100.7');
    expect(html).toContain('deadbeef');
  });

  // ─── sendInvitation ──────────────────────────────────────────────────────

  it('sendInvitation — calls emails.send; subject contains tenantName; HTML contains inviterName', async () => {
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

  it('sendInvitation — strips CRLF from tenantName and produces the canonical subject verbatim', async () => {
    // Security: a malicious tenant name containing CR+LF characters could inject
    // extra headers if included verbatim in the subject line.
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

  // ─── Resend SDK error path ────────────────────────────────────────────────

  it('throws Error("Email delivery failed") when emails.send returns a non-null error object', async () => {
    // The Resend SDK signals delivery failure via result.error rather than throwing.
    // The provider must convert this into a thrown Error so callers do not have to
    // inspect the result shape — consistent with the Mailpit/nodemailer error path.
    mockEmailsSend.mockResolvedValueOnce({
      data: null,
      error: { name: 'validation_error' },
    });

    await expect(provider.sendPasswordResetOtp('err@example.test', '000000')).rejects.toThrow(
      'Email delivery failed',
    );
  });

  // ─── Resend SDK success path ──────────────────────────────────────────────

  it('resolves without throwing when emails.send returns { data: { id }, error: null }', async () => {
    // Happy path: a successful Resend delivery must not throw, allowing the caller
    // to proceed without error handling for the normal case.
    mockEmailsSend.mockResolvedValueOnce({ data: { id: 'ok-id' }, error: null });

    await expect(
      provider.sendEmailVerificationOtp('ok@example.test', '999888'),
    ).resolves.toBeUndefined();
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

  // ─── Logging, escape, and Prisma call-shape contract ─────────────────────

  describe('logging, escape, and Prisma call shape', () => {
    it('logs the subject and recipient on a successful send (no body or secrets)', async () => {
      /*
       * Scenario: every successful email through Resend must surface
       * in operator logs with the subject and `to` address — and ONLY
       * those — so support can confirm delivery without leaking OTPs,
       * reset tokens, session hashes, or the API key.
       */
      const logSpy = jest
        .spyOn((provider as unknown as { logger: { log: (m: unknown) => void } }).logger, 'log')
        .mockImplementation(() => undefined);

      await provider.sendPasswordResetOtp('alice@example.test', '123456');

      expect(logSpy).toHaveBeenCalledTimes(1);
      const arg = logSpy.mock.calls[0]?.[0] as { msg?: string; subject?: string; to?: string };
      expect(arg.msg).toBe('Email sent via Resend');
      expect(arg.subject).toBe('Your password reset code');
      expect(arg.to).toBe('alice@example.test');
    });

    it('logs the failure with the error class name (not message) and rethrows when Resend returns an error', async () => {
      /*
       * Scenario: Resend returns an `error` object on the response
       * (rate limit, invalid recipient, suppressed address). The
       * provider must log the error's CLASS name only — never the
       * message — because Resend's error messages can carry
       * account-specific details that should not reach log
       * aggregators or exception serialisers.
       */
      const errorSpy = jest
        .spyOn((provider as unknown as { logger: { error: (m: unknown) => void } }).logger, 'error')
        .mockImplementation(() => undefined);
      mockEmailsSend.mockResolvedValueOnce({
        data: null,
        // Cast to the SendResult.error shape so additional fields the SDK
        // carries at runtime do not trip TS's excess-property checking.
        error: {
          name: 'rate_limit_exceeded',
          message: 'detailed reason — must not be logged',
        } as unknown as { name: string },
      });

      await expect(provider.sendPasswordResetOtp('bob@example.test', '999999')).rejects.toThrow(
        'Email delivery failed',
      );

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const arg = errorSpy.mock.calls[0]?.[0] as {
        msg?: string;
        subject?: string;
        to?: string;
        error?: string;
      };
      expect(arg.msg).toBe('Email delivery failed');
      expect(arg.subject).toBe('Your password reset code');
      expect(arg.to).toBe('bob@example.test');
      expect(arg.error).toBe('rate_limit_exceeded');
      // The detailed message must never reach the log entry.
      expect(JSON.stringify(arg)).not.toContain('detailed reason');
    });

    it('escapes the five HTML-significant characters in attacker-controlled template variables', () => {
      /*
       * Scenario: an invitee accepts an invitation from a tenant
       * whose inviter name contains every HTML metacharacter. The
       * template must render each one as its named/numeric entity
       * so no variant of the input can break out of its text
       * context. Missing any of the five would leave one injection
       * path open in production email.
       */
      const escape = (ResendEmailProvider as unknown as { escapeHtml: (s: string) => string })
        .escapeHtml;

      const out = escape(`& < > " ' `);

      expect(out).toContain('&amp;');
      expect(out).toContain('&lt;');
      expect(out).toContain('&gt;');
      expect(out).toContain('&quot;');
      expect(out).toContain('&#039;');
      expect(out).not.toContain('<');
      expect(out).not.toContain('>');
      expect(out).not.toContain('"');
      expect(out).not.toContain("'");
    });

    it('looks up the reset-token tenant by lowercased email with a narrow {tenantId} projection', async () => {
      /*
       * Scenario: the lib calls password reset with whatever casing
       * the user typed. The lookup MUST normalise to lower case so
       * the canonical row is found regardless of input casing. The
       * select MUST stay narrow to {tenantId} so the lookup never
       * reads the password hash or MFA secret as a side effect of
       * resolving the tenant.
       */
      const prisma = makePrismaService();
      provider = new ResendEmailProvider(makeConfigService() as never, prisma as never);

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
       * URI-encoded so reserved characters survive transit through
       * mail clients. A drift that dropped the encoding or the
       * token would break every invitation link in production.
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
