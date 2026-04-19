# Email Guidelines

Implementations of `IEmailProvider` for `@bymax-one/nest-auth`. One dev provider (Mailpit) and one prod reference (Resend); both go through a single transport-agnostic interface.

- **Packages**: `nodemailer` `^8.0.x`, Resend SDK (`resend`) when `EMAIL_PROVIDER=resend`
- **Library contract**: `IEmailProvider` — `sendEmailVerification`, `sendPasswordReset`, `sendInvitation`, `sendNewSessionAlert`, `sendPasswordChangedNotification`
- **Dev sink**: Mailpit on `smtp://localhost:1025`, UI at http://localhost:8025
- **Official docs**: https://nodemailer.com, https://resend.com/docs, https://mailpit.axllent.org

---

## When to read this

Before adding a new templated email, switching a provider, tweaking the `IEmailProvider` implementation, or designing a production sender domain.

---

## Provider selection

```ts
// apps/api/src/auth/email/email.module.ts
{
  provide: EMAIL_PROVIDER,
  useFactory: (config: ConfigService<Env, true>) => {
    const provider = config.getOrThrow<'mailpit' | 'resend'>('EMAIL_PROVIDER');
    return provider === 'resend' ? new ResendEmailProvider(config) : new MailpitEmailProvider(config);
  },
  inject: [ConfigService],
}
```

- `EMAIL_PROVIDER` is a **required** env var; unknown values fail fast in the Zod schema.
- Production never runs `mailpit`. Add a Zod refinement that forbids `EMAIL_PROVIDER=mailpit` when `NODE_ENV=production`.
- Both providers export the same class shape — pick one, don't branch inside a single class.

---

## Mailpit (dev)

```ts
@Injectable()
export class MailpitEmailProvider implements IEmailProvider {
  private readonly transport: Transporter;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.transport = nodemailer.createTransport({
      host: config.getOrThrow('SMTP_HOST'), // localhost
      port: config.getOrThrow('SMTP_PORT'), // 1025
      secure: false, // Mailpit is plaintext on 1025
      tls: { rejectUnauthorized: false },
    });
  }

  async sendPasswordReset(to: string, payload: PasswordResetPayload) {
    await this.transport.sendMail({
      from: this.config.getOrThrow('SMTP_FROM'),
      to,
      subject: 'Reset your password',
      html: renderPasswordResetHtml(payload), // see "Templates" below
      text: renderPasswordResetText(payload),
    });
  }
  // ...every other method on IEmailProvider
}
```

- Mailpit does **not** enforce authentication, size limits, or rate limits. Do not rely on it to surface production issues.
- It **captures everything** — safe for demos and screenshots in `docs/FEATURES.md`.
- Mailpit UI is `http://localhost:8025`; the REST API exposes JSON of captured messages for test assertions.

---

## Resend (prod reference)

```ts
@Injectable()
export class ResendEmailProvider implements IEmailProvider {
  private readonly resend: Resend;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    this.resend = new Resend(config.getOrThrow('RESEND_API_KEY'));
    this.from = config.getOrThrow('SMTP_FROM');
  }

  async sendPasswordReset(to: string, payload: PasswordResetPayload) {
    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Reset your password',
      html: renderPasswordResetHtml(payload),
      text: renderPasswordResetText(payload),
      headers: { 'X-Entity-Ref-ID': payload.requestId },
    });
    if (error) throw new ServiceUnavailableException(error.message);
  }
}
```

- **API key** lives in `.env` only, never checked in, always redacted in logs (see [logging-guidelines.md](logging-guidelines.md)).
- **`from`** must be a verified domain sender. SPF, DKIM, DMARC must all pass — documented in `docs/DEPLOYMENT.md`.
- Treat Resend errors as **retryable** for transient failures; `ServiceUnavailableException` upward, let the caller decide.

---

## Interface contract

Do not invent new method signatures. The library pins the contract; adding custom fields to payloads breaks minor-version upgrades.

Every implementation:

- Returns `void` (or `Promise<void>`) on success.
- Throws on permanent failure (invalid address, rejected domain).
- Throws `ServiceUnavailableException` on transient failure so `@nestjs/throttler` and retry logic upstream can react.
- Never catches and silently swallows — the library's hooks depend on the promise rejection.

---

## Templates

Templates are plain TS functions that return `{ html, text }`. No HTML-templating framework for this example — keeps the surface tiny.

```ts
// apps/api/src/auth/email/templates/password-reset.ts
export function renderPasswordResetHtml(p: PasswordResetPayload): string {
  return `<!doctype html>
<html><body style="font-family: sans-serif;">
  <h1>Reset your password</h1>
  <p>Click the link below to reset your password. The link expires in 30 minutes.</p>
  <p><a href="${escapeHtml(p.url)}">Reset password</a></p>
</body></html>`;
}

export function renderPasswordResetText(p: PasswordResetPayload): string {
  return `Reset your password\n\n${p.url}\n\nThe link expires in 30 minutes.`;
}
```

Rules:

- **Always emit both `html` and `text`.** Text-only clients (accessibility readers, some corporate filters) fail silently otherwise.
- **`escapeHtml` every dynamic value** inserted into HTML. The library passes user-controlled data like display name through payloads — treat them as untrusted.
- **Inline CSS only** — many email clients strip `<style>` blocks. Keep styling minimal.
- **No remote images** in dev; Mailpit blocks them anyway. Prod templates may include CDN-hosted images if they tolerate image-blocking clients.
- **One subject line per call site**, English. Localized subjects are out of scope for this reference — would require plumbing locale down from the library.

---

## Delivery model

- **Synchronous send** inside the library's auth flow. If the email send is slow, the user-facing request is slow.
- **Acceptable** for this example because the throttler keeps bursts small and Mailpit is local.
- **Production hardening** (outside this reference's scope): move email dispatch to a queue (`BullMQ` on Redis, a separate worker consuming `IAuthHooks` events), retry with backoff. Document the tradeoff if you ship it.

---

## Testing

- Unit: fake `IEmailProvider` that records calls — no network.
- E2E: Mailpit is already running in `docker-compose.test.yml`. Assert via its REST API:
  ```ts
  const msgs = await fetch('http://localhost:18025/api/v1/messages').then((r) => r.json());
  expect(msgs.messages[0].Subject).toBe('Verify your email');
  ```
- Never assert against a live Resend API in tests. Use the recorded fake.

---

## Common pitfalls

1. **Unverified sender domain** in prod — Resend returns `403` forever, flows silently 500 to users.
2. **Missing `text` body** — mail clients penalize spam score; some filters drop the message entirely.
3. **User input concatenated into HTML without escaping** — XSS in inboxes is a real exploit class.
4. **Logging the full email body** — includes reset tokens, OTPs. Log only addressee + template name.
5. **Mixing Mailpit and Resend in the same deploy** via a fallback chain — introduces environment-dependent latencies and makes incident triage harder. Pick one per environment.
6. **Retries that fire the library hook multiple times** — use idempotency keys in payloads when adding retry middleware.

---

## References

- `IEmailProvider` contract: [nest-auth-guidelines.md](nest-auth-guidelines.md)
- Nodemailer: https://nodemailer.com/about/
- Resend: https://resend.com/docs
- Mailpit: https://mailpit.axllent.org
- SPF/DKIM/DMARC primer: https://resend.com/docs/knowledge-base/dns
