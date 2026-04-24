/**
 * @file env.schema.ts
 * @description Zod validation schema for all environment variables consumed by `apps/api`.
 *
 * Every variable is declared here exactly once. `ConfigService<Env, true>` (strict mode)
 * is the single access point for env values at runtime — no `process.env.*` reads in
 * application code.
 *
 * Boot aborts with a descriptive error when a required variable is missing or violates
 * its constraints. Optional variables are explicitly `.optional()` or carry a `.default()`.
 *
 * @layer config
 * @see docs/guidelines/environment-guidelines.md
 * @see docs/DEVELOPMENT_PLAN.md Appendix A
 */

import { z } from 'zod';

/** Base object schema — all fields without cross-field constraints. */
const base = z.object({
  // ---------------------------------------------------------------------------
  // Shared
  // ---------------------------------------------------------------------------
  /** Runtime environment. Defaults to `development` so local dev never requires the var. */
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development')
    .describe('Runtime environment'),

  /** Pino log level. Defaults to `info`. */
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info')
    .describe('Pino log level'),

  // ---------------------------------------------------------------------------
  // HTTP server
  // ---------------------------------------------------------------------------
  /** TCP port the API listens on. Defaults to `4000`. */
  API_PORT: z.coerce
    .number()
    .int()
    .positive()
    .max(65535)
    .default(4000)
    .describe('TCP port for the NestJS HTTP server'),

  /** Browser-visible frontend origin used for CORS. */
  WEB_ORIGIN: z.string().url().describe('Frontend origin for CORS allowlist'),

  // ---------------------------------------------------------------------------
  // Database
  // ---------------------------------------------------------------------------
  /** PostgreSQL connection URL for the application database. */
  DATABASE_URL: z.string().url().describe('PostgreSQL connection URL'),

  /** PostgreSQL connection URL for the test database (CI / e2e). */
  DATABASE_URL_TEST: z
    .string()
    .url()
    .optional()
    .describe('PostgreSQL connection URL for the test database (e2e)'),

  // ---------------------------------------------------------------------------
  // Redis
  // ---------------------------------------------------------------------------
  /** Redis connection URL consumed by `ioredis` and forwarded to `BymaxAuthModule`. */
  REDIS_URL: z.string().url().describe('ioredis connection URL'),

  /** Key namespace prefix for all library-owned Redis keys. Defaults to `nest-auth-example`. */
  REDIS_NAMESPACE: z
    .string()
    .min(1)
    .default('nest-auth-example')
    .describe('Redis key namespace shared with @bymax-one/nest-auth'),

  // ---------------------------------------------------------------------------
  // Auth secrets
  // ---------------------------------------------------------------------------
  /**
   * HS256 signing secret for JWT access and refresh tokens.
   *
   * Must be at least 64 hex characters (32 bytes) with sufficient entropy.
   * Generate via: `openssl rand -hex 64`
   */
  JWT_SECRET: z
    .string()
    .min(64, 'JWT_SECRET must be at least 64 characters — use `openssl rand -hex 64`')
    .refine(
      (v) => new Set(v).size >= 16,
      'JWT_SECRET appears to be a low-entropy placeholder — use `openssl rand -hex 64`',
    )
    .describe('HS256 JWT signing secret'),

  /**
   * AES-256 encryption key for TOTP secrets stored in the database.
   *
   * Must be a base64-encoded 32-byte value. Generate via:
   * `openssl rand -base64 32`
   */
  MFA_ENCRYPTION_KEY: z
    .string()
    .regex(/^[A-Za-z0-9+/=]+$/, 'MFA_ENCRYPTION_KEY must be a valid base64 string')
    .refine(
      (v) => Buffer.from(v, 'base64').length === 32,
      'MFA_ENCRYPTION_KEY must decode to exactly 32 bytes',
    )
    .describe('AES-256 key for TOTP secret encryption'),

  // ---------------------------------------------------------------------------
  // Email
  // ---------------------------------------------------------------------------
  /**
   * Email delivery backend.
   *
   * `mailpit` (default) is for local dev only — rejected in production.
   * `resend` requires `RESEND_API_KEY` to be set.
   */
  EMAIL_PROVIDER: z
    .enum(['mailpit', 'resend'])
    .default('mailpit')
    .describe('Email delivery backend: mailpit (dev) | resend (prod)'),

  /** SMTP server hostname for Mailpit. Defaults to `localhost`. */
  SMTP_HOST: z
    .string()
    .min(1)
    .default('localhost')
    .describe('SMTP hostname (Mailpit dev default: localhost)'),

  /** SMTP server port for Mailpit. Defaults to `1025`. */
  SMTP_PORT: z.coerce
    .number()
    .int()
    .positive()
    .default(1025)
    .describe('SMTP port (Mailpit dev default: 1025)'),

  /**
   * Sender address for all outbound emails — used by both Mailpit and Resend providers.
   *
   * When `EMAIL_PROVIDER=resend` this address must be verified in the Resend dashboard.
   * The default is for local dev only; set a real verified address for production.
   */
  SMTP_FROM: z
    .email()
    .default('no-reply@nest-auth-example.dev')
    .describe('Sender address for all outbound emails (must be Resend-verified in production)'),

  /** Resend API key. Required only when `EMAIL_PROVIDER=resend`. */
  RESEND_API_KEY: z
    .string()
    .optional()
    .describe('Resend API key — required when EMAIL_PROVIDER=resend'),

  // ---------------------------------------------------------------------------
  // OAuth (optional — both vars required together to enable Google OAuth)
  // ---------------------------------------------------------------------------
  /** Google OAuth client ID. Both ID and secret must be set to enable OAuth. */
  OAUTH_GOOGLE_CLIENT_ID: z
    .string()
    .optional()
    .describe('Google OAuth client ID — set both ID and secret to enable OAuth'),

  /** Google OAuth client secret. Both ID and secret must be set to enable OAuth. */
  OAUTH_GOOGLE_CLIENT_SECRET: z.string().optional().describe('Google OAuth client secret'),

  /** Google OAuth redirect URL. Required when OAuth is enabled. */
  OAUTH_GOOGLE_CALLBACK_URL: z
    .string()
    .url()
    .optional()
    .describe('Google OAuth redirect URL — required when OAuth is enabled'),

  // ---------------------------------------------------------------------------
  // Password reset
  // ---------------------------------------------------------------------------
  /**
   * Password reset delivery method.
   *
   * `token` (default) sends a signed link; `otp` sends a short numeric code.
   * Both modes are available in this example to cover FCM rows #6 and #7.
   */
  PASSWORD_RESET_METHOD: z
    .enum(['token', 'otp'])
    .default('token')
    .describe('Password reset method: token (link via email) | otp (numeric code via email)'),

  // ---------------------------------------------------------------------------
  // Cookie domain (production only)
  // ---------------------------------------------------------------------------
  /**
   * Public domain used by `cookies.resolveDomains` to set the cookie `Domain`
   * attribute for all sub-domains (e.g. `example.com` → cookie on `.example.com`).
   *
   * Only effective in production and only when set. Leave unset in local dev.
   */
  PUBLIC_DOMAIN: z
    .string()
    .min(1)
    .optional()
    .describe('Public apex domain for cookie domain resolution in production'),
});

