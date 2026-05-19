# Email: providers, templates, and locales

How transactional email works in this example, how to switch from Mailpit (dev) to Resend (or any custom transport), how to override templates, and how to add a locale.

Every outbound message goes through the library's `IEmailProvider` contract. This example ships two implementations and binds one at startup based on `EMAIL_PROVIDER`.

---

## Email flow overview

1. A library flow (registration, password reset, new login, invitation, …) calls a method on the injected `IEmailProvider`.
2. The bound provider renders an HTML template and hands it to its transport.
3. In development the transport is SMTP → **Mailpit**, which captures the message at [http://localhost:8025](http://localhost:8025) without sending anything externally.
4. In production the transport is the **Resend** API.

No user-facing copy lives in TypeScript — all wording is in the HTML templates under [`apps/api/src/auth/email-templates/`](../apps/api/src/auth/email-templates/).

---

## Provider selection

The provider is chosen **once, synchronously, at module-decoration time** in [`auth.module.ts`](../apps/api/src/auth/auth.module.ts) — before the DI container exists — so it reads `process.env.EMAIL_PROVIDER` directly (the one documented exception to the "no direct `process.env`" rule):

```ts
// apps/api/src/auth/auth.module.ts
function chooseEmailProviderClass(): Type<IEmailProvider> {
  return (process.env['EMAIL_PROVIDER'] ?? 'mailpit').toLowerCase() === 'resend'
    ? ResendEmailProvider
    : MailpitEmailProvider;
}
const EmailProviderClass = chooseEmailProviderClass();
// …bound to the library's injection token:
// { provide: BYMAX_AUTH_EMAIL_PROVIDER, useClass: EmailProviderClass }
```

To switch transports, set the env var and restart:

| `EMAIL_PROVIDER`    | Bound class            | Transport        |
| ------------------- | ---------------------- | ---------------- |
| `mailpit` (default) | `MailpitEmailProvider` | SMTP → Mailpit   |
| `resend`            | `ResendEmailProvider`  | Resend HTTPS API |

`resend` additionally requires `RESEND_API_KEY`, and `mailpit` is **rejected in production** by the env schema. See [environment](./ENVIRONMENT.md) and [the production refinements](./ENVIRONMENT.md#production-refinements).

---

## Transactional emails

Every method of `IEmailProvider`, as implemented by [`MailpitEmailProvider`](../apps/api/src/auth/mailpit-email.provider.ts) (Resend mirrors these):

| Method                        | Subject                                | Template               | Fires on                           | FCM row              |
| ----------------------------- | -------------------------------------- | ---------------------- | ---------------------------------- | -------------------- |
| `sendEmailVerificationOtp`    | Verify your email address              | `verify-email`         | Registration / resend verification | [#5](./FEATURES.md)  |
| `sendPasswordResetToken`      | Reset your password                    | `password-reset-token` | Forgot password (token mode)       | [#6](./FEATURES.md)  |
| `sendPasswordResetOtp`        | Your password reset code               | `password-reset-otp`   | Forgot password (OTP mode)         | [#7](./FEATURES.md)  |
| `sendMfaEnabledNotification`  | Two-factor authentication enabled      | `mfa-enabled`          | After MFA enrollment is confirmed  | [#8](./FEATURES.md)  |
| `sendMfaDisabledNotification` | Two-factor authentication disabled     | `mfa-disabled`         | After MFA is disabled              | [#11](./FEATURES.md) |
| `sendNewSessionAlert`         | New sign-in detected on your account   | `new-session-alert`    | Each fresh login (new session)     | [#15](./FEATURES.md) |
| `sendInvitation`              | You've been invited to join _{tenant}_ | `invitation`           | Admin invites a teammate           | [#21](./FEATURES.md) |

Reset and invitation links are built from the validated `WEB_ORIGIN` and point at the public auth pages — e.g. the reset link is `${WEB_ORIGIN}/auth/reset-password?mode=token&email=…&tenantId=…&token=…` and the invite link is `${WEB_ORIGIN}/auth/accept-invitation?token=…`.

> **Security.** The provider logs only the subject and recipient — never the body, OTP, token, or session hash. Template variables from user input are HTML-escaped; pre-built URLs are not (escaping `&` would break `href`s). The invitation subject strips CRLF to prevent SMTP header injection.

---

## Templates

Templates are plain HTML with `{{variable}}` placeholders, preloaded into memory at construction. The provider enforces an **allowlist** of template names (prevents path traversal) — currently:

```
apps/api/src/auth/email-templates/
├── verify-email.html
├── password-reset-token.html
├── password-reset-otp.html
├── mfa-enabled.html
├── mfa-disabled.html
├── new-session-alert.html
└── invitation.html
```

### Overriding a template's markup

Edit the corresponding `.html` file. The provider copies these into `dist/` at build time (configured in `nest-cli.json` asset rules), so changes apply on the next build.

### Overriding rendering behaviour

Subclass the provider and override `render()` or a specific `send*` method, then bind your subclass to `BYMAX_AUTH_EMAIL_PROVIDER`:

```ts
@Injectable()
class BrandedEmailProvider extends ResendEmailProvider {
  // override sendInvitation(), inject a layout wrapper, etc.
}
```

### Registering a fully custom provider

Implement the `IEmailProvider` interface and bind it in [`auth.module.ts`](../apps/api/src/auth/auth.module.ts) `extraProviders`:

```ts
{ provide: BYMAX_AUTH_EMAIL_PROVIDER, useClass: MyCustomEmailProvider }
```

This is exactly the FCM #31 pattern — the library never assumes a concrete transport.

---

## Locales

Every `send*` method accepts an optional BCP 47 `locale` argument. It is currently unused — this example ships a single (English) locale and the wording lives entirely in the HTML templates.

To add a locale:

1. Add per-locale template files (e.g. `verify-email.es.html`) and extend the allowlist.
2. In `render()`, select the file by the `locale` argument with a safe fallback to the default.
3. Keep all user-facing strings in the templates — never inline copy into the provider code.

---

## Production considerations

When `EMAIL_PROVIDER=resend`:

- `SMTP_FROM` must be a sender address **verified** in the Resend dashboard.
- Configure DNS for your sending domain: **SPF**, **DKIM**, and **DMARC**. Without them, mail lands in spam or is rejected.
- Keep `RESEND_API_KEY` in the secret store, never in the repo.

Full production steps are in the [deployment guide](./DEPLOYMENT.md#email-dns).

---

## Further reading

- [Environment](./ENVIRONMENT.md) — `EMAIL_PROVIDER`, `SMTP_*`, `RESEND_API_KEY`, `SMTP_FROM`.
- [Features](./FEATURES.md) — the flows that trigger each email, with Mailpit screenshots.
- [Deployment](./DEPLOYMENT.md) — DNS records and the production email checklist.
- [Getting started](./GETTING_STARTED.md) — viewing captured mail in Mailpit.
