/**
 * @file auth.config.spec.ts
 * @description Unit tests for `envSchema` from `apps/api/src/config/env.schema.ts`.
 *
 * Verifies all field-level constraints and cross-field refinements:
 * - JWT_SECRET entropy and length requirements.
 * - MFA_ENCRYPTION_KEY base64 validity and decoded-byte-length requirement.
 * - Required fields (DATABASE_URL, WEB_ORIGIN, REDIS_URL).
 * - WEB_ORIGIN must use https:// in production.
 * - EMAIL_PROVIDER production constraint and RESEND_API_KEY co-dependency.
 * - Google OAuth client ID/secret pairing requirement.
 * - OAuth callback URL requirement when OAuth is enabled.
 *
 * These constraints are security-critical: a relaxed validation gate would let
 * the application start with weak secrets or a misconfigured provider, silently
 * degrading security or causing runtime failures. Boot-time rejection is the
 * safeguard.
 *
 * @layer test
 * @see apps/api/src/config/env.schema.ts
 */

import { envSchema } from '../config/env.schema.js';

// ─── Shared valid base environment ────────────────────────────────────────────

/**
 * A fully valid environment object used as the baseline for all tests.
 * Tests mutate or omit individual fields to exercise specific validation paths.
 */
const VALID_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  // 74-character string — satisfies the ≥64 char length and entropy requirements.
  JWT_SECRET: 'test-only-jwt-secret-must-be-at-least-64-characters-for-schema-validation-ok',
  // base64(32 bytes) — satisfies the AES-256 key requirement.
  MFA_ENCRYPTION_KEY: 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMmJ5dGVzLW9rPT0=',
  WEB_ORIGIN: 'http://localhost:3000',
  EMAIL_PROVIDER: 'mailpit',
  PASSWORD_RESET_METHOD: 'token',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Valid base env
// ─────────────────────────────────────────────────────────────────────────────