/**
 * Full environment schema with cross-field refinements.
 *
 * Refinements enforce:
 * - `mailpit` is rejected in `production`
 * - `RESEND_API_KEY` is required when `EMAIL_PROVIDER=resend`
 * - Google OAuth client ID and secret must be set together
 */
export const envSchema = base.superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && !env.WEB_ORIGIN.startsWith('https://')) {
    ctx.addIssue({
      code: 'custom',
      path: ['WEB_ORIGIN'],
      message: 'WEB_ORIGIN must use https:// in production',
    });
  }

  if (env.NODE_ENV === 'production' && env.EMAIL_PROVIDER === 'mailpit') {
    ctx.addIssue({
      code: 'custom',
      path: ['EMAIL_PROVIDER'],
      message: 'EMAIL_PROVIDER=mailpit is not allowed in production — use resend',
    });
  }

  if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['RESEND_API_KEY'],
      message: 'RESEND_API_KEY is required when EMAIL_PROVIDER=resend',
    });
  }

  if (Boolean(env.OAUTH_GOOGLE_CLIENT_ID) !== Boolean(env.OAUTH_GOOGLE_CLIENT_SECRET)) {
    ctx.addIssue({
      code: 'custom',
      path: ['OAUTH_GOOGLE_CLIENT_ID'],
      message:
        'OAUTH_GOOGLE_CLIENT_ID and OAUTH_GOOGLE_CLIENT_SECRET must both be set or both be unset',
    });
  }

  if (env.OAUTH_GOOGLE_CLIENT_ID && !env.OAUTH_GOOGLE_CALLBACK_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['OAUTH_GOOGLE_CALLBACK_URL'],
      message: 'OAUTH_GOOGLE_CALLBACK_URL is required when OAuth is enabled',
    });
  }
});

/** Inferred type of the validated environment object. */
export type Env = z.infer<typeof envSchema>;