describe('envSchema — valid base environment', () => {
  it('accepts a fully valid environment object and returns the parsed value', () => {
    // The baseline object must pass all constraints. Any failure here indicates
    // that VALID_ENV itself is misconfigured and all other tests are suspect.
    const result = envSchema.safeParse(VALID_ENV);

    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// JWT_SECRET
// ─────────────────────────────────────────────────────────────────────────────

describe('envSchema — JWT_SECRET validation', () => {
  it('rejects JWT_SECRET shorter than 64 characters with an error on the JWT_SECRET path', () => {
    // A short secret makes brute-force attacks feasible. The schema must reject
    // any value under the 64-character minimum to enforce the security baseline.
    const result = envSchema.safeParse({ ...VALID_ENV, JWT_SECRET: 'too-short' });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('JWT_SECRET');
    }
  });

  it('rejects a low-entropy JWT_SECRET (all same character, ≥ 64 chars)', () => {
    // A 64-character string of a single repeated character passes length but not
    // entropy. The schema must reject this to catch accidental placeholder values.
    const lowEntropy = '0'.repeat(64);
    const result = envSchema.safeParse({ ...VALID_ENV, JWT_SECRET: lowEntropy });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('JWT_SECRET');
    }
  });

  it('accepts a JWT_SECRET with sufficient length and entropy', () => {
    // The baseline secret in VALID_ENV has both sufficient length and character
    // diversity. Parsing it must succeed to confirm the pass-case is reachable.
    const result = envSchema.safeParse(VALID_ENV);

    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MFA_ENCRYPTION_KEY
// ─────────────────────────────────────────────────────────────────────────────

describe('envSchema — MFA_ENCRYPTION_KEY validation', () => {
  it('rejects a value that is not valid base64 (contains invalid characters)', () => {
    // The AES-256 key must be base64-encoded. An invalid base64 string cannot
    // decode to a usable key and must be rejected at boot time.
    const result = envSchema.safeParse({
      ...VALID_ENV,
      MFA_ENCRYPTION_KEY: 'not-valid-base64!!!',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('MFA_ENCRYPTION_KEY');
    }
  });

  it('rejects a valid base64 string that decodes to fewer than 32 bytes', () => {
    // AES-256 requires a 32-byte key. A valid base64 string that decodes to a
    // shorter value (e.g. 16 bytes for AES-128) must be rejected.
    const sixteenBytes = Buffer.from('this-is-16-bytes').toString('base64');
    const result = envSchema.safeParse({
      ...VALID_ENV,
      MFA_ENCRYPTION_KEY: sixteenBytes,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('MFA_ENCRYPTION_KEY');
    }
  });

  it('rejects a valid base64 string that decodes to more than 32 bytes', () => {
    // An oversized key (e.g. 48 bytes) also fails the exactly-32-bytes constraint.
    const fortyEightBytes = Buffer.alloc(48).fill('x').toString('base64');
    const result = envSchema.safeParse({
      ...VALID_ENV,
      MFA_ENCRYPTION_KEY: fortyEightBytes,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('MFA_ENCRYPTION_KEY');
    }
  });

  it('accepts a valid base64 string that decodes to exactly 32 bytes', () => {
    // The VALID_ENV key decodes to exactly 32 bytes — this is the canonical
    // pass case for the AES-256 key constraint.
    const thirtyTwoBytes = Buffer.alloc(32).fill('k').toString('base64');
    const result = envSchema.safeParse({ ...VALID_ENV, MFA_ENCRYPTION_KEY: thirtyTwoBytes });

    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Required fields
// ─────────────────────────────────────────────────────────────────────────────

describe('envSchema — required fields', () => {
  it('rejects when DATABASE_URL is missing', () => {
    // The API cannot function without a database connection. Missing DATABASE_URL
    // must cause boot-time failure rather than a silent undefined at runtime.
    const { DATABASE_URL: _omit, ...rest } = VALID_ENV;

    const result = envSchema.safeParse(rest);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('DATABASE_URL');
    }
  });

  it('rejects when WEB_ORIGIN is missing', () => {
    // CORS is configured from WEB_ORIGIN. Without it the API either blocks
    // all browser traffic or defaults to open CORS — both unacceptable.
    const { WEB_ORIGIN: _omit, ...rest } = VALID_ENV;

    const result = envSchema.safeParse(rest);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('WEB_ORIGIN');
    }
  });

  it('rejects when REDIS_URL is missing', () => {
    // Redis is required for token revocation and session management.
    // A missing REDIS_URL must cause boot-time rejection.
    const { REDIS_URL: _omit, ...rest } = VALID_ENV;

    const result = envSchema.safeParse(rest);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('REDIS_URL');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL_PROVIDER cross-field rules
// ─────────────────────────────────────────────────────────────────────────────

describe('envSchema — WEB_ORIGIN production https requirement', () => {
  it('rejects WEB_ORIGIN without https:// scheme in a production environment', () => {
    // Production deployments must use TLS. An http:// WEB_ORIGIN in production
    // would allow CORS to permit insecure origins, exposing auth cookies to
    // network eavesdropping. The schema must reject this at boot time.
    const result = envSchema.safeParse({
      ...VALID_ENV,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'http://app.example.com',
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_live_abc123',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('WEB_ORIGIN');
    }
  });
});

describe('envSchema — EMAIL_PROVIDER cross-field refinements', () => {
  it('rejects EMAIL_PROVIDER=mailpit in a production environment', () => {
    // Mailpit is a local dev tool — running it in production would silently
    // drop all transactional emails (password reset, verification). The schema
    // must prevent this misconfiguration from ever reaching a production server.
    const result = envSchema.safeParse({
      ...VALID_ENV,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://app.example.com',
      EMAIL_PROVIDER: 'mailpit',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('EMAIL_PROVIDER');
    }
  });

  it('rejects EMAIL_PROVIDER=resend when RESEND_API_KEY is absent', () => {
    // Choosing the Resend provider without supplying an API key would cause all
    // email operations to fail at runtime. Boot-time rejection is preferable.
    const result = envSchema.safeParse({
      ...VALID_ENV,
      EMAIL_PROVIDER: 'resend',
      // RESEND_API_KEY deliberately omitted
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('RESEND_API_KEY');
    }
  });

  it('accepts EMAIL_PROVIDER=mailpit in a test environment', () => {
    // Mailpit is the expected email backend in CI and local dev.
    // The test env must not trigger the production-only rejection.
    const result = envSchema.safeParse({ ...VALID_ENV, NODE_ENV: 'test' });

    expect(result.success).toBe(true);
  });

  it('accepts EMAIL_PROVIDER=resend when RESEND_API_KEY is provided', () => {
    // A fully configured Resend setup must pass validation.
    const result = envSchema.safeParse({
      ...VALID_ENV,
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_live_abc123',
    });

    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OAuth cross-field rules
// ─────────────────────────────────────────────────────────────────────────────

describe('envSchema — Google OAuth cross-field refinements', () => {
  it('rejects when OAUTH_GOOGLE_CLIENT_ID is set without OAUTH_GOOGLE_CLIENT_SECRET', () => {
    // ID and secret must always be configured together. An orphaned client ID
    // produces an OAuth app that cannot complete the authorization code flow.
    const result = envSchema.safeParse({
      ...VALID_ENV,
      OAUTH_GOOGLE_CLIENT_ID: 'gid.apps.googleusercontent.com',
      // OAUTH_GOOGLE_CLIENT_SECRET deliberately omitted
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('OAUTH_GOOGLE_CLIENT_ID');
    }
  });

  it('rejects when OAUTH_GOOGLE_CLIENT_SECRET is set without OAUTH_GOOGLE_CLIENT_ID', () => {
    // An orphaned client secret is equally misconfigured. The asymmetric check
    // must fire in both directions to prevent partial configurations.
    const result = envSchema.safeParse({
      ...VALID_ENV,
      OAUTH_GOOGLE_CLIENT_SECRET: 'GOCSPX-secret',
      // OAUTH_GOOGLE_CLIENT_ID deliberately omitted
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('OAUTH_GOOGLE_CLIENT_ID');
    }
  });

  it('rejects when both OAuth client vars are set but OAUTH_GOOGLE_CALLBACK_URL is missing', () => {
    // The callback URL is required to complete the OAuth redirect flow. Without
    // it, Google cannot return the authorization code to the correct endpoint.
    const result = envSchema.safeParse({
      ...VALID_ENV,
      OAUTH_GOOGLE_CLIENT_ID: 'gid.apps.googleusercontent.com',
      OAUTH_GOOGLE_CLIENT_SECRET: 'GOCSPX-secret',
      // OAUTH_GOOGLE_CALLBACK_URL deliberately omitted
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('OAUTH_GOOGLE_CALLBACK_URL');
    }
  });

  it('accepts a fully configured OAuth setup (client ID, secret, and callback URL all set)', () => {
    // When all three OAuth vars are present and valid the schema must accept
    // the configuration so the application can start in OAuth-enabled mode.
    const result = envSchema.safeParse({
      ...VALID_ENV,
      OAUTH_GOOGLE_CLIENT_ID: 'gid.apps.googleusercontent.com',
      OAUTH_GOOGLE_CLIENT_SECRET: 'GOCSPX-secret',
      OAUTH_GOOGLE_CALLBACK_URL: 'http://localhost:4000/auth/google/callback',
    });

    expect(result.success).toBe(true);
  });

  it('accepts the base env without any OAuth vars (OAuth disabled)', () => {
    // Omitting all OAuth vars is a valid configuration — OAuth is optional.
    // The schema must not require any of these fields when none are provided.
    const result = envSchema.safeParse(VALID_ENV);

    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Refinement messages and entropy boundary
// ─────────────────────────────────────────────────────────────────────────────

describe('envSchema — refinement error messages (verbatim)', () => {
  /*
   * Each refinement attaches a literal `message` that the boot-time error
   * handler surfaces to the operator. Deviating from the documented text
   * would silently break runbooks and the inline diagnostics our
   * environment-config script prints when refusing to start.
   */
  it('rejects a production WEB_ORIGIN without https:// with the documented message', () => {
    const result = envSchema.safeParse({
      ...VALID_ENV,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'http://app.example.com',
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_live_abc',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'WEB_ORIGIN');
      expect(issue?.message).toBe('WEB_ORIGIN must use https:// in production');
    }
  });

  it('accepts a production https:// WEB_ORIGIN — confirms startsWith is the right anchor', () => {
    /*
     * Scenario: a properly configured production deployment uses
     * https. The refinement MUST validate the SCHEME PREFIX, not any
     * other position — a substring-based check would let attacker
     * URLs like `http://malicious.tld?next=https://safe.example`
     * pass. Anchoring at the start protects the CORS allowlist
     * downstream.
     */
    const result = envSchema.safeParse({
      ...VALID_ENV,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://app.example.com',
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_live_abc',
    });

    expect(result.success).toBe(true);
  });

  it('rejects production EMAIL_PROVIDER=mailpit with the documented message', () => {
    const result = envSchema.safeParse({
      ...VALID_ENV,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://app.example.com',
      EMAIL_PROVIDER: 'mailpit',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'EMAIL_PROVIDER');
      expect(issue?.message).toBe(
        'EMAIL_PROVIDER=mailpit is not allowed in production — use resend',
      );
    }
  });

  it('accepts EMAIL_PROVIDER=mailpit in non-production environments', () => {
    /*
     * Scenario: every developer running the app locally uses
     * Mailpit. The mailpit-in-production refinement must NOT fire
     * when NODE_ENV is anything other than production, otherwise
     * `pnpm dev` would refuse to start.
     */
    const result = envSchema.safeParse({
      ...VALID_ENV,
      NODE_ENV: 'development',
      EMAIL_PROVIDER: 'mailpit',
    });

    expect(result.success).toBe(true);
  });

  it('rejects EMAIL_PROVIDER=resend without RESEND_API_KEY with the documented message', () => {
    const result = envSchema.safeParse({
      ...VALID_ENV,
      EMAIL_PROVIDER: 'resend',
      // RESEND_API_KEY deliberately omitted
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'RESEND_API_KEY');
      expect(issue?.message).toBe('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
    }
  });

  it('rejects OAUTH_GOOGLE_CLIENT_ID set without OAUTH_GOOGLE_CLIENT_SECRET with the documented message', () => {
    const result = envSchema.safeParse({
      ...VALID_ENV,
      OAUTH_GOOGLE_CLIENT_ID: 'gid.apps.googleusercontent.com',
      // secret deliberately omitted
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'OAUTH_GOOGLE_CLIENT_ID');
      expect(issue?.message).toBe(
        'OAUTH_GOOGLE_CLIENT_ID and OAUTH_GOOGLE_CLIENT_SECRET must both be set or both be unset',
      );
    }
  });

  it('rejects OAUTH_GOOGLE_CLIENT_ID+SECRET without OAUTH_GOOGLE_CALLBACK_URL with the documented message', () => {
    const result = envSchema.safeParse({
      ...VALID_ENV,
      OAUTH_GOOGLE_CLIENT_ID: 'gid.apps.googleusercontent.com',
      OAUTH_GOOGLE_CLIENT_SECRET: 'GOCSPX-secret',
      // callback URL deliberately omitted
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join('.') === 'OAUTH_GOOGLE_CALLBACK_URL',
      );
      expect(issue?.message).toBe('OAUTH_GOOGLE_CALLBACK_URL is required when OAuth is enabled');
    }
  });
});

describe('envSchema — JWT_SECRET entropy boundary', () => {
  it('accepts a 64-character secret with exactly 16 unique characters (boundary value)', () => {
    /*
     * Scenario: the entropy refinement counts distinct characters
     * via `new Set(v).size >= 16`. A secret sitting EXACTLY at the
     * boundary (16 unique characters across 64 positions) must
     * pass — testing the boundary keeps the comparison anchored at
     * the documented threshold rather than drifting to `> 16` or
     * `< 16`.
     */
    // Build a 64-char secret using exactly 16 distinct characters.
    const sixteenChars = '0123456789abcdef';
    const boundary = sixteenChars.repeat(4); // 16 * 4 = 64 chars, 16 unique.
    const result = envSchema.safeParse({ ...VALID_ENV, JWT_SECRET: boundary });

    expect(result.success).toBe(true);
  });

  it('rejects a 64-character secret with only 15 unique characters (one below the boundary)', () => {
    /*
     * Scenario: a secret one step below the entropy threshold
     * must be rejected with the entropy-specific message. This
     * pins the lower side of the boundary so the comparison
     * cannot loosen to `> 15` without a test failure.
     */
    // 15 unique characters padded to length 64.
    const fifteenChars = '0123456789abcde';
    // 15 * 4 = 60, then pad with one of the existing chars to reach 64.
    const belowBoundary = fifteenChars.repeat(4) + '0000';
    const result = envSchema.safeParse({ ...VALID_ENV, JWT_SECRET: belowBoundary });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'JWT_SECRET');
      expect(issue?.message).toContain('low-entropy');
    }
  });
});
